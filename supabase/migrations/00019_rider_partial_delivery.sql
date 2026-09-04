-- Rider quantity-level delivery outcomes.
-- Additive only. Inspect with 00019_rider_partial_delivery_inspect.sql first.
-- This migration is intentionally not applied by application code.
begin;

do $$
declare v_missing text;
begin
  select string_agg(name, ', ' order by name) into v_missing
  from (values
    ('public.businesses', to_regclass('public.businesses')),
    ('public.profiles', to_regclass('public.profiles')),
    ('public.riders', to_regclass('public.riders')),
    ('public.invoices', to_regclass('public.invoices')),
    ('public.invoice_items', to_regclass('public.invoice_items')),
    ('public.products', to_regclass('public.products')),
    ('public.sale_return_documents', to_regclass('public.sale_return_documents')),
    ('public.rider_cash_ledger', to_regclass('public.rider_cash_ledger'))
  ) required(name, relation_name)
  where relation_name is null;
  if v_missing is not null then
    raise exception 'Rider partial delivery requires verified tables: %', v_missing;
  end if;
end $$;

create table if not exists public.delivery_line_progress (
  business_id uuid not null references public.businesses(id) on delete restrict,
  invoice_id text not null,
  invoice_item_id uuid not null references public.invoice_items(id) on delete restrict,
  ordered_qty int not null check (ordered_qty > 0),
  delivered_qty int not null default 0 check (delivered_qty >= 0),
  returned_qty int not null default 0 check (returned_qty >= 0),
  updated_at timestamptz not null default now(),
  constraint delivery_line_progress_pkey primary key (business_id, invoice_id, invoice_item_id),
  constraint delivery_line_progress_invoice_fkey
    foreign key (business_id, invoice_id)
    references public.invoices(business_id, id) on delete restrict,
  constraint delivery_line_progress_total_check
    check (delivered_qty + returned_qty <= ordered_qty)
);

create table if not exists public.delivery_outcome_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  invoice_id text not null,
  rider_id uuid not null references public.riders(id) on delete restrict,
  outcome_no text not null,
  outcome_status text not null check (
    outcome_status in ('Delivered', 'Partially Delivered', 'Returned / Failed')
  ),
  cash_collected numeric(20,0) not null default 0 check (cash_collected >= 0),
  sale_return_id uuid references public.sale_return_documents(id) on delete restrict,
  idempotency_key text not null,
  request_fingerprint text not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  result jsonb,
  constraint delivery_outcome_batches_invoice_fkey
    foreign key (business_id, invoice_id)
    references public.invoices(business_id, id) on delete restrict,
  constraint delivery_outcome_batches_number_key unique (business_id, outcome_no),
  constraint delivery_outcome_batches_idempotency_key unique (business_id, idempotency_key)
);

create table if not exists public.delivery_outcome_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  batch_id uuid not null references public.delivery_outcome_batches(id) on delete restrict,
  invoice_item_id uuid not null references public.invoice_items(id) on delete restrict,
  ordered_qty int not null check (ordered_qty > 0),
  delivered_qty int not null default 0 check (delivered_qty >= 0),
  returned_qty int not null default 0 check (returned_qty >= 0),
  remaining_qty int not null check (remaining_qty >= 0),
  constraint delivery_outcome_lines_batch_item_key unique (batch_id, invoice_item_id),
  constraint delivery_outcome_lines_total_check
    check (delivered_qty + returned_qty + remaining_qty <= ordered_qty)
);

create index if not exists delivery_outcome_batches_invoice_date_idx
  on public.delivery_outcome_batches(business_id, invoice_id, occurred_at desc);
create index if not exists delivery_outcome_batches_rider_date_idx
  on public.delivery_outcome_batches(business_id, rider_id, occurred_at desc);

alter table public.delivery_line_progress enable row level security;
alter table public.delivery_outcome_batches enable row level security;
alter table public.delivery_outcome_lines enable row level security;
revoke all on public.delivery_line_progress from public, anon, authenticated;
revoke all on public.delivery_outcome_batches from public, anon, authenticated;
revoke all on public.delivery_outcome_lines from public, anon, authenticated;
grant all on public.delivery_line_progress to service_role;
grant all on public.delivery_outcome_batches to service_role;
grant all on public.delivery_outcome_lines to service_role;

-- Shared safe allocator. Phase 2 expands its prefix registry but retains this
-- row-locking implementation.
create or replace function public.allocate_readable_identity(
  p_business_id uuid, p_prefix text
) returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_prefix text := upper(trim(coalesce(p_prefix, ''))); v_seq int;
begin
  if v_prefix = '' or v_prefix !~ '^[A-Z][A-Z0-9-]{0,15}$' then
    raise exception 'A valid transaction prefix is required';
  end if;
  insert into public.identity_sequences (business_id, prefix, last_seq)
  values (p_business_id, v_prefix, 1)
  on conflict (business_id, prefix)
  do update set last_seq = public.identity_sequences.last_seq + 1
  returning last_seq into v_seq;
  return v_prefix || '-' || lpad(v_seq::text, 6, '0');
end $$;

create or replace function public.record_delivery_outcome(
  p_business_id uuid,
  p_invoice_id text,
  p_items jsonb,
  p_cash_collected numeric,
  p_reason text,
  p_idempotency_key text,
  p_actor_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_rider public.riders%rowtype;
  v_invoice public.invoices%rowtype;
  v_existing public.delivery_outcome_batches%rowtype;
  v_batch_id uuid;
  v_item jsonb;
  v_line record;
  v_normalized jsonb;
  v_fingerprint text;
  v_outcome_no text;
  v_status text;
  v_return_items jsonb := '[]'::jsonb;
  v_return_result jsonb;
  v_return_id uuid;
  v_delivered int;
  v_returned int;
  v_total_delivered int;
  v_total_returned int;
  v_total_remaining int;
  v_cumulative_collectible numeric(20,0);
  v_prior_collections numeric(20,0);
  v_prior_settlements numeric(20,0);
  v_available_to_collect numeric(20,0);
  v_result jsonb;
begin
  if p_actor_id is null then
    raise exception 'Server-attributed actor is required' using errcode = '42501';
  end if;
  select pr.* into v_profile
  from public.profiles pr
  where pr.id = p_actor_id
    and pr.business_id = p_business_id
    and pr.status = 'Active'
  for update;
  if not found then
    raise exception 'Active actor is not authorized for this business' using errcode = '42501';
  end if;

  select r.* into v_rider
  from public.riders r
  where r.business_id = p_business_id
    and r.profile_id = v_profile.id
    and coalesce(r.is_active, true)
  for update;
  if not found then
    raise exception 'Only the assigned active rider can record an outcome' using errcode = '42501';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0
     or p_cash_collected is null or p_cash_collected < 0
     or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Items, non-negative cash, and idempotency key are required';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'invoice_item_id', value->>'invoice_item_id',
      'delivered_qty', (value->>'delivered_qty')::int,
      'returned_qty', (value->>'returned_qty')::int
    ) order by value->>'invoice_item_id'
  ) into v_normalized
  from jsonb_array_elements(p_items);

  if jsonb_array_length(v_normalized) <> (
    select count(distinct value->>'invoice_item_id')
    from jsonb_array_elements(v_normalized)
  ) then
    raise exception 'Each invoice item may appear only once';
  end if;

  v_fingerprint := encode(digest(concat_ws('|',
    p_invoice_id, v_rider.id::text, v_normalized::text,
    p_cash_collected::text, coalesce(trim(p_reason), '')
  ), 'sha256'), 'hex');

  select * into v_existing
  from public.delivery_outcome_batches
  where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'Idempotency key conflicts with a different delivery outcome' using errcode = '23505';
    end if;
    return v_existing.result || jsonb_build_object('idempotent', true);
  end if;

  select i.* into v_invoice
  from public.invoices i
  where i.business_id = p_business_id and i.id = p_invoice_id
  for update;
  if not found then raise exception 'Invoice not found'; end if;
  if v_invoice.rider_id is distinct from v_rider.id then
    raise exception 'Invoice is not assigned to this rider' using errcode = '42501';
  end if;
  if lower(coalesce(v_invoice.delivery_status, '')) not in
    ('out for delivery', 'out_for_delivery', 'partially delivered', 'partially_delivered') then
    raise exception 'Delivery outcome is not allowed from the current state';
  end if;

  insert into public.delivery_line_progress
    (business_id, invoice_id, invoice_item_id, ordered_qty)
  select ii.business_id, ii.invoice_id, ii.id, ii.qty
  from public.invoice_items ii
  where ii.business_id = p_business_id and ii.invoice_id = p_invoice_id
  on conflict (business_id, invoice_id, invoice_item_id) do nothing;

  -- Lock every invoice line before validating any mutation.
  perform 1 from public.delivery_line_progress dlp
  where dlp.business_id = p_business_id and dlp.invoice_id = p_invoice_id
  order by dlp.invoice_item_id
  for update;

  for v_item in select value from jsonb_array_elements(v_normalized)
  loop
    begin
      v_delivered := (v_item->>'delivered_qty')::int;
      v_returned := (v_item->>'returned_qty')::int;
    exception when others then
      raise exception 'Delivery quantities must be integers';
    end;
    if v_delivered < 0 or v_returned < 0 or v_delivered + v_returned = 0 then
      raise exception 'Each outcome line requires a positive delivered or returned quantity';
    end if;
    select dlp.*, ii.unit_price into v_line
    from public.delivery_line_progress dlp
    join public.invoice_items ii on ii.id = dlp.invoice_item_id
    where dlp.business_id = p_business_id
      and dlp.invoice_id = p_invoice_id
      and dlp.invoice_item_id = (v_item->>'invoice_item_id')::uuid;
    if not found then
      raise exception 'Outcome line is not an item on this invoice';
    end if;
    if v_delivered > v_line.ordered_qty - v_line.delivered_qty - v_line.returned_qty then
      raise exception 'Delivered quantity exceeds remaining quantity for invoice item %', v_line.invoice_item_id;
    end if;
    if v_returned > v_line.ordered_qty - v_line.delivered_qty - v_line.returned_qty - v_delivered then
      raise exception 'Returned quantity exceeds remaining quantity for invoice item %', v_line.invoice_item_id;
    end if;
    update public.delivery_line_progress
    set delivered_qty = delivered_qty + v_delivered,
        returned_qty = returned_qty + v_returned,
        updated_at = now()
    where business_id = p_business_id
      and invoice_id = p_invoice_id
      and invoice_item_id = v_line.invoice_item_id;
    if v_returned > 0 then
      v_return_items := v_return_items || jsonb_build_array(jsonb_build_object(
        'invoice_item_id', v_line.invoice_item_id, 'qty', v_returned
      ));
    end if;
  end loop;

  if jsonb_array_length(v_return_items) > 0 and exists (
    select 1 from public.rider_cash_ledger rcl
    where rcl.business_id = p_business_id
      and rcl.invoice_id = p_invoice_id
      and rcl.event_type = 'settlement'
  ) then
    raise exception 'Financially settled delivery cannot be returned or failed';
  end if;

  if jsonb_array_length(v_return_items) > 0 then
    v_return_result := public.post_sale_return(
      p_business_id, p_invoice_id, v_return_items, 'CREDIT',
      coalesce(nullif(trim(p_reason), ''), 'Operational delivery return'),
      'delivery-return:' || p_idempotency_key
    );
    v_return_id := (v_return_result->>'return_id')::uuid;
  end if;

  select sum(delivered_qty), sum(returned_qty),
         sum(ordered_qty - delivered_qty - returned_qty)
    into v_total_delivered, v_total_returned, v_total_remaining
  from public.delivery_line_progress
  where business_id = p_business_id and invoice_id = p_invoice_id;

  if v_total_remaining = 0 and v_total_returned = 0 then
    v_status := 'Delivered';
  elsif v_total_remaining = 0 and v_total_delivered = 0 then
    v_status := 'Returned / Failed';
  else
    v_status := 'Partially Delivered';
  end if;

  -- The collectible value is driven by delivered quantities. Any non-line
  -- invoice charge (for example delivery charge) becomes collectible only
  -- after at least one unit is delivered.
  select
    coalesce(sum(ii.unit_price * dlp.delivered_qty), 0)
      + case when v_total_delivered > 0 then greatest(
          coalesce(v_invoice.total, 0) -
          coalesce((select sum(x.unit_price * x.qty)
                    from public.invoice_items x
                    where x.business_id = p_business_id and x.invoice_id = p_invoice_id), 0),
          0
        ) else 0 end
    into v_cumulative_collectible
  from public.delivery_line_progress dlp
  join public.invoice_items ii on ii.id = dlp.invoice_item_id
  where dlp.business_id = p_business_id and dlp.invoice_id = p_invoice_id;

  select
    coalesce(sum(case when event_type = 'collection' then amount else 0 end), 0),
    coalesce(sum(case when event_type = 'settlement' then amount else 0 end), 0)
    into v_prior_collections, v_prior_settlements
  from public.rider_cash_ledger
  where business_id = p_business_id and invoice_id = p_invoice_id;

  v_available_to_collect := greatest(least(
    v_cumulative_collectible - v_prior_collections,
    coalesce(v_invoice.total, 0) - coalesce(v_invoice.paid, 0) + v_prior_settlements
  ), 0);
  if p_cash_collected > v_available_to_collect then
    raise exception 'COD collection exceeds the actually delivered collectible amount';
  end if;

  v_outcome_no := public.allocate_readable_identity(p_business_id, 'DO');
  insert into public.delivery_outcome_batches (
    business_id, invoice_id, rider_id, outcome_no, outcome_status,
    cash_collected, sale_return_id, idempotency_key, request_fingerprint, actor_id
  ) values (
    p_business_id, p_invoice_id, v_rider.id, v_outcome_no, v_status,
    p_cash_collected, v_return_id, p_idempotency_key, v_fingerprint, v_profile.id
  ) returning id into v_batch_id;

  insert into public.delivery_outcome_lines (
    business_id, batch_id, invoice_item_id, ordered_qty,
    delivered_qty, returned_qty, remaining_qty
  )
  select p_business_id, v_batch_id, dlp.invoice_item_id, dlp.ordered_qty,
         (item.value->>'delivered_qty')::int,
         (item.value->>'returned_qty')::int,
         dlp.ordered_qty - dlp.delivered_qty - dlp.returned_qty
  from jsonb_array_elements(v_normalized) item
  join public.delivery_line_progress dlp
    on dlp.business_id = p_business_id
   and dlp.invoice_id = p_invoice_id
   and dlp.invoice_item_id = (item.value->>'invoice_item_id')::uuid;

  if p_cash_collected > 0 then
    insert into public.rider_cash_ledger (
      business_id, rider_id, invoice_id, event_type, amount,
      delivered_at, created_at, idempotency_key
    ) values (
      p_business_id, v_rider.id, p_invoice_id, 'collection',
      p_cash_collected, now(), now(), 'delivery-outcome:' || p_idempotency_key
    );
  end if;

  update public.invoices
  set delivery_status = v_status,
      delivered_at = case when v_total_delivered > 0 then coalesce(delivered_at, now()) else delivered_at end,
      returned_at = case when v_total_returned > 0 then coalesce(returned_at, now()) else returned_at end
  where business_id = p_business_id and id = p_invoice_id;

  v_result := jsonb_build_object(
    'batch_id', v_batch_id,
    'outcome_no', v_outcome_no,
    'invoice_id', p_invoice_id,
    'status', v_status,
    'delivered_qty', v_total_delivered,
    'returned_qty', v_total_returned,
    'remaining_qty', v_total_remaining,
    'cash_collected', p_cash_collected,
    'sale_return_id', v_return_id,
    'idempotent', false
  );
  update public.delivery_outcome_batches set result = v_result where id = v_batch_id;
  return v_result;
end $$;

revoke all on function public.allocate_readable_identity(uuid, text) from public, anon, authenticated;
revoke all on function public.record_delivery_outcome(uuid, text, jsonb, numeric, text, text, uuid) from public, anon, authenticated;
grant execute on function public.allocate_readable_identity(uuid, text) to service_role;
grant execute on function public.record_delivery_outcome(uuid, text, jsonb, numeric, text, text, uuid) to service_role;

commit;
