-- One atomic, service-only canonical voucher posting engine.
begin;

do $$
begin
  if to_regclass('public.ledger_vouchers') is null
     or to_regclass('public.ledger_voucher_lines') is null then
    raise exception 'Atomic ledger posting requires migrations 00025 and 00026';
  end if;
end $$;

create or replace function public.ledger_voucher_prefix(p_voucher_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case upper(trim(coalesce(p_voucher_type, '')))
    when 'SI' then 'INV' when 'SALE' then 'INV'
    when 'SR' then 'SR'
    when 'PU' then 'PUR' when 'PURCHASE' then 'PUR'
    when 'PR' then 'PRN'
    when 'RC' then 'RV' when 'RV' then 'RV'
    when 'PM' then 'PV' when 'PV' then 'PV'
    when 'JV' then 'JV'
    when 'CT' then 'CTB' when 'CONTRA' then 'CTB'
    when 'CAPITAL' then 'CAP'
    when 'DRAWING' then 'DRW'
    when 'OP' then 'OS'
    when 'EXP' then 'EXP'
    when 'SA' then 'SA'
    when 'COD' then 'RCS'
    else 'JV'
  end
$$;

create or replace function public.ledger_next_voucher_number(
  p_business_id uuid, p_voucher_type text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prefix text := public.ledger_voucher_prefix(p_voucher_type);
  v_sequence bigint;
begin
  if not exists (select 1 from public.businesses where id = p_business_id) then
    raise exception 'Voucher business does not exist';
  end if;
  insert into public.ledger_voucher_sequences (business_id, prefix, last_sequence)
  values (p_business_id, v_prefix, 1)
  on conflict (business_id, prefix)
  do update set last_sequence = public.ledger_voucher_sequences.last_sequence + 1
  returning last_sequence into v_sequence;
  return v_prefix || '-' || lpad(v_sequence::text, 6, '0');
end $$;

create or replace function public.post_ledger_voucher(
  p_business_id uuid,
  p_voucher_type text,
  p_transaction_date date,
  p_narration text,
  p_lines jsonb,
  p_source_type text,
  p_source_id text,
  p_idempotency_key text,
  p_posted_by uuid,
  p_reference text default null,
  p_readable_number text default null,
  p_reverses_voucher_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.ledger_vouchers%rowtype;
  v_voucher_id uuid := gen_random_uuid();
  v_readable_number text;
  v_normalized_lines jsonb;
  v_fingerprint text;
  v_total_debit numeric(20,0);
  v_total_credit numeric(20,0);
  v_line_count integer;
  v_valid_account_count integer;
  v_prefix text;
  v_supplied_sequence bigint;
begin
  if p_posted_by is null or not exists (
    select 1
    from public.profiles pr
    where pr.id = p_posted_by
      and pr.business_id = p_business_id
      and pr.status = 'Active'
  ) then
    raise exception 'Active same-business posting profile is required'
      using errcode = '42501';
  end if;
  if p_transaction_date is null
     or nullif(trim(coalesce(p_voucher_type, '')), '') is null
     or nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Voucher type, date, and idempotency key are required';
  end if;
  if (p_source_type is null) <> (p_source_id is null) then
    raise exception 'Source type and source ID must be supplied together';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) < 2 then
    raise exception 'Voucher must have at least 2 lines';
  end if;

  begin
    with parsed as (
      select
        value->>'account_id' as account_id,
        coalesce((value->>'debit_paisas')::numeric, (value->>'debit')::numeric, 0) as debit_paisas,
        coalesce((value->>'credit_paisas')::numeric, (value->>'credit')::numeric, 0) as credit_paisas,
        nullif(trim(value->>'party_type'), '') as party_type,
        nullif(trim(value->>'party_id'), '') as party_id,
        nullif(trim(coalesce(value->>'line_narration', value->>'memo')), '') as line_narration,
        nullif(trim(value->>'source_line_reference'), '') as source_line_reference,
        ordinal::integer as line_number
      from jsonb_array_elements(p_lines) with ordinality item(value, ordinal)
    )
    select
      jsonb_agg(jsonb_build_object(
        'account_id', account_id,
        'debit_paisas', debit_paisas::text,
        'credit_paisas', credit_paisas::text,
        'party_type', party_type,
        'party_id', party_id,
        'line_narration', line_narration,
        'source_line_reference', source_line_reference,
        'line_number', line_number
      ) order by line_number),
      sum(debit_paisas), sum(credit_paisas), count(*)
    into v_normalized_lines, v_total_debit, v_total_credit, v_line_count
    from parsed
    where account_id is not null
      and debit_paisas = trunc(debit_paisas)
      and credit_paisas = trunc(credit_paisas)
      and debit_paisas >= 0
      and credit_paisas >= 0
      and (
        (debit_paisas > 0 and credit_paisas = 0)
        or (credit_paisas > 0 and debit_paisas = 0)
      );
  exception when others then
    raise exception 'Voucher lines contain an invalid account or whole-paisa amount';
  end;

  if v_line_count <> jsonb_array_length(p_lines) then
    raise exception 'Each line must have exactly one positive debit or credit';
  end if;
  if v_total_debit is null or v_total_debit <= 0
     or v_total_debit <> v_total_credit then
    raise exception 'Unbalanced voucher: total debit % <> total credit %',
      coalesce(v_total_debit, 0), coalesce(v_total_credit, 0);
  end if;

  select count(*) into v_valid_account_count
  from (
    select distinct (line->>'account_id')::uuid as account_id
    from jsonb_array_elements(v_normalized_lines) line
  ) requested
  join public.ledger_accounts a
    on a.id = requested.account_id
   and a.business_id = p_business_id
   and a.is_active
   and a.is_postable;
  if v_valid_account_count <> (
    select count(distinct line->>'account_id')
    from jsonb_array_elements(v_normalized_lines) line
  ) then
    raise exception 'Invalid, inactive, non-postable, or cross-business ledger account';
  end if;

  if p_reverses_voucher_id is not null and not exists (
    select 1 from public.ledger_vouchers
    where business_id = p_business_id and id = p_reverses_voucher_id
  ) then
    raise exception 'Reversed voucher does not belong to this business';
  end if;

  v_fingerprint := encode(digest(jsonb_build_object(
    'business_id', p_business_id,
    'voucher_type', upper(trim(p_voucher_type)),
    'transaction_date', p_transaction_date,
    'narration', nullif(trim(coalesce(p_narration, '')), ''),
    'reference', nullif(trim(coalesce(p_reference, '')), ''),
    'source_type', nullif(trim(coalesce(p_source_type, '')), ''),
    'source_id', nullif(trim(coalesce(p_source_id, '')), ''),
    'reverses_voucher_id', p_reverses_voucher_id,
    'lines', v_normalized_lines
  )::text, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(
    hashtextextended(p_business_id::text || ':' || trim(p_idempotency_key), 0)
  );
  select * into v_existing
  from public.ledger_vouchers
  where business_id = p_business_id and idempotency_key = trim(p_idempotency_key);
  if found then
    if v_existing.payload_fingerprint <> v_fingerprint then
      raise exception 'Idempotency key conflicts with a different voucher payload'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'voucher_id', v_existing.id,
      'readable_number', v_existing.readable_number,
      'total_debit_paisas', v_existing.total_debit_paisas,
      'total_credit_paisas', v_existing.total_credit_paisas,
      'idempotent', true
    );
  end if;

  if p_source_type is not null and exists (
    select 1 from public.ledger_vouchers
    where business_id = p_business_id
      and source_type = trim(p_source_type)
      and source_id = trim(p_source_id)
  ) then
    raise exception 'Source transaction is already posted to the ledger'
      using errcode = '23505';
  end if;

  if p_readable_number is null then
    v_readable_number := public.ledger_next_voucher_number(
      p_business_id, p_voucher_type
    );
  else
    v_readable_number := upper(trim(p_readable_number));
    if v_readable_number !~ '^[A-Z][A-Z0-9]{0,7}-[0-9]{1,12}$' then
      raise exception 'Supplied readable voucher number is invalid';
    end if;
    v_prefix := split_part(v_readable_number, '-', 1);
    v_supplied_sequence := split_part(v_readable_number, '-', 2)::bigint;
    insert into public.ledger_voucher_sequences (business_id, prefix, last_sequence)
    values (p_business_id, v_prefix, v_supplied_sequence)
    on conflict (business_id, prefix) do update
      set last_sequence = greatest(
        public.ledger_voucher_sequences.last_sequence,
        excluded.last_sequence
      );
  end if;

  insert into public.ledger_vouchers (
    id, business_id, readable_number, voucher_type, transaction_date,
    narration, reference, source_type, source_id, idempotency_key,
    payload_fingerprint, posted_by, total_debit_paisas,
    total_credit_paisas, reverses_voucher_id
  ) values (
    v_voucher_id, p_business_id, v_readable_number, upper(trim(p_voucher_type)),
    p_transaction_date, nullif(trim(coalesce(p_narration, '')), ''),
    nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_source_type, '')), ''),
    nullif(trim(coalesce(p_source_id, '')), ''),
    trim(p_idempotency_key), v_fingerprint, p_posted_by,
    v_total_debit, v_total_credit, p_reverses_voucher_id
  );

  insert into public.ledger_voucher_lines (
    business_id, voucher_id, account_id, line_number,
    debit_paisas, credit_paisas, party_type, party_id,
    line_narration, source_line_reference
  )
  select
    p_business_id, v_voucher_id, (line->>'account_id')::uuid,
    (line->>'line_number')::integer,
    (line->>'debit_paisas')::numeric,
    (line->>'credit_paisas')::numeric,
    nullif(line->>'party_type', 'null'),
    nullif(line->>'party_id', 'null'),
    nullif(line->>'line_narration', 'null'),
    nullif(line->>'source_line_reference', 'null')
  from jsonb_array_elements(v_normalized_lines) line;

  return jsonb_build_object(
    'voucher_id', v_voucher_id,
    'readable_number', v_readable_number,
    'total_debit_paisas', v_total_debit,
    'total_credit_paisas', v_total_credit,
    'idempotent', false
  );
end $$;

create or replace function public.reverse_ledger_voucher(
  p_business_id uuid,
  p_voucher_id uuid,
  p_reversal_date date,
  p_reason text,
  p_idempotency_key text,
  p_posted_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_original public.ledger_vouchers%rowtype;
  v_lines jsonb;
begin
  select * into v_original
  from public.ledger_vouchers
  where business_id = p_business_id and id = p_voucher_id;
  if not found then raise exception 'Original voucher not found'; end if;

  select jsonb_agg(jsonb_build_object(
    'account_id', l.account_id,
    'debit_paisas', l.credit_paisas,
    'credit_paisas', l.debit_paisas,
    'party_type', l.party_type,
    'party_id', l.party_id,
    'line_narration', coalesce(p_reason, 'Reversal') || ': ' || coalesce(l.line_narration, ''),
    'source_line_reference', l.id::text
  ) order by l.line_number)
  into v_lines
  from public.ledger_voucher_lines l
  where l.business_id = p_business_id and l.voucher_id = p_voucher_id;

  return public.post_ledger_voucher(
    p_business_id, 'JV', p_reversal_date,
    'Reversal of ' || v_original.readable_number || ': ' || coalesce(p_reason, ''),
    v_lines, 'ledger_reversal', p_voucher_id::text, p_idempotency_key,
    p_posted_by, v_original.readable_number, null, p_voucher_id
  );
end $$;

revoke all on function public.ledger_voucher_prefix(text) from public, anon;
revoke all on function public.ledger_next_voucher_number(uuid, text)
  from public, anon, authenticated;
revoke all on function public.post_ledger_voucher(
  uuid, text, date, text, jsonb, text, text, text, uuid, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.reverse_ledger_voucher(
  uuid, uuid, date, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.ledger_voucher_prefix(text) to service_role;
grant execute on function public.ledger_next_voucher_number(uuid, text) to service_role;
grant execute on function public.post_ledger_voucher(
  uuid, text, date, text, jsonb, text, text, text, uuid, text, text, uuid
) to service_role;
grant execute on function public.reverse_ledger_voucher(
  uuid, uuid, date, text, text, uuid
) to service_role;

commit;
notify pgrst, 'reload schema';
