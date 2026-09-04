-- KhataPro ERP - immutable, readable Business Account identities.
--
-- Legacy-compatible rollout:
--   * the four deployed Business Accounts RPC signatures stay untouched;
--   * old inserts acquire an identity through the table trigger;
--   * the additive list_business_accounts_v2 RPC exposes stored identity;
--   * the numeric ledger code remains an accounting reference only.

begin;

do $$
declare
  v_missing text;
begin
  select string_agg(name, ', ' order by name) into v_missing
  from (values
    ('public.accounts', to_regclass('public.accounts')),
    ('public.account_categories', to_regclass('public.account_categories')),
    ('public.audit_logs', to_regclass('public.audit_logs')),
    ('public.business_accounts', to_regclass('public.business_accounts')),
    ('public.profiles', to_regclass('public.profiles'))
  ) required(name, relation_name)
  where relation_name is null;

  if v_missing is not null then
    raise exception 'Business Account identity preflight failed: required legacy relations are missing: %', v_missing;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'business_accounts'
      and column_name = 'identity'
  ) then
    raise exception 'Business Account identity preflight failed: business_accounts.identity already exists';
  end if;

  if exists (
    select 1
    from (values
      ('id', 'text', 'text'),
      ('business_id', 'text', 'text'),
      ('account_id', 'text', 'text'),
      ('name', 'text', 'text'),
      ('type', 'text', 'text'),
      ('account_holder', 'text', 'text'),
      ('bank_name', 'text', 'text'),
      ('is_active', 'boolean', 'bool'),
      ('created_at', 'timestamp with time zone', 'timestamptz')
    ) expected(column_name, data_type, udt_name)
    left join information_schema.columns c
      on c.table_schema = 'public'
     and c.table_name = 'business_accounts'
     and c.column_name = expected.column_name
    where c.column_name is null
       or c.data_type <> expected.data_type
       or c.udt_name <> expected.udt_name
  ) then
    raise exception 'Business Account identity preflight failed: unexpected business_accounts column types';
  end if;

  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.business_accounts'::regclass
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid, true) = 'UNIQUE (account_id)'
  ) then
    raise exception 'Business Account identity preflight failed: UNIQUE (account_id) is missing';
  end if;

  if to_regprocedure('public.list_business_accounts(text,uuid)') is null
     or to_regprocedure('public.create_business_account(text,text,text,text,text,text,uuid,text)') is null
     or to_regprocedure('public.update_business_account(text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean,uuid)') is null
     or to_regprocedure('public.delete_business_account(text,text,uuid)') is null then
    raise exception 'Business Account identity preflight failed: deployed Business Accounts RPC contract changed';
  end if;
end $$;

-- The only new data column. It is nullable just long enough to backfill while
-- the ALTER TABLE lock prevents concurrent legacy inserts.
alter table public.business_accounts add column identity text;

-- Canonical token helper shared by backfill and future allocation. This never
-- consumes a row id, UUID, or numeric ledger code as a fallback.
create or replace function public.normalize_business_account_identity(p_value text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_token text;
  v_cut text;
  v_last_hyphen integer;
begin
  v_token := trim(both '-' from regexp_replace(upper(coalesce(p_value, '')), '[^A-Z0-9]+', '-', 'g'));
  if char_length(v_token) <= 40 then
    return v_token;
  end if;

  v_cut := left(v_token, 40);
  v_last_hyphen := strpos(reverse(v_cut), '-');
  if v_last_hyphen > 0 then
    v_cut := left(v_cut, char_length(v_cut) - v_last_hyphen);
  end if;
  return trim(both '-' from v_cut);
end;
$$;

-- One central allocator for backfill and every later INSERT. It serializes per
-- business and checks both persisted identities and the five canonical seeded
-- identities, including seeded ledger rows that have not been linked yet.
create or replace function public.allocate_business_account_identity(
  p_business_id text,
  p_name text,
  p_type text,
  p_account_code text,
  p_bank_name text,
  p_account_holder text
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_base text;
  v_candidate text;
  v_hint text;
  v_suffix text;
  v_prefix text;
  v_budget integer;
  v_alt integer;
begin
  if nullif(btrim(p_business_id), '') is null then
    raise exception using errcode = '22023', message = 'Business Account identity requires a business';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('business-account-identity:' || p_business_id, 0));

  v_base := case btrim(coalesce(p_account_code, ''))
    when '1010' then 'CASH'
    when '1020' then 'PETTY-CASH'
    when '1030' then 'BANK'
    when '1040' then 'EASYPAISA'
    when '1050' then 'JAZZCASH'
    else public.normalize_business_account_identity(p_name)
  end;

  if btrim(coalesce(p_account_code, '')) not in ('1010', '1020', '1030', '1040', '1050') then
    if nullif(v_base, '') is null or v_base ~ '^[0-9-]+$' or v_base !~ '^[A-Z]' then
      raise exception using
        errcode = '22023',
        message = 'A readable Business Account identity cannot be derived from this name';
    end if;
    if coalesce(p_type, '') ilike '%bank%' and left(v_base, 4) <> 'BANK' then
      v_base := public.normalize_business_account_identity('BANK-' || v_base);
    end if;
  end if;

  if v_base !~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$' then
    raise exception using errcode = '22023', message = 'Generated Business Account identity is not readable';
  end if;

  -- A candidate is unavailable if already persisted or reserved for a seeded
  -- ledger row in this business. The seeded row itself may claim its own word.
  v_candidate := v_base;
  if not exists (
      select 1 from public.business_accounts ba
      where ba.business_id = p_business_id and ba.identity = v_candidate
    ) and not exists (
      select 1 from public.accounts a
      where a.business_id = p_business_id
        and a.code in ('1010', '1020', '1030', '1040', '1050')
        and a.code is distinct from btrim(coalesce(p_account_code, ''))
        and case a.code
          when '1010' then 'CASH'
          when '1020' then 'PETTY-CASH'
          when '1030' then 'BANK'
          when '1040' then 'EASYPAISA'
          when '1050' then 'JAZZCASH'
        end = v_candidate
    ) then
    return v_candidate;
  end if;

  foreach v_hint in array array[p_bank_name, p_account_holder] loop
    v_suffix := public.normalize_business_account_identity(left(coalesce(v_hint, ''), 20));
    if nullif(v_suffix, '') is null or v_suffix ~ '^[0-9-]+$' or v_suffix !~ '^[A-Z]' then
      continue;
    end if;
    v_budget := 40 - char_length(v_suffix) - 1;
    if v_budget < 1 then continue; end if;
    v_prefix := left(v_base, v_budget);
    if char_length(v_base) > v_budget and strpos(reverse(v_prefix), '-') > 0 then
      v_prefix := left(v_prefix, char_length(v_prefix) - strpos(reverse(v_prefix), '-'));
    end if;
    v_prefix := trim(both '-' from v_prefix);
    if nullif(v_prefix, '') is null then continue; end if;
    v_candidate := v_prefix || '-' || v_suffix;
    if not exists (
        select 1 from public.business_accounts ba
        where ba.business_id = p_business_id and ba.identity = v_candidate
      ) and not exists (
        select 1 from public.accounts a
        where a.business_id = p_business_id
          and a.code in ('1010', '1020', '1030', '1040', '1050')
          and a.code is distinct from btrim(coalesce(p_account_code, ''))
          and case a.code
            when '1010' then 'CASH'
            when '1020' then 'PETTY-CASH'
            when '1030' then 'BANK'
            when '1040' then 'EASYPAISA'
            when '1050' then 'JAZZCASH'
          end = v_candidate
      ) then
      return v_candidate;
    end if;
  end loop;

  for v_alt in 1..99 loop
    v_suffix := case when v_alt = 1 then 'ALT' else 'ALT-' || v_alt::text end;
    v_budget := 40 - char_length(v_suffix) - 1;
    v_prefix := left(v_base, v_budget);
    if char_length(v_base) > v_budget and strpos(reverse(v_prefix), '-') > 0 then
      v_prefix := left(v_prefix, char_length(v_prefix) - strpos(reverse(v_prefix), '-'));
    end if;
    v_prefix := trim(both '-' from v_prefix);
    if nullif(v_prefix, '') is null then exit; end if;
    v_candidate := v_prefix || '-' || v_suffix;
    if not exists (
        select 1 from public.business_accounts ba
        where ba.business_id = p_business_id and ba.identity = v_candidate
      ) and not exists (
        select 1 from public.accounts a
        where a.business_id = p_business_id
          and a.code in ('1010', '1020', '1030', '1040', '1050')
          and a.code is distinct from btrim(coalesce(p_account_code, ''))
          and case a.code
            when '1010' then 'CASH'
            when '1020' then 'PETTY-CASH'
            when '1030' then 'BANK'
            when '1040' then 'EASYPAISA'
            when '1050' then 'JAZZCASH'
          end = v_candidate
      ) then
      return v_candidate;
    end if;
  end loop;

  raise exception using
    errcode = '23505',
    message = 'No safe unique readable Business Account identity is available';
end;
$$;

-- Deterministic order makes collision handling repeatable. The table lock held
-- by ADD COLUMN prevents a concurrent old caller from entering mid-backfill.
do $$
declare
  v_row record;
begin
  for v_row in
    select ba.id, ba.business_id, ba.name, ba.type, ba.bank_name,
           ba.account_holder, a.code as account_code
    from public.business_accounts ba
    join public.accounts a
      on a.id = ba.account_id and a.business_id = ba.business_id
    order by ba.business_id, ba.created_at, ba.id
  loop
    update public.business_accounts
    set identity = public.allocate_business_account_identity(
      v_row.business_id,
      v_row.name,
      v_row.type,
      v_row.account_code,
      v_row.bank_name,
      v_row.account_holder
    )
    where id = v_row.id and business_id = v_row.business_id;
  end loop;
end $$;

alter table public.business_accounts
  alter column identity set not null,
  add constraint business_accounts_identity_readable check (
    char_length(identity) between 1 and 40
    and identity = btrim(identity)
    and identity ~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$'
  ),
  add constraint business_accounts_business_identity_key unique (business_id, identity);

create or replace function public.enforce_business_account_identity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_account_code text;
begin
  if tg_op = 'UPDATE' then
    if new.identity is distinct from old.identity then
      raise exception using
        errcode = '23514',
        message = 'Business Account identity is immutable';
    end if;
    return new;
  end if;

  select a.code into v_account_code
  from public.accounts a
  where a.id = new.account_id and a.business_id = new.business_id;
  if v_account_code is null then
    raise exception using errcode = '23503', message = 'Linked ledger account is unavailable';
  end if;

  -- Ignore caller-supplied identity: normal create/link callers have no identity
  -- input, and every inserted row must use the central server-side allocator.
  new.identity := public.allocate_business_account_identity(
    new.business_id,
    new.name,
    new.type,
    v_account_code,
    new.bank_name,
    new.account_holder
  );
  return new;
end;
$$;

create trigger business_accounts_identity_guard
before insert or update of identity on public.business_accounts
for each row execute function public.enforce_business_account_identity();

-- Additive read contract. Existing deployed clients continue calling the old
-- function; the new application prefers v2 and falls back during rollout.
create or replace function public.list_business_accounts_v2(
  p_business_id text,
  p_actor_profile_id uuid
)
returns table (
  id text,
  account_id text,
  identity text,
  name text,
  type text,
  account_holder text,
  bank_name text,
  account_number text,
  is_active boolean,
  created_at timestamptz,
  account_code text,
  category_name text,
  category_type text,
  balance_paisas numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id::text
      and p.business_id = p_business_id
      and p.is_active = true
  ) then
    raise exception 'Business account access denied';
  end if;

  return query
  select ba.id, ba.account_id, ba.identity, ba.name, ba.type,
    ba.account_holder, ba.bank_name, ba.account_number, ba.is_active,
    ba.created_at, a.code, c.name, c.type, coalesce(a.balance_cache, 0)
  from public.business_accounts ba
  join public.accounts a
    on a.id = ba.account_id and a.business_id = ba.business_id
  join public.account_categories c
    on c.id = a.category_id and c.business_id = ba.business_id
  where ba.business_id = p_business_id
  order by ba.is_active desc, ba.created_at asc;
end;
$$;

-- Every new money-account audit row is self-contained and readable. Internal
-- row ids are removed from details; entity_id remains the protected audit FK.
create or replace function public.enrich_business_account_audit_identity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_name text;
  v_identity text;
  v_ledger_code text;
begin
  if new.entity = 'business_account' and new.entity_id is not null then
    select ba.name, ba.identity, a.code
    into v_name, v_identity, v_ledger_code
    from public.business_accounts ba
    join public.accounts a
      on a.id = ba.account_id and a.business_id = ba.business_id
    where ba.id = new.entity_id and ba.business_id = new.business_id;

    if found then
      new.details := (
        coalesce(new.details, '{}'::jsonb)
        - 'ledgerAccountId' - 'accountId' - 'businessId' - 'userId'
        - 'profileId' - 'idempotencyKey'
      ) || jsonb_build_object(
        'name', v_name,
        'identity', v_identity,
        'ledgerCode', v_ledger_code
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger audit_logs_business_account_identity
before insert on public.audit_logs
for each row execute function public.enrich_business_account_audit_identity();

revoke all on function public.normalize_business_account_identity(text) from public, anon, authenticated;
revoke all on function public.allocate_business_account_identity(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.enforce_business_account_identity() from public, anon, authenticated;
revoke all on function public.enrich_business_account_audit_identity() from public, anon, authenticated;
revoke all on function public.list_business_accounts_v2(text, uuid) from public, anon, authenticated;

grant execute on function public.normalize_business_account_identity(text) to service_role;
grant execute on function public.allocate_business_account_identity(text, text, text, text, text, text) to service_role;
grant execute on function public.list_business_accounts_v2(text, uuid) to service_role;

notify pgrst, 'reload schema';

commit;
