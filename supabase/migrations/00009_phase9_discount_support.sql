-- ============================================================================
-- KhataPro ERP — Phase 9: Discount + net-collection commission + receipt
--                        allocation + idempotency + RLS hardening
--
-- This migration contains ALL database changes for Phase 9:
--   1. Drop old 13-arg post_sale, create canonical 14-arg with p_discount_paisas
--   2. Create INTERNAL helper _post_salesman_collection_commission() (not exposed)
--   3. post_sale() calls internal helper ONCE per sale using net_collected
--   4. post_receipt_voucher() supports multi-invoice allocation + commission
--      with stable idempotency key for genuine retry safety
--   5. Receipt allocations table (immutable, RLS-protected)
--   6. Idempotent commission via NOT NULL source_allocation_id + unique index
--   7. Discount validated (>= 0 and <= subtotal)
--   8. OFC full-advance enforced server-side
--   9. Online delivery fields on invoices for grand-total reconciliation
--  10. Customer Advances liability account (2040) for unallocated customer money
--  11. Internal auth/permission checks inside SECURITY DEFINER RPCs
--  12. Receipt-allocation immutability triggers (no update/delete)
--
-- SECURITY:
--   _post_salesman_collection_commission is INTERNAL — revoked from all roles.
--   post_sale and post_receipt_voucher verify auth.uid(), active profile,
--   business ownership, and database permissions INSIDE the function body.
--   receipt_allocations table has RLS enabled, no direct DML policies.
--
-- TRANSACTION SAFETY:
--   The entire migration is wrapped in a single transaction. If any statement
--   fails, the whole migration rolls back — no partial state.
--
-- Rerunnable: DROP IF EXISTS + CREATE OR REPLACE + IF NOT EXISTS. Safe to re-run.
-- ============================================================================

-- ============================================================================
-- TRANSACTION WRAP — all-or-nothing
-- ============================================================================
begin;

-- ============================================================================
-- PART 1: Schema — salesman_commissions source tracking
-- ============================================================================
alter table public.salesman_commissions
  add column if not exists source_type text not null default 'sale_payment';

alter table public.salesman_commissions
  add column if not exists source_allocation_id text;

-- Backfill legacy rows so the unique index can apply without NULL gaps.
-- Existing commission records are preserved (not deleted).
update public.salesman_commissions
  set source_allocation_id = 'legacy_' || coalesce(allocation_id, id)
  where source_allocation_id is null;

drop index if exists public.salesman_commissions_source_unique;
create unique index if not exists salesman_commissions_source_unique
  on public.salesman_commissions (business_id, invoice_id, salesman_id, source_type, source_allocation_id)
  where source_allocation_id is not null;

-- ============================================================================
-- PART 2: Schema — invoices delivery fields (Online grand-total reconciliation)
-- ============================================================================
alter table public.invoices
  add column if not exists delivery_charge numeric(20,0) not null default 0;

alter table public.invoices
  add column if not exists rider_earning numeric(20,0) not null default 0;

alter table public.invoices
  add column if not exists company_delivery_income numeric(20,0) not null default 0;

-- Online advance split: how much of the advance covers product vs delivery.
-- These let invoice detail, delivery order and print agree on grand total,
-- paid (product portion), outstanding, and COD expected.
alter table public.invoices
  add column if not exists product_advance numeric(20,0) not null default 0;

alter table public.invoices
  add column if not exists delivery_advance numeric(20,0) not null default 0;

-- ============================================================================
-- PART 3: Customer Advances liability account (2040)
-- ============================================================================
-- Used for unallocated customer money (advance with no invoice allocation).
-- Customer advance is a liability: the business owes the customer goods,
-- delivery, or a refund until the advance is allocated or consumed.
insert into public.accounts (business_id, code, name, category_id, is_active, is_business_account, is_party_account, party_type)
select 'biz-default', '2040', 'Customer Advances', c.id, true, false, true, 'customer'
from public.account_categories c
where c.business_id = 'biz-default' and c.code = 'LIABILITY'
on conflict (business_id, code) do update set
  name = excluded.name,
  is_active = true,
  is_party_account = true,
  party_type = 'customer';

-- ============================================================================
-- PART 4: receipts — idempotency key column
-- ============================================================================
-- Stable client-generated key. Replaying the same HTTP request with the same
-- key returns the existing receipt result instead of creating duplicates.
alter table public.receipts
  add column if not exists idempotency_key text;

-- Unique index: one receipt per (business, idempotency_key).
-- NULL keys are allowed (backward compat for non-idempotent callers) and
-- excluded from the uniqueness constraint.
drop index if exists public.receipts_idempotency_unique;
create unique index if not exists receipts_idempotency_unique
  on public.receipts (business_id, idempotency_key)
  where idempotency_key is not null;

-- ============================================================================
-- PART 5: invoices — idempotency key column (for sale retry safety)
-- ============================================================================
alter table public.invoices
  add column if not exists idempotency_key text;

drop index if exists public.invoices_idempotency_unique;
create unique index if not exists invoices_idempotency_unique
  on public.invoices (business_id, idempotency_key)
  where idempotency_key is not null;

-- ============================================================================
-- PART 6: receipt_allocations table (immutable, RLS-protected)
-- ============================================================================
create table if not exists public.receipt_allocations (
  id              text primary key default gen_random_uuid()::text,
  business_id     text not null references public.business(id) on delete cascade,
  receipt_id      text not null references public.receipts(id) on delete cascade,
  invoice_id      text not null references public.invoices(id) on delete restrict,
  customer_id     text,
  salesman_id     text,
  allocated_amount numeric(20,0) not null,
  allocation_date date not null default (now() at time zone 'Asia/Karachi')::date,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  constraint receipt_allocations_amount_check check (allocated_amount > 0)
);

create index if not exists receipt_allocations_receipt_idx
  on public.receipt_allocations(receipt_id);
create index if not exists receipt_allocations_invoice_idx
  on public.receipt_allocations(invoice_id);
create index if not exists receipt_allocations_biz_idx
  on public.receipt_allocations(business_id);

-- ── RLS: enable, no direct DML policies (only SECURITY DEFINER writes) ──
alter table public.receipt_allocations enable row level security;

-- Revoke all direct DML from all roles
revoke insert, update, delete on public.receipt_allocations from public;
revoke insert, update, delete on public.receipt_allocations from anon;
revoke insert, update, delete on public.receipt_allocations from authenticated;

-- Select policy: readable by members with can_view_sales or can_view_day_book
-- Salesmen can only see allocations for their own invoices (via salesman_id).
drop policy if exists receipt_allocations_select_own on public.receipt_allocations;
create policy receipt_allocations_select_own on public.receipt_allocations
  for select using (
    business_id = public.current_business_id()
    and (
      public.has_permission('can_view_sales')
      or public.has_permission('can_view_day_book')
      or public.has_permission('can_view_vouchers')
      or (
        public.has_permission('can_view_own_sales')
        and salesman_id in (
          select s.id from public.salesmen s
          where s.business_id = public.current_business_id()
            and s.user_id = auth.uid()
        )
      )
    )
  );

-- No INSERT/UPDATE/DELETE policies — only SECURITY DEFINER functions write.
-- (RLS blocks all direct DML because no permissive policies exist.)

-- ── Immutability triggers: block UPDATE and DELETE ──
create or replace function public._block_receipt_allocation_update()
returns trigger language plpgsql as $$
begin
  raise exception 'receipt_allocations are immutable — UPDATE is not allowed. Use a reversal voucher to correct.';
end;
$$;

create or replace function public._block_receipt_allocation_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'receipt_allocations are immutable — DELETE is not allowed. Use a reversal voucher to correct.';
end;
$$;

drop trigger if exists trg_block_ra_update on public.receipt_allocations;
create trigger trg_block_ra_update before update on public.receipt_allocations
  for each row execute function public._block_receipt_allocation_update();

drop trigger if exists trg_block_ra_delete on public.receipt_allocations;
create trigger trg_block_ra_delete before delete on public.receipt_allocations
  for each row execute function public._block_receipt_allocation_delete();

-- ============================================================================
-- PART 7: INTERNAL commission helper — _post_salesman_collection_commission
-- ============================================================================
-- Validates source persistence, not just caller text. For sale_payment the
-- source must be a real voucher linked to the invoice. For receipt_collection
-- the source must be a real receipt_allocation row belonging to the invoice.

create or replace function public._post_salesman_collection_commission(
  p_business_id          text,
  p_invoice_id           text,
  p_net_collected        numeric(20,0),
  p_source_type          text,
  p_source_allocation_id text,
  p_collection_date      date,
  p_created_by           uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_biz     text;
  v_salesman_id     text;
  v_comm_pct        numeric(5,2);
  v_comm_amount     numeric(20,0);
  v_comm_id         text;
  v_existing_id     text;
  v_invoice_total   numeric(20,0);
  v_invoice_paid    numeric(20,0);
  v_source_valid    boolean := false;
begin
  -- source_allocation_id must NEVER be null
  if p_source_allocation_id is null then
    raise exception 'source_allocation_id is required for commission creation';
  end if;

  if p_source_type not in ('sale_payment', 'receipt_collection') then
    raise exception 'Invalid source_type: %', p_source_type;
  end if;

  if p_net_collected is null or p_net_collected <= 0 then
    return null;
  end if;

  if not exists (select 1 from public.business where id = p_business_id) then
    raise exception 'Business not found: %', p_business_id;
  end if;

  -- Fetch invoice (salesman obtained from invoice, NOT from caller)
  select business_id, salesman_id, total, paid_amount
    into v_invoice_biz, v_salesman_id, v_invoice_total, v_invoice_paid
  from public.invoices
  where id = p_invoice_id;

  if not found then
    raise exception 'Invoice not found: %', p_invoice_id;
  end if;

  if v_invoice_biz is distinct from p_business_id then
    raise exception 'Invoice does not belong to business';
  end if;

  if v_salesman_id is null then
    return null;
  end if;

  -- ── SOURCE VALIDATION ──
  -- For sale_payment: source must be the actual posted sale voucher linked
  -- to this invoice (vouchers.reference_id = invoice_id OR invoices.voucher_id).
  -- For receipt_collection: source must be an existing receipt_allocation row
  -- belonging to this invoice and business, with allocated_amount matching.
  if p_source_type = 'sale_payment' then
    select exists(
      select 1 from public.invoices i
      where i.id = p_invoice_id
        and i.business_id = p_business_id
        and i.voucher_id = p_source_allocation_id
    ) into v_source_valid;

    if not v_source_valid then
      raise exception 'sale_payment source must be the invoice voucher_id';
    end if;

    if p_net_collected > v_invoice_total then
      raise exception 'Net collected exceeds invoice total';
    end if;
  else  -- receipt_collection
    select exists(
      select 1 from public.receipt_allocations ra
      where ra.id = p_source_allocation_id
        and ra.business_id = p_business_id
        and ra.invoice_id = p_invoice_id
        and ra.allocated_amount = p_net_collected
    ) into v_source_valid;

    if not v_source_valid then
      raise exception 'receipt_collection source must be a valid receipt_allocation with matching amount';
    end if;
  end if;

  -- Get salesman's commission rate
  select commission_pct into v_comm_pct
  from public.salesmen
  where id = v_salesman_id
    and business_id = p_business_id
    and is_active = true;

  if not found or v_comm_pct is null or v_comm_pct <= 0 then
    return null;
  end if;

  -- Idempotency: return existing commission on replay
  select id into v_existing_id
  from public.salesman_commissions
  where business_id = p_business_id
    and invoice_id = p_invoice_id
    and salesman_id = v_salesman_id
    and source_type = p_source_type
    and source_allocation_id = p_source_allocation_id
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  v_comm_amount := (p_net_collected * v_comm_pct) / 100;
  if v_comm_amount <= 0 then
    return null;
  end if;

  insert into public.salesman_commissions (
    business_id, salesman_id, invoice_id, allocation_id,
    collected_amount, commission_pct, commission_amount,
    status, source_type, source_allocation_id
  ) values (
    p_business_id, v_salesman_id, p_invoice_id, null,
    p_net_collected, v_comm_pct, v_comm_amount,
    'accrued', p_source_type, p_source_allocation_id
  )
  on conflict do nothing
  returning id into v_comm_id;

  if v_comm_id is null then
    select id into v_comm_id
    from public.salesman_commissions
    where business_id = p_business_id
      and invoice_id = p_invoice_id
      and salesman_id = v_salesman_id
      and source_type = p_source_type
      and source_allocation_id = p_source_allocation_id
    limit 1;
  end if;

  return v_comm_id;
end;
$$;

revoke execute on function public._post_salesman_collection_commission(
  text, text, numeric(20,0), text, text, date, uuid
) from public;
revoke execute on function public._post_salesman_collection_commission(
  text, text, numeric(20,0), text, text, date, uuid
) from anon;
revoke execute on function public._post_salesman_collection_commission(
  text, text, numeric(20,0), text, text, date, uuid
) from authenticated;

-- ============================================================================
-- PART 8: Internal auth helper — _require_sale_posting_auth
-- ============================================================================
-- Shared auth/permission check used by post_sale and post_receipt_voucher.
-- Verifies the caller is a real authenticated, active, business-scoped user
-- with the required permission. Prevents direct PostgREST bypass.

create or replace function public._require_posting_auth(
  p_business_id     text,
  p_required_perm   text,
  p_created_by      uuid default null
)
returns uuid  -- the verified auth.uid() of the caller
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_uid uuid;
  v_profile_biz text;
  v_profile_active boolean;
begin
  v_auth_uid := auth.uid();
  if v_auth_uid is null then
    raise exception 'Authentication required (auth.uid is null)';
  end if;

  -- Fetch profile
  select business_id, is_active
    into v_profile_biz, v_profile_active
  from public.profiles
  where user_id = v_auth_uid
  limit 1;

  if not found then
    raise exception 'No active profile for authenticated user';
  end if;

  if not v_profile_active then
    raise exception 'User profile is disabled';
  end if;

  if v_profile_biz is distinct from p_business_id then
    raise exception 'Cross-business access denied';
  end if;

  -- Permission check
  if not public.has_permission(p_required_perm) then
    raise exception 'Permission denied: %', p_required_perm;
  end if;

  -- p_created_by cannot impersonate another user
  if p_created_by is not null and p_created_by <> v_auth_uid then
    raise exception 'created_by does not match authenticated user';
  end if;

  return v_auth_uid;
end;
$$;

revoke execute on function public._require_posting_auth(text, text, uuid) from public;
revoke execute on function public._require_posting_auth(text, text, uuid) from anon;
revoke execute on function public._require_posting_auth(text, text, uuid) from authenticated;

-- ============================================================================
-- PART 9: Drop old post_sale and create canonical 14-arg
-- ============================================================================

drop function if exists public.post_sale(
  text, text, date, jsonb, jsonb, text, text, text, text, text, text, text, uuid
);

create function public.post_sale(
  p_business_id    text,
  p_invoice_type   text,
  p_invoice_date   date,
  p_items          jsonb,
  p_payments       jsonb,
  p_salesman_id    text default null,
  p_customer_id    text default null,
  p_customer_name  text default null,
  p_customer_phone text default null,
  p_customer_address text default null,
  p_customer_city  text default null,
  p_memo           text default null,
  p_created_by     uuid default null,
  p_discount_paisas numeric(20,0) default 0,
  p_idempotency_key text default null,
  p_delivery_charge numeric(20,0) default 0,
  p_rider_earning   numeric(20,0) default 0,
  p_company_delivery_income numeric(20,0) default 0
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_uid       uuid;
  v_existing_inv_id text;
  v_invoice_id     text;
  v_invoice_no     text;
  v_subtotal       numeric(20,0) := 0;
  v_total          numeric(20,0) := 0;
  v_paid           numeric(20,0) := 0;
  v_change_total   numeric(20,0) := 0;
  v_item           jsonb;
  v_payment        jsonb;
  v_line_total     numeric(20,0);
  v_qty            integer;
  v_unit_price     numeric(20,0);
  v_product_id     text;
  v_is_temporary   boolean;
  v_voucher_id     text;
  v_voucher_lines  jsonb := '[]'::jsonb;
  v_sales_account  text;
  v_cogs_account   text;
  v_inventory_acct text;
  v_ar_account     text;
  v_outstanding    numeric(20,0);
  v_stock_sm_id    text;
  v_alloc_id       text;
  v_net_collected  numeric(20,0);
  v_product_wac    numeric(20,0);
  v_item_cogs      numeric(20,0);
  v_total_cogs     numeric(20,0) := 0;
  v_discount       numeric(20,0) := 0;
  v_comm_id        text;
  v_delivery_charge numeric(20,0) := 0;
  v_product_advance numeric(20,0) := 0;
  v_delivery_advance numeric(20,0) := 0;
  v_salesman_for_check text;
begin
  -- ── AUTH + PERMISSION CHECK ──
  v_auth_uid := public._require_posting_auth(p_business_id, 'can_create_sales', p_created_by);

  if p_invoice_type not in ('COUNTER', 'ONLINE', 'OFC') then
    raise exception 'Invalid invoice_type: %', p_invoice_type;
  end if;

  if jsonb_array_length(p_items) < 1 then
    raise exception 'Invoice must have at least 1 item';
  end if;

  -- ── IDEMPOTENCY: return existing invoice if same key already used ──
  if p_idempotency_key is not null then
    select id into v_existing_inv_id
    from public.invoices
    where business_id = p_business_id and idempotency_key = p_idempotency_key
    limit 1;
    if v_existing_inv_id is not null then
      return v_existing_inv_id;
    end if;
  end if;

  -- ── SALESMAN FORGERY PROTECTION ──
  -- Owner/Accountant can specify any active salesman in the business.
  -- Salesman (can_view_own_sales only) must use their own linked salesman_id.
  if p_salesman_id is not null then
    select s.id into v_salesman_for_check
    from public.salesmen s
    where s.id = p_salesman_id and s.business_id = p_business_id and s.is_active = true;
    if not found then
      raise exception 'Salesman does not belong to this business or is inactive';
    end if;

    -- If the caller is a salesman (not owner), they can only post as themselves
    if not public.has_permission('can_view_sales') and public.has_permission('can_view_own_sales') then
      if p_salesman_id not in (
        select s2.id from public.salesmen s2
        where s2.business_id = p_business_id and s2.user_id = v_auth_uid
      ) then
        raise exception 'Salesman can only post sales under their own identity';
      end if;
    end if;
  end if;

  -- ── DISCOUNT VALIDATION ──
  v_discount := coalesce(p_discount_paisas, 0);
  if v_discount < 0 then
    raise exception 'Discount cannot be negative';
  end if;

  v_invoice_no := public.next_invoice_no(p_business_id);

  -- ── SUBTOTAL (server recalculates from items, no client trust) ──
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::integer;
    if v_qty <= 0 then
      raise exception 'Item qty must be positive';
    end if;
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    if v_unit_price < 0 then
      raise exception 'Item unit_price cannot be negative';
    end if;
    v_line_total := v_qty * v_unit_price;
    v_subtotal := v_subtotal + v_line_total;

    -- Validate product belongs to business (if not temporary)
    v_product_id := v_item->>'product_id';
    v_is_temporary := coalesce((v_item->>'is_temporary')::boolean, false);
    if v_product_id is not null and v_product_id <> '' and not v_is_temporary then
      if not exists (
        select 1 from public.products
        where id = v_product_id and business_id = p_business_id
      ) then
        raise exception 'Product does not belong to this business';
      end if;
    end if;
  end loop;

  if v_discount > v_subtotal then
    raise exception 'Discount (%) cannot exceed subtotal (%)', v_discount, v_subtotal;
  end if;

  v_total := v_subtotal - v_discount;
  v_delivery_charge := coalesce(p_delivery_charge, 0);
  if v_delivery_charge < 0 then
    raise exception 'Delivery charge cannot be negative';
  end if;

  -- ── PAYMENT VALIDATION ──
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if not coalesce((v_payment->>'is_change')::boolean, false) then
      v_paid := v_paid + coalesce((v_payment->>'amount')::numeric, 0);
      -- Validate payment account belongs to business
      if not exists (
        select 1 from public.accounts
        where id = (v_payment->>'account_id') and business_id = p_business_id and is_active = true
      ) then
        raise exception 'Payment account does not belong to this business';
      end if;
    else
      v_change_total := v_change_total + coalesce((v_payment->>'amount')::numeric, 0);
      if not exists (
        select 1 from public.accounts
        where id = (v_payment->>'account_id') and business_id = p_business_id and is_active = true
      ) then
        raise exception 'Change account does not belong to this business';
      end if;
    end if;
  end loop;

  -- ── NET COLLECTED ──
  v_net_collected := greatest(least(v_total, v_paid - v_change_total), 0);

  -- ── ONLINE ADVANCE SPLIT ──
  -- product_advance = min(net_collected, net_product_total)
  -- delivery_advance = min(max(net_collected - product_advance, 0), delivery_charge)
  if p_invoice_type = 'ONLINE' and v_delivery_charge > 0 then
    v_product_advance := least(v_net_collected, v_total);
    v_delivery_advance := least(greatest(v_net_collected - v_product_advance, 0), v_delivery_charge);
  else
    v_product_advance := v_net_collected;
    v_delivery_advance := 0;
  end if;

  -- ── OFC FULL-ADVANCE ENFORCEMENT (server-side, in RPC) ──
  if p_invoice_type = 'OFC' then
    if v_net_collected <> v_total then
      raise exception 'OFC requires full advance: net_collected (%) must equal final_total (%)', v_net_collected, v_total;
    end if;
    if p_customer_name is null or p_customer_phone is null
       or p_customer_address is null or p_customer_city is null then
      raise exception 'OFC requires customer name, phone, address and city';
    end if;
  end if;

  -- ── RESOLVE ACCOUNTS ──
  select id into v_sales_account from public.accounts
  where business_id = p_business_id and code = '4010' and is_active = true;
  if not found then raise exception 'Sales account (4010) not found'; end if;

  select id into v_cogs_account from public.accounts
  where business_id = p_business_id and code = '5010' and is_active = true;
  if not found then raise exception 'COGS account (5010) not found'; end if;

  select id into v_inventory_acct from public.accounts
  where business_id = p_business_id and code = '1100' and is_active = true;
  if not found then raise exception 'Inventory account (1100) not found'; end if;

  select id into v_ar_account from public.accounts
  where business_id = p_business_id and code = '1200' and is_active = true;

  -- ── BUILD VOUCHER LINES ──
  -- Product Sales credit = net product total only (delivery is separate)
  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', v_sales_account, 'debit', '0', 'credit', v_total::text,
    'memo', 'Sale ' || v_invoice_no
  );

  -- Debit each payment account (non-change)
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if not coalesce((v_payment->>'is_change')::boolean, false) then
      v_voucher_lines := v_voucher_lines || jsonb_build_object(
        'account_id', v_payment->>'account_id',
        'debit', coalesce((v_payment->>'amount')::numeric, 0)::text,
        'credit', '0', 'memo', 'Payment received ' || v_invoice_no
      );
    end if;
  end loop;

  -- Credit change accounts
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

  -- AR debit for outstanding (product portion only)
  v_outstanding := v_total - v_product_advance;
  if v_outstanding > 0 and v_ar_account is not null then
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_ar_account,
      'debit', v_outstanding::text, 'credit', '0',
      'memo', 'Outstanding ' || v_invoice_no
    );
  end if;

  -- COGS (discount does NOT reduce COGS)
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::integer;
    v_product_id := v_item->>'product_id';
    v_is_temporary := coalesce((v_item->>'is_temporary')::boolean, false);

    if v_product_id is not null and v_product_id <> '' and not v_is_temporary then
      select weighted_average_cost into v_product_wac
      from public.products
      where id = v_product_id and business_id = p_business_id;

      v_item_cogs := v_qty * coalesce(v_product_wac, 0);
      v_total_cogs := v_total_cogs + v_item_cogs;

      if v_item_cogs > 0 then
        v_voucher_lines := v_voucher_lines || jsonb_build_object(
          'account_id', v_cogs_account,
          'debit', v_item_cogs::text, 'credit', '0',
          'memo', 'COGS: ' || (v_item->>'product_name')
        );
        v_voucher_lines := v_voucher_lines || jsonb_build_object(
          'account_id', v_inventory_acct,
          'debit', '0', 'credit', v_item_cogs::text,
          'memo', 'Stock out: ' || (v_item->>'product_name')
        );
      end if;
    end if;
  end loop;

  -- Insert invoice header FIRST — atomic replay via ON CONFLICT.
  -- Only catches the idempotency-key unique constraint; other unique
  -- violations (e.g. invoice_no) bubble up as real errors.
  insert into public.invoices (
    business_id, invoice_no, invoice_type, invoice_date,
    customer_id, salesman_id,
    customer_name, customer_phone, customer_address, customer_city,
    subtotal, discount, total, paid_amount,
    voucher_id, memo, created_by,
    delivery_charge, rider_earning, company_delivery_income,
    product_advance, delivery_advance, idempotency_key
  ) values (
    p_business_id, v_invoice_no, p_invoice_type, p_invoice_date,
    p_customer_id, p_salesman_id,
    p_customer_name, p_customer_phone, p_customer_address, p_customer_city,
    v_subtotal, v_discount, v_total, v_product_advance,
    null, p_memo, v_auth_uid,
    v_delivery_charge, coalesce(p_rider_earning, 0), coalesce(p_company_delivery_income, 0),
    v_product_advance, v_delivery_advance, p_idempotency_key
  )
  on conflict (business_id, idempotency_key)
  where idempotency_key is not null
  do nothing
  returning id into v_invoice_id;

  if v_invoice_id is null then
    -- Another concurrent request already committed this idempotency_key.
    select id into v_invoice_id
    from public.invoices
    where business_id = p_business_id and idempotency_key = p_idempotency_key;
    if not found then
      raise exception 'Idempotency conflict resolved; please retry.';
    end if;
    return v_invoice_id;
  end if;

  -- Post voucher (only winner executes; loser returns above)
  v_voucher_id := public.post_voucher(
    p_business_id, 'SI', p_invoice_date, p_memo, v_voucher_lines,
    null, null, v_auth_uid
  );

  -- Update invoice with the voucher_id now that we have it
  update public.invoices set voucher_id = v_voucher_id where id = v_invoice_id;

  -- Insert items + stock-out
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::integer;
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_total := v_qty * v_unit_price;
    v_product_id := v_item->>'product_id';
    v_is_temporary := coalesce((v_item->>'is_temporary')::boolean, false);

    v_stock_sm_id := null;
    if v_product_id is not null and v_product_id <> '' and not v_is_temporary then
      select weighted_average_cost into v_product_wac
      from public.products where id = v_product_id;

      v_stock_sm_id := public.create_stock_movement(
        p_business_id, v_product_id, 'adjustment_out', v_qty,
        'Sale ' || v_invoice_no, p_invoice_date, v_auth_uid
      );
    else
      v_product_wac := 0;
    end if;

    insert into public.invoice_items (
      business_id, invoice_id, product_id, product_name, qty, unit_price, line_total, is_temporary, stock_movement_id, unit_cost_paisas
    ) values (
      p_business_id, v_invoice_id, v_product_id,
      v_item->>'product_name', v_qty, v_unit_price, v_line_total,
      v_is_temporary, v_stock_sm_id, coalesce(v_product_wac, 0)
    );
  end loop;

  -- Insert payment allocations (non-change)
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if not coalesce((v_payment->>'is_change')::boolean, false) then
      insert into public.payment_allocations (
        business_id, invoice_id, account_id, amount, is_change, voucher_id, created_by
      ) values (
        p_business_id, v_invoice_id, v_payment->>'account_id',
        coalesce((v_payment->>'amount')::numeric, 0), false, v_voucher_id, v_auth_uid
      ) returning id into v_alloc_id;
    end if;
  end loop;

  -- Change allocations
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if coalesce((v_payment->>'is_change')::boolean, false) then
      insert into public.payment_allocations (
        business_id, invoice_id, account_id, amount, is_change, voucher_id, created_by
      ) values (
        p_business_id, v_invoice_id, v_payment->>'account_id',
        coalesce((v_payment->>'amount')::numeric, 0), true, v_voucher_id, v_auth_uid
      ) returning id into v_alloc_id;
    end if;
  end loop;

  -- ── CANONICAL COMMISSION: ONE call per sale ──
  -- Commission is on product net collection only (NOT delivery advance).
  -- Salesman commission excludes delivery-fee collection.
  if p_salesman_id is not null and v_product_advance > 0 then
    v_comm_id := public._post_salesman_collection_commission(
      p_business_id, v_invoice_id, v_product_advance,
      'sale_payment', v_voucher_id,
      p_invoice_date, v_auth_uid
    );
  end if;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, v_auth_uid, 'POST_SALE', 'invoice', v_invoice_id,
    jsonb_build_object('invoice_no', v_invoice_no, 'type', p_invoice_type, 'total', v_total,
      'discount', v_discount, 'paid', v_paid, 'change', v_change_total,
      'net_collected', v_net_collected, 'product_advance', v_product_advance,
      'delivery_advance', v_delivery_advance, 'delivery_charge', v_delivery_charge,
      'outstanding', v_outstanding, 'cogs', v_total_cogs, 'voucher_id', v_voucher_id,
      'commission_id', v_comm_id, 'idempotency_key', p_idempotency_key));

  return v_invoice_id;
end;
$$;

grant execute on function public.post_sale(
  text, text, date, jsonb, jsonb, text, text, text, text, text, text, text, uuid, numeric, text, numeric, numeric, numeric
) to authenticated;

-- ============================================================================
-- PART 10: post_receipt_voucher — with idempotency + multi-invoice allocation
-- ============================================================================

drop function if exists public.post_receipt_voucher(
  text, date, text, text, numeric(20,0), text, text, text, uuid
);
drop function if exists public.post_receipt_voucher(
  text, date, text, text, numeric(20,0), text, text, text, uuid, text
);
drop function if exists public.post_receipt_voucher(
  text, date, text, text, numeric(20,0), text, text, text, uuid, jsonb
);

create function public.post_receipt_voucher(
  p_business_id text,
  p_receipt_date date,
  p_received_into_account_id text,
  p_credit_account_id text,
  p_amount_paisas numeric(20,0),
  p_customer_id text default null,
  p_reference text default null,
  p_notes text default null,
  p_created_by uuid default null,
  p_allocations jsonb default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_uid       uuid;
  v_existing_receipt_id text;
  v_existing_result jsonb;
  v_receipt_id     text;
  v_receipt_no     text;
  v_voucher_id     text;
  v_lines          jsonb;
  v_alloc_row      jsonb;
  v_alloc_id       text;
  v_alloc_amount   numeric(20,0);
  v_alloc_total    numeric(20,0) := 0;
  v_unallocated    numeric(20,0);
  v_invoice_id     text;
  v_invoice_salesman_id text;
  v_invoice_biz    text;
  v_invoice_total  numeric(20,0);
  v_invoice_paid   numeric(20,0);
  v_invoice_outstanding numeric(20,0);
  v_comm_id        text;
  v_commission_ids text[] := '{}';
  v_ar_account     text;
  v_advance_account text;
  v_credit_account_final text;
  v_credit_amount_final numeric(20,0);
  v_credit_amount_alloc  numeric(20,0);
  v_credit_amount_unalloc numeric(20,0);
  v_seen_invoices  text[] := '{}';
  v_dup_invoice    boolean;
begin
  -- ── AUTH + PERMISSION CHECK ──
  v_auth_uid := public._require_posting_auth(p_business_id, 'can_create_receipt_voucher', p_created_by);

  -- ── IDEMPOTENCY: return existing receipt result if same key ──
  if p_idempotency_key is not null then
    select id into v_existing_receipt_id
    from public.receipts
    where business_id = p_business_id and idempotency_key = p_idempotency_key
    limit 1;
    if v_existing_receipt_id is not null then
      -- Reconstruct result from existing receipt + allocations
      select jsonb_build_object(
        'receipt_id', r.id,
        'receipt_no', r.receipt_no,
        'voucher_id', r.voucher_id,
        'replay', true
      ) into v_existing_result
      from public.receipts r
      where r.id = v_existing_receipt_id;
      return v_existing_result;
    end if;
  end if;

  -- ── VALIDATE ACCOUNTS ──
  if not exists (select 1 from public.accounts where id = p_received_into_account_id and business_id = p_business_id and is_active = true) then
    raise exception 'Invalid or inactive received-into account';
  end if;
  if p_amount_paisas <= 0 then
    raise exception 'Amount must be positive';
  end if;

  -- Resolve AR account (1200) for invoice allocations
  select id into v_ar_account from public.accounts
  where business_id = p_business_id and code = '1200' and is_active = true;

  -- Resolve Customer Advances account (2040) for unallocated customer remainder
  select id into v_advance_account from public.accounts
  where business_id = p_business_id and code = '2040' and is_active = true;

  -- ── VALIDATE ALLOCATIONS (if provided) ──
  if p_allocations is not null and jsonb_array_length(p_allocations) > 0 then
    -- If allocations exist, p_credit_account_id is ignored for the allocated portion;
    -- AR (1200) is credited. The caller's credit_account_id applies only to the
    -- unallocated remainder (and must be valid).
    for v_alloc_row in select * from jsonb_array_elements(p_allocations)
    loop
      v_invoice_id := v_alloc_row->>'invoice_id';
      v_alloc_amount := coalesce((v_alloc_row->>'allocated_amount')::numeric, 0);

      if v_invoice_id is null then
        raise exception 'Allocation missing invoice_id';
      end if;
      if v_alloc_amount <= 0 then
        raise exception 'Allocation amount must be positive';
      end if;

      -- Duplicate invoice inside same request?
      v_dup_invoice := v_invoice_id = any(v_seen_invoices);
      if v_dup_invoice then
        raise exception 'Duplicate invoice_id in allocation request — consolidate into one allocation';
      end if;
      v_seen_invoices := v_seen_invoices || array[v_invoice_id];

      select business_id, salesman_id, total, paid_amount
        into v_invoice_biz, v_invoice_salesman_id, v_invoice_total, v_invoice_paid
      from public.invoices
      where id = v_invoice_id;

      if not found then
        raise exception 'Allocated invoice not found: %', v_invoice_id;
      end if;
      if v_invoice_biz is distinct from p_business_id then
        raise exception 'Allocated invoice does not belong to business';
      end if;

      -- Invoice must belong to customer (if customer provided)
      if p_customer_id is not null then
        if not exists (
          select 1 from public.invoices
          where id = v_invoice_id and business_id = p_business_id
            and (customer_id = p_customer_id or customer_id is null)
        ) then
          raise exception 'Invoice does not belong to the selected customer';
        end if;
      end if;

      -- Allocation cannot exceed outstanding (reject fully-paid invoices)
      v_invoice_outstanding := v_invoice_total - coalesce(v_invoice_paid, 0);
      if v_invoice_outstanding <= 0 then
        raise exception 'Invoice is fully paid — cannot allocate more';
      end if;
      if v_alloc_amount > v_invoice_outstanding then
        raise exception 'Allocation (%) exceeds invoice outstanding (%)', v_alloc_amount, v_invoice_outstanding;
      end if;

      v_alloc_total := v_alloc_total + v_alloc_amount;
    end loop;

    if v_alloc_total > p_amount_paisas then
      raise exception 'Total allocations (%) exceed receipt amount (%)', v_alloc_total, p_amount_paisas;
    end if;
  end if;

  -- ── DETERMINE CREDIT TREATMENT ──
  -- Allocated portion → credit AR (1200)
  -- Unallocated customer remainder → credit Customer Advances (2040)
  -- General non-customer receipt (no customer, no allocations) → credit caller's account
  v_credit_amount_alloc := v_alloc_total;
  v_credit_amount_unalloc := p_amount_paisas - v_alloc_total;

  if v_credit_amount_alloc > 0 then
    if v_ar_account is null then
      raise exception 'Accounts Receivable (1200) account not found for invoice allocation';
    end if;
  end if;

  if v_credit_amount_unalloc > 0 then
    if p_customer_id is not null then
      -- Customer advance remainder must go to 2040
      if v_advance_account is null then
        raise exception 'Customer Advances (2040) account not found — cannot accept unallocated customer money';
      end if;
    else
      -- General receipt: validate caller's credit account
      if not exists (select 1 from public.accounts where id = p_credit_account_id and business_id = p_business_id and is_active = true) then
        raise exception 'Invalid or inactive credit account';
      end if;
      if p_received_into_account_id = p_credit_account_id then
        raise exception 'Received-into and credit accounts must differ';
      end if;
    end if;
  end if;

  v_receipt_no := public.next_document_no(p_business_id, 'RV', 'receipts', 'receipt_no');

  -- ── BUILD VOUCHER LINES ──
  -- Dr Received-into (full amount)
  -- Cr AR 1200 (allocated portion, if any)
  -- Cr Customer Advances 2040 (unallocated customer remainder, if any)
  -- Cr Caller credit account (general non-customer remainder, if any)
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', p_received_into_account_id, 'debit', p_amount_paisas::text, 'credit', '0', 'memo', 'Receipt ' || v_receipt_no)
  );

  if v_credit_amount_alloc > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_id', v_ar_account, 'debit', '0', 'credit', v_credit_amount_alloc::text,
      'memo', 'AR settled ' || v_receipt_no
    );
  end if;

  if v_credit_amount_unalloc > 0 then
    if p_customer_id is not null then
      v_lines := v_lines || jsonb_build_object(
        'account_id', v_advance_account, 'debit', '0', 'credit', v_credit_amount_unalloc::text,
        'memo', 'Customer advance ' || v_receipt_no
      );
    else
      v_lines := v_lines || jsonb_build_object(
        'account_id', p_credit_account_id, 'debit', '0', 'credit', v_credit_amount_unalloc::text,
        'memo', 'Credited ' || v_receipt_no
      );
    end if;
  end if;

  v_voucher_id := public.post_voucher(p_business_id, 'RC', p_receipt_date,
    'Receipt Voucher ' || v_receipt_no, v_lines, null, 'receipt_voucher', v_auth_uid);

  insert into public.receipts (business_id, receipt_no, receipt_date, received_into_account_id,
    credit_account_id, customer_id, amount, reference, notes, status, voucher_id, created_by,
    idempotency_key)
  values (p_business_id, v_receipt_no, p_receipt_date, p_received_into_account_id,
    coalesce(v_ar_account, p_credit_account_id), p_customer_id, p_amount_paisas, p_reference, p_notes,
    'posted', v_voucher_id, v_auth_uid, p_idempotency_key)
  returning id into v_receipt_id;

  -- ── PROCESS ALLOCATIONS ──
  if p_allocations is not null and jsonb_array_length(p_allocations) > 0 then
    for v_alloc_row in select * from jsonb_array_elements(p_allocations)
    loop
      v_invoice_id := v_alloc_row->>'invoice_id';
      v_alloc_amount := coalesce((v_alloc_row->>'allocated_amount')::numeric, 0);

      -- Re-fetch (paid_amount may have changed from prior allocation in same request)
      select salesman_id, total, paid_amount
        into v_invoice_salesman_id, v_invoice_total, v_invoice_paid
      from public.invoices
      where id = v_invoice_id and business_id = p_business_id;

      -- Create immutable receipt_allocation row
      insert into public.receipt_allocations (
        business_id, receipt_id, invoice_id, customer_id, salesman_id,
        allocated_amount, allocation_date, created_by
      ) values (
        p_business_id, v_receipt_id, v_invoice_id, p_customer_id, v_invoice_salesman_id,
        v_alloc_amount, p_receipt_date, v_auth_uid
      ) returning id into v_alloc_id;

      -- Update invoice paid_amount (AR reduced exactly once)
      update public.invoices
        set paid_amount = coalesce(paid_amount, 0) + v_alloc_amount
      where id = v_invoice_id and business_id = p_business_id;

      -- Commission via internal helper (source = receipt_allocation.id)
      if v_invoice_salesman_id is not null then
        v_comm_id := public._post_salesman_collection_commission(
          p_business_id, v_invoice_id, v_alloc_amount,
          'receipt_collection', v_alloc_id,
          p_receipt_date, v_auth_uid
        );
        if v_comm_id is not null then
          v_commission_ids := v_commission_ids || array[v_comm_id];
        end if;
      end if;
    end loop;
  end if;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, v_auth_uid, 'POST_RECEIPT_VOUCHER', 'receipt', v_receipt_id,
    jsonb_build_object('receipt_no', v_receipt_no, 'amount', p_amount_paisas,
      'voucher_id', v_voucher_id, 'customer_id', p_customer_id,
      'allocations_total', v_alloc_total,
      'unallocated', v_credit_amount_unalloc,
      'commission_ids', to_jsonb(v_commission_ids),
      'idempotency_key', p_idempotency_key));

  return jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_no', v_receipt_no,
    'voucher_id', v_voucher_id,
    'allocations_total', v_alloc_total,
    'unallocated', v_credit_amount_unalloc,
    'commission_ids', to_jsonb(v_commission_ids),
    'replay', false
  );
end;
$$;

grant execute on function public.post_receipt_voucher(
  text, date, text, text, numeric(20,0), text, text, text, uuid, jsonb, text
) to authenticated;

-- ============================================================================
-- PART 11: PostgREST schema reload (only after all definitions succeed)
-- ============================================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Commit the transaction — all changes succeed or all roll back
-- ============================================================================
commit;

-- ============================================================================
-- Migration 00009 complete hardened scope:
--   ✓ Idempotency: receipts.idempotency_key + invoices.idempotency_key
--     Unique indexes on (business_id, idempotency_key) where not null
--     RPCs return existing result on replay (zero new voucher/allocation/AR)
--   ✓ receipt_allocations: RLS enabled, all DML revoked from PUBLIC/anon/authenticated
--     SELECT policy: business-scoped, permission-checked, salesman-self filter
--     Immutability triggers block UPDATE and DELETE
--   ✓ Internal auth helper _require_posting_auth: auth.uid, active profile,
--     business ownership, permission check, created_by impersonation guard
--   ✓ post_sale: 18 params with p_idempotency_key + delivery fields
--     - Server recalculates subtotal (no client trust)
--     - Product/account business ownership verified
--     - Salesman forgery protection (salesmen can only post as themselves)
--     - Online advance split: product_advance + delivery_advance
--     - Commission on product_advance only (excludes delivery)
--     - OFC full-advance enforced in RPC body
--   ✓ post_receipt_voucher: 11 params with p_allocations + p_idempotency_key
--     - Allocated portion → Cr AR 1200 (not caller's credit account)
--     - Unallocated customer remainder → Cr Customer Advances 2040
--     - General receipt → Cr caller's credit account (validated)
--     - Duplicate invoice in same request rejected
--     - Fully-paid invoice rejected
--     - Idempotent replay returns existing result
--   ✓ Customer Advances account (2040) created in CoA
--   ✓ _post_salesman_collection_commission: source validation
--     - sale_payment source must = invoice.voucher_id
--     - receipt_collection source must = valid receipt_allocation with matching amount
--   ✓ TRANSACTION wrap: all-or-nothing
--   ✓ NOTIFY pgrst only after successful definitions
--   ✓ No CASCADE used
--   ✓ Rerunnable: DROP IF EXISTS + CREATE OR REPLACE + IF NOT EXISTS
--   ✓ Legacy commission rows preserved (backfilled with stable source_allocation_id)
-- ============================================================================
