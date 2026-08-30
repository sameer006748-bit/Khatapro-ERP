-- KhataPro ERP — legacy-compatible Business Accounts management.
--
-- Additive only. Targets the verified public.business / accounts /
-- account_categories / business_accounts lineage and has no UUID-ledger
-- dependency. Application code must call these functions through service_role.

begin;

do $$
declare v_missing text;
begin
  select string_agg(name, ', ' order by name) into v_missing
  from (values
    ('public.business', to_regclass('public.business')),
    ('public.profiles', to_regclass('public.profiles')),
    ('public.accounts', to_regclass('public.accounts')),
    ('public.account_categories', to_regclass('public.account_categories')),
    ('public.business_accounts', to_regclass('public.business_accounts')),
    ('public.audit_logs', to_regclass('public.audit_logs')),
    ('public.payment_allocations', to_regclass('public.payment_allocations')),
    ('public.voucher_lines', to_regclass('public.voucher_lines')),
    ('public.purchase_payments', to_regclass('public.purchase_payments')),
    ('public.legacy_transaction_identity_requests', to_regclass('public.legacy_transaction_identity_requests'))
  ) required(name, relation_name)
  where relation_name is null;

  if v_missing is not null then
    raise exception '00040 preflight failed: required legacy relations are missing: %', v_missing;
  end if;
  if to_regprocedure('public.claim_legacy_transaction_request(text,text,text)') is null then
    raise exception '00040 preflight failed: required legacy idempotency helper is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'legacy_transaction_identity_requests'
      and column_name = 'request_fingerprint'
  ) then
    raise exception '00040 preflight failed: request fingerprint support is missing';
  end if;
end $$;

create or replace function public.list_business_accounts(
  p_business_id text,
  p_actor_profile_id uuid
)
returns table (
  id text,
  account_id text,
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
    where p.id = p_actor_profile_id
      and p.business_id = p_business_id
      and p.is_active = true
  ) then
    raise exception 'Business account access denied';
  end if;

  return query
  select ba.id, ba.account_id, ba.name, ba.type, ba.account_holder,
    ba.bank_name, ba.account_number, ba.is_active, ba.created_at,
    a.code, c.name, c.type, coalesce(a.balance_cache, 0)
  from public.business_accounts ba
  join public.accounts a
    on a.id = ba.account_id and a.business_id = ba.business_id
  join public.account_categories c
    on c.id = a.category_id and c.business_id = ba.business_id
  where ba.business_id = p_business_id
  order by ba.is_active desc, ba.created_at asc;
end;
$$;

create or replace function public.create_business_account(
  p_business_id text,
  p_name text,
  p_type text,
  p_account_holder text,
  p_bank_name text,
  p_account_number text,
  p_actor_profile_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid;
  v_category public.account_categories%rowtype;
  v_account_id text;
  v_business_account_id text;
  v_created_at timestamptz;
  v_code_number integer;
  v_code text;
  v_claimed boolean;
  v_replay jsonb;
  v_result jsonb;
  v_fingerprint text;
  v_saved_fingerprint text;
begin
  if nullif(btrim(p_name), '') is null or length(btrim(p_name)) > 80 then
    raise exception 'Business account name is invalid';
  end if;
  if p_type is null or p_type <> all (array['Cash', 'Bank', 'Wallet', 'Other']) then
    raise exception 'Business account type is invalid';
  end if;

  select p.user_id into v_actor_user_id
  from public.profiles p
  where p.id = p_actor_profile_id
    and p.business_id = p_business_id
    and p.is_active = true;
  if v_actor_user_id is null then
    raise exception 'Business account access denied';
  end if;
  if not exists (select 1 from public.business b where b.id = p_business_id) then
    raise exception 'Business is unavailable';
  end if;

  v_fingerprint := encode(digest(concat_ws(chr(31),
    btrim(p_name), p_type, coalesce(p_account_holder, ''),
    coalesce(p_bank_name, ''), coalesce(p_account_number, '')), 'sha256'), 'hex');

  select claimed, replay into v_claimed, v_replay
  from public.claim_legacy_transaction_request(
    p_business_id, 'business_account_create', p_idempotency_key
  );
  if not v_claimed then
    select request_fingerprint into v_saved_fingerprint
    from public.legacy_transaction_identity_requests
    where business_id = p_business_id
      and operation = 'business_account_create'
      and idempotency_key = p_idempotency_key;
    if v_saved_fingerprint is distinct from v_fingerprint then
      raise exception 'Idempotency key was already used for a different request';
    end if;
    return v_replay || jsonb_build_object('idempotent', true);
  end if;

  update public.legacy_transaction_identity_requests
  set request_fingerprint = v_fingerprint
  where business_id = p_business_id
    and operation = 'business_account_create'
    and idempotency_key = p_idempotency_key;

  select c.* into v_category
  from public.account_categories c
  where c.business_id = p_business_id and c.code = 'ASSET';
  if v_category.id is null then
    raise exception 'Asset category is unavailable';
  end if;

  -- Serialize code allocation per business. The unique business/code constraint
  -- remains the final collision guard.
  perform pg_advisory_xact_lock(hashtextextended('business-account-code:' || p_business_id, 0));
  v_code_number := 1060;
  loop
    if v_code_number = 1100 then v_code_number := 1900; end if;
    if v_code_number > 1999 then
      raise exception 'No business account code is available';
    end if;
    v_code := lpad(v_code_number::text, 4, '0');
    exit when not exists (
      select 1 from public.accounts a
      where a.business_id = p_business_id and a.code = v_code
    );
    v_code_number := v_code_number + 1;
  end loop;

  insert into public.accounts (
    business_id, code, name, category_id, is_active,
    is_business_account, is_party_account, party_type, balance_cache
  ) values (
    p_business_id, v_code, btrim(p_name), v_category.id, true,
    true, false, null, 0
  ) returning id into v_account_id;

  insert into public.business_accounts (
    business_id, account_id, name, type, account_holder,
    bank_name, account_number, is_active
  ) values (
    p_business_id, v_account_id, btrim(p_name), p_type,
    nullif(btrim(p_account_holder), ''), nullif(btrim(p_bank_name), ''),
    nullif(btrim(p_account_number), ''), true
  ) returning id, created_at into v_business_account_id, v_created_at;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, v_actor_user_id, 'CREATE', 'business_account', v_business_account_id,
    jsonb_build_object('name', btrim(p_name), 'type', p_type,
      'ledgerCode', v_code, 'ledgerAccountId', v_account_id));

  v_result := jsonb_build_object(
    'id', v_business_account_id, 'account_id', v_account_id,
    'name', btrim(p_name), 'type', p_type,
    'account_holder', nullif(btrim(p_account_holder), ''),
    'bank_name', nullif(btrim(p_bank_name), ''),
    'account_number', nullif(btrim(p_account_number), ''),
    'is_active', true, 'created_at', v_created_at, 'account_code', v_code,
    'category_name', v_category.name, 'category_type', v_category.type,
    'balance_paisas', '0', 'idempotent', false
  );
  update public.legacy_transaction_identity_requests set result = v_result
  where business_id = p_business_id
    and operation = 'business_account_create'
    and idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;

create or replace function public.update_business_account(
  p_business_id text,
  p_business_account_id text,
  p_name text,
  p_type text,
  p_account_holder text,
  p_bank_name text,
  p_account_number text,
  p_is_active boolean,
  p_update_name boolean,
  p_update_type boolean,
  p_update_account_holder boolean,
  p_update_bank_name boolean,
  p_update_account_number boolean,
  p_update_is_active boolean,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid;
  v_row record;
begin
  select p.user_id into v_actor_user_id from public.profiles p
  where p.id = p_actor_profile_id and p.business_id = p_business_id and p.is_active = true;
  if v_actor_user_id is null then raise exception 'Business account access denied'; end if;
  if p_update_name and (nullif(btrim(p_name), '') is null or length(btrim(p_name)) > 80) then
    raise exception 'Business account name is invalid';
  end if;
  if p_update_type and (p_type is null or p_type <> all (
    array['Cash','Bank','Wallet','Other','Petty Cash','Easypaisa','JazzCash','Custom / Other']
  )) then raise exception 'Business account type is invalid'; end if;

  select ba.id, ba.account_id into v_row
  from public.business_accounts ba
  where ba.id = p_business_account_id and ba.business_id = p_business_id
  for update;
  if v_row.id is null then raise exception 'Business account not found'; end if;

  update public.business_accounts set
    name = case when p_update_name then btrim(p_name) else name end,
    type = case when p_update_type then p_type else type end,
    account_holder = case when p_update_account_holder then nullif(btrim(p_account_holder), '') else account_holder end,
    bank_name = case when p_update_bank_name then nullif(btrim(p_bank_name), '') else bank_name end,
    account_number = case when p_update_account_number then nullif(btrim(p_account_number), '') else account_number end,
    is_active = case when p_update_is_active then p_is_active else is_active end,
    updated_at = now()
  where id = v_row.id and business_id = p_business_id;

  if p_update_name or p_update_is_active then
    update public.accounts set
      name = case when p_update_name then btrim(p_name) else name end,
      is_active = case when p_update_is_active then p_is_active else is_active end,
      updated_at = now()
    where id = v_row.account_id and business_id = p_business_id;
  end if;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, v_actor_user_id, 'UPDATE', 'business_account', v_row.id,
    jsonb_build_object('ledgerAccountId', v_row.account_id));

  select ba.id, ba.account_id, ba.name, ba.type, ba.account_holder, ba.bank_name,
    ba.account_number, ba.is_active, ba.created_at, a.code as account_code,
    c.name as category_name, c.type as category_type, coalesce(a.balance_cache, 0) as balance_paisas
  into v_row
  from public.business_accounts ba
  join public.accounts a on a.id = ba.account_id and a.business_id = ba.business_id
  join public.account_categories c on c.id = a.category_id and c.business_id = ba.business_id
  where ba.id = p_business_account_id and ba.business_id = p_business_id;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.delete_business_account(
  p_business_id text,
  p_business_account_id text,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid;
  v_row record;
  v_payment_allocations bigint;
  v_voucher_lines bigint;
  v_purchase_payments bigint;
begin
  select p.user_id into v_actor_user_id from public.profiles p
  where p.id = p_actor_profile_id and p.business_id = p_business_id and p.is_active = true;
  if v_actor_user_id is null then raise exception 'Business account access denied'; end if;

  select ba.id, ba.account_id, ba.name, ba.type, a.balance_cache into v_row
  from public.business_accounts ba
  join public.accounts a on a.id = ba.account_id and a.business_id = ba.business_id
  where ba.id = p_business_account_id and ba.business_id = p_business_id
  for update of ba, a;
  if v_row.id is null then raise exception 'Business account not found'; end if;

  select count(*) into v_payment_allocations from public.payment_allocations
    where business_id = p_business_id and account_id = v_row.account_id;
  select count(*) into v_voucher_lines from public.voucher_lines
    where business_id = p_business_id and account_id = v_row.account_id;
  select count(*) into v_purchase_payments from public.purchase_payments
    where business_id = p_business_id and account_id = v_row.account_id;

  if v_payment_allocations + v_voucher_lines + v_purchase_payments > 0
     or coalesce(v_row.balance_cache, 0) <> 0 then
    return jsonb_build_object(
      'deleted', false, 'error', 'ACCOUNT_IN_USE',
      'references', jsonb_build_object(
        'paymentAllocations', v_payment_allocations,
        'voucherLines', v_voucher_lines,
        'purchasePayments', v_purchase_payments
      )
    );
  end if;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, v_actor_user_id, 'DELETE', 'business_account', v_row.id,
    jsonb_build_object('name', v_row.name, 'type', v_row.type,
      'ledgerAccountId', v_row.account_id));
  delete from public.business_accounts
    where id = v_row.id and business_id = p_business_id;
  delete from public.accounts
    where id = v_row.account_id and business_id = p_business_id;
  return jsonb_build_object('deleted', true, 'deleted_id', v_row.id);
end;
$$;

revoke all on function public.list_business_accounts(text, uuid) from public, anon, authenticated;
revoke all on function public.create_business_account(text, text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.update_business_account(text, text, text, text, text, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, uuid) from public, anon, authenticated;
revoke all on function public.delete_business_account(text, text, uuid) from public, anon, authenticated;

grant execute on function public.list_business_accounts(text, uuid) to service_role;
grant execute on function public.create_business_account(text, text, text, text, text, text, uuid, text) to service_role;
grant execute on function public.update_business_account(text, text, text, text, text, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, uuid) to service_role;
grant execute on function public.delete_business_account(text, text, uuid) to service_role;

notify pgrst, 'reload schema';

commit;