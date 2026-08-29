-- Historical / partial sales returns for the verified legacy production schema.
--
-- This is additive and intentionally separate from 00036. It must be applied
-- explicitly only after preflight; application code never executes migrations.

begin;

do $$
declare v_missing text;
begin
  select string_agg(name, ', ' order by name) into v_missing
  from (values
    ('public.business', to_regclass('public.business')),
    ('public.invoices', to_regclass('public.invoices')),
    ('public.invoice_items', to_regclass('public.invoice_items')),
    ('public.sales_returns', to_regclass('public.sales_returns')),
    ('public.accounts', to_regclass('public.accounts')),
    ('public.payment_allocations', to_regclass('public.payment_allocations')),
    ('public.salesman_commissions', to_regclass('public.salesman_commissions')),
    ('public.legacy_transaction_identity_requests', to_regclass('public.legacy_transaction_identity_requests'))
  ) required(name, relation_name)
  where relation_name is null;
  if v_missing is not null then
    raise exception '00037 preflight failed: required legacy relations are missing: %', v_missing;
  end if;
  if to_regprocedure('public.post_voucher(text,text,date,text,jsonb,text,text,uuid)') is null
     or to_regprocedure('public.create_stock_movement(text,text,text,integer,text,date,uuid,numeric)') is null
     or to_regprocedure('public.claim_legacy_transaction_request(text,text,text)') is null then
    raise exception '00037 preflight failed: required atomic posting helpers or migration 00036 are missing';
  end if;
end $$;

alter table public.invoice_items
  add column if not exists returned_qty integer not null default 0;
alter table public.invoice_items
  drop constraint if exists invoice_items_returned_qty_valid;
alter table public.invoice_items
  add constraint invoice_items_returned_qty_valid
  check (returned_qty >= 0 and returned_qty <= qty);

alter table public.sales_returns add column if not exists refund_mode text;
alter table public.sales_returns add column if not exists refund_account_id text references public.accounts(id) on delete restrict;
alter table public.sales_returns add column if not exists settlement_status text;
alter table public.legacy_transaction_identity_requests
  add column if not exists request_fingerprint text;

create table if not exists public.sales_return_lines (
  id text primary key default gen_random_uuid()::text,
  business_id text not null references public.business(id) on delete cascade,
  sales_return_id text not null references public.sales_returns(id) on delete restrict,
  original_invoice_item_id text not null references public.invoice_items(id) on delete restrict,
  returned_qty integer not null check (returned_qty > 0),
  reason text,
  created_at timestamptz not null default now(),
  unique (sales_return_id, original_invoice_item_id)
);
create index if not exists sales_return_lines_original_item_idx
  on public.sales_return_lines (business_id, original_invoice_item_id);

alter table public.sales_return_lines enable row level security;
revoke all on table public.sales_return_lines from public, anon, authenticated;
grant select, insert on table public.sales_return_lines to service_role;

create or replace function public.post_sales_return(
  p_business_id text,
  p_invoice_id text,
  p_return_date date,
  p_return_items jsonb,
  p_refund_mode text,
  p_refund_account_id text,
  p_reason text,
  p_created_by uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean;
  v_result jsonb;
  v_invoice public.invoices%rowtype;
  v_item jsonb;
  v_line record;
  v_requested integer;
  v_distinct_items integer;
  v_return_id text;
  v_return_no text;
  v_return_total numeric(20,0) := 0;
  v_sales_account_id text;
  v_settlement_account_id text;
  v_voucher_id text;
  v_refund_allocation_id text;
  v_voucher_lines jsonb;
  v_all_returned boolean;
  v_commission record;
  v_reversal numeric(20,0);
  v_status text;
  v_request_fingerprint text;
  v_saved_fingerprint text;
begin
  if p_return_items is null or jsonb_typeof(p_return_items) <> 'array'
     or jsonb_array_length(p_return_items) = 0 then
    raise exception 'At least one return item is required';
  end if;
  if upper(coalesce(p_refund_mode, '')) not in ('CREDIT', 'CASH', 'BANK') then
    raise exception 'Refund mode must be CREDIT, CASH, or BANK';
  end if;

  select count(distinct value->>'invoice_item_id') into v_distinct_items
  from jsonb_array_elements(p_return_items);
  if v_distinct_items <> jsonb_array_length(p_return_items) then
    raise exception 'A duplicate invoice item cannot be returned twice in one request';
  end if;

  v_request_fingerprint := md5(jsonb_build_object(
    'invoice_id', p_invoice_id,
    'return_date', p_return_date,
    'return_items', p_return_items,
    'refund_mode', upper(p_refund_mode),
    'refund_account_id', p_refund_account_id,
    'reason', p_reason
  )::text);

  select claimed, replay into v_claimed, v_result
  from public.claim_legacy_transaction_request(
    p_business_id, 'historical_sales_return', p_idempotency_key
  );
  if not v_claimed then
    select request_fingerprint into v_saved_fingerprint
    from public.legacy_transaction_identity_requests
    where business_id = p_business_id
      and operation = 'historical_sales_return'
      and idempotency_key = p_idempotency_key;
    if v_saved_fingerprint is distinct from v_request_fingerprint then
      raise exception 'The idempotency key was already used for a different sales return';
    end if;
    return v_result || jsonb_build_object('idempotent', true);
  end if;
  update public.legacy_transaction_identity_requests
  set request_fingerprint = v_request_fingerprint
  where business_id = p_business_id
    and operation = 'historical_sales_return'
    and idempotency_key = p_idempotency_key;

  select * into v_invoice from public.invoices
  where id = p_invoice_id and business_id = p_business_id
  for update;
  if not found then raise exception 'Original invoice not found for this business'; end if;
  if v_invoice.status = 'Cancelled' then raise exception 'A cancelled invoice cannot be returned'; end if;

  select id into v_sales_account_id from public.accounts
  where business_id = p_business_id and code = '4010' and is_active = true;
  if not found then raise exception 'Sales account (4010) not found'; end if;

  if upper(p_refund_mode) = 'CREDIT' then
    select id into v_settlement_account_id from public.accounts
    where business_id = p_business_id and code = '1200' and is_active = true;
    if not found then raise exception 'Customers Receivable account (1200) not found'; end if;
    v_status := 'CREDIT_DUE';
  else
    select id into v_settlement_account_id from public.accounts
    where id = p_refund_account_id and business_id = p_business_id
      and is_active = true and is_business_account = true;
    if not found then raise exception 'Selected refund account was not found or is inactive'; end if;
    v_status := 'REFUNDED';
  end if;

  -- Validate and lock every original line before the first business write.
  for v_item in select value from jsonb_array_elements(p_return_items)
  loop
    begin
      v_requested := (v_item->>'qty')::integer;
    exception when others then
      raise exception 'Return quantities must be positive whole numbers';
    end;
    if v_requested is null or v_requested <= 0 then
      raise exception 'Return quantities must be positive whole numbers';
    end if;
    select ii.id, ii.product_id, ii.product_name, ii.qty, ii.returned_qty, ii.unit_price
      into v_line
    from public.invoice_items ii
    where ii.id = v_item->>'invoice_item_id'
      and ii.invoice_id = p_invoice_id
      and ii.business_id = p_business_id
    for update;
    if not found then
      raise exception 'Referenced invoice item does not belong to the original invoice and business';
    end if;
    if v_requested > v_line.qty - v_line.returned_qty then
      raise exception 'Return quantity exceeds remaining returnable quantity (%) for item %',
        v_line.qty - v_line.returned_qty, v_line.product_name;
    end if;
    v_return_total := v_return_total + (v_line.unit_price * v_requested);
  end loop;

  insert into public.sales_returns (
    business_id, original_invoice_id, return_date, total, reason, created_by,
    refund_mode, refund_account_id, settlement_status
  ) values (
    p_business_id, p_invoice_id, p_return_date, v_return_total, p_reason, p_created_by,
    upper(p_refund_mode), v_settlement_account_id, v_status
  ) returning id, return_no into v_return_id, v_return_no;

  v_voucher_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_sales_account_id, 'debit', v_return_total::text,
      'credit', '0', 'memo', 'Historical return ' || v_return_no),
    jsonb_build_object('account_id', v_settlement_account_id, 'debit', '0',
      'credit', v_return_total::text,
      'memo', case when v_status = 'REFUNDED' then 'Refund ' else 'Customer credit ' end || v_return_no)
  );
  v_voucher_id := public.post_voucher(
    p_business_id, 'SR', p_return_date,
    'Historical return ' || v_return_no || ' against ' || v_invoice.invoice_no,
    v_voucher_lines, v_return_id, 'sales_return', p_created_by
  );
  update public.sales_returns set return_voucher_id = v_voucher_id where id = v_return_id;

  insert into public.payment_allocations (
    business_id, invoice_id, account_id, amount, is_change, voucher_id,
    allocation_date, created_by
  ) values (
    p_business_id, p_invoice_id, v_settlement_account_id, v_return_total, true,
    v_voucher_id, p_return_date, p_created_by
  ) returning id into v_refund_allocation_id;

  for v_item in select value from jsonb_array_elements(p_return_items)
  loop
    v_requested := (v_item->>'qty')::integer;
    select ii.id, ii.product_id, ii.product_name, ii.qty, ii.returned_qty, ii.unit_price
      into v_line
    from public.invoice_items ii
    where ii.id = v_item->>'invoice_item_id'
      and ii.invoice_id = p_invoice_id
      and ii.business_id = p_business_id
    for update;

    insert into public.sales_return_lines (
      business_id, sales_return_id, original_invoice_item_id, returned_qty, reason
    ) values (
      p_business_id, v_return_id, v_line.id, v_requested, p_reason
    );
    update public.invoice_items
    set returned_qty = returned_qty + v_requested
    where id = v_line.id and business_id = p_business_id;
    if v_line.product_id is not null then
      perform public.create_stock_movement(
        p_business_id, v_line.product_id, 'adjustment_in', v_requested,
        'Historical return ' || v_return_no || ' against ' || v_invoice.invoice_no,
        p_return_date, p_created_by, null
      );
    end if;
  end loop;

  -- Legacy percentage commission remains immutable: add one negative entry per
  -- seller, capped at commission actually earned and not already reversed.
  for v_commission in
    select sc.salesman_id, max(sc.commission_pct) as commission_pct,
           greatest(sum(sc.commission_amount), 0) as earned_remaining
    from public.salesman_commissions sc
    where sc.business_id = p_business_id and sc.invoice_id = p_invoice_id
    group by sc.salesman_id
    having greatest(sum(sc.commission_amount), 0) > 0
  loop
    v_reversal := least(
      v_commission.earned_remaining,
      floor(v_return_total * v_commission.commission_pct / 100)
    );
    if v_reversal > 0 then
      insert into public.salesman_commissions (
        business_id, salesman_id, invoice_id, allocation_id, collected_amount,
        commission_pct, commission_amount
      ) values (
        p_business_id, v_commission.salesman_id, p_invoice_id, v_refund_allocation_id,
        -v_return_total, v_commission.commission_pct, -v_reversal
      );
    end if;
  end loop;

  select not exists (
    select 1 from public.invoice_items ii
    where ii.business_id = p_business_id and ii.invoice_id = p_invoice_id
      and ii.returned_qty < ii.qty
  ) into v_all_returned;
  if v_all_returned then
    update public.invoices
    set is_returned = true, return_voucher_id = v_voucher_id, updated_at = now()
    where id = p_invoice_id and business_id = p_business_id;
  end if;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (
    p_business_id, p_created_by, 'POST_HISTORICAL_SALES_RETURN', 'sales_return', v_return_id,
    jsonb_build_object(
      'return_no', v_return_no, 'original_invoice_id', p_invoice_id,
      'total', v_return_total, 'settlement_status', v_status
    )
  );

  v_result := jsonb_build_object(
    'return_id', v_return_id,
    'return_no', v_return_no,
    'total', v_return_total,
    'status', case when v_all_returned then 'Returned' else 'Partially Returned' end,
    'settlement_status', v_status,
    'idempotent', false
  );
  update public.legacy_transaction_identity_requests
  set result = v_result
  where business_id = p_business_id
    and operation = 'historical_sales_return'
    and idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;

revoke all on function public.post_sales_return(
  text, text, date, jsonb, text, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.post_sales_return(
  text, text, date, jsonb, text, text, text, uuid, text
) to service_role;

commit;
