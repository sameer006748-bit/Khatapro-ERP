-- ============================================================================
-- KhataPro ERP — Phase 3 Products & Stock Migration
-- Target: Supabase Postgres
--
-- This migration adds the products & stock module:
--   - product_categories (active/inactive)
--   - products (item name, category, unit=piece, sale/purchase price,
--     opening stock, is_temporary, active/inactive)
--   - stock_movements (opening, adjustment_in, adjustment_out,
--     temporary_item, correction)
--
-- Design rules from the master prompt:
--   * Negative stock is ALLOWED — never block a stock-out.
--   * Every stock in/out/adjustment creates a stock_movements row.
--   * Phase 3 does NOT post COGS or sales vouchers — stock movements are
--     inventory-only in this phase.
--   * business_id on every table (multi-tenant-ready).
--   * RLS enabled on every table.
--
-- Money columns use numeric(14,2) for prices (PKR with 2 decimal places).
-- Quantities use integer (pieces).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. product_categories
-- ----------------------------------------------------------------------------
create table if not exists public.product_categories (
  id          text primary key default gen_random_uuid()::text,
  business_id text not null references public.business(id) on delete cascade,
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (business_id, name)
);
create index if not exists product_categories_biz_idx on public.product_categories(business_id);

-- ----------------------------------------------------------------------------
-- 2. products
-- ----------------------------------------------------------------------------
create table if not exists public.products (
  id             text primary key default gen_random_uuid()::text,
  business_id    text not null references public.business(id) on delete cascade,
  name           text not null,
  category_id    text references public.product_categories(id) on delete set null,
  unit           text not null default 'piece',
  sale_price     numeric(14,2) not null default 0,
  purchase_price numeric(14,2) not null default 0,
  -- running stock — derived from stock_movements, but cached here for fast
  -- list queries. Updated atomically by the create_stock_movement() RPC.
  -- Negative values are ALLOWED.
  current_stock  integer not null default 0,
  is_temporary   boolean not null default false,
  is_active      boolean not null default true,
  -- Merge foundation: when a temporary product is merged into a real one,
  -- this points to the canonical product. NULL = not yet merged.
  merged_into_id text references public.products(id) on delete set null,
  marked_for_merge boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists products_biz_idx on public.products(business_id);
create index if not exists products_category_idx on public.products(business_id, category_id);
create index if not exists products_temporary_idx on public.products(business_id, is_temporary);
create index if not exists products_stock_idx on public.products(business_id, current_stock);

-- ----------------------------------------------------------------------------
-- 3. stock_movements
-- ----------------------------------------------------------------------------
create table if not exists public.stock_movements (
  id             text primary key default gen_random_uuid()::text,
  business_id    text not null references public.business(id) on delete cascade,
  product_id     text not null references public.products(id) on delete cascade,
  movement_type  text not null,
  -- opening, adjustment_in, adjustment_out, temporary_item, correction
  -- (sale, purchase, return reserved for future phases — NOT built in Phase 3)
  quantity       integer not null,
  -- Signed delta: +N for in, -N for out. Stored separately from quantity
  -- so the report can show "5 out" not "-5".
  balance_after  integer not null,
  reason         text,
  movement_date  date not null default (now() at time zone 'Asia/Karachi')::date,
  created_by     uuid,  -- auth.users.id
  created_at     timestamptz not null default now(),
  -- Optional link to a voucher (for future phases when stock movements
  -- post COGS/sales vouchers). NULL in Phase 3.
  voucher_id     text references public.vouchers(id) on delete set null
);
create index if not exists stock_movements_product_idx on public.stock_movements(product_id);
create index if not exists stock_movements_biz_date_idx on public.stock_movements(business_id, movement_date desc);
create index if not exists stock_movements_type_idx on public.stock_movements(business_id, movement_type);

-- ----------------------------------------------------------------------------
-- 4. create_stock_movement() — the ONLY way to create a stock movement.
-- SECURITY DEFINER so it can update products.current_stock atomically.
-- Negative stock is ALLOWED — no blocking on stock-out.
-- ----------------------------------------------------------------------------
create or replace function public.create_stock_movement(
  p_business_id   text,
  p_product_id    text,
  p_movement_type text,
  p_quantity      integer,
  p_reason        text default null,
  p_movement_date date default null,
  p_created_by    uuid default null
)
returns text  -- the new stock_movement id
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement_id text;
  v_current     integer;
  v_delta       integer;
  v_balance_after integer;
  v_date        date;
begin
  -- Validate movement type.
  if p_movement_type not in ('opening', 'adjustment_in', 'adjustment_out', 'temporary_item', 'correction') then
    raise exception 'Invalid movement_type: %', p_movement_type;
  end if;

  -- Validate product belongs to the business.
  if not exists (
    select 1 from public.products p
    where p.id = p_product_id and p.business_id = p_business_id
  ) then
    raise exception 'Invalid or foreign product_id: %', p_product_id;
  end if;

  -- Validate quantity is positive.
  if p_quantity <= 0 then
    raise exception 'Quantity must be positive for type %', p_movement_type;
  end if;

  -- Compute signed delta.
  if p_movement_type = 'adjustment_out' then
    v_delta := -p_quantity;
  else
    -- opening, adjustment_in, temporary_item, correction
    v_delta := p_quantity;
  end if;

  -- Lock the product row and get current stock.
  select current_stock into v_current
  from public.products
  where id = p_product_id
  for update;

  v_balance_after := v_current + v_delta;
  v_date := coalesce(p_movement_date, (now() at time zone 'Asia/Karachi')::date);

  -- Insert the movement record.
  insert into public.stock_movements
    (business_id, product_id, movement_type, quantity, balance_after, reason, movement_date, created_by)
  values
    (p_business_id, p_product_id, p_movement_type, p_quantity, v_balance_after, p_reason, v_date, p_created_by)
  returning id into v_movement_id;

  -- Update the product's cached current_stock. Negative is allowed.
  update public.products
  set current_stock = v_balance_after,
      updated_at = now()
  where id = p_product_id;

  -- Audit entry.
  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'CREATE_STOCK_MOVEMENT', 'stock_movement', v_movement_id,
    jsonb_build_object(
      'product_id', p_product_id,
      'movement_type', p_movement_type,
      'quantity', p_quantity,
      'delta', v_delta,
      'balance_after', v_balance_after,
      'reason', p_reason
    ));

  return v_movement_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. negative_stock_report() — products with current_stock < 0.
-- ----------------------------------------------------------------------------
create or replace function public.negative_stock_report(
  p_business_id text
)
returns table (
  product_id text,
  product_name text,
  category_name text,
  current_stock integer,
  is_temporary boolean,
  last_movement_date date,
  last_movement_type text
)
language sql stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.name,
    pc.name,
    p.current_stock,
    p.is_temporary,
    (select sm.movement_date from public.stock_movements sm
     where sm.product_id = p.id
     order by sm.created_at desc limit 1),
    (select sm.movement_type from public.stock_movements sm
     where sm.product_id = p.id
     order by sm.created_at desc limit 1)
  from public.products p
  left join public.product_categories pc on pc.id = p.category_id
  where p.business_id = p_business_id
    and p.current_stock < 0
    and p.is_active = true
  order by p.current_stock asc, p.name;
$$;

-- ----------------------------------------------------------------------------
-- 6. pending_stock_report() — products with negative stock OR zero stock
--    that have pending stock entry needs (i.e. sold before purchased).
--    For Phase 3, this returns products with stock <= 0 that have at least
--    one adjustment_out movement.
-- ----------------------------------------------------------------------------
create or replace function public.pending_stock_report(
  p_business_id text
)
returns table (
  product_id text,
  product_name text,
  category_name text,
  current_stock integer,
  is_temporary boolean,
  last_movement_date date,
  last_movement_type text,
  pending_qty integer
)
language sql stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.name,
    pc.name,
    p.current_stock,
    p.is_temporary,
    (select sm.movement_date from public.stock_movements sm
     where sm.product_id = p.id
     order by sm.created_at desc limit 1),
    (select sm.movement_type from public.stock_movements sm
     where sm.product_id = p.id
     order by sm.created_at desc limit 1),
    case when p.current_stock < 0 then abs(p.current_stock) else 0 end
  from public.products p
  left join public.product_categories pc on pc.id = p.category_id
  where p.business_id = p_business_id
    and p.is_active = true
    and (
      p.current_stock < 0
      or exists (
        select 1 from public.stock_movements sm
        where sm.product_id = p.id
          and sm.movement_type in ('adjustment_out', 'correction')
          and sm.quantity > 0
      )
    )
  order by p.current_stock asc, p.name;
$$;

-- ============================================================================
-- Row-Level Security
-- ============================================================================

alter table public.product_categories enable row level security;
alter table public.products          enable row level security;
alter table public.stock_movements   enable row level security;

-- product_categories: readable by members; managed by can_create_products.
drop policy if exists product_categories_select_own on public.product_categories;
create policy product_categories_select_own on public.product_categories
  for select using (business_id = public.current_business_id());

drop policy if exists product_categories_manage_perms on public.product_categories;
create policy product_categories_manage_perms on public.product_categories
  for all using (
    business_id = public.current_business_id()
    and public.has_permission('can_create_products')
  ) with check (
    business_id = public.current_business_id()
    and public.has_permission('can_create_products')
  );

-- products: readable by members; managed by can_create_products.
drop policy if exists products_select_own on public.products;
create policy products_select_own on public.products
  for select using (business_id = public.current_business_id());

drop policy if exists products_manage_perms on public.products;
create policy products_manage_perms on public.products
  for all using (
    business_id = public.current_business_id()
    and public.has_permission('can_create_products')
  ) with check (
    business_id = public.current_business_id()
    and public.has_permission('can_create_products')
  );

-- stock_movements: readable by members with can_view_products.
-- Insert must go through create_stock_movement() RPC (SECURITY DEFINER).
-- No direct INSERT policy for regular users.
drop policy if exists stock_movements_select_own on public.stock_movements;
create policy stock_movements_select_own on public.stock_movements
  for select using (
    business_id = public.current_business_id()
    and (public.has_permission('can_view_products')
         or public.has_permission('can_create_products'))
  );

-- CRITICAL: NO insert/update/delete policy on stock_movements for regular users.
-- The ONLY way to create a stock movement is via create_stock_movement() RPC.

-- Updated_at triggers
drop trigger if exists product_categories_touch on public.product_categories;
create trigger product_categories_touch before update on public.product_categories
  for each row execute function public.touch_updated_at();

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Done. Phase 3 products & stock module is live with:
--   ✓ product_categories (active/inactive)
--   ✓ products (with is_temporary, marked_for_merge, current_stock cache)
--   ✓ stock_movements (opening, adjustment_in/out, temporary_item, correction)
--   ✓ create_stock_movement() RPC with atomic stock update + audit
--   ✓ negative_stock_report() RPC
--   ✓ pending_stock_report() RPC
--   ✓ RLS on all tables
--   ✓ Negative stock ALLOWED (no blocking)
-- ============================================================================
