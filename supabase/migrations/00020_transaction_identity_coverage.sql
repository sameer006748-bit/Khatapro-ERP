-- Business-scoped, concurrency-safe readable transaction identities.
-- Additive only; no historical number is rewritten.
begin;

do $$
begin
  if to_regclass('public.businesses') is null
     or to_regclass('public.identity_sequences') is null then
    raise exception 'Transaction identities require businesses and identity_sequences';
  end if;
end $$;

create or replace function public.transaction_prefix(p_transaction_type text)
returns text
language sql immutable
set search_path = public
as $$
  select case upper(trim(coalesce(p_transaction_type, '')))
    when 'COUNTER_SALE' then 'INV'
    when 'ONLINE_SALE' then 'INV'
    when 'OFC_SALE' then 'INV'
    when 'OTHER_SALE' then 'INV'
    when 'SALE_RETURN' then 'SR'
    when 'PURCHASE' then 'PUR'
    when 'PURCHASE_RETURN' then 'PRN'
    when 'RECEIPT_VOUCHER' then 'RV'
    when 'PAYMENT_VOUCHER' then 'PV'
    when 'JOURNAL_VOUCHER' then 'JV'
    when 'CONTRA_BATCH' then 'CTB'
    when 'CAPITAL_INTRODUCED' then 'CAP'
    when 'OWNER_DRAWING' then 'DRW'
    when 'STOCK_ADJUSTMENT' then 'SA'
    when 'OPENING_STOCK' then 'OS'
    when 'RIDER_COD_SETTLEMENT' then 'RCS'
    when 'RIDER_COD_SUBMISSION' then 'CS'
    when 'COMMISSION_SETTLEMENT' then 'CMS'
    when 'EXPENSE_BATCH' then 'EXP'
    when 'DELIVERY_OUTCOME' then 'DO'
    else null
  end
$$;

create or replace function public.allocate_readable_identity(
  p_business_id uuid, p_prefix text
) returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prefix text := upper(trim(coalesce(p_prefix, '')));
  v_seq int;
begin
  if v_prefix not in (
    'INV', 'SR', 'PUR', 'PRN', 'RV', 'PV', 'JV', 'CTB', 'CAP',
    'DRW', 'SA', 'OS', 'RCS', 'CS', 'CMS', 'EXP', 'DO'
  ) then
    raise exception 'Unsupported transaction identity prefix';
  end if;
  if not exists (select 1 from public.businesses b where b.id = p_business_id) then
    raise exception 'Identity business does not exist';
  end if;

  -- INSERT .. ON CONFLICT UPDATE takes the sequence row lock. The increment is
  -- part of the caller transaction, so a rollback rolls the allocation back.
  insert into public.identity_sequences (business_id, prefix, last_seq)
  values (p_business_id, v_prefix, 1)
  on conflict (business_id, prefix)
  do update set last_seq = public.identity_sequences.last_seq + 1
  returning last_seq into v_seq;
  return v_prefix || '-' || lpad(v_seq::text, 6, '0');
end $$;

create or replace function public.allocate_transaction_identity(
  p_business_id uuid, p_transaction_type text
) returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_prefix text;
begin
  v_prefix := public.transaction_prefix(p_transaction_type);
  if v_prefix is null then
    raise exception 'Unsupported transaction type %', p_transaction_type;
  end if;
  return public.allocate_readable_identity(p_business_id, v_prefix);
end $$;

-- Initialize a prefix from well-formed legacy values only. Malformed values are
-- ignored and existing sequence values can only move forward.
create or replace function public.phase20_seed_identity_sequence(
  p_table_name text, p_column_name text, p_prefix text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare v_sql text;
begin
  if to_regclass(format('public.%I', p_table_name)) is null then return; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table_name
      and column_name = p_column_name
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table_name
      and column_name = 'business_id' and udt_name = 'uuid'
  ) then return; end if;

  v_sql := format(
    $seed$
      insert into public.identity_sequences (business_id, prefix, last_seq)
      select business_id, %L,
             max((substring(%I from %L))::int)
      from public.%I
      where %I ~ %L
      group by business_id
      on conflict (business_id, prefix)
      do update set last_seq = greatest(
        public.identity_sequences.last_seq, excluded.last_seq
      )
    $seed$,
    p_prefix, p_column_name, '^' || p_prefix || '-([0-9]+)$',
    p_table_name, p_column_name, '^' || p_prefix || '-[0-9]+$'
  );
  execute v_sql;
end $$;

select public.phase20_seed_identity_sequence('invoices', 'invoice_no', 'INV');
select public.phase20_seed_identity_sequence('sale_return_documents', 'return_no', 'SR');
select public.phase20_seed_identity_sequence('purchases', 'purchase_no', 'PUR');
select public.phase20_seed_identity_sequence('purchase_returns', 'return_no', 'PRN');
select public.phase20_seed_identity_sequence('receipts', 'receipt_no', 'RV');
select public.phase20_seed_identity_sequence('payments', 'payment_no', 'PV');
select public.phase20_seed_identity_sequence('vouchers', 'voucher_no', 'JV');
select public.phase20_seed_identity_sequence('rider_cod_settlement_batches', 'reference', 'RCS');
select public.phase20_seed_identity_sequence('rider_cod_submissions', 'submission_no', 'CS');
select public.phase20_seed_identity_sequence('delivery_outcome_batches', 'outcome_no', 'DO');

-- Compatibility entry points used by the existing posting RPCs. Their
-- table/column arguments are retained but never interpolated.
create or replace function public.next_invoice_no(p_business_id text)
returns text language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return public.allocate_transaction_identity(p_business_id::uuid, 'COUNTER_SALE');
end $$;

create or replace function public.next_purchase_no(p_business_id text)
returns text language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return public.allocate_transaction_identity(p_business_id::uuid, 'PURCHASE');
end $$;

create or replace function public.next_purchase_return_no(p_business_id text)
returns text language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return public.allocate_transaction_identity(p_business_id::uuid, 'PURCHASE_RETURN');
end $$;

create or replace function public.next_cod_submission_no(p_business_id text)
returns text language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return public.allocate_readable_identity(p_business_id::uuid, 'CS');
end $$;

create or replace function public.next_document_no(
  p_business_id text, p_prefix text, p_table text, p_column text
) returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_prefix text := upper(trim(coalesce(p_prefix, '')));
begin
  if v_prefix = 'CV' then v_prefix := 'CTB'; end if;
  if v_prefix not in ('RV', 'PV', 'JV', 'CTB', 'EXP') then
    raise exception 'Unsupported voucher identity prefix';
  end if;
  return public.allocate_readable_identity(p_business_id::uuid, v_prefix);
end $$;

-- The Phase 2 Sale Return RPC still supplies a last-row candidate. This trigger
-- replaces every new candidate inside the same transaction with the safe SR
-- sequence. Existing return_no values are never touched.
create or replace function public.phase20_assign_sale_return_identity()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  new.return_no := public.allocate_transaction_identity(new.business_id, 'SALE_RETURN');
  return new;
end $$;

do $$
begin
  if to_regclass('public.sale_return_documents') is not null then
    drop trigger if exists phase20_sale_return_identity
      on public.sale_return_documents;
    create trigger phase20_sale_return_identity
      before insert on public.sale_return_documents
      for each row execute function public.phase20_assign_sale_return_identity();
  end if;
end $$;

-- Stock adjustments/opening stock did not previously have a document number.
-- The nullable column preserves historical rows; only new applicable movements
-- are assigned.
do $$
begin
  if to_regclass('public.stock_movements') is not null then
    alter table public.stock_movements add column if not exists readable_no text;
    create unique index if not exists stock_movements_business_readable_no_idx
      on public.stock_movements(business_id, readable_no)
      where readable_no is not null;
  end if;
end $$;

create or replace function public.phase20_assign_stock_identity()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.readable_no is not null then return new; end if;
  if lower(new.movement_type) = 'opening' then
    new.readable_no := public.allocate_transaction_identity(new.business_id::text::uuid, 'OPENING_STOCK');
  elsif lower(new.movement_type) in ('adjustment_in', 'adjustment_out', 'correction') then
    new.readable_no := public.allocate_transaction_identity(new.business_id::text::uuid, 'STOCK_ADJUSTMENT');
  end if;
  return new;
end $$;

do $$
begin
  if to_regclass('public.stock_movements') is not null then
    drop trigger if exists phase20_stock_identity on public.stock_movements;
    create trigger phase20_stock_identity
      before insert on public.stock_movements
      for each row execute function public.phase20_assign_stock_identity();
  end if;
end $$;

-- One stable drilldown source for report/audit code. Transaction tables retain
-- their existing user-facing number columns.
create table if not exists public.transaction_identity_audit (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  transaction_type text not null,
  readable_no text not null,
  source_id text,
  actor_id uuid,
  allocated_at timestamptz not null default now(),
  constraint transaction_identity_audit_number_key
    unique (business_id, readable_no)
);
alter table public.transaction_identity_audit enable row level security;
revoke all on public.transaction_identity_audit from public, anon, authenticated;
grant all on public.transaction_identity_audit to service_role;

revoke all on function public.transaction_prefix(text) from public, anon;
revoke all on function public.allocate_readable_identity(uuid, text) from public, anon, authenticated;
revoke all on function public.allocate_transaction_identity(uuid, text) from public, anon, authenticated;
revoke all on function public.phase20_seed_identity_sequence(text, text, text) from public, anon, authenticated;
grant execute on function public.transaction_prefix(text) to authenticated, service_role;
grant execute on function public.allocate_readable_identity(uuid, text) to service_role;
grant execute on function public.allocate_transaction_identity(uuid, text) to service_role;

commit;
