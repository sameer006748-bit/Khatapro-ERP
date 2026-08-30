-- KhataPro ERP — legacy-compatible rider delivery outcomes + COD settlement.
--
-- Additive and scoped to the VERIFIED legacy production schema (public.business
-- singular lineage): business / riders / delivery_orders / delivery_status_events /
-- rider_cod_submissions / rider_cod_submission_items / invoices /
-- invoice_items / sales_returns / accounts / vouchers / audit_logs /
-- legacy_transaction_identity_sequences. It does NOT introduce ledger_accounts,
-- rider_cash_ledger, delivery_line_progress, or the UUID/businesses lineage, and
-- it does NOT touch migrations 00017 / 00019 (those target the UUID ledger and
-- are not applicable to production).
--
-- What it adds:
--   1. delivery_line_outcomes — cumulative DELIVERED qty per invoice line for a
--      delivery order (returned qty is already tracked on invoice_items.returned_qty
--      by 00037's post_sales_return, which this reuses).
--   2. rider_cod_settlements + rider_cod_settlement_allocations — RDS settlement
--      batches with oldest-first allocation to delivered orders.
--   3. record_delivery_outcome() — partial delivery / partial return in one atomic
--      idempotent call. Returned quantities are routed through the existing 9-arg
--      post_sales_return (00037) so stock is restored exactly once, over-return is
--      rejected, invoice-item linkage is preserved, and commission is reversed.
--   4. get_rider_cod_balances() + settle_rider_cod() — COD held/settled/outstanding
--      per rider, and an atomic RDS settlement voucher (Dr money account / Cr 1310).
--
-- ACCOUNTING POLICY (balanced by construction, never touches Sales 4010 twice):
--   * The original ONLINE sale already booked Dr 1200 Customer Receivable /
--     Cr 4010 Sales for the product (00007 policy); the delivery fee is NOT in Sales.
--   * On a delivery outcome, for the DELIVERED portion we post:
--       Dr 1310 Rider COD Receivable = delivered_product + delivery_fee_this_event
--       Cr 1200 Customer Receivable  = delivered_product   (clears the receivable)
--       Cr 2020 Rider Payable        = rider earning        (order-level, once)
--       Cr 4030 Delivery Income      = company income       (order-level, once)
--     The delivery fee (rider earning + company income) is recognised IN FULL on
--     the FIRST outcome that delivers anything (one trip = one fee), tracked by
--     delivery_orders.delivery_fee_recognized; later partial events add no new fee.
--   * The RETURNED portion is reversed via post_sales_return in CREDIT mode
--     (Dr 4010 / Cr 1200): no cash left the business on a COD return, so the
--     customer receivable is simply cleared. Stock is restored there, once.
--   * Collected cash must equal the collectible for the delivered portion
--     (delivered_product + delivery_fee_this_event) — the same exact-collection
--     invariant production's mark_order_delivered already enforces, scoped to partial.
--   * Settlement posts Dr <money account by mode> / Cr 1310 for the settled amount,
--     allocated oldest-delivered-first; this is the ONLY place 1310 is relieved for
--     the Phase-3 settlement path.
--
-- Applied explicitly only after preflight; application code never runs migrations.

begin;

-- Preflight: fail before changing anything when the verified legacy contract is
-- not present.
do $$
declare v_missing text;
begin
  select string_agg(name, ', ' order by name) into v_missing
  from (values
    ('public.business', to_regclass('public.business')),
    ('public.riders', to_regclass('public.riders')),
    ('public.delivery_orders', to_regclass('public.delivery_orders')),
    ('public.delivery_status_events', to_regclass('public.delivery_status_events')),
    ('public.rider_cod_submissions', to_regclass('public.rider_cod_submissions')),
    ('public.rider_cod_submission_items', to_regclass('public.rider_cod_submission_items')),
    ('public.invoices', to_regclass('public.invoices')),
    ('public.invoice_items', to_regclass('public.invoice_items')),
    ('public.sales_returns', to_regclass('public.sales_returns')),
    ('public.accounts', to_regclass('public.accounts')),
    ('public.vouchers', to_regclass('public.vouchers')),
    ('public.audit_logs', to_regclass('public.audit_logs')),
    ('public.legacy_transaction_identity_requests', to_regclass('public.legacy_transaction_identity_requests'))
  ) required(name, relation_name)
  where relation_name is null;
  if v_missing is not null then
    raise exception '00039 preflight failed: required legacy relations are missing: %', v_missing;
  end if;
  if to_regprocedure('public.allocate_legacy_transaction_identity(text,text)') is null
     or to_regprocedure('public.post_voucher(text,text,date,text,jsonb,text,text,uuid)') is null
     or to_regprocedure('public.claim_legacy_transaction_request(text,text,text)') is null
     or to_regprocedure('public.post_sales_return(text,text,date,jsonb,text,text,text,uuid,text)') is null then
    raise exception '00039 preflight failed: required legacy helpers or migrations 00036/00037 are missing';
  end if;
  -- invoice_items.returned_qty is added by 00037 and is required to derive remaining.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoice_items' and column_name = 'returned_qty'
  ) then
    raise exception '00039 preflight failed: invoice_items.returned_qty (migration 00037) is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'legacy_transaction_identity_requests'
      and column_name = 'request_fingerprint'
  ) then
    raise exception '00039 preflight failed: request_fingerprint (migration 00037) is missing';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Schema additions.
-- ---------------------------------------------------------------------------

-- Track whether the one-trip delivery fee (rider earning + company income) has
-- already been recognised for this order, so partial outcomes never double-book it.
alter table public.delivery_orders
  add column if not exists delivery_fee_recognized boolean not null default false;

-- Cumulative delivered qty per invoice line for a delivery order. Returned qty
-- lives on invoice_items.returned_qty (maintained by post_sales_return / 00037);
-- remaining = invoice_items.qty - returned_qty - delivered_qty.
create table if not exists public.delivery_line_outcomes (
  id text primary key default gen_random_uuid()::text,
  business_id text not null references public.business(id) on delete cascade,
  delivery_order_id text not null references public.delivery_orders(id) on delete cascade,
  invoice_item_id text not null references public.invoice_items(id) on delete restrict,
  delivered_qty integer not null default 0 check (delivered_qty >= 0),
  updated_at timestamptz not null default now(),
  unique (delivery_order_id, invoice_item_id)
);
create index if not exists delivery_line_outcomes_biz_item_idx
  on public.delivery_line_outcomes(business_id, invoice_item_id);

-- RDS settlement batches — one readable RDS identity per settlement.
create table if not exists public.rider_cod_settlements (
  id text primary key default gen_random_uuid()::text,
  business_id text not null references public.business(id) on delete cascade,
  reference text not null,
  rider_id text not null references public.riders(id) on delete restrict,
  settlement_date date not null,
  amount numeric(20,0) not null check (amount > 0),
  mode text not null,
  note text,
  voucher_id text references public.vouchers(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint rider_cod_settlements_business_reference_key unique (business_id, reference)
);
create index if not exists rider_cod_settlements_rider_idx
  on public.rider_cod_settlements(business_id, rider_id, settlement_date desc);

-- Oldest-first allocation of a settlement across delivered delivery orders.
create table if not exists public.rider_cod_settlement_allocations (
  id text primary key default gen_random_uuid()::text,
  business_id text not null references public.business(id) on delete cascade,
  settlement_id text not null references public.rider_cod_settlements(id) on delete cascade,
  delivery_order_id text not null references public.delivery_orders(id) on delete restrict,
  amount numeric(20,0) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (settlement_id, delivery_order_id)
);
create index if not exists rider_cod_settlement_alloc_order_idx
  on public.rider_cod_settlement_allocations(business_id, delivery_order_id);

-- RLS + grants — no anon/authenticated/public access.
alter table public.delivery_line_outcomes enable row level security;
alter table public.rider_cod_settlements enable row level security;
alter table public.rider_cod_settlement_allocations enable row level security;
revoke all on table public.delivery_line_outcomes from public, anon, authenticated;
revoke all on table public.rider_cod_settlements from public, anon, authenticated;
revoke all on table public.rider_cod_settlement_allocations from public, anon, authenticated;
grant select, insert, update on table public.delivery_line_outcomes to service_role;
grant select, insert on table public.rider_cod_settlements to service_role;
grant select, insert on table public.rider_cod_settlement_allocations to service_role;

-- Relax the legacy status check so partial delivery is representable without a
-- second status column. Additive: keeps every existing value valid.
alter table public.delivery_orders
  drop constraint if exists delivery_orders_status_check;
alter table public.delivery_orders
  add constraint delivery_orders_status_check
  check (status in ('pending','assigned','out_for_delivery','delivered','returned','Partially Delivered'));

-- ---------------------------------------------------------------------------
-- 2. record_delivery_outcome() — partial delivery / partial return, atomic.
--    p_items: [{invoice_item_id, delivered_qty, returned_qty}, ...]
--    Returned quantities are routed through the 9-arg post_sales_return (00037)
--    in CREDIT mode (Dr 4010 / Cr 1200) — a COD return moved no cash, so it only
--    clears the customer receivable and restores stock (once). Delivered
--    quantities post the COD-receivable delivery voucher; the one-trip delivery
--    fee is recognised in full on the first outcome that delivers anything.
-- ---------------------------------------------------------------------------
create or replace function public.record_delivery_outcome(
  p_business_id text,
  p_invoice_id text,
  p_items jsonb,
  p_cash_collected numeric(20,0),
  p_reason text,
  p_idempotency_key text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean;
  v_result jsonb;
  v_order public.delivery_orders%rowtype;
  v_item jsonb;
  v_line record;
  v_delivered integer;
  v_returned integer;
  v_prior_delivered integer;
  v_remaining integer;
  v_distinct integer;
  v_total_delivered integer := 0;
  v_total_returned integer := 0;
  v_delivered_value numeric(20,0) := 0;
  v_return_items jsonb := '[]'::jsonb;
  v_return_count integer := 0;
  v_fee_this_event numeric(20,0) := 0;
  v_collectible numeric(20,0);
  v_rider_cod_acct text;
  v_cust_recv_acct text;
  v_rider_payable_acct text;
  v_delivery_income_acct text;
  v_lines jsonb;
  v_voucher_id text;
  v_outcome_no text;
  v_sale_return jsonb;
  v_sale_return_id text := null;
  v_remaining_order integer;
  v_new_status text;
  v_request_fingerprint text;
  v_saved_fingerprint text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one outcome line is required';
  end if;
  if p_cash_collected is null or p_cash_collected < 0 then
    raise exception 'Collected amount cannot be negative';
  end if;

  v_request_fingerprint := md5(jsonb_build_object(
    'invoice_id', p_invoice_id,
    'items', p_items,
    'cash_collected', p_cash_collected,
    'reason', p_reason
  )::text);

  select count(distinct value->>'invoice_item_id') into v_distinct
  from jsonb_array_elements(p_items);
  if v_distinct <> jsonb_array_length(p_items) then
    raise exception 'An invoice item cannot appear twice in one outcome';
  end if;

  -- Idempotency claim; replay returns the original result.
  select claimed, replay into v_claimed, v_result
  from public.claim_legacy_transaction_request(p_business_id, 'delivery_outcome', p_idempotency_key);
  if not v_claimed then
    select request_fingerprint into v_saved_fingerprint
    from public.legacy_transaction_identity_requests
    where business_id = p_business_id and operation = 'delivery_outcome'
      and idempotency_key = p_idempotency_key;
    if v_saved_fingerprint is distinct from v_request_fingerprint then
      raise exception 'The idempotency key was already used for a different delivery outcome';
    end if;
    return v_result || jsonb_build_object('idempotent', true);
  end if;
  update public.legacy_transaction_identity_requests
  set request_fingerprint = v_request_fingerprint
  where business_id = p_business_id and operation = 'delivery_outcome'
    and idempotency_key = p_idempotency_key;

  select * into v_order from public.delivery_orders
  where invoice_id = p_invoice_id and business_id = p_business_id
  for update;
  if not found then raise exception 'Delivery order not found for this invoice'; end if;
  if v_order.rider_id is null then
    raise exception 'A rider must be assigned before recording a delivery outcome';
  end if;
  if not exists (select 1 from public.riders
    where id = v_order.rider_id and business_id = p_business_id) then
    raise exception 'The assigned rider is invalid for this business';
  end if;
  if v_order.status not in ('assigned','out_for_delivery','Partially Delivered') then
    raise exception 'Cannot record an outcome: order status is %', v_order.status;
  end if;

  -- Resolve control accounts once.
  select id into v_rider_cod_acct from public.accounts
  where business_id = p_business_id and code = '1310' and is_active = true;
  if not found then raise exception 'Rider COD Receivable (1310) not found'; end if;
  select id into v_cust_recv_acct from public.accounts
  where business_id = p_business_id and code = '1200' and is_active = true;
  if not found then raise exception 'Customers Receivable (1200) not found'; end if;

  -- Validate + lock every line before the first business write.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_delivered := coalesce((v_item->>'delivered_qty')::integer, 0);
      v_returned := coalesce((v_item->>'returned_qty')::integer, 0);
    exception when others then
      raise exception 'Outcome quantities must be whole numbers';
    end;
    if v_delivered < 0 or v_returned < 0 then
      raise exception 'Outcome quantities cannot be negative';
    end if;
    if v_delivered = 0 and v_returned = 0 then
      continue;
    end if;

    select ii.id, ii.qty, ii.returned_qty, ii.unit_price into v_line
    from public.invoice_items ii
    where ii.id = v_item->>'invoice_item_id'
      and ii.invoice_id = p_invoice_id
      and ii.business_id = p_business_id
    for update;
    if not found then
      raise exception 'Referenced invoice item does not belong to the original invoice and business';
    end if;

    select coalesce(delivered_qty, 0) into v_prior_delivered
    from public.delivery_line_outcomes
    where delivery_order_id = v_order.id and invoice_item_id = v_line.id;
    v_prior_delivered := coalesce(v_prior_delivered, 0);

    -- Remaining is bounded by both prior deliveries and prior returns.
    v_remaining := v_line.qty - v_line.returned_qty - v_prior_delivered;
    if v_delivered + v_returned > v_remaining then
      raise exception 'Delivered + returned (%) exceeds remaining quantity (%) for an invoice line',
        v_delivered + v_returned, v_remaining;
    end if;

    v_total_delivered := v_total_delivered + v_delivered;
    v_total_returned := v_total_returned + v_returned;
    v_delivered_value := v_delivered_value + (v_line.unit_price * v_delivered);
    if v_returned > 0 then
      v_return_items := v_return_items || jsonb_build_object(
        'invoice_item_id', v_line.id, 'qty', v_returned);
      v_return_count := v_return_count + 1;
    end if;
  end loop;

  if v_total_delivered = 0 and v_total_returned = 0 then
    raise exception 'Outcome has no delivered or returned quantity';
  end if;

  -- One-trip delivery fee: recognised in full on the first outcome that delivers.
  if v_total_delivered > 0 and not v_order.delivery_fee_recognized then
    v_fee_this_event := v_order.rider_earning_amount + v_order.company_delivery_income;
  end if;
  v_collectible := v_delivered_value + v_fee_this_event;
  if p_cash_collected <> v_collectible then
    raise exception 'Collected amount (%) must equal the delivered collectible (%)',
      p_cash_collected, v_collectible;
  end if;

  -- Route the returned portion through the shared historical-return engine.
  if v_return_count > 0 then
    v_sale_return := public.post_sales_return(
      p_business_id, p_invoice_id, (now() at time zone 'Asia/Karachi')::date,
      v_return_items, 'CREDIT', null,
      coalesce(p_reason, 'Rider delivery return'),
      p_actor_id, p_idempotency_key || ':return'
    );
    v_sale_return_id := v_sale_return->>'return_id';
  end if;

  -- Post the delivery COD voucher for the delivered portion (if any).
  if v_collectible > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_rider_cod_acct, 'debit', v_collectible::text,
        'credit', '0', 'memo', 'COD collectible on delivery')
    );
    if v_delivered_value > 0 then
      v_lines := v_lines || jsonb_build_object('account_id', v_cust_recv_acct,
        'debit', '0', 'credit', v_delivered_value::text,
        'memo', 'Customer receivable settled on delivery');
    end if;
    if v_fee_this_event > 0 and v_order.rider_earning_amount > 0 then
      select id into v_rider_payable_acct from public.accounts
      where business_id = p_business_id and code = '2020' and is_active = true;
      if not found then raise exception 'Rider Payable (2020) not found'; end if;
      v_lines := v_lines || jsonb_build_object('account_id', v_rider_payable_acct,
        'debit', '0', 'credit', v_order.rider_earning_amount::text,
        'memo', 'Rider delivery earning');
    end if;
    if v_fee_this_event > 0 and v_order.company_delivery_income > 0 then
      select id into v_delivery_income_acct from public.accounts
      where business_id = p_business_id and code = '4030' and is_active = true;
      if not found then raise exception 'Delivery Income (4030) not found'; end if;
      v_lines := v_lines || jsonb_build_object('account_id', v_delivery_income_acct,
        'debit', '0', 'credit', v_order.company_delivery_income::text,
        'memo', 'Company delivery income share');
    end if;

    v_voucher_id := public.post_voucher(
      p_business_id, 'DR', (now() at time zone 'Asia/Karachi')::date,
      'Delivery outcome: ' || p_invoice_id, v_lines,
      v_order.id, 'delivery_outcome', p_actor_id
    );
  end if;

  -- Persist cumulative delivered qty per line.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_delivered := coalesce((v_item->>'delivered_qty')::integer, 0);
    if v_delivered > 0 then
      insert into public.delivery_line_outcomes
        (business_id, delivery_order_id, invoice_item_id, delivered_qty)
      values (p_business_id, v_order.id, v_item->>'invoice_item_id', v_delivered)
      on conflict (delivery_order_id, invoice_item_id)
      do update set delivered_qty = public.delivery_line_outcomes.delivered_qty + excluded.delivered_qty,
                    updated_at = now();
    end if;
  end loop;

  -- Determine the resulting order status from remaining collectible quantity.
  select coalesce(sum(ii.qty - ii.returned_qty), 0)
       - coalesce((select sum(dlo.delivered_qty) from public.delivery_line_outcomes dlo
                   where dlo.delivery_order_id = v_order.id), 0)
    into v_remaining_order
  from public.invoice_items ii
  where ii.invoice_id = p_invoice_id and ii.business_id = p_business_id;

  if v_remaining_order <= 0 then
    -- Nothing left: delivered if anything was ever delivered, else fully returned.
    if v_total_delivered > 0
       or exists (select 1 from public.delivery_line_outcomes dlo
                  where dlo.delivery_order_id = v_order.id and dlo.delivered_qty > 0) then
      v_new_status := 'delivered';
    else
      v_new_status := 'returned';
    end if;
  else
    v_new_status := 'Partially Delivered';
  end if;

  v_outcome_no := public.allocate_legacy_transaction_identity(p_business_id, 'DO');

  update public.delivery_orders
  set status = v_new_status,
      cod_collected_amount = cod_collected_amount + p_cash_collected,
      delivery_fee_recognized = delivery_fee_recognized or (v_fee_this_event > 0),
      delivered_at = case when v_new_status = 'delivered' then now() else delivered_at end,
      returned_at = case when v_new_status = 'returned' then now() else returned_at end,
      delivery_voucher_id = coalesce(delivery_voucher_id, v_voucher_id),
      updated_at = now(), updated_by = p_actor_id
  where id = v_order.id;

  insert into public.delivery_status_events
    (business_id, delivery_order_id, from_status, to_status, rider_id, note, created_by)
  values (p_business_id, v_order.id, v_order.status, v_new_status, v_order.rider_id,
    coalesce(p_reason, 'Delivery outcome ' || v_outcome_no), p_actor_id);

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_actor_id, 'RECORD_DELIVERY_OUTCOME', 'delivery_order', v_order.id,
    jsonb_build_object('outcome_no', v_outcome_no, 'delivered', v_total_delivered,
      'returned', v_total_returned, 'cash', p_cash_collected,
      'voucher_id', v_voucher_id, 'sale_return_id', v_sale_return_id));

  v_result := jsonb_build_object(
    'batch_id', v_order.id,
    'outcome_no', v_outcome_no,
    'invoice_id', p_invoice_id,
    'status', v_new_status,
    'delivered_qty', v_total_delivered,
    'returned_qty', v_total_returned,
    'remaining_qty', greatest(v_remaining_order, 0),
    'cash_collected', p_cash_collected::text,
    'sale_return_id', v_sale_return_id,
    'idempotent', false
  );
  update public.legacy_transaction_identity_requests set result = v_result
  where business_id = p_business_id and operation = 'delivery_outcome'
    and idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;

revoke all on function public.record_delivery_outcome(
  text, text, jsonb, numeric, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.record_delivery_outcome(
  text, text, jsonb, numeric, text, text, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- 3. get_rider_cod_balances() — collected / settled / outstanding per rider.
--    Collected = cash collected on delivered orders (cod_collected_amount).
--    Settled   = preserved confirmed COD submissions + new RDS settlements.
--    Outstanding = collected - settled.
-- ---------------------------------------------------------------------------
create or replace function public.get_rider_cod_balances(
  p_business_id text,
  p_rider_id text default null
)
returns table (
  rider_id text, rider_name text, collected_cod numeric, settled_cod numeric,
  outstanding_cod numeric, invoice_count bigint,
  oldest_outstanding_delivery_date date, latest_settlement_date date
)
language sql
stable
security definer
set search_path = public
as $$
  with legacy_order_settled as (
    select si.delivery_order_id, sum(si.amount_allocated) as amount
    from public.rider_cod_submission_items si
    join public.rider_cod_submissions s on s.id = si.submission_id
      and s.business_id = p_business_id and s.status = 'confirmed'
    where si.business_id = p_business_id
    group by si.delivery_order_id
  ),
  rds_order_settled as (
    select a.delivery_order_id, sum(a.amount) as amount
    from public.rider_cod_settlement_allocations a
    where a.business_id = p_business_id
    group by a.delivery_order_id
  ),
  collected as (
    select doo.rider_id,
           sum(doo.cod_collected_amount) as collected_cod,
           count(*) filter (where doo.cod_collected_amount
             > coalesce(los.amount, 0) + coalesce(ros.amount, 0)) as invoice_count,
           min(doo.delivered_at::date) filter (where doo.cod_collected_amount
             > coalesce(los.amount, 0) + coalesce(ros.amount, 0)) as oldest_delivery_date
    from public.delivery_orders doo
    left join legacy_order_settled los on los.delivery_order_id = doo.id
    left join rds_order_settled ros on ros.delivery_order_id = doo.id
    where doo.business_id = p_business_id
      and doo.rider_id is not null
      and doo.status in ('delivered','Partially Delivered')
      and doo.cod_collected_amount > 0
    group by doo.rider_id
  ),
  legacy_settled as (
    select s.rider_id,
           sum(s.confirmed_cash_amount + s.rider_fee_deduction) as settled_cod,
           max(s.confirmed_at::date) as latest_settlement_date
    from public.rider_cod_submissions s
    where s.business_id = p_business_id and s.status = 'confirmed'
    group by s.rider_id
  ),
  rds_settled as (
    select s.rider_id,
           sum(s.amount) as settled_cod,
           max(s.settlement_date) as latest_settlement_date
    from public.rider_cod_settlements s
    where s.business_id = p_business_id
    group by s.rider_id
  )
  select r.id as rider_id, r.name as rider_name,
    coalesce(c.collected_cod, 0) as collected_cod,
    coalesce(ls.settled_cod, 0) + coalesce(rs.settled_cod, 0) as settled_cod,
    greatest(coalesce(c.collected_cod, 0)
      - coalesce(ls.settled_cod, 0) - coalesce(rs.settled_cod, 0), 0) as outstanding_cod,
    coalesce(c.invoice_count, 0) as invoice_count,
    c.oldest_delivery_date as oldest_outstanding_delivery_date,
    greatest(ls.latest_settlement_date, rs.latest_settlement_date) as latest_settlement_date
  from public.riders r
  left join collected c on c.rider_id = r.id
  left join legacy_settled ls on ls.rider_id = r.id
  left join rds_settled rs on rs.rider_id = r.id
  where r.business_id = p_business_id
    and (p_rider_id is null or r.id = p_rider_id)
    and (coalesce(c.collected_cod, 0) > 0
      or coalesce(ls.settled_cod, 0) > 0
      or coalesce(rs.settled_cod, 0) > 0)
  order by r.name;
$$;

revoke all on function public.get_rider_cod_balances(text, text) from public, anon, authenticated;
grant execute on function public.get_rider_cod_balances(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. settle_rider_cod() — atomic RDS settlement of held COD, oldest-first.
--    Posts Dr <money account by mode> / Cr 1310 Rider COD Receivable.
--    The amount cannot exceed the rider's outstanding COD. Allocation is applied
--    oldest-delivered-order-first for a clean audit trail.
-- ---------------------------------------------------------------------------
create or replace function public.settle_rider_cod(
  p_business_id text,
  p_rider_id text,
  p_amount numeric(20,0),
  p_mode text,
  p_note text,
  p_idempotency_key text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean;
  v_result jsonb;
  v_outstanding numeric(20,0);
  v_money_acct text;
  v_rider_cod_acct text;
  v_settlement_id text;
  v_reference text;
  v_voucher_id text;
  v_lines jsonb;
  v_remaining numeric(20,0);
  v_alloc numeric(20,0);
  v_order record;
  v_alloc_count integer := 0;
  v_settled_so_far numeric(20,0);
  v_request_fingerprint text;
  v_saved_fingerprint text;
begin
  if p_amount is null or p_amount <= 0 or p_amount <> trunc(p_amount) then
    raise exception 'Settlement amount must be a positive whole number';
  end if;
  if upper(coalesce(p_mode, '')) not in ('CASH','BANK','ONLINE') then
    raise exception 'Settlement mode must be Cash, Bank, or Online';
  end if;

  v_request_fingerprint := md5(jsonb_build_object(
    'rider_id', p_rider_id,
    'amount', p_amount,
    'mode', upper(p_mode),
    'note', p_note
  )::text);

  select claimed, replay into v_claimed, v_result
  from public.claim_legacy_transaction_request(p_business_id, 'rider_cod_settlement', p_idempotency_key);
  if not v_claimed then
    select request_fingerprint into v_saved_fingerprint
    from public.legacy_transaction_identity_requests
    where business_id = p_business_id and operation = 'rider_cod_settlement'
      and idempotency_key = p_idempotency_key;
    if v_saved_fingerprint is distinct from v_request_fingerprint then
      raise exception 'The idempotency key was already used for a different rider COD settlement';
    end if;
    return v_result || jsonb_build_object('idempotent', true);
  end if;
  update public.legacy_transaction_identity_requests
  set request_fingerprint = v_request_fingerprint
  where business_id = p_business_id and operation = 'rider_cod_settlement'
    and idempotency_key = p_idempotency_key;

  -- Serialize settlement checks for a rider so two different request keys cannot
  -- both spend the same outstanding balance.
  perform 1 from public.riders
  where id = p_rider_id and business_id = p_business_id
  for update;
  if not found then
    raise exception 'Invalid rider for this business';
  end if;

  -- Outstanding includes both preserved legacy confirmations and new RDS rows.
  select coalesce(sum(doo.cod_collected_amount), 0) into v_outstanding
  from public.delivery_orders doo
  where doo.business_id = p_business_id and doo.rider_id = p_rider_id
    and doo.status in ('delivered','Partially Delivered');
  v_outstanding := v_outstanding - coalesce((
    select sum(s.confirmed_cash_amount + s.rider_fee_deduction)
    from public.rider_cod_submissions s
    where s.business_id = p_business_id and s.rider_id = p_rider_id
      and s.status = 'confirmed'
  ), 0) - coalesce((
    select sum(s.amount) from public.rider_cod_settlements s
    where s.business_id = p_business_id and s.rider_id = p_rider_id
  ), 0);

  if p_amount > v_outstanding then
    raise exception 'Settlement amount (%) exceeds outstanding COD (%)', p_amount, v_outstanding;
  end if;

  -- Resolve the destination money account from the mode.
  select id into v_money_acct from public.accounts
  where business_id = p_business_id and is_active = true and is_business_account = true
    and code = case upper(p_mode)
      when 'CASH' then '1010'
      when 'BANK' then '1030'
      when 'ONLINE' then '1040' end
  order by code
  limit 1;
  if not found then
    raise exception 'The selected settlement money account is unavailable';
  end if;

  select id into v_rider_cod_acct from public.accounts
  where business_id = p_business_id and code = '1310' and is_active = true;
  if not found then raise exception 'Rider COD Receivable (1310) not found'; end if;

  v_reference := public.allocate_legacy_transaction_identity(p_business_id, 'RDS');
  v_settlement_id := gen_random_uuid()::text;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_money_acct, 'debit', p_amount::text, 'credit', '0',
      'memo', 'Rider COD settlement ' || v_reference),
    jsonb_build_object('account_id', v_rider_cod_acct, 'debit', '0', 'credit', p_amount::text,
      'memo', 'Rider COD receivable settled ' || v_reference)
  );
  v_voucher_id := public.post_voucher(
    p_business_id, 'RDS', (now() at time zone 'Asia/Karachi')::date,
    'Rider COD settlement ' || v_reference, v_lines,
    v_settlement_id, 'rider_cod_settlement', p_actor_id
  );

  insert into public.rider_cod_settlements
    (id, business_id, reference, rider_id, settlement_date, amount, mode, note, voucher_id, created_by)
  values (v_settlement_id, p_business_id, v_reference, p_rider_id,
    (now() at time zone 'Asia/Karachi')::date, p_amount, p_mode, p_note, v_voucher_id, p_actor_id);

  -- Oldest-delivered-first allocation across this rider's collected orders.
  v_remaining := p_amount;
  for v_order in
    select doo.id, doo.cod_collected_amount,
      coalesce((select sum(a.amount) from public.rider_cod_settlement_allocations a
                where a.business_id = p_business_id and a.delivery_order_id = doo.id), 0)
      + coalesce((select sum(si.amount_allocated)
                  from public.rider_cod_submission_items si
                  join public.rider_cod_submissions s on s.id = si.submission_id
                    and s.business_id = p_business_id and s.status = 'confirmed'
                  where si.business_id = p_business_id
                    and si.delivery_order_id = doo.id), 0) as already_allocated
    from public.delivery_orders doo
    where doo.business_id = p_business_id and doo.rider_id = p_rider_id
      and doo.status in ('delivered','Partially Delivered')
      and doo.cod_collected_amount > 0
    order by doo.delivered_at nulls last, doo.created_at
  loop
    exit when v_remaining <= 0;
    v_settled_so_far := v_order.cod_collected_amount - v_order.already_allocated;
    if v_settled_so_far <= 0 then continue; end if;
    v_alloc := least(v_remaining, v_settled_so_far);
    insert into public.rider_cod_settlement_allocations
      (business_id, settlement_id, delivery_order_id, amount)
    values (p_business_id, v_settlement_id, v_order.id, v_alloc);
    v_remaining := v_remaining - v_alloc;
    v_alloc_count := v_alloc_count + 1;
  end loop;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_actor_id, 'SETTLE_RIDER_COD', 'rider_cod_settlement', v_settlement_id,
    jsonb_build_object('reference', v_reference, 'rider_id', p_rider_id,
      'amount', p_amount, 'voucher_id', v_voucher_id, 'allocations', v_alloc_count));

  v_result := jsonb_build_object(
    'batch_id', v_settlement_id,
    'reference', v_reference,
    'amount', p_amount::text,
    'allocation_count', v_alloc_count,
    'idempotent', false
  );
  update public.legacy_transaction_identity_requests set result = v_result
  where business_id = p_business_id and operation = 'rider_cod_settlement'
    and idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;

revoke all on function public.settle_rider_cod(
  text, text, numeric, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.settle_rider_cod(
  text, text, numeric, text, text, text, uuid
) to service_role;

NOTIFY pgrst, 'reload schema';

commit;
