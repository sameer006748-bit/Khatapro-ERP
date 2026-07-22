-- Phase 2: linked sales returns and collection-based commission.
-- Additive production migration.  Do not execute this file from application code.
-- The accounting model is deliberately invoice/customer/payment based: it does
-- not reference accounts, vouchers, or voucher_lines.

begin;

-- Fail before changing anything if the verified production model has drifted.
do $$
declare v_missing text;
begin
  select string_agg(required_name, ', ' order by required_name) into v_missing
  from (values
    ('public.invoices', to_regclass('public.invoices')),
    ('public.invoice_items', to_regclass('public.invoice_items')),
    ('public.products', to_regclass('public.products')),
    ('public.customers', to_regclass('public.customers')),
    ('public.payments', to_regclass('public.payments')),
    ('public.profiles', to_regclass('public.profiles')),
    ('public.salesmen', to_regclass('public.salesmen')),
    ('public.roles', to_regclass('public.roles')),
    ('public.permissions', to_regclass('public.permissions')),
    ('public.role_permissions', to_regclass('public.role_permissions')),
    ('public.sale_return_documents', to_regclass('public.sale_return_documents')),
    ('public.sale_return_lines', to_regclass('public.sale_return_lines')),
    ('public.commission_events', to_regclass('public.commission_events'))
  ) required(required_name, relation_name)
  where relation_name is null;
  if v_missing is not null then
    raise exception 'Phase 2 requires verified production base tables: %. Aborting without changes.', v_missing;
  end if;
end $$;

-- Phase 2 payment links are additive.  They make a payment unambiguously an
-- invoice collection or a cash/bank refund without repurposing customer-level
-- receipts.  Existing payment columns and rows are retained.
alter table public.payments add column if not exists invoice_id text;
alter table public.payments add column if not exists customer_id text;
alter table public.payments add column if not exists direction text;
alter table public.payments add column if not exists payment_mode text;
alter table public.payments add column if not exists idempotency_key text;
alter table public.payments add column if not exists return_document_id uuid;
create unique index if not exists payments_business_idempotency_key_idx
  on public.payments(business_id, idempotency_key) where idempotency_key is not null;
create index if not exists payments_business_invoice_idx
  on public.payments(business_id, invoice_id) where invoice_id is not null;

-- The API invokes RPCs through the service role.  Direct authenticated callers
-- are also checked against the active profile and role-permission map below.
-- auth.uid() is NULL for the service-role path, which is intentionally allowed;
-- that role has no client credential and the HTTP routes perform the same check.
create or replace function public.phase2_assert_actor(
  p_business_id uuid,
  p_permission text
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then return; end if;
  if not exists (
    select 1
    from public.profiles pr
    join public.roles r on r.id = pr.role_id and r.business_id = pr.business_id
    left join public.role_permissions rp on rp.role_id = r.id
    left join public.permissions pe on pe.id = rp.permission_id
    where pr.user_id = auth.uid()
      and pr.business_id = p_business_id
      and pr.is_active
      and (r.name = 'Owner/Admin' or pe.code = p_permission)
  ) then
    raise exception 'Phase 2 authorization denied for business %', p_business_id using errcode = '42501';
  end if;
end $$;

-- Snapshot the rate at sale-line creation.  The trigger intentionally has no
-- dependency on a current product rate after the snapshot is written.
create or replace function public.phase2_capture_commission_eligibility()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice record;
  v_rate numeric(20,0) := 0;
  v_eligible numeric(20,0) := 0;
  v_initial_earned numeric(20,0) := 0;
  v_owner_only boolean := false;
begin
  select i.business_id, i.id, i.salesman_id, i.total, i.paid, i.status
    into v_invoice
    from public.invoices i
   where i.business_id = new.business_id and i.id = new.invoice_id;
  if not found then raise exception 'Invoice item does not belong to a production invoice'; end if;
  if new.product_id is not null then
    select coalesce(p.commission_rate, 0) into v_rate
      from public.products p where p.business_id = new.business_id and p.id = new.product_id;
  end if;
  v_eligible := coalesce(v_rate, 0) * new.qty;
  v_owner_only := exists (
    select 1 from public.salesmen s
    join public.profiles pr on pr.user_id = s.user_id
    join public.roles r on r.id = pr.role_id
    where s.business_id = new.business_id and s.id = v_invoice.salesman_id
      and r.name = 'Owner/Admin'
  );
  insert into public.commission_events (
    business_id, salesman_id, invoice_id, invoice_item_id, event_type, quantity,
    rate_paisas, gross_amount, eligible_amount, payable_amount, paid_amount,
    status, allocation_id, idempotency_key, is_owner_only
  ) values (
    new.business_id, v_invoice.salesman_id, new.invoice_id, new.id, 'eligibility', new.qty,
    v_rate, new.line_total, v_eligible, 0, 0, 'calculated', null,
    'phase2:eligibility:' || new.id::text, v_owner_only
  ) on conflict (business_id, idempotency_key) where idempotency_key is not null do nothing;
  if coalesce(v_invoice.total, 0) > 0 and coalesce(v_invoice.paid, 0) > 0 and not v_owner_only then
    v_initial_earned := floor(v_eligible * least(v_invoice.paid, v_invoice.total) / v_invoice.total);
    if v_initial_earned > 0 then
      insert into public.commission_events (
        business_id, salesman_id, invoice_id, invoice_item_id, event_type, quantity,
        rate_paisas, gross_amount, eligible_amount, payable_amount, paid_amount,
        status, allocation_id, idempotency_key, is_owner_only
      ) values (
        new.business_id, v_invoice.salesman_id, new.invoice_id, new.id, 'collection', 0,
        v_rate, new.line_total, v_eligible, v_initial_earned, 0, 'payable', 'initial-sale',
        'phase2:initial-collection:' || new.id::text, false
      ) on conflict (business_id, idempotency_key) where idempotency_key is not null do nothing;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists phase2_invoice_item_commission_snapshot on public.invoice_items;
create trigger phase2_invoice_item_commission_snapshot
after insert on public.invoice_items
for each row execute function public.phase2_capture_commission_eligibility();

-- Allocate collection commission with integer/numeric arithmetic.  The target
-- is recomputed from the locked invoice payment ratio, so the final collection
-- receives any deterministic rounding residue and cumulative earning cannot
-- exceed the net eligible amount.
create or replace function public.phase2_allocate_collection_commission(
  p_business_id uuid,
  p_invoice_id text,
  p_allocation_key text
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_item record; v_target numeric(20,0); v_prior numeric(20,0); v_delta numeric(20,0); v_invoice record;
begin
  select id, total, paid into v_invoice from public.invoices
   where business_id = p_business_id and id = p_invoice_id for update;
  for v_item in
    select e.* from public.commission_events e
     where e.business_id = p_business_id and e.invoice_id = p_invoice_id
       and e.event_type = 'eligibility'
     order by e.invoice_item_id for update
  loop
    if v_item.is_owner_only or v_invoice.total <= 0 then continue; end if;
    v_target := floor(v_item.eligible_amount * least(v_invoice.paid, v_invoice.total) / v_invoice.total);
    select coalesce(sum(e.payable_amount), 0) into v_prior
      from public.commission_events e
     where e.business_id = p_business_id and e.invoice_item_id = v_item.invoice_item_id
       and e.event_type in ('collection', 'return_adjustment');
    v_delta := greatest(least(v_target - v_prior, v_item.eligible_amount - v_prior), 0);
    if v_delta > 0 then
      insert into public.commission_events (
        business_id, salesman_id, invoice_id, invoice_item_id, event_type, quantity,
        rate_paisas, gross_amount, eligible_amount, payable_amount, paid_amount,
        status, allocation_id, idempotency_key, is_owner_only
      ) values (
        p_business_id, v_item.salesman_id, p_invoice_id, v_item.invoice_item_id, 'collection', 0,
        v_item.rate_paisas, v_item.gross_amount, v_item.eligible_amount, v_delta, 0,
        'payable', p_allocation_key, 'phase2:collection:' || p_allocation_key || ':' || v_item.invoice_item_id::text, false
      ) on conflict (business_id, idempotency_key) where idempotency_key is not null do nothing;
    end if;
  end loop;
end $$;

create or replace function public.receive_invoice_payment(
  p_business_id uuid, p_invoice_id text, p_amount numeric, p_mode text, p_idempotency_key text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_invoice record; v_payment_id text; v_result jsonb;
begin
  perform public.phase2_assert_actor(p_business_id, 'can_create_sales');
  if p_amount is null or p_amount <= 0 or p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'Payment amount and idempotency key are required';
  end if;
  select jsonb_build_object('payment_id', id, 'invoice_id', invoice_id, 'idempotent', true)
    into v_result from public.payments
   where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if v_result is not null then return v_result; end if;
  select * into v_invoice from public.invoices
   where business_id = p_business_id and id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if v_invoice.status in ('Cancelled', 'Returned') then raise exception 'Invoice cannot receive a collection in status %', v_invoice.status; end if;
  if p_amount > v_invoice.total - v_invoice.paid then raise exception 'Collection exceeds remaining invoice balance'; end if;
  update public.invoices set paid = paid + p_amount,
    status = case when paid + p_amount >= total then 'Paid' else 'Partially Paid' end
   where business_id = p_business_id and id = p_invoice_id;
  if v_invoice.customer_id is not null then
    update public.customers set credit = greatest(coalesce(credit, 0) - p_amount, 0)
     where business_id = p_business_id and id = v_invoice.customer_id;
  end if;
  -- Phase 2 columns are deliberately explicit; existing payment metadata stays intact.
  insert into public.payments (business_id, invoice_id, customer_id, amount, direction, payment_mode, idempotency_key)
  values (p_business_id, p_invoice_id, v_invoice.customer_id, p_amount, 'Received', p_mode, p_idempotency_key)
  returning id::text into v_payment_id;
  perform public.phase2_allocate_collection_commission(p_business_id, p_invoice_id, v_payment_id);
  return jsonb_build_object('payment_id', v_payment_id, 'invoice_id', p_invoice_id, 'amount', p_amount, 'idempotent', false);
end $$;

create or replace function public.post_sale_return(
  p_business_id uuid, p_original_invoice_id text, p_items jsonb,
  p_refund_mode text, p_reason text, p_idempotency_key text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice record; v_item jsonb; v_line record; v_document_id uuid; v_return_total numeric(20,0) := 0;
  v_return_no text; v_cash_refund boolean := upper(coalesce(p_refund_mode, 'CREDIT')) in ('CASH', 'BANK');
  v_all_returned boolean; v_payment_id text; v_result jsonb; v_requested int;
begin
  perform public.phase2_assert_actor(p_business_id, 'can_cancel_sales');
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'At least one return item is required'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then raise exception 'Return idempotency key is required'; end if;
  select jsonb_build_object('return_id', id, 'return_no', return_no, 'total', total, 'idempotent', true)
    into v_result from public.sale_return_documents
   where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if v_result is not null then return v_result; end if;
  select * into v_invoice from public.invoices
   where business_id = p_business_id and id = p_original_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if v_invoice.status = 'Cancelled' then raise exception 'Cancelled invoice cannot be returned'; end if;
  select 'SR-' || lpad((coalesce(max(nullif(regexp_replace(return_no, '\\D', '', 'g'), '')::int), 0) + 1)::text, 6, '0')
    into v_return_no from public.sale_return_documents where business_id = p_business_id for update;
  insert into public.sale_return_documents (business_id, original_invoice_id, return_no, idempotency_key, status, reason, total)
  values (p_business_id, p_original_invoice_id, v_return_no, p_idempotency_key, 'posted', p_reason, 0)
  returning id into v_document_id;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_requested := (v_item->>'qty')::int;
    if v_requested is null or v_requested <= 0 then raise exception 'Return quantities must be positive integers'; end if;
    select ii.*,
           coalesce((select sum(srl.returned_qty) from public.sale_return_lines srl
                     where srl.original_invoice_item_id = ii.id), 0) as prior_returned
      into v_line
      from public.invoice_items ii
      where ii.business_id = p_business_id and ii.invoice_id = p_original_invoice_id
        and ii.id = (v_item->>'invoice_item_id')::uuid
      for update;
    if not found then raise exception 'Return line is not an item on this invoice'; end if;
    if v_requested + v_line.prior_returned > v_line.qty then raise exception 'Cumulative return exceeds sold quantity for invoice item %', v_line.id; end if;
    insert into public.sale_return_lines (business_id, sale_return_id, original_invoice_item_id, returned_qty, reason)
    values (p_business_id, v_document_id, v_line.id, v_requested, p_reason);
    update public.invoice_items set returned_qty = returned_qty + v_requested where id = v_line.id;
    if v_line.product_id is not null then
      update public.products set stock = stock + v_requested where business_id = p_business_id and id = v_line.product_id;
    end if;
    v_return_total := v_return_total + floor(v_line.unit_price * v_requested);
    -- Immutable negative adjustment preserves the original eligibility snapshot.
    insert into public.commission_events (
      business_id, salesman_id, invoice_id, invoice_item_id, original_invoice_item_id, return_event_id,
      event_type, quantity, rate_paisas, gross_amount, eligible_amount, payable_amount, paid_amount,
      status, allocation_id, idempotency_key, is_owner_only
    )
    select e.business_id, e.salesman_id, e.invoice_id, e.invoice_item_id, e.invoice_item_id, v_document_id::text,
      'return_adjustment', -v_requested, e.rate_paisas, -floor(v_line.unit_price * v_requested),
      -(e.rate_paisas * v_requested),
      -least(coalesce((select sum(x.payable_amount) from public.commission_events x where x.business_id = e.business_id and x.invoice_item_id = e.invoice_item_id and x.event_type = 'collection'), 0), e.rate_paisas * v_requested),
      0, 'reversed', v_document_id::text, 'phase2:return:' || v_document_id::text || ':' || e.invoice_item_id::text, e.is_owner_only
    from public.commission_events e
    where e.business_id = p_business_id and e.invoice_item_id = v_line.id and e.event_type = 'eligibility';
  end loop;
  update public.sale_return_documents set total = v_return_total where id = v_document_id;
  if v_invoice.customer_id is not null then
    update public.customers set
      debit = greatest(coalesce(debit, 0) - v_return_total, 0),
      credit = coalesce(credit, 0) + greatest(v_return_total - coalesce(debit, 0), 0)
     where business_id = p_business_id and id = v_invoice.customer_id;
  end if;
  if v_cash_refund and v_return_total > 0 then
    insert into public.payments (business_id, invoice_id, customer_id, amount, direction, payment_mode, idempotency_key, return_document_id)
    values (p_business_id, p_original_invoice_id, v_invoice.customer_id, v_return_total, 'Paid', upper(p_refund_mode),
            'phase2:refund:' || p_idempotency_key, v_document_id)
    returning id::text into v_payment_id;
  end if;
  select bool_and(returned_qty >= qty) into v_all_returned
    from public.invoice_items where business_id = p_business_id and invoice_id = p_original_invoice_id;
  update public.invoices
     set status = case when v_all_returned then 'Returned' else 'Partially Returned' end
   where business_id = p_business_id and id = p_original_invoice_id;
  return jsonb_build_object('return_id', v_document_id, 'return_no', v_return_no, 'total', v_return_total,
                            'refund_payment_id', v_payment_id, 'status', case when v_all_returned then 'Returned' else 'Partially Returned' end,
                            'idempotent', false);
end $$;

-- One production-facing sale entry point for Counter, Online and OFC.  It
-- delegates the proven stock/negative-stock policy to the existing text-ID
-- post_sale core, while adding server-side attribution checks and a durable
-- retry mapping.  The invoice-item trigger above snapshots commission rates
-- and records any initial collection earned by that core.
create table if not exists public.phase2_sale_idempotency (
  business_id uuid not null references public.businesses(id) on delete restrict,
  idempotency_key text not null,
  invoice_id text not null,
  created_at timestamptz not null default now(),
  primary key (business_id, idempotency_key)
);
alter table public.phase2_sale_idempotency enable row level security;
revoke all on public.phase2_sale_idempotency from public, anon, authenticated;
grant all on public.phase2_sale_idempotency to service_role;

create or replace function public.post_sale_phase2(
  p_business_id uuid, p_invoice_type text, p_invoice_date date, p_items jsonb,
  p_payments jsonb, p_salesman_id uuid, p_customer_id text, p_customer_name text,
  p_customer_phone text, p_customer_address text, p_customer_city text, p_memo text,
  p_created_by uuid, p_idempotency_key text
) returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_invoice_id text;
begin
  perform public.phase2_assert_actor(p_business_id, 'can_create_sales');
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'Sale idempotency key is required';
  end if;
  select invoice_id into v_invoice_id from public.phase2_sale_idempotency
   where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then return v_invoice_id; end if;
  if not exists (
    select 1 from public.salesmen s
     where s.business_id = p_business_id and s.id = p_salesman_id and s.is_active
  ) then raise exception 'Server-attributed salesman is not active in this business'; end if;
  v_invoice_id := public.post_sale(
    p_business_id, p_invoice_type, p_invoice_date, p_items, p_payments,
    p_salesman_id, p_customer_id, p_customer_name, p_customer_phone,
    p_customer_address, p_customer_city, p_memo, p_created_by
  );
  insert into public.phase2_sale_idempotency (business_id, idempotency_key, invoice_id)
  values (p_business_id, p_idempotency_key, v_invoice_id);
  return v_invoice_id;
end $$;

-- Remove only known incompatible UUID-era overloads after the canonical text
-- mutation entry points exist.  The record_sale loop is deliberately limited
-- to UUID-argument overloads; it cannot remove a text-ID implementation.
do $$
declare v_proc record;
begin
  for v_proc in
    select p.oid, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_sale' and p.prokind = 'f'
      and pg_get_function_identity_arguments(p.oid) ~* '(^|, )uuid(,|$)'
  loop
    execute format('drop function public.record_sale(%s)', v_proc.args);
  end loop;
end $$;
drop function if exists public.process_return(uuid, jsonb, text);
drop function if exists public.mark_invoice_paid(uuid);
drop function if exists public.receive_payment(uuid, uuid, numeric, text);

-- No client role receives execute by default.  service_role is the production
-- HTTP boundary; authenticated is allowed only through active-profile checks.
revoke all on function public.phase2_assert_actor(uuid, text) from public, anon, authenticated;
revoke all on function public.phase2_capture_commission_eligibility() from public, anon, authenticated;
revoke all on function public.phase2_allocate_collection_commission(uuid, text, text) from public, anon, authenticated;
revoke all on function public.post_sale_return(uuid, text, jsonb, text, text, text) from public, anon;
revoke all on function public.receive_invoice_payment(uuid, text, numeric, text, text) from public, anon;
revoke all on function public.post_sale_phase2(uuid, text, date, jsonb, jsonb, uuid, text, text, text, text, text, text, uuid, text) from public, anon;
grant execute on function public.post_sale_return(uuid, text, jsonb, text, text, text) to authenticated, service_role;
grant execute on function public.receive_invoice_payment(uuid, text, numeric, text, text) to authenticated, service_role;
grant execute on function public.post_sale_phase2(uuid, text, date, jsonb, jsonb, uuid, text, text, text, text, text, text, uuid, text) to authenticated, service_role;

commit;
