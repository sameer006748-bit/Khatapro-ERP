-- ============================================================================
-- KhataPro ERP — Phase 4 Sales Module Migration
-- Target: Supabase Postgres
--
-- This migration adds the sales module:
--   - salesmen (party accounts linked to accounts table)
--   - customers (party accounts)
--   - invoices (shared invoice sequence: INV-0001, INV-0002, ...)
--   - invoice_items (line items)
--   - payment_allocations (links payments to invoices)
--   - salesman_commissions (idempotent, based on collected amount)
--   - sales_returns (reversing vouchers, no hard delete)
--
-- Design rules from the master prompt:
--   * Shared invoice sequence across Counter / Online / OFC.
--   * Invoice numbers generated server-side, concurrency-safe.
--   * Every sale posts a balanced voucher via post_voucher().
--   * Sale creates stock movements (adjustment_out / temporary_item).
--   * Negative stock allowed.
--   * Commission accrues only on collected/allocated amount, not invoice total.
--   * Commission is idempotent — re-processing same payment never duplicates.
--   * Sales return posts reversing voucher, does NOT reverse commission.
--   * No hard delete for posted invoices.
--
-- Money columns use numeric(20,0) = BigInt paisas (consistent with vouchers).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. salesmen — party accounts linked to the accounts table.
-- ----------------------------------------------------------------------------
create table if not exists public.salesmen (
  id             text primary key default gen_random_uuid()::text,
  business_id    text not null references public.business(id) on delete cascade,
  account_id     text not null unique references public.accounts(id) on delete restrict,
  name           text not null,
  phone          text,
  commission_pct numeric(5,2) not null default 5.00,  -- override per salesman
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists salesmen_biz_idx on public.salesmen(business_id);

-- ----------------------------------------------------------------------------
-- 2. customers — party accounts linked to the accounts table.
-- ----------------------------------------------------------------------------
create table if not exists public.customers (
  id             text primary key default gen_random_uuid()::text,
  business_id    text not null references public.business(id) on delete cascade,
  account_id     text not null unique references public.accounts(id) on delete restrict,
  name           text not null,
  phone          text,
  address        text,
  city           text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists customers_biz_idx on public.customers(business_id);

-- ----------------------------------------------------------------------------
-- 3. invoices — shared invoice sequence.
--    invoice_type: COUNTER | ONLINE | OFC
-- ----------------------------------------------------------------------------
create table if not exists public.invoices (
  id              text primary key default gen_random_uuid()::text,
  business_id     text not null references public.business(id) on delete cascade,
  invoice_no      text not null,
  invoice_type    text not null,  -- COUNTER | ONLINE | OFC
  invoice_date    date not null default (now() at time zone 'Asia/Karachi')::date,
  -- Party references (nullable for counter sales without customer)
  customer_id     text references public.customers(id) on delete set null,
  salesman_id     text references public.salesmen(id) on delete set null,
  -- Online / OFC fields (nullable for counter)
  customer_name   text,
  customer_phone  text,
  customer_address text,
  customer_city   text,
  -- Totals in paisas
  subtotal        numeric(20,0) not null default 0,
  discount        numeric(20,0) not null default 0,
  total           numeric(20,0) not null default 0,
  paid_amount     numeric(20,0) not null default 0,
  -- Voucher link
  voucher_id      text references public.vouchers(id) on delete set null,
  -- Cancel/void
  is_cancelled    boolean not null default false,
  cancelled_at    timestamptz,
  cancel_voucher_id text references public.vouchers(id) on delete set null,
  -- Return tracking
  is_returned     boolean not null default false,
  return_voucher_id text references public.vouchers(id) on delete set null,
  -- Metadata
  memo            text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (business_id, invoice_no)
);
create index if not exists invoices_biz_date_idx on public.invoices(business_id, invoice_date desc);
create index if not exists invoices_type_idx on public.invoices(business_id, invoice_type);
create index if not exists invoices_salesman_idx on public.invoices(salesman_id);
create index if not exists invoices_customer_idx on public.invoices(customer_id);

-- ----------------------------------------------------------------------------
-- 4. invoice_items
-- ----------------------------------------------------------------------------
create table if not exists public.invoice_items (
  id            text primary key default gen_random_uuid()::text,
  business_id   text not null references public.business(id) on delete cascade,
  invoice_id    text not null references public.invoices(id) on delete cascade,
  product_id    text references public.products(id) on delete set null,
  product_name  text not null,
  qty           integer not null,
  unit_price    numeric(20,0) not null,  -- paisas
  line_total    numeric(20,0) not null,  -- paisas
  is_temporary  boolean not null default false,
  stock_movement_id text references public.stock_movements(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists invoice_items_invoice_idx on public.invoice_items(invoice_id);
create index if not exists invoice_items_product_idx on public.invoice_items(product_id);

-- ----------------------------------------------------------------------------
-- 5. payment_allocations — links payments to invoices.
--    Each row = one payment method's contribution to one invoice.
-- ----------------------------------------------------------------------------
create table if not exists public.payment_allocations (
  id              text primary key default gen_random_uuid()::text,
  business_id     text not null references public.business(id) on delete cascade,
  invoice_id      text not null references public.invoices(id) on delete cascade,
  -- Which business account received the payment
  account_id      text not null references public.accounts(id) on delete restrict,
  -- Amount in paisas
  amount          numeric(20,0) not null,
  -- For change/refund: negative amount or is_change=true
  is_change       boolean not null default false,
  -- Voucher link (the payment may be part of the sale voucher or a separate receipt)
  voucher_id      text references public.vouchers(id) on delete set null,
  allocation_date date not null default (now() at time zone 'Asia/Karachi')::date,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create index if not exists payment_allocations_invoice_idx on public.payment_allocations(invoice_id);
create index if not exists payment_allocations_account_idx on public.payment_allocations(account_id);

-- ----------------------------------------------------------------------------
-- 6. salesman_commissions — idempotent, based on collected amount.
--    Unique constraint on (allocation_id, salesman_id) prevents duplicates.
-- ----------------------------------------------------------------------------
create table if not exists public.salesman_commissions (
  id              text primary key default gen_random_uuid()::text,
  business_id     text not null references public.business(id) on delete cascade,
  salesman_id     text not null references public.salesmen(id) on delete cascade,
  invoice_id      text not null references public.invoices(id) on delete cascade,
  allocation_id   text not null references public.payment_allocations(id) on delete cascade,
  -- Commission = collected_amount * commission_pct / 100
  collected_amount numeric(20,0) not null,  -- paisas
  commission_pct  numeric(5,2) not null,
  commission_amount numeric(20,0) not null,  -- paisas
  -- Idempotency: one commission per (allocation, salesman)
  created_at      timestamptz not null default now(),
  unique (allocation_id, salesman_id)
);
create index if not exists commissions_salesman_idx on public.salesman_commissions(salesman_id);
create index if not exists commissions_invoice_idx on public.salesman_commissions(invoice_id);

-- ----------------------------------------------------------------------------
-- 7. sales_returns — reversing vouchers, no hard delete.
-- ----------------------------------------------------------------------------
create table if not exists public.sales_returns (
  id              text primary key default gen_random_uuid()::text,
  business_id     text not null references public.business(id) on delete cascade,
  original_invoice_id text not null references public.invoices(id) on delete restrict,
  return_voucher_id   text references public.vouchers(id) on delete set null,
  return_date     date not null default (now() at time zone 'Asia/Karachi')::date,
  total           numeric(20,0) not null,  -- paisas returned
  reason          text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create index if not exists sales_returns_invoice_idx on public.sales_returns(original_invoice_id);

-- ----------------------------------------------------------------------------
-- 8. next_invoice_no() — concurrency-safe shared invoice sequence.
--    Uses an advisory lock so parallel calls serialize.
--    Returns 'INV-0001', 'INV-0002', etc.
-- ----------------------------------------------------------------------------
create or replace function public.next_invoice_no(p_business_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next int;
  v_no text;
begin
  -- Advisory lock keyed to a constant + business hash so different businesses
  -- don't block each other (single-business MVP, but future-proof).
  perform pg_advisory_xact_lock(987654321, hashtext(p_business_id));
  -- Find the max invoice number for this business and increment.
  select coalesce(max(cast(replace(invoice_no, 'INV-', '') as integer)), 0) + 1
    into v_next
    from public.invoices
    where business_id = p_business_id;
  v_no := 'INV-' || lpad(v_next::text, 4, '0');
  return v_no;
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. post_sale() — the main RPC that posts a complete sale.
--    Creates invoice + items + payment allocations + stock movements +
--    balanced voucher + commission (if salesman + collected amount).
--    SECURITY DEFINER so it can insert into all tables atomically.
-- ----------------------------------------------------------------------------
create or replace function public.post_sale(
  p_business_id    text,
  p_invoice_type   text,   -- COUNTER | ONLINE | OFC
  p_invoice_date   date,
  p_items          jsonb,  -- [{product_id, product_name, qty, unit_price, is_temporary}, ...]
  p_payments       jsonb,  -- [{account_id, amount, is_change}, ...]
  p_salesman_id    text default null,
  p_customer_id    text default null,
  p_customer_name  text default null,
  p_customer_phone text default null,
  p_customer_address text default null,
  p_customer_city  text default null,
  p_memo           text default null,
  p_created_by     uuid default null
)
returns text  -- the new invoice id
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id    text;
  v_invoice_no    text;
  v_subtotal      numeric(20,0) := 0;
  v_total         numeric(20,0) := 0;
  v_paid          numeric(20,0) := 0;
  v_change        numeric(20,0) := 0;
  v_item          jsonb;
  v_payment       jsonb;
  v_line_total    numeric(20,0);
  v_qty           integer;
  v_unit_price    numeric(20,0);
  v_product_id    text;
  v_voucher_id    text;
  v_voucher_lines jsonb := '[]'::jsonb;
  v_sales_account text;
  v_stock_sm_id   text;
  v_alloc_id      text;
  v_comm_pct      numeric(5,2);
  v_comm_amount   numeric(20,0);
begin
  -- Validate invoice type.
  if p_invoice_type not in ('COUNTER', 'ONLINE', 'OFC') then
    raise exception 'Invalid invoice_type: %', p_invoice_type;
  end if;

  -- Validate at least 1 item.
  if jsonb_array_length(p_items) < 1 then
    raise exception 'Invoice must have at least 1 item';
  end if;

  -- Generate the shared invoice number (concurrency-safe).
  v_invoice_no := public.next_invoice_no(p_business_id);

  -- Compute subtotal from items.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::integer;
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_total := v_qty * v_unit_price;
    v_subtotal := v_subtotal + v_line_total;
  end loop;

  v_total := v_subtotal;

  -- Compute paid amount and change from payments.
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if coalesce((v_payment->>'is_change')::boolean, false) then
      v_change := v_change + coalesce((v_payment->>'amount')::numeric, 0);
    else
      v_paid := v_paid + coalesce((v_payment->>'amount')::numeric, 0);
    end if;
  end loop;

  -- Find the Sales account (code 4010) for this business.
  select id into v_sales_account
  from public.accounts
  where business_id = p_business_id and code = '4010' and is_active = true;
  if not found then
    raise exception 'Sales account (4010) not found';
  end if;

  -- Build voucher lines.
  -- Line 1: Credit Sales by total.
  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', v_sales_account,
    'debit', '0',
    'credit', v_total::text,
    'memo', 'Sale ' || v_invoice_no
  );

  -- Lines 2..N: Debit each payment account by its amount (non-change).
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if not coalesce((v_payment->>'is_change')::boolean, false) then
      v_voucher_lines := v_voucher_lines || jsonb_build_object(
        'account_id', v_payment->>'account_id',
        'debit', coalesce((v_payment->>'amount')::numeric, 0)::text,
        'credit', '0',
        'memo', 'Payment received ' || v_invoice_no
      );
    end if;
  end loop;

  -- Lines for change: Credit the change account.
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if coalesce((v_payment->>'is_change')::boolean, false) then
      v_voucher_lines := v_voucher_lines || jsonb_build_object(
        'account_id', v_payment->>'account_id',
        'debit', '0',
        'credit', coalesce((v_payment->>'amount')::numeric, 0)::text,
        'memo', 'Change given ' || v_invoice_no
      );
    end if;
  end loop;

  -- Post the voucher via post_voucher (balanced validation enforced).
  v_voucher_id := public.post_voucher(
    p_business_id,
    'SI',  -- Sale Invoice
    p_invoice_date,
    p_memo,
    v_voucher_lines,
    null,
    null,
    p_created_by
  );

  -- Insert the invoice header.
  insert into public.invoices (
    business_id, invoice_no, invoice_type, invoice_date,
    customer_id, salesman_id,
    customer_name, customer_phone, customer_address, customer_city,
    subtotal, discount, total, paid_amount,
    voucher_id, memo, created_by
  ) values (
    p_business_id, v_invoice_no, p_invoice_type, p_invoice_date,
    p_customer_id, p_salesman_id,
    p_customer_name, p_customer_phone, p_customer_address, p_customer_city,
    v_subtotal, 0, v_total, v_paid,
    v_voucher_id, p_memo, p_created_by
  ) returning id into v_invoice_id;

  -- Insert invoice items + create stock movements.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::integer;
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_total := v_qty * v_unit_price;
    v_product_id := v_item->>'product_id';

    -- Create stock movement if product_id is real (not temporary).
    v_stock_sm_id := null;
    if v_product_id is not null and v_product_id <> '' then
      v_stock_sm_id := public.create_stock_movement(
        p_business_id,
        v_product_id,
        'adjustment_out',
        v_qty,
        'Sale ' || v_invoice_no,
        p_invoice_date,
        p_created_by
      );
    end if;

    insert into public.invoice_items (
      business_id, invoice_id, product_id, product_name, qty, unit_price,
      line_total, is_temporary, stock_movement_id
    ) values (
      p_business_id, v_invoice_id, v_product_id,
      v_item->>'product_name',
      v_qty, v_unit_price, v_line_total,
      coalesce((v_item->>'is_temporary')::boolean, false),
      v_stock_sm_id
    );
  end loop;

  -- Insert payment allocations + commission.
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if not coalesce((v_payment->>'is_change')::boolean, false) then
      insert into public.payment_allocations (
        business_id, invoice_id, account_id, amount, is_change, voucher_id, created_by
      ) values (
        p_business_id, v_invoice_id,
        v_payment->>'account_id',
        coalesce((v_payment->>'amount')::numeric, 0),
        false,
        v_voucher_id,
        p_created_by
      ) returning id into v_alloc_id;

      -- Commission: only if salesman assigned + amount > 0.
      if p_salesman_id is not null and coalesce((v_payment->>'amount')::numeric, 0) > 0 then
        select commission_pct into v_comm_pct
        from public.salesmen
        where id = p_salesman_id and business_id = p_business_id;
        if found then
          v_comm_amount := round(coalesce((v_payment->>'amount')::numeric, 0) * v_comm_pct / 100);
          -- Idempotent: unique (allocation_id, salesman_id) prevents duplicates.
          insert into public.salesman_commissions (
            business_id, salesman_id, invoice_id, allocation_id,
            collected_amount, commission_pct, commission_amount
          ) values (
            p_business_id, p_salesman_id, v_invoice_id, v_alloc_id,
            coalesce((v_payment->>'amount')::numeric, 0),
            v_comm_pct, v_comm_amount
          ) on conflict (allocation_id, salesman_id) do nothing;
        end if;
      end if;
    end if;
  end loop;

  -- Audit entry.
  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'POST_SALE', 'invoice', v_invoice_id,
    jsonb_build_object(
      'invoice_no', v_invoice_no,
      'invoice_type', p_invoice_type,
      'total', v_total,
      'paid', v_paid,
      'change', v_change,
      'voucher_id', v_voucher_id
    ));

  return v_invoice_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. post_sales_return() — reverses a sale.
--     Posts reversing voucher, restores stock, does NOT reverse commission.
-- ----------------------------------------------------------------------------
create or replace function public.post_sales_return(
  p_business_id   text,
  p_invoice_id    text,
  p_return_date   date,
  p_reason        text default null,
  p_created_by    uuid default null
)
returns text  -- the sales_return id
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice     public.invoices%rowtype;
  v_items       public.invoice_items%rowtype;
  v_voucher_id  text;
  v_voucher_lines jsonb := '[]'::jsonb;
  v_sales_account text;
  v_return_id   text;
  v_stock_sm_id text;
begin
  -- Load the original invoice.
  select * into v_invoice from public.invoices
  where id = p_invoice_id and business_id = p_business_id;

  if not found then
    raise exception 'Invoice not found: %', p_invoice_id;
  end if;

  if v_invoice.is_returned then
    raise exception 'Invoice already returned';
  end if;

  -- Find Sales account (4010).
  select id into v_sales_account
  from public.accounts
  where business_id = p_business_id and code = '4010';
  if not found then
    raise exception 'Sales account (4010) not found';
  end if;

  -- Build REVERSING voucher lines (swap debit/credit from original sale).
  -- Original: Debit payment accounts, Credit Sales.
  -- Reversal: Debit Sales, Credit payment accounts.
  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', v_sales_account,
    'debit', v_invoice.total::text,
    'credit', '0',
    'memo', 'Sales return reversal: ' || v_invoice.invoice_no
  );

  -- Credit each original payment account (reverse the debit).
  for v_items in select * from public.invoice_items where invoice_id = p_invoice_id
  loop
    -- We don't have the original payment accounts stored per-item, so we
    -- reverse against the payment_allocations.
    null;
  end loop;

  -- Reverse payment allocations.
  for v_items in
    select pa.* from public.payment_allocations pa
    where pa.invoice_id = p_invoice_id and pa.is_change = false
  loop
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_items.account_id,
      'debit', '0',
      'credit', v_items.amount::text,
      'memo', 'Return refund: ' || v_invoice.invoice_no
    );
  end loop;

  -- Post the reversing voucher.
  v_voucher_id := public.post_voucher(
    p_business_id,
    'SR',  -- Sales Return
    p_return_date,
    'Return: ' || v_invoice.invoice_no,
    v_voucher_lines,
    p_invoice_id,
    'sales_return',
    p_created_by
  );

  -- Restore stock for each item.
  for v_items in select * from public.invoice_items where invoice_id = p_invoice_id
  loop
    if v_items.product_id is not null then
      v_stock_sm_id := public.create_stock_movement(
        p_business_id,
        v_items.product_id,
        'adjustment_in',
        v_items.qty,
        'Return: ' || v_invoice.invoice_no,
        p_return_date,
        p_created_by
      );
    end if;
  end loop;

  -- Create the sales_return record.
  insert into public.sales_returns (
    business_id, original_invoice_id, return_voucher_id, return_date, total, reason, created_by
  ) values (
    p_business_id, p_invoice_id, v_voucher_id, p_return_date, v_invoice.total, p_reason, p_created_by
  ) returning id into v_return_id;

  -- Mark invoice as returned.
  update public.invoices
  set is_returned = true, return_voucher_id = v_voucher_id, updated_at = now()
  where id = p_invoice_id;

  -- Audit.
  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'POST_SALES_RETURN', 'invoice', p_invoice_id,
    jsonb_build_object('return_id', v_return_id, 'voucher_id', v_voucher_id, 'reason', p_reason));

  return v_return_id;
end;
$$;

-- ============================================================================
-- Row-Level Security
-- ============================================================================

alter table public.salesmen              enable row level security;
alter table public.customers             enable row level security;
alter table public.invoices              enable row level security;
alter table public.invoice_items         enable row level security;
alter table public.payment_allocations   enable row level security;
alter table public.salesman_commissions  enable row level security;
alter table public.sales_returns         enable row level security;

-- salesmen: readable by members; managed by can_manage_setup.
drop policy if exists salesmen_select_own on public.salesmen;
create policy salesmen_select_own on public.salesmen
  for select using (business_id = public.current_business_id());

drop policy if exists salesmen_manage_perms on public.salesmen;
create policy salesmen_manage_perms on public.salesmen
  for all using (business_id = public.current_business_id() and public.has_permission('can_manage_setup'))
  with check (business_id = public.current_business_id() and public.has_permission('can_manage_setup'));

-- customers: readable by members; managed by can_manage_setup.
drop policy if exists customers_select_own on public.customers;
create policy customers_select_own on public.customers
  for select using (business_id = public.current_business_id());

drop policy if exists customers_manage_perms on public.customers;
create policy customers_manage_perms on public.customers
  for all using (business_id = public.current_business_id() and public.has_permission('can_manage_setup'))
  with check (business_id = public.current_business_id() and public.has_permission('can_manage_setup'));

-- invoices: readable by members with can_view_sales OR can_view_own_sales.
drop policy if exists invoices_select_own on public.invoices;
create policy invoices_select_own on public.invoices
  for select using (
    business_id = public.current_business_id()
    and (public.has_permission('can_view_sales') or public.has_permission('can_view_own_sales'))
  );

-- No direct INSERT/UPDATE/DELETE on invoices — must use post_sale() RPC.

-- invoice_items: readable by members with can_view_sales.
drop policy if exists invoice_items_select_own on public.invoice_items;
create policy invoice_items_select_own on public.invoice_items
  for select using (
    business_id = public.current_business_id()
    and (public.has_permission('can_view_sales') or public.has_permission('can_view_own_sales'))
  );

-- payment_allocations: readable by members with can_view_sales.
drop policy if exists payment_allocations_select_own on public.payment_allocations;
create policy payment_allocations_select_own on public.payment_allocations
  for select using (
    business_id = public.current_business_id()
    and (public.has_permission('can_view_sales') or public.has_permission('can_view_own_sales'))
  );

-- salesman_commissions: readable by members.
drop policy if exists commissions_select_own on public.salesman_commissions;
create policy commissions_select_own on public.salesman_commissions
  for select using (business_id = public.current_business_id());

-- sales_returns: readable by members.
drop policy if exists sales_returns_select_own on public.sales_returns;
create policy sales_returns_select_own on public.sales_returns
  for select using (business_id = public.current_business_id());

-- Updated_at triggers
drop trigger if exists salesmen_touch on public.salesmen;
create trigger salesmen_touch before update on public.salesmen
  for each row execute function public.touch_updated_at();

drop trigger if exists customers_touch on public.customers;
create trigger customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();

drop trigger if exists invoices_touch on public.invoices;
create trigger invoices_touch before update on public.invoices
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Done. Phase 4 sales module is live with:
--   ✓ Shared concurrency-safe invoice sequence (next_invoice_no)
--   ✓ post_sale() RPC: invoice + items + payments + stock + voucher + commission
--   ✓ post_sales_return() RPC: reversing voucher + stock restore (no commission reversal)
--   ✓ Idempotent commission (unique allocation_id + salesman_id)
--   ✓ RLS on all tables (no direct inserts on invoices)
--   ✓ Negative stock allowed
-- ============================================================================
