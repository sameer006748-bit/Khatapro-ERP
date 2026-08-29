-- KhataPro ERP - legacy-compatible transaction identity bridge
--
-- Target: the original production schema rooted at public.business.
-- This migration is additive. It preserves every existing document number and
-- does not depend on migrations 00033, 00034, or 00035.
--
-- Preflight: fail before changing anything when the verified legacy contract
-- is not present. Supabase migrations run transactionally, so a failure rolls
-- back the statements in this file.
do $$
declare
  v_table text;
  v_column text;
  v_signature text;
begin
  foreach v_table in array array[
    'business', 'invoices', 'purchases', 'expenses', 'receipts', 'payments',
    'contra_entries', 'purchase_returns', 'sales_returns', 'vouchers',
    'rider_cod_submissions'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception '00036 preflight failed: required legacy table public.% is missing', v_table;
    end if;
  end loop;

  foreach v_column in array array[
    'invoices.invoice_no', 'purchases.purchase_no', 'expenses.expense_no',
    'receipts.receipt_no', 'payments.payment_no', 'contra_entries.contra_no',
    'purchase_returns.return_no', 'vouchers.voucher_no',
    'rider_cod_submissions.submission_no'
  ] loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = split_part(v_column, '.', 1)
        and column_name = split_part(v_column, '.', 2)
    ) then
      raise exception '00036 preflight failed: required legacy column public.% is missing', v_column;
    end if;
  end loop;

  foreach v_signature in array array[
    'public.post_sale(text,text,date,jsonb,jsonb,text,text,text,text,text,text,text,uuid)',
    'public.post_payment_voucher(text,date,text,text,numeric,text,text,text,uuid)',
    'public.post_receipt_voucher(text,date,text,text,numeric,text,text,text,uuid)',
    'public.post_journal_voucher(text,date,text,jsonb,text,uuid)',
    'public.post_contra_entry(text,date,text,text,numeric,text,text,uuid)',
    'public.post_expense_batch(text,date,text,jsonb,text,text,uuid)',
    'public.post_purchase_return(text,text,jsonb,text,text,date,text,uuid)',
    'public.post_sales_return(text,text,date,text,uuid)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception '00036 preflight failed: required legacy function % is missing', v_signature;
    end if;
  end loop;
end;
$$;

-- Durable high-water marks prevent a number from being reused after its source
-- transaction is deleted. One row exists per business and approved prefix.
create table if not exists public.legacy_transaction_identity_sequences (
  business_id text not null references public.business(id) on delete cascade,
  prefix text not null check (prefix in (
    'INV', 'SRT', 'PUR', 'PRT', 'EXP', 'REC', 'PAY', 'CON', 'JRV',
    'STA', 'STM', 'OPS', 'RDS', 'COM', 'CAP', 'DRW', 'CS', 'DO'
  )),
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (business_id, prefix)
);

alter table public.legacy_transaction_identity_sequences enable row level security;
revoke all on table public.legacy_transaction_identity_sequences from public, anon, authenticated;
grant select, insert, update on table public.legacy_transaction_identity_sequences to service_role;

-- Posting-level replay records make retry behavior idempotent. A failed posting
-- rolls its claim back in the same transaction; a successful retry returns the
-- original response and therefore cannot consume another identity.
create table if not exists public.legacy_transaction_identity_requests (
  business_id text not null references public.business(id) on delete cascade,
  operation text not null,
  idempotency_key text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (business_id, operation, idempotency_key)
);

alter table public.legacy_transaction_identity_requests enable row level security;
revoke all on table public.legacy_transaction_identity_requests from public, anon, authenticated;
grant select, insert, update on table public.legacy_transaction_identity_requests to service_role;

create or replace function public.legacy_identity_seed_value(
  p_business_id text,
  p_prefix text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seed bigint := 0;
begin
  case p_prefix
    when 'INV' then
      select coalesce(max(substring(invoice_no from '[0-9]+$')::bigint), 0)
      into v_seed from public.invoices
      where business_id = p_business_id and invoice_no ~ '^INV-[0-9]+$';
    when 'PUR' then
      select coalesce(max(substring(purchase_no from '[0-9]+$')::bigint), 0)
      into v_seed from public.purchases
      where business_id = p_business_id and purchase_no ~ '^PUR-[0-9]+$';
    when 'EXP' then
      select coalesce(max(substring(expense_no from '[0-9]+$')::bigint), 0)
      into v_seed from public.expenses
      where business_id = p_business_id and expense_no ~ '^EXP-[0-9]+$';
    when 'REC' then
      select coalesce(max(substring(receipt_no from '[0-9]+$')::bigint), 0)
      into v_seed from public.receipts
      where business_id = p_business_id and receipt_no ~ '^REC-[0-9]+$';
    when 'PAY' then
      select coalesce(max(substring(payment_no from '[0-9]+$')::bigint), 0)
      into v_seed from public.payments
      where business_id = p_business_id and payment_no ~ '^PAY-[0-9]+$';
    when 'CON' then
      select coalesce(max(substring(contra_no from '[0-9]+$')::bigint), 0)
      into v_seed from public.contra_entries
      where business_id = p_business_id and contra_no ~ '^CON-[0-9]+$';
    when 'JRV' then
      select coalesce(max(substring(voucher_no from '[0-9]+$')::bigint), 0)
      into v_seed from public.vouchers
      where business_id = p_business_id and voucher_no ~ '^JRV-[0-9]+$';
    when 'PRT' then
      select coalesce(max(substring(return_no from '[0-9]+$')::bigint), 0)
      into v_seed from public.purchase_returns
      where business_id = p_business_id and return_no ~ '^PRT-[0-9]+$';
    when 'SRT' then
      select coalesce(max(substring(return_no from '[0-9]+$')::bigint), 0)
      into v_seed from public.sales_returns
      where business_id = p_business_id and return_no ~ '^SRT-[0-9]+$';
    when 'CS' then
      select coalesce(max(substring(submission_no from '[0-9]+$')::bigint), 0)
      into v_seed from public.rider_cod_submissions
      where business_id = p_business_id and submission_no ~ '^CS-[0-9]+$';
    when 'STA', 'STM', 'OPS', 'RDS', 'COM', 'CAP', 'DRW', 'DO' then
      v_seed := 0;
    else
      raise exception 'Unsupported legacy transaction prefix: %', p_prefix;
  end case;
  return v_seed;
end;
$$;

revoke all on function public.legacy_identity_seed_value(text, text) from public, anon, authenticated;
grant execute on function public.legacy_identity_seed_value(text, text) to service_role;

-- Add the missing readable sales-return identity in the required safe order:
-- nullable column, stable historical backfill, scoped uniqueness, then NOT NULL.
alter table public.sales_returns add column if not exists return_no text;

with existing as (
  select business_id,
         coalesce(max(substring(return_no from '[0-9]+$')::bigint), 0) as maximum
  from public.sales_returns
  where return_no ~ '^SR-[0-9]+$'
  group by business_id
), ranked as (
  select sr.id,
         coalesce(e.maximum, 0) + row_number() over (
           partition by sr.business_id
           order by sr.created_at, sr.id
         ) as legacy_sequence
  from public.sales_returns sr
  left join existing e on e.business_id = sr.business_id
  where sr.return_no is null
)
update public.sales_returns sr
set return_no = 'SR-' || lpad(r.legacy_sequence::text, 4, '0')
from ranked r
where sr.id = r.id;

create unique index if not exists sales_returns_business_return_no_uidx
  on public.sales_returns (business_id, return_no);

alter table public.sales_returns alter column return_no set not null;

-- Snapshot all current maxima during migration. From this point onward a
-- deletion cannot lower a sequence high-water mark.
insert into public.legacy_transaction_identity_sequences (business_id, prefix, last_value)
select b.id, p.prefix, public.legacy_identity_seed_value(b.id, p.prefix)
from public.business b
cross join unnest(array[
  'INV', 'SRT', 'PUR', 'PRT', 'EXP', 'REC', 'PAY', 'CON', 'JRV',
  'STA', 'STM', 'OPS', 'RDS', 'COM', 'CAP', 'DRW', 'CS', 'DO'
]::text[]) as p(prefix)
on conflict (business_id, prefix) do update
set last_value = greatest(
      public.legacy_transaction_identity_sequences.last_value,
      excluded.last_value
    ),
    updated_at = now();

create or replace function public.allocate_legacy_transaction_identity(
  p_business_id text,
  p_prefix text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next bigint;
begin
  if p_prefix not in (
    'INV', 'SRT', 'PUR', 'PRT', 'EXP', 'REC', 'PAY', 'CON', 'JRV',
    'STA', 'STM', 'OPS', 'RDS', 'COM', 'CAP', 'DRW', 'CS', 'DO'
  ) then
    raise exception 'Unsupported legacy transaction prefix: %', p_prefix;
  end if;

  if not exists (select 1 from public.business where id = p_business_id) then
    raise exception 'Business not found: %', p_business_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id || ':' || p_prefix, 0));

  insert into public.legacy_transaction_identity_sequences (business_id, prefix, last_value)
  values (p_business_id, p_prefix, public.legacy_identity_seed_value(p_business_id, p_prefix))
  on conflict (business_id, prefix) do nothing;

  update public.legacy_transaction_identity_sequences
  set last_value = last_value + 1,
      updated_at = now()
  where business_id = p_business_id and prefix = p_prefix
  returning last_value into v_next;

  return p_prefix || '-' || lpad(v_next::text, 4, '0');
end;
$$;

revoke all on function public.allocate_legacy_transaction_identity(text, text) from public, anon, authenticated;
grant execute on function public.allocate_legacy_transaction_identity(text, text) to service_role;

-- Existing posting functions continue to call their original helpers. These
-- replacements translate old call-site tokens to the approved new prefixes.
create or replace function public.next_invoice_no(p_business_id text)
returns text language sql security definer set search_path = public
as $$ select public.allocate_legacy_transaction_identity(p_business_id, 'INV') $$;

create or replace function public.next_purchase_no(p_business_id text)
returns text language sql security definer set search_path = public
as $$ select public.allocate_legacy_transaction_identity(p_business_id, 'PUR') $$;

create or replace function public.next_purchase_return_no(p_business_id text)
returns text language sql security definer set search_path = public
as $$ select public.allocate_legacy_transaction_identity(p_business_id, 'PRT') $$;

create or replace function public.next_cod_submission_no(p_business_id text)
returns text language sql security definer set search_path = public
as $$ select public.allocate_legacy_transaction_identity(p_business_id, 'CS') $$;

create or replace function public.next_document_no(
  p_business_id text,
  p_prefix text,
  p_table text,
  p_column text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
begin
  v_prefix := case p_table || '.' || p_column
    when 'payments.payment_no' then 'PAY'
    when 'receipts.receipt_no' then 'REC'
    when 'vouchers.voucher_no' then 'JRV'
    when 'contra_entries.contra_no' then 'CON'
    when 'expenses.expense_no' then 'EXP'
    else null
  end;
  if v_prefix is null then
    raise exception 'Invalid legacy document sequence target: %.%', p_table, p_column;
  end if;
  return public.allocate_legacy_transaction_identity(p_business_id, v_prefix);
end;
$$;

create or replace function public.assign_legacy_sales_return_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.return_no is null or btrim(new.return_no) = '' then
    new.return_no := public.allocate_legacy_transaction_identity(new.business_id, 'SRT');
  end if;
  return new;
end;
$$;

drop trigger if exists sales_returns_assign_return_no on public.sales_returns;
create trigger sales_returns_assign_return_no
before insert on public.sales_returns
for each row execute function public.assign_legacy_sales_return_no();

revoke all on function public.assign_legacy_sales_return_no() from public, anon, authenticated;

create or replace function public.claim_legacy_transaction_request(
  p_business_id text,
  p_operation text,
  p_idempotency_key text,
  out claimed boolean,
  out replay jsonb
)
returns record
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Idempotency key is required';
  end if;

  insert into public.legacy_transaction_identity_requests (
    business_id, operation, idempotency_key, result
  ) values (
    p_business_id, p_operation, p_idempotency_key, null
  ) on conflict do nothing;
  get diagnostics v_rows = row_count;
  claimed := v_rows > 0;

  if not claimed then
    select r.result into replay
    from public.legacy_transaction_identity_requests r
    where r.business_id = p_business_id
      and r.operation = p_operation
      and r.idempotency_key = p_idempotency_key;
    if replay is null then
      raise exception 'Idempotent request is still in progress; retry shortly';
    end if;
  end if;
end;
$$;

revoke all on function public.claim_legacy_transaction_request(text, text, text) from public, anon, authenticated;
grant execute on function public.claim_legacy_transaction_request(text, text, text) to service_role;

-- Identity-aware overloads. Before 00036, PostgREST reports these signatures
-- as missing and the application safely retries the original signatures.
create or replace function public.post_sale(
  p_business_id text, p_invoice_type text, p_invoice_date date, p_items jsonb,
  p_payments jsonb, p_salesman_id text, p_customer_id text,
  p_customer_name text, p_customer_phone text, p_customer_address text,
  p_customer_city text, p_memo text, p_created_by uuid, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_claimed boolean; v_result jsonb; v_invoice_id text; v_invoice_no text;
begin
  select claimed, replay into v_claimed, v_result from public.claim_legacy_transaction_request(p_business_id, 'sale', p_idempotency_key);
  if not v_claimed then return v_result || jsonb_build_object('idempotent', true); end if;
  v_invoice_id := public.post_sale(p_business_id, p_invoice_type, p_invoice_date, p_items, p_payments, p_salesman_id, p_customer_id, p_customer_name, p_customer_phone, p_customer_address, p_customer_city, p_memo, p_created_by);
  select invoice_no into v_invoice_no from public.invoices where id = v_invoice_id and business_id = p_business_id;
  v_result := jsonb_build_object('invoice_id', v_invoice_id, 'invoice_no', v_invoice_no, 'idempotent', false);
  update public.legacy_transaction_identity_requests set result = v_result where business_id = p_business_id and operation = 'sale' and idempotency_key = p_idempotency_key;
  return v_result;
end; $$;

create or replace function public.post_payment_voucher(
  p_business_id text, p_payment_date date, p_paid_from_account_id text,
  p_debit_account_id text, p_amount_paisas numeric, p_vendor_id text,
  p_reference text, p_notes text, p_created_by uuid, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_claimed boolean; v_result jsonb;
begin
  select claimed, replay into v_claimed, v_result from public.claim_legacy_transaction_request(p_business_id, 'payment', p_idempotency_key);
  if not v_claimed then return v_result || jsonb_build_object('idempotent', true); end if;
  v_result := public.post_payment_voucher(p_business_id, p_payment_date, p_paid_from_account_id, p_debit_account_id, p_amount_paisas, p_vendor_id, p_reference, p_notes, p_created_by);
  v_result := v_result || jsonb_build_object('idempotent', false);
  update public.legacy_transaction_identity_requests set result = v_result where business_id = p_business_id and operation = 'payment' and idempotency_key = p_idempotency_key;
  return v_result;
end; $$;

create or replace function public.post_receipt_voucher(
  p_business_id text, p_receipt_date date, p_received_into_account_id text,
  p_credit_account_id text, p_amount_paisas numeric, p_customer_id text,
  p_reference text, p_notes text, p_created_by uuid, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_claimed boolean; v_result jsonb;
begin
  select claimed, replay into v_claimed, v_result from public.claim_legacy_transaction_request(p_business_id, 'receipt', p_idempotency_key);
  if not v_claimed then return v_result || jsonb_build_object('idempotent', true); end if;
  v_result := public.post_receipt_voucher(p_business_id, p_receipt_date, p_received_into_account_id, p_credit_account_id, p_amount_paisas, p_customer_id, p_reference, p_notes, p_created_by);
  v_result := v_result || jsonb_build_object('idempotent', false);
  update public.legacy_transaction_identity_requests set result = v_result where business_id = p_business_id and operation = 'receipt' and idempotency_key = p_idempotency_key;
  return v_result;
end; $$;

create or replace function public.post_journal_voucher(
  p_business_id text, p_jv_date date, p_memo text, p_lines jsonb,
  p_reference text, p_created_by uuid, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_claimed boolean; v_result jsonb;
begin
  select claimed, replay into v_claimed, v_result from public.claim_legacy_transaction_request(p_business_id, 'journal', p_idempotency_key);
  if not v_claimed then return v_result || jsonb_build_object('idempotent', true); end if;
  v_result := public.post_journal_voucher(p_business_id, p_jv_date, p_memo, p_lines, p_reference, p_created_by);
  v_result := v_result || jsonb_build_object('idempotent', false);
  update public.legacy_transaction_identity_requests set result = v_result where business_id = p_business_id and operation = 'journal' and idempotency_key = p_idempotency_key;
  return v_result;
end; $$;

create or replace function public.post_contra_entry(
  p_business_id text, p_contra_date date, p_from_account_id text,
  p_to_account_id text, p_amount_paisas numeric, p_reference text,
  p_notes text, p_created_by uuid, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_claimed boolean; v_result jsonb;
begin
  select claimed, replay into v_claimed, v_result from public.claim_legacy_transaction_request(p_business_id, 'contra', p_idempotency_key);
  if not v_claimed then return v_result || jsonb_build_object('idempotent', true); end if;
  v_result := public.post_contra_entry(p_business_id, p_contra_date, p_from_account_id, p_to_account_id, p_amount_paisas, p_reference, p_notes, p_created_by);
  v_result := v_result || jsonb_build_object('idempotent', false);
  update public.legacy_transaction_identity_requests set result = v_result where business_id = p_business_id and operation = 'contra' and idempotency_key = p_idempotency_key;
  return v_result;
end; $$;

create or replace function public.post_expense_batch(
  p_business_id text, p_expense_date date, p_payment_account_id text,
  p_lines jsonb, p_reference text, p_notes text, p_created_by uuid,
  p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_claimed boolean; v_result jsonb;
begin
  select claimed, replay into v_claimed, v_result from public.claim_legacy_transaction_request(p_business_id, 'expense', p_idempotency_key);
  if not v_claimed then return v_result || jsonb_build_object('idempotent', true); end if;
  v_result := public.post_expense_batch(p_business_id, p_expense_date, p_payment_account_id, p_lines, p_reference, p_notes, p_created_by);
  v_result := v_result || jsonb_build_object('idempotent', false);
  update public.legacy_transaction_identity_requests set result = v_result where business_id = p_business_id and operation = 'expense' and idempotency_key = p_idempotency_key;
  return v_result;
end; $$;

create or replace function public.post_purchase_return(
  p_business_id text, p_purchase_id text, p_return_items jsonb,
  p_settlement_type text, p_settlement_account_id text, p_return_date date,
  p_notes text, p_created_by uuid, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_claimed boolean; v_result jsonb; v_return_id text; v_return_no text;
begin
  select claimed, replay into v_claimed, v_result from public.claim_legacy_transaction_request(p_business_id, 'purchase_return', p_idempotency_key);
  if not v_claimed then return v_result || jsonb_build_object('idempotent', true); end if;
  v_return_id := public.post_purchase_return(p_business_id, p_purchase_id, p_return_items, p_settlement_type, p_settlement_account_id, p_return_date, p_notes, p_created_by);
  select return_no into v_return_no from public.purchase_returns where id = v_return_id and business_id = p_business_id;
  v_result := jsonb_build_object('return_id', v_return_id, 'return_no', v_return_no, 'idempotent', false);
  update public.legacy_transaction_identity_requests set result = v_result where business_id = p_business_id and operation = 'purchase_return' and idempotency_key = p_idempotency_key;
  return v_result;
end; $$;

create or replace function public.post_sales_return(
  p_business_id text, p_invoice_id text, p_return_date date, p_reason text,
  p_created_by uuid, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_claimed boolean; v_result jsonb; v_return_id text; v_return_no text; v_total numeric;
begin
  select claimed, replay into v_claimed, v_result from public.claim_legacy_transaction_request(p_business_id, 'sales_return', p_idempotency_key);
  if not v_claimed then return v_result || jsonb_build_object('idempotent', true); end if;
  v_return_id := public.post_sales_return(p_business_id, p_invoice_id, p_return_date, p_reason, p_created_by);
  select return_no, total into v_return_no, v_total from public.sales_returns where id = v_return_id and business_id = p_business_id;
  v_result := jsonb_build_object('return_id', v_return_id, 'return_no', v_return_no, 'total', v_total, 'status', 'posted', 'idempotent', false);
  update public.legacy_transaction_identity_requests set result = v_result where business_id = p_business_id and operation = 'sales_return' and idempotency_key = p_idempotency_key;
  return v_result;
end; $$;

revoke all on function public.post_sale(text, text, date, jsonb, jsonb, text, text, text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.post_payment_voucher(text, date, text, text, numeric, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.post_receipt_voucher(text, date, text, text, numeric, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.post_journal_voucher(text, date, text, jsonb, text, uuid, text) from public, anon, authenticated;
revoke all on function public.post_contra_entry(text, date, text, text, numeric, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.post_expense_batch(text, date, text, jsonb, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.post_purchase_return(text, text, jsonb, text, text, date, text, uuid, text) from public, anon, authenticated;
revoke all on function public.post_sales_return(text, text, date, text, uuid, text) from public, anon, authenticated;

grant execute on function public.post_sale(text, text, date, jsonb, jsonb, text, text, text, text, text, text, text, uuid, text) to service_role;
grant execute on function public.post_payment_voucher(text, date, text, text, numeric, text, text, text, uuid, text) to service_role;
grant execute on function public.post_receipt_voucher(text, date, text, text, numeric, text, text, text, uuid, text) to service_role;
grant execute on function public.post_journal_voucher(text, date, text, jsonb, text, uuid, text) to service_role;
grant execute on function public.post_contra_entry(text, date, text, text, numeric, text, text, uuid, text) to service_role;
grant execute on function public.post_expense_batch(text, date, text, jsonb, text, text, uuid, text) to service_role;
grant execute on function public.post_purchase_return(text, text, jsonb, text, text, date, text, uuid, text) to service_role;
grant execute on function public.post_sales_return(text, text, date, text, uuid, text) to service_role;

-- Rollback notes (manual, intentionally not executed):
-- 1. Drop the eight identity-aware overloads above and the sales-return trigger.
-- 2. Restore the previous next_* function bodies from migrations 00004-00007.
-- 3. Keep sales_returns.return_no and both bridge tables unless a verified backup
--    proves no application or audit dependency; dropping them loses identities
--    and replay history. Never rewrite CV/RV/JV/PRN/SR historical values.
