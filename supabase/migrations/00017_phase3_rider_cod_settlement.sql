-- Phase 3: rider-held COD collection and settlement.
-- Additive, transactional, and intentionally independent of the legacy
-- delivery-orders / COD-submission implementation.
begin;

do $$
declare v_missing text;
begin
  select string_agg(required_name, ', ' order by required_name) into v_missing
  from (values
    ('public.businesses', to_regclass('public.businesses')),
    ('public.profiles', to_regclass('public.profiles')),
    ('public.riders', to_regclass('public.riders')),
    ('public.invoices', to_regclass('public.invoices')),
    ('public.customers', to_regclass('public.customers')),
    ('public.payments', to_regclass('public.payments')),
    ('public.delivery_events', to_regclass('public.delivery_events')),
    ('public.rider_cash_ledger', to_regclass('public.rider_cash_ledger')),
    ('public.commission_events', to_regclass('public.commission_events'))
  ) required(required_name, relation_name)
  where relation_name is null;
  if v_missing is not null then
    raise exception 'Phase 3 rider COD requires verified production tables: %', v_missing;
  end if;
end $$;

-- The Phase 1 columns remain the idempotency and batch foundation.  The
-- following nullable additions describe only Phase 3 records; legacy rows are
-- deliberately left untouched.
alter table public.riders add column if not exists profile_id uuid;
alter table public.invoices add column if not exists rider_id uuid;
alter table public.invoices add column if not exists delivery_status text;
alter table public.invoices add column if not exists delivered_at timestamptz;
alter table public.invoices add column if not exists returned_at timestamptz;

alter table public.delivery_events add column if not exists business_id uuid;
alter table public.delivery_events add column if not exists invoice_id text;
alter table public.delivery_events add column if not exists rider_id uuid;
alter table public.delivery_events add column if not exists event_type text;
alter table public.delivery_events add column if not exists cash_collected numeric(20,0);
alter table public.delivery_events add column if not exists occurred_at timestamptz;

alter table public.rider_cash_ledger add column if not exists business_id uuid;
alter table public.rider_cash_ledger add column if not exists rider_id uuid;
alter table public.rider_cash_ledger add column if not exists invoice_id text;
alter table public.rider_cash_ledger add column if not exists event_type text;
alter table public.rider_cash_ledger add column if not exists amount numeric(20,0);
alter table public.rider_cash_ledger add column if not exists related_entry_id uuid;
alter table public.rider_cash_ledger add column if not exists delivered_at timestamptz;
alter table public.rider_cash_ledger add column if not exists created_at timestamptz;

update public.delivery_events set occurred_at = now() where occurred_at is null;
update public.rider_cash_ledger set created_at = now() where created_at is null;

create unique index if not exists riders_business_profile_id_idx
  on public.riders(business_id, profile_id) where profile_id is not null;
create index if not exists invoices_business_rider_delivery_idx
  on public.invoices(business_id, rider_id, delivery_status);
create unique index if not exists delivery_events_business_invoice_event_key_idx
  on public.delivery_events(business_id, invoice_id, event_type)
  where event_type in ('cod_delivered', 'delivery_returned');
create index if not exists rider_cash_ledger_outstanding_idx
  on public.rider_cash_ledger(business_id, rider_id, event_type, delivered_at, created_at);
create index if not exists rider_cash_ledger_related_entry_idx
  on public.rider_cash_ledger(related_entry_id) where related_entry_id is not null;

create table if not exists public.rider_cod_settlement_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  rider_id uuid not null references public.riders(id) on delete restrict,
  reference text not null,
  amount numeric(20,0) not null check (amount > 0),
  mode text not null,
  note text,
  idempotency_key text not null,
  request_fingerprint text not null,
  result jsonb,
  settled_by uuid,
  settled_at timestamptz not null default now(),
  constraint rider_cod_settlement_batches_reference_key unique (business_id, reference),
  constraint rider_cod_settlement_batches_idempotency_key unique (business_id, idempotency_key)
);
create index if not exists rider_cod_settlement_batches_rider_date_idx
  on public.rider_cod_settlement_batches(business_id, rider_id, settled_at desc);
alter table public.rider_cod_settlement_batches enable row level security;
revoke all on public.rider_cod_settlement_batches from public, anon, authenticated;
grant all on public.rider_cod_settlement_batches to service_role;

-- Do not retain legacy mutations that can receipt cash at delivery or allow a
-- client-selected settlement allocation.  The dynamic form safely removes all
-- overloads without assuming their old argument types.
do $$
declare v_proc record;
begin
  for v_proc in
    select p.oid, pg_get_function_identity_arguments(p.oid) as args, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('mark_order_delivered', 'mark_order_returned', 'create_cod_submission',
       'confirm_cod_submission', 'complete_cod_delivery', 'settle_rider_cod')
  loop
    execute format('drop function public.%I(%s)', v_proc.proname, v_proc.args);
  end loop;
end $$;

create or replace function public.phase3_assert_active_profile(p_business_id uuid)
returns public.profiles
language plpgsql security definer
set search_path = public
as $$
declare v_profile public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authenticated active profile is required' using errcode = '42501';
  end if;
  select pr.* into v_profile from public.profiles pr
   where pr.id = auth.uid()
     and pr.business_id = p_business_id
     and pr.status = 'Active';
  if not found then
    raise exception 'Active profile is not authorized for this business' using errcode = '42501';
  end if;
  return v_profile;
end $$;

create or replace function public.mark_cod_out_for_delivery(
  p_business_id uuid, p_invoice_id text, p_idempotency_key text
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_profile public.profiles%rowtype; v_rider public.riders%rowtype; v_invoice public.invoices%rowtype;
begin
  v_profile := public.phase3_assert_active_profile(p_business_id);
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then raise exception 'Idempotency key is required'; end if;
  select r.* into v_rider from public.riders r
   where r.business_id = p_business_id and r.profile_id = v_profile.id for update;
  if not found then raise exception 'Only the assigned rider can start delivery' using errcode = '42501'; end if;
  select i.* into v_invoice from public.invoices i
   where i.business_id = p_business_id and i.id = p_invoice_id for update;
  if not found or v_invoice.rider_id is distinct from v_rider.id then raise exception 'Invoice is not assigned to this rider' using errcode = '42501'; end if;
  if lower(coalesce(v_invoice.delivery_status, '')) in ('out for delivery', 'out_for_delivery') then
    return jsonb_build_object('invoice_id', p_invoice_id, 'status', 'Out for Delivery', 'idempotent', true);
  end if;
  if lower(coalesce(v_invoice.delivery_status, '')) not in ('assigned', '') then raise exception 'Invoice cannot start delivery from its current state'; end if;
  update public.invoices set delivery_status = 'Out for Delivery' where business_id = p_business_id and id = p_invoice_id;
  return jsonb_build_object('invoice_id', p_invoice_id, 'status', 'Out for Delivery', 'idempotent', false);
end $$;

create or replace function public.complete_cod_delivery(
  p_business_id uuid,
  p_invoice_id text,
  p_cash_collected numeric,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype; v_rider public.riders%rowtype; v_invoice public.invoices%rowtype;
  v_existing record; v_outstanding numeric(20,0); v_delivery_event_id uuid; v_ledger_id uuid;
begin
  v_profile := public.phase3_assert_active_profile(p_business_id);
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 or p_cash_collected is null or p_cash_collected < 0 then
    raise exception 'A non-negative collection and idempotency key are required';
  end if;
  select r.* into v_rider from public.riders r
   where r.business_id = p_business_id and r.profile_id = v_profile.id for update;
  if not found then raise exception 'Only a rider can complete COD delivery' using errcode = '42501'; end if;
  select de.id, de.business_id, de.invoice_id, de.rider_id, de.cash_collected into v_existing
    from public.delivery_events de where de.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.business_id = p_business_id and v_existing.invoice_id = p_invoice_id
       and v_existing.rider_id = v_rider.id and v_existing.cash_collected = p_cash_collected then
      return jsonb_build_object('invoice_id', p_invoice_id, 'delivery_event_id', v_existing.id,
                                'cash_collected', v_existing.cash_collected, 'idempotent', true);
    end if;
    raise exception 'Idempotency key conflicts with a different delivery request' using errcode = '23505';
  end if;
  select i.* into v_invoice from public.invoices i
   where i.business_id = p_business_id and i.id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if v_invoice.rider_id is distinct from v_rider.id then raise exception 'Invoice is not assigned to this rider' using errcode = '42501'; end if;
  if lower(coalesce(v_invoice.delivery_status, '')) not in ('out for delivery', 'out_for_delivery') then
    raise exception 'Invoice must be out for delivery before completion';
  end if;
  v_outstanding := greatest(coalesce(v_invoice.total, 0) - coalesce(v_invoice.paid, 0), 0);
  if p_cash_collected > v_outstanding then raise exception 'COD collection exceeds outstanding invoice balance'; end if;
  update public.invoices set delivery_status = 'Delivered', delivered_at = now()
   where business_id = p_business_id and id = p_invoice_id;
  insert into public.delivery_events (business_id, invoice_id, rider_id, event_type, cash_collected, occurred_at, idempotency_key)
  values (p_business_id, p_invoice_id, v_rider.id, 'cod_delivered', p_cash_collected, now(), p_idempotency_key)
  returning id into v_delivery_event_id;
  -- A non-COD invoice has no rider-held cash.  Delivery never changes paid,
  -- never creates a receipt, and never earns commission.
  if v_outstanding > 0 and p_cash_collected > 0 then
    insert into public.rider_cash_ledger
      (business_id, rider_id, invoice_id, event_type, amount, delivered_at, created_at, idempotency_key)
    values
      (p_business_id, v_rider.id, p_invoice_id, 'collection', p_cash_collected, now(), now(), 'phase3:collection:' || p_idempotency_key)
    returning id into v_ledger_id;
  end if;
  return jsonb_build_object('invoice_id', p_invoice_id, 'delivery_event_id', v_delivery_event_id,
                            'ledger_id', v_ledger_id, 'cash_collected', p_cash_collected, 'idempotent', false);
end $$;

create or replace function public.return_rider_delivery(
  p_business_id uuid, p_invoice_id text, p_reason text, p_idempotency_key text
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_profile public.profiles%rowtype; v_rider public.riders%rowtype; v_invoice public.invoices%rowtype; v_event uuid;
begin
  v_profile := public.phase3_assert_active_profile(p_business_id);
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then raise exception 'Idempotency key is required'; end if;
  select r.* into v_rider from public.riders r where r.business_id = p_business_id and r.profile_id = v_profile.id for update;
  if not found then raise exception 'Only a rider can return delivery' using errcode = '42501'; end if;
  select i.* into v_invoice from public.invoices i where i.business_id = p_business_id and i.id = p_invoice_id for update;
  if not found or v_invoice.rider_id is distinct from v_rider.id then raise exception 'Invoice is not assigned to this rider' using errcode = '42501'; end if;
  if lower(coalesce(v_invoice.delivery_status, '')) = 'returned' then return jsonb_build_object('invoice_id', p_invoice_id, 'status', 'Returned', 'idempotent', true); end if;
  if lower(coalesce(v_invoice.delivery_status, '')) not in ('out for delivery', 'out_for_delivery') then raise exception 'Delivered or settled delivery cannot be returned'; end if;
  if exists (select 1 from public.rider_cash_ledger rcl where rcl.business_id = p_business_id and rcl.invoice_id = p_invoice_id and rcl.event_type = 'settlement') then
    raise exception 'Settled delivery cannot be returned';
  end if;
  update public.invoices set delivery_status = 'Returned', returned_at = now() where business_id = p_business_id and id = p_invoice_id;
  insert into public.delivery_events (business_id, invoice_id, rider_id, event_type, cash_collected, occurred_at, idempotency_key)
  values (p_business_id, p_invoice_id, v_rider.id, 'delivery_returned', 0, now(), p_idempotency_key) returning id into v_event;
  return jsonb_build_object('invoice_id', p_invoice_id, 'delivery_event_id', v_event, 'status', 'Returned', 'idempotent', false);
end $$;

create or replace function public.settle_rider_cod(
  p_business_id uuid,
  p_rider_id uuid,
  p_amount numeric,
  p_mode text,
  p_note text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype; v_rider public.riders%rowtype; v_batch public.rider_cod_settlement_batches%rowtype;
  v_entry record; v_invoice public.invoices%rowtype; v_payment_id text; v_remaining numeric(20,0); v_allocate numeric(20,0);
  v_available numeric(20,0) := 0; v_reference text; v_result jsonb; v_fingerprint text; v_count int := 0;
begin
  v_profile := public.phase3_assert_active_profile(p_business_id);
  if v_profile.role = 'Rider' then raise exception 'Rider cannot settle own cash' using errcode = '42501'; end if;
  if v_profile.role not in ('Owner', 'Admin', 'Accountant')
     and not (coalesce(v_profile.perms, '{}'::text[]) && array['can_settle_rider_cod', 'can_confirm_cod_submission']) then
    raise exception 'Profile is not permitted to settle rider cash' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 or p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 or nullif(trim(coalesce(p_mode, '')), '') is null then
    raise exception 'Positive amount, mode, and idempotency key are required';
  end if;
  v_fingerprint := encode(digest(concat_ws('|', p_rider_id::text, p_amount::text, upper(trim(p_mode)), coalesce(p_note, '')), 'sha256'), 'hex');
  select * into v_batch from public.rider_cod_settlement_batches
   where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then
    if v_batch.request_fingerprint <> v_fingerprint then raise exception 'Idempotency key conflicts with a different settlement request' using errcode = '23505'; end if;
    return coalesce(v_batch.result, jsonb_build_object('reference', v_batch.reference, 'idempotent', true));
  end if;
  select r.* into v_rider from public.riders r where r.id = p_rider_id and r.business_id = p_business_id for update;
  if not found then raise exception 'Rider does not belong to this business'; end if;
  for v_entry in
    select c.id, c.invoice_id, c.amount, c.delivered_at, c.created_at,
      coalesce((select sum(s.amount) from public.rider_cash_ledger s where s.related_entry_id = c.id and s.event_type = 'settlement'), 0) as settled
    from public.rider_cash_ledger c
    where c.business_id = p_business_id and c.rider_id = p_rider_id and c.event_type = 'collection'
    order by c.delivered_at nulls last, c.created_at, c.id
    for update of c
  loop
    v_available := v_available + greatest(v_entry.amount - v_entry.settled, 0);
  end loop;
  if p_amount > v_available then raise exception 'Settlement exceeds rider held COD'; end if;
  v_reference := 'RCS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  insert into public.rider_cod_settlement_batches
    (business_id, rider_id, reference, amount, mode, note, idempotency_key, request_fingerprint, settled_by)
  values (p_business_id, p_rider_id, v_reference, p_amount, upper(trim(p_mode)), nullif(trim(p_note), ''), p_idempotency_key, v_fingerprint, v_profile.id)
  returning * into v_batch;
  v_remaining := p_amount;
  for v_entry in
    select c.id, c.invoice_id, c.amount, c.delivered_at, c.created_at,
      coalesce((select sum(s.amount) from public.rider_cash_ledger s where s.related_entry_id = c.id and s.event_type = 'settlement'), 0) as settled
    from public.rider_cash_ledger c
    where c.business_id = p_business_id and c.rider_id = p_rider_id and c.event_type = 'collection'
    order by c.delivered_at nulls last, c.created_at, c.id
  loop
    exit when v_remaining = 0;
    v_allocate := least(v_remaining, greatest(v_entry.amount - v_entry.settled, 0));
    if v_allocate <= 0 then continue; end if;
    select * into v_invoice from public.invoices i where i.business_id = p_business_id and i.id = v_entry.invoice_id for update;
    if not found then raise exception 'Collection references a missing invoice'; end if;
    if v_allocate > greatest(v_invoice.total - v_invoice.paid, 0) then raise exception 'Settlement exceeds the invoice balance'; end if;
    insert into public.rider_cash_ledger
      (business_id, rider_id, invoice_id, event_type, amount, related_entry_id, settlement_batch_id, created_at, idempotency_key)
    values
      (p_business_id, p_rider_id, v_entry.invoice_id, 'settlement', v_allocate, v_entry.id, v_batch.id::text, now(),
       'phase3:settlement:' || v_batch.id::text || ':' || v_entry.id::text);
    update public.invoices set paid = paid + v_allocate,
      status = case when paid + v_allocate >= total then 'Paid' else 'Partially Paid' end
      where business_id = p_business_id and id = v_entry.invoice_id;
    if v_invoice.customer_id is not null then
      update public.customers set credit = greatest(coalesce(credit, 0) - v_allocate, 0)
       where business_id = p_business_id and id = v_invoice.customer_id;
    end if;
    insert into public.payments (business_id, invoice_id, customer_id, amount, direction, payment_mode, idempotency_key)
    values (p_business_id, v_entry.invoice_id, v_invoice.customer_id, v_allocate, 'Received', upper(trim(p_mode)),
            'phase3:payment:' || v_batch.id::text || ':' || v_entry.id::text)
    returning id::text into v_payment_id;
    perform public.phase2_allocate_collection_commission(p_business_id, v_entry.invoice_id, v_payment_id);
    v_remaining := v_remaining - v_allocate; v_count := v_count + 1;
  end loop;
  if v_remaining <> 0 then raise exception 'Settlement allocation did not complete'; end if;
  v_result := jsonb_build_object('batch_id', v_batch.id, 'reference', v_reference, 'amount', p_amount,
                                 'allocation_count', v_count, 'idempotent', false);
  update public.rider_cod_settlement_batches set result = v_result where id = v_batch.id;
  return v_result;
end $$;

create or replace function public.get_rider_cod_balances(
  p_business_id uuid, p_rider_id uuid default null
) returns table(
  rider_id uuid, rider_name text, collected_cod numeric, settled_cod numeric,
  outstanding_cod numeric, invoice_count bigint, oldest_outstanding_delivery_date timestamptz,
  latest_settlement_date timestamptz
)
language plpgsql security definer
set search_path = public
as $$
declare v_profile public.profiles%rowtype; v_self_rider uuid;
begin
  v_profile := public.phase3_assert_active_profile(p_business_id);
  if v_profile.role = 'Rider' then
    select r.id into v_self_rider from public.riders r where r.business_id = p_business_id and r.profile_id = v_profile.id;
    if v_self_rider is null then raise exception 'No rider profile linked to this account' using errcode = '42501'; end if;
    if p_rider_id is not null and p_rider_id <> v_self_rider then raise exception 'Rider can only view own COD balance' using errcode = '42501'; end if;
    p_rider_id := v_self_rider;
  elsif v_profile.role not in ('Owner', 'Admin', 'Accountant')
    and not (coalesce(v_profile.perms, '{}'::text[]) && array['can_view_rider_cod', 'can_settle_rider_cod']) then
    raise exception 'Profile is not permitted to view rider COD' using errcode = '42501';
  end if;
  return query
  select r.id, r.name,
    coalesce(sum(case when c.event_type = 'collection' then c.amount else 0 end), 0),
    coalesce(sum(case when c.event_type = 'settlement' then c.amount else 0 end), 0),
    coalesce(sum(case when c.event_type = 'collection' then c.amount else -c.amount end), 0),
    count(distinct c.invoice_id) filter (where c.event_type = 'collection'),
    min(c.delivered_at) filter (where c.event_type = 'collection' and not exists (
      select 1 from public.rider_cash_ledger s where s.related_entry_id = c.id and s.event_type = 'settlement' and s.amount >= c.amount
    )),
    max(b.settled_at)
  from public.riders r
  left join public.rider_cash_ledger c on c.business_id = r.business_id and c.rider_id = r.id
  left join public.rider_cod_settlement_batches b on b.business_id = r.business_id and b.rider_id = r.id
  where r.business_id = p_business_id and (p_rider_id is null or r.id = p_rider_id)
  group by r.id, r.name;
end $$;

revoke all on function public.phase3_assert_active_profile(uuid) from public, anon, authenticated;
revoke all on function public.mark_cod_out_for_delivery(uuid, text, text) from public, anon;
revoke all on function public.complete_cod_delivery(uuid, text, numeric, text) from public, anon;
revoke all on function public.return_rider_delivery(uuid, text, text, text) from public, anon;
revoke all on function public.settle_rider_cod(uuid, uuid, numeric, text, text, text) from public, anon;
revoke all on function public.get_rider_cod_balances(uuid, uuid) from public, anon;
grant execute on function public.mark_cod_out_for_delivery(uuid, text, text) to authenticated, service_role;
grant execute on function public.complete_cod_delivery(uuid, text, numeric, text) to authenticated, service_role;
grant execute on function public.return_rider_delivery(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.settle_rider_cod(uuid, uuid, numeric, text, text, text) to authenticated, service_role;
grant execute on function public.get_rider_cod_balances(uuid, uuid) to authenticated, service_role;

commit;
