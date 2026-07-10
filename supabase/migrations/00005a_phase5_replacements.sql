-- ============================================================================
-- KhataPro ERP — Phase 5a: Purchase Replacements + Advance Application
--                        + Proper Vendor Ledger RPC
--
-- This migration adds:
--   1. purchase_replacements — header for vendor replacement records
--   2. purchase_replacement_items — outgoing defective + incoming replacement
--   3. post_purchase_replacement() RPC — atomic replacement posting
--   4. post_advance_application() RPC — apply vendor advance against purchase
--   5. vendor_ledger() RPC — proper per-vendor ledger with type/references
--   6. New permission: can_replace_purchases
--   7. RLS on all new tables
--
-- Accounting rules:
--   * Equal-value replacement: NO voucher (audit trail via replacement record + stock movements only)
--   * Higher-value replacement: Debit Purchases, Credit Vendor Payable (for the difference)
--   * Lower-value replacement: Debit Vendor Payable, Credit Purchases (for the difference)
--   * Advance application: Debit Vendor Payable, Credit Vendor Payable (reclassify, no net change)
--   * Vendor ledger derives ALL balances from voucher_lines on account 2010
--   * No hard delete for posted records
--   * All money in numeric(20,0) paisas
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. purchase_replacements — header with REP-0001 sequence.
-- ----------------------------------------------------------------------------
create table if not exists public.purchase_replacements (
  id              text primary key default gen_random_uuid()::text,
  business_id     text not null references public.business(id) on delete cascade,
  purchase_id     text not null references public.purchases(id) on delete restrict,
  vendor_id       text not null references public.vendors(id) on delete restrict,
  replacement_no  text not null,
  replacement_date date not null default (now() at time zone 'Asia/Karachi')::date,
  outgoing_value  numeric(20,0) not null default 0,  -- paisas
  incoming_value  numeric(20,0) not null default 0,  -- paisas
  value_diff      numeric(20,0) not null default 0,  -- incoming - outgoing (can be negative)
  voucher_id      text references public.vouchers(id) on delete set null,
  notes           text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (business_id, replacement_no)
);
create index if not exists purchase_replacements_biz_idx on public.purchase_replacements(business_id);
create index if not exists purchase_replacements_purchase_idx on public.purchase_replacements(purchase_id);
create index if not exists purchase_replacements_vendor_idx on public.purchase_replacements(vendor_id);

-- ----------------------------------------------------------------------------
-- 2. purchase_replacement_items — outgoing (defective) + incoming (replacement)
-- ----------------------------------------------------------------------------
create table if not exists public.purchase_replacement_items (
  id              text primary key default gen_random_uuid()::text,
  business_id     text not null references public.business(id) on delete cascade,
  purchase_replacement_id text not null references public.purchase_replacements(id) on delete cascade,
  original_purchase_item_id text not null references public.purchase_items(id) on delete restrict,
  -- Outgoing (defective item sent back to vendor)
  outgoing_product_id   text references public.products(id) on delete set null,
  outgoing_product_name text not null,
  outgoing_quantity     integer not null,
  outgoing_unit_cost    numeric(20,0) not null,
  outgoing_line_total   numeric(20,0) not null,
  outgoing_stock_movement_id text references public.stock_movements(id) on delete set null,
  -- Incoming (replacement item received from vendor)
  incoming_product_id   text references public.products(id) on delete set null,
  incoming_product_name text not null,
  incoming_quantity     integer not null,
  incoming_unit_cost    numeric(20,0) not null,
  incoming_line_total   numeric(20,0) not null,
  incoming_stock_movement_id text references public.stock_movements(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists purchase_replacement_items_replacement_idx on public.purchase_replacement_items(purchase_replacement_id);

-- ============================================================================
-- RPC FUNCTIONS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 3. next_replacement_no() — concurrency-safe REP-0001 sequence.
-- ----------------------------------------------------------------------------
create or replace function public.next_replacement_no(p_business_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next int;
begin
  perform pg_advisory_xact_lock(987654325, hashtext(p_business_id));
  select coalesce(max(cast(replace(replacement_no, 'REP-', '') as integer)), 0) + 1
    into v_next
    from public.purchase_replacements
    where business_id = p_business_id;
  return 'REP-' || lpad(v_next::text, 4, '0');
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. post_purchase_replacement() — atomic vendor replacement posting.
--    Creates: replacement header + items + stock-out (defective) + stock-in (replacement)
--             + voucher ONLY if there's a value difference.
--
--    p_replacement_items: [{
--       original_purchase_item_id, outgoing_product_id, outgoing_product_name,
--       outgoing_quantity, outgoing_unit_cost,
--       incoming_product_id, incoming_product_name,
--       incoming_quantity, incoming_unit_cost
--    }, ...]
--
--    Accounting:
--      - Equal value (outgoing == incoming): NO voucher. Audit trail only.
--      - Higher value (incoming > outgoing): Debit Purchases, Credit Vendor Payable (diff)
--      - Lower value (incoming < outgoing): Debit Vendor Payable, Credit Purchases (diff)
-- ----------------------------------------------------------------------------
create or replace function public.post_purchase_replacement(
  p_business_id        text,
  p_purchase_id        text,
  p_replacement_items  jsonb,
  p_replacement_date   date default null,
  p_notes              text default null,
  p_created_by         uuid default null
)
returns text  -- the replacement id
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replacement_id   text;
  v_replacement_no   text;
  v_outgoing_value   numeric(20,0) := 0;
  v_incoming_value   numeric(20,0) := 0;
  v_value_diff       numeric(20,0);
  v_item             jsonb;
  v_voucher_id       text;
  v_voucher_lines    jsonb := '[]'::jsonb;
  v_purchases_acct   text;
  v_payable_acct     text;
  v_purchase         record;
  v_outgoing_sm_id   text;
  v_incoming_sm_id   text;
  v_date             date;
  v_out_qty          integer;
  v_out_cost         numeric(20,0);
  v_in_qty           integer;
  v_in_cost          numeric(20,0);
begin
  if jsonb_array_length(p_replacement_items) < 1 then
    raise exception 'Replacement must have at least 1 item';
  end if;

  -- Load original purchase.
  select * into v_purchase from public.purchases
  where id = p_purchase_id and business_id = p_business_id;
  if not found then raise exception 'Purchase not found: %', p_purchase_id; end if;

  -- Generate replacement number.
  v_replacement_no := public.next_replacement_no(p_business_id);

  -- Compute values.
  for v_item in select * from jsonb_array_elements(p_replacement_items)
  loop
    v_out_qty := (v_item->>'outgoing_quantity')::integer;
    v_out_cost := coalesce((v_item->>'outgoing_unit_cost')::numeric, 0);
    v_in_qty := (v_item->>'incoming_quantity')::integer;
    v_in_cost := coalesce((v_item->>'incoming_unit_cost')::numeric, 0);
    v_outgoing_value := v_outgoing_value + (v_out_qty * v_out_cost);
    v_incoming_value := v_incoming_value + (v_in_qty * v_in_cost);
  end loop;

  v_value_diff := v_incoming_value - v_outgoing_value;

  -- Resolve accounts.
  select id into v_purchases_acct from public.accounts
  where business_id = p_business_id and code = '5010' and is_active = true;
  if not found then raise exception 'Purchases account (5010) not found'; end if;

  select id into v_payable_acct from public.accounts
  where business_id = p_business_id and code = '2010' and is_active = true;
  if not found then raise exception 'Vendors Payable account (2010) not found'; end if;

  v_date := coalesce(p_replacement_date, (now() at time zone 'Asia/Karachi')::date);

  -- Post voucher ONLY if there is a value difference.
  if v_value_diff > 0 then
    -- Replacement costs more: Debit Purchases (additional expense), Credit Vendor Payable (additional payable).
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_purchases_acct, 'debit', v_value_diff::text, 'credit', '0',
      'memo', 'Replacement value difference (higher) ' || v_replacement_no
    );
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_payable_acct, 'debit', '0', 'credit', v_value_diff::text,
      'memo', 'Additional payable for ' || v_replacement_no
    );
    v_voucher_id := public.post_voucher(
      p_business_id, 'RP', v_date, 'Replacement (higher value) ' || v_replacement_no,
      v_voucher_lines, null, 'purchase_replacement', p_created_by
    );
  elsif v_value_diff < 0 then
    -- Replacement costs less: Debit Vendor Payable (reduce payable / create credit), Credit Purchases (reduce expense).
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_payable_acct, 'debit', (-v_value_diff)::text, 'credit', '0',
      'memo', 'Vendor credit for ' || v_replacement_no
    );
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_purchases_acct, 'debit', '0', 'credit', (-v_value_diff)::text,
      'memo', 'Replacement value reduction ' || v_replacement_no
    );
    v_voucher_id := public.post_voucher(
      p_business_id, 'RP', v_date, 'Replacement (lower value) ' || v_replacement_no,
      v_voucher_lines, null, 'purchase_replacement', p_created_by
    );
  else
    -- Equal value: no voucher, no accounting impact. Audit trail only.
    v_voucher_id := null;
  end if;

  -- Insert replacement header.
  insert into public.purchase_replacements (
    business_id, purchase_id, vendor_id, replacement_no, replacement_date,
    outgoing_value, incoming_value, value_diff, voucher_id, notes, created_by
  ) values (
    p_business_id, p_purchase_id, v_purchase.vendor_id, v_replacement_no, v_date,
    v_outgoing_value, v_incoming_value, v_value_diff, v_voucher_id, p_notes, p_created_by
  ) returning id into v_replacement_id;

  -- Insert items + stock movements.
  for v_item in select * from jsonb_array_elements(p_replacement_items)
  loop
    v_out_qty := (v_item->>'outgoing_quantity')::integer;
    v_out_cost := coalesce((v_item->>'outgoing_unit_cost')::numeric, 0);
    v_in_qty := (v_item->>'incoming_quantity')::integer;
    v_in_cost := coalesce((v_item->>'incoming_unit_cost')::numeric, 0);

    -- Stock-out for defective item.
    v_outgoing_sm_id := null;
    if v_item->>'outgoing_product_id' is not null and (v_item->>'outgoing_product_id') <> '' then
      v_outgoing_sm_id := public.create_stock_movement(
        p_business_id, v_item->>'outgoing_product_id', 'adjustment_out', v_out_qty,
        'Replacement out (defective) ' || v_replacement_no, v_date, p_created_by
      );
    end if;

    -- Stock-in for replacement item.
    v_incoming_sm_id := null;
    if v_item->>'incoming_product_id' is not null and (v_item->>'incoming_product_id') <> '' then
      v_incoming_sm_id := public.create_stock_movement(
        p_business_id, v_item->>'incoming_product_id', 'adjustment_in', v_in_qty,
        'Replacement in (received) ' || v_replacement_no, v_date, p_created_by
      );
    end if;

    insert into public.purchase_replacement_items (
      business_id, purchase_replacement_id, original_purchase_item_id,
      outgoing_product_id, outgoing_product_name, outgoing_quantity, outgoing_unit_cost, outgoing_line_total, outgoing_stock_movement_id,
      incoming_product_id, incoming_product_name, incoming_quantity, incoming_unit_cost, incoming_line_total, incoming_stock_movement_id
    ) values (
      p_business_id, v_replacement_id, v_item->>'original_purchase_item_id',
      nullif(v_item->>'outgoing_product_id', ''), v_item->>'outgoing_product_name', v_out_qty, v_out_cost, v_out_qty * v_out_cost, v_outgoing_sm_id,
      nullif(v_item->>'incoming_product_id', ''), v_item->>'incoming_product_name', v_in_qty, v_in_cost, v_in_qty * v_in_cost, v_incoming_sm_id
    );
  end loop;

  -- Audit.
  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'PURCHASE_REPLACEMENT', 'purchase_replacement', v_replacement_id,
    jsonb_build_object('replacement_no', v_replacement_no, 'purchase_id', p_purchase_id,
      'outgoing_value', v_outgoing_value, 'incoming_value', v_incoming_value,
      'value_diff', v_value_diff, 'voucher_id', v_voucher_id));

  return v_replacement_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. post_advance_application() — apply a vendor advance against a purchase.
--    Posts: Debit Vendor Payable (reduce payable), Credit Vendor Payable (reduce advance).
--    Both on 2010 — reclassifies the advance against the payable. Net = 0.
--    Updates purchase outstanding_amount + paid_amount.
-- ----------------------------------------------------------------------------
create or replace function public.post_advance_application(
  p_business_id   text,
  p_vendor_id     text,
  p_purchase_id   text,
  p_amount_paisas numeric(20,0),
  p_application_date date default null,
  p_notes         text default null,
  p_created_by    uuid default null
)
returns text  -- purchase_payment id
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp_id        text;
  v_voucher_id   text;
  v_voucher_lines jsonb := '[]'::jsonb;
  v_payable_acct text;
  v_date         date;
  v_purchase     record;
begin
  -- Validate vendor.
  if not exists (select 1 from public.vendors where id = p_vendor_id and business_id = p_business_id and is_active = true) then
    raise exception 'Invalid vendor: %', p_vendor_id;
  end if;

  -- Validate purchase belongs to vendor and has sufficient outstanding.
  select * into v_purchase from public.purchases
  where id = p_purchase_id and business_id = p_business_id and vendor_id = p_vendor_id;
  if not found then raise exception 'Purchase not found for this vendor'; end if;
  if v_purchase.outstanding_amount < p_amount_paisas then
    raise exception 'Advance application amount (%) exceeds outstanding (%)', p_amount_paisas, v_purchase.outstanding_amount;
  end if;

  -- Resolve Vendors Payable account (2010).
  select id into v_payable_acct from public.accounts
  where business_id = p_business_id and code = '2010' and is_active = true;
  if not found then raise exception 'Vendors Payable account (2010) not found'; end if;

  v_date := coalesce(p_application_date, (now() at time zone 'Asia/Karachi')::date);

  -- Voucher: Debit Payable (reduce payable), Credit Payable (reduce advance).
  -- Both lines on 2010 — balanced, no net change, creates audit trail.
  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', v_payable_acct, 'debit', p_amount_paisas::text, 'credit', '0',
    'memo', 'Advance applied to purchase ' || v_purchase.purchase_no
  );
  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', v_payable_acct, 'debit', '0', 'credit', p_amount_paisas::text,
    'memo', 'Advance applied (reclassify)'
  );

  v_voucher_id := public.post_voucher(
    p_business_id, 'PM', v_date, 'Advance application ' || v_purchase.purchase_no, v_voucher_lines,
    p_purchase_id, 'advance_application', p_created_by
  );

  -- Insert payment record.
  insert into public.purchase_payments (
    business_id, purchase_id, vendor_id, account_id, amount, payment_date, payment_type, voucher_id, notes, created_by
  ) values (
    p_business_id, p_purchase_id, p_vendor_id, v_payable_acct, p_amount_paisas, v_date,
    'advance_application', v_voucher_id, p_notes, p_created_by
  ) returning id into v_pp_id;

  -- Update purchase outstanding.
  update public.purchases
  set paid_amount = paid_amount + p_amount_paisas,
      outstanding_amount = outstanding_amount - p_amount_paisas,
      status = case when outstanding_amount - p_amount_paisas <= 0 then 'paid' else 'partially_paid' end,
      updated_at = now()
  where id = p_purchase_id;

  -- Audit.
  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'ADVANCE_APPLICATION', 'purchase_payment', v_pp_id,
    jsonb_build_object('vendor_id', p_vendor_id, 'purchase_id', p_purchase_id,
      'amount', p_amount_paisas, 'voucher_id', v_voucher_id));

  return v_pp_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. vendor_ledger() — proper per-vendor ledger derived from voucher_lines.
--    Returns one row per voucher (aggregated) with:
--      date, type, reference, description, debit, credit, running_balance,
--      voucher_id, reference_id, reference_type
--
--    Running balance = cumulative (credit - debit).
--      Positive = Payable to Vendor (credit balance).
--      Negative = Advance With Vendor (debit balance).
--
--    Resolves vendor's entries by joining vouchers → purchases / purchase_payments
--    / purchase_returns / purchase_replacements that belong to this vendor.
-- ----------------------------------------------------------------------------
create or replace function public.vendor_ledger(
  p_business_id text,
  p_vendor_id   text,
  p_from_date   date default null,
  p_to_date     date default null
)
returns table (
  line_date        date,
  line_type        text,
  reference        text,
  description      text,
  debit            numeric,
  credit           numeric,
  running_balance  numeric,
  voucher_id       text,
  reference_id     text,
  reference_type   text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payable_acct text;
begin
  -- Resolve the Vendors Payable account (2010).
  select id into v_payable_acct from public.accounts
  where business_id = p_business_id and code = '2010';
  if not found then return; end if;

  return query
  with vendor_vouchers as (
    -- Purchases by this vendor
    select p.voucher_id, p.purchase_no as ref_no, 'Purchase'::text as txn_type,
           p.purchase_date as txn_date, p.id as entity_id, 'purchase'::text as entity_kind
    from public.purchases p
    where p.business_id = p_business_id and p.vendor_id = p_vendor_id and p.voucher_id is not null

    union all

    -- Purchase payments by this vendor
    select pp.voucher_id,
      case when pp.payment_type = 'vendor_advance' then 'ADV'
           when pp.payment_type = 'advance_application' then 'APP'
           when pp.payment_type = 'vendor_refund' then 'RFD'
           else 'PMT' end as ref_no,
      case pp.payment_type
        when 'vendor_advance' then 'Vendor Advance'::text
        when 'advance_application' then 'Advance Application'::text
        when 'vendor_refund' then 'Vendor Refund'::text
        when 'later_payment' then 'Vendor Payment'::text
        else 'Payment'::text end as txn_type,
      pp.payment_date as txn_date, pp.id as entity_id, 'payment'::text as entity_kind
    from public.purchase_payments pp
    where pp.business_id = p_business_id and pp.vendor_id = p_vendor_id and pp.voucher_id is not null

    union all

    -- Purchase returns for this vendor
    select pr.voucher_id, pr.return_no as ref_no, 'Purchase Return'::text as txn_type,
           pr.return_date as txn_date, pr.id as entity_id, 'return'::text as entity_kind
    from public.purchase_returns pr
    where pr.business_id = p_business_id and pr.vendor_id = p_vendor_id and pr.voucher_id is not null

    union all

    -- Purchase replacements for this vendor
    select prep.voucher_id, prep.replacement_no as ref_no, 'Replacement'::text as txn_type,
           prep.replacement_date as txn_date, prep.id as entity_id, 'replacement'::text as entity_kind
    from public.purchase_replacements prep
    where prep.business_id = p_business_id and prep.vendor_id = p_vendor_id
      and prep.voucher_id is not null and prep.value_diff <> 0
  ),
  ledger as (
    select
      vv.ref_no,
      vv.txn_type,
      vv.txn_date,
      vv.entity_id,
      vv.entity_kind,
      v.id as voucher_id,
      v.memo,
      v.created_at,
      sum(vl.debit) as total_debit,
      sum(vl.credit) as total_credit
    from vendor_vouchers vv
    join public.vouchers v on v.id = vv.voucher_id
    join public.voucher_lines vl on vl.voucher_id = v.id and vl.account_id = v_payable_acct
    where (p_from_date is null or v.voucher_date >= p_from_date)
      and (p_to_date is null or v.voucher_date <= p_to_date)
    group by vv.ref_no, vv.txn_type, vv.txn_date, vv.entity_id, vv.entity_kind, v.id, v.memo, v.created_at
  )
  select
    l.txn_date,
    l.txn_type,
    l.ref_no,
    coalesce(l.memo, '') as description,
    l.total_debit,
    l.total_credit,
    sum(l.total_credit - l.total_debit) over (order by l.txn_date, l.created_at, l.voucher_id) as running_balance,
    l.voucher_id,
    l.entity_id,
    l.entity_kind
  from ledger l
  order by l.txn_date, l.created_at, l.voucher_id;
end;
$$;

-- ============================================================================
-- Row-Level Security
-- ============================================================================

alter table public.purchase_replacements        enable row level security;
alter table public.purchase_replacement_items   enable row level security;

-- purchase_replacements: readable by members with can_view_purchases.
drop policy if exists purchase_replacements_select_own on public.purchase_replacements;
create policy purchase_replacements_select_own on public.purchase_replacements
  for select using (
    business_id = public.current_business_id()
    and public.has_permission('can_view_purchases')
  );

-- purchase_replacement_items: readable by members with can_view_purchases.
drop policy if exists purchase_replacement_items_select_own on public.purchase_replacement_items;
create policy purchase_replacement_items_select_own on public.purchase_replacement_items
  for select using (
    business_id = public.current_business_id()
    and public.has_permission('can_view_purchases')
  );

-- ============================================================================
-- Updated_at triggers
-- ============================================================================
drop trigger if exists purchase_replacements_touch on public.purchase_replacements;
create trigger purchase_replacements_touch before update on public.purchase_replacements
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Add new permission to the catalog
-- ============================================================================
insert into public.permissions (code, module, description) values
  ('can_replace_purchases', 'purchases', 'Post purchase replacements (vendor replacement flow)')
on conflict (code) do update set
  module = excluded.module,
  description = excluded.description;

-- Grant to Owner/Admin and Accountant.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.business_id = 'biz-default' and r.name in ('Owner/Admin', 'Accountant')
  and p.code = 'can_replace_purchases'
on conflict do nothing;

-- Refresh PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Done. Phase 5a additions are live with:
--   ✓ purchase_replacements + purchase_replacement_items tables
--   ✓ post_purchase_replacement() RPC — atomic, value-diff-aware
--   ✓ post_advance_application() RPC — advance application with reclassifying voucher
--   ✓ vendor_ledger() RPC — proper per-vendor ledger from voucher_lines
--   ✓ REP-0001 concurrency-safe sequence
--   ✓ RLS on all new tables
--   ✓ Audit logs for all actions
--   ✓ New permission: can_replace_purchases
-- ============================================================================
