-- Batch 1: production-safe business money transfers and owner equity.
-- This is intentionally an operational store, not a Chart of Accounts or
-- voucher engine.  It uses only proven production identities: businesses and
-- profiles.  All amounts are whole paisas (numeric(20,0)).
begin;

do $$
declare v_missing text;
begin
  select string_agg(required_name, ', ' order by required_name) into v_missing
  from (values
    ('public.businesses', to_regclass('public.businesses')),
    ('public.profiles', to_regclass('public.profiles'))
  ) required(required_name, relation_name)
  where relation_name is null;
  if v_missing is not null then
    raise exception 'Contra/drawings requires proven production table(s): %', v_missing;
  end if;
end $$;

create table if not exists public.business_money_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  account_key text not null check (account_key in ('cash', 'bank', 'wallet')),
  name text not null,
  balance_paisas numeric(20,0) not null default 0 check (balance_paisas >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, account_key)
);

create table if not exists public.business_money_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  transaction_kind text not null check (transaction_kind in ('contra', 'capital', 'drawings')),
  source_account_id uuid references public.business_money_accounts(id) on delete restrict,
  destination_account_id uuid references public.business_money_accounts(id) on delete restrict,
  amount_paisas numeric(20,0) not null check (amount_paisas > 0),
  equity_delta_paisas numeric(20,0) not null default 0,
  transaction_date date not null,
  note text,
  reference text not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  posted_by uuid not null references public.profiles(id) on delete restrict,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint business_money_transactions_idempotency unique (business_id, idempotency_key),
  constraint business_money_transactions_shape check (
    (transaction_kind = 'contra' and source_account_id is not null and destination_account_id is not null and source_account_id <> destination_account_id and equity_delta_paisas = 0)
    or (transaction_kind = 'capital' and source_account_id is null and destination_account_id is not null and equity_delta_paisas = amount_paisas)
    or (transaction_kind = 'drawings' and source_account_id is not null and destination_account_id is null and equity_delta_paisas = -amount_paisas)
  )
);

create index if not exists business_money_accounts_business_active_idx
  on public.business_money_accounts(business_id, is_active);
create index if not exists business_money_transactions_business_date_idx
  on public.business_money_transactions(business_id, transaction_date desc, created_at desc);

alter table public.business_money_accounts enable row level security;
alter table public.business_money_transactions enable row level security;
revoke all on public.business_money_accounts from public, anon, authenticated;
revoke all on public.business_money_transactions from public, anon, authenticated;
grant all on public.business_money_accounts, public.business_money_transactions to service_role;

create or replace function public.phase18_assert_active_profile(
  p_business_id uuid, p_actor_profile_id uuid
) returns public.profiles
language plpgsql security definer
set search_path = public
as $$
declare v_profile public.profiles%rowtype; v_actor uuid;
begin
  -- Browser calls must use their own authenticated profile.  Server-side
  -- calls use service_role and supply the already session-verified profile id.
  if auth.uid() is not null and auth.uid() <> p_actor_profile_id then
    raise exception 'Authenticated profile does not match the requested actor' using errcode = '42501';
  end if;
  v_actor := coalesce(auth.uid(), p_actor_profile_id);
  if v_actor is null then raise exception 'Authenticated active profile is required' using errcode = '42501'; end if;
  select pr.* into v_profile from public.profiles pr
   where pr.id = v_actor and pr.business_id = p_business_id and pr.status = 'Active';
  if not found then raise exception 'Active profile is not authorized for this business' using errcode = '42501'; end if;
  return v_profile;
end $$;

create or replace function public.phase18_ensure_money_accounts(p_business_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.business_money_accounts (business_id, account_key, name)
  values (p_business_id, 'cash', 'Cash'), (p_business_id, 'bank', 'Bank'), (p_business_id, 'wallet', 'Wallet')
  on conflict (business_id, account_key) do nothing;
end $$;

create or replace function public.phase18_can_contra(v_profile public.profiles)
returns boolean language sql stable security definer set search_path = public as $$
  select v_profile.role in ('Owner', 'Admin', 'Owner/Admin')
      or (v_profile.role = 'Accountant' and coalesce(v_profile.perms, '{}'::text[]) @> array['can_create_contra']);
$$;

create or replace function public.phase18_can_manage_owner_equity(v_profile public.profiles)
returns boolean language sql stable security definer set search_path = public as $$
  select v_profile.role in ('Owner', 'Admin', 'Owner/Admin')
      or (v_profile.role = 'Accountant' and coalesce(v_profile.perms, '{}'::text[]) @> array['can_manage_owner_equity']);
$$;

create or replace function public.list_business_money_accounts(
  p_business_id uuid, p_actor_profile_id uuid
) returns table(id uuid, account_key text, name text, balance_paisas numeric, is_active boolean)
language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles%rowtype;
begin
  v_profile := public.phase18_assert_active_profile(p_business_id, p_actor_profile_id);
  if not (v_profile.role in ('Owner', 'Admin', 'Owner/Admin', 'Accountant')
          or coalesce(v_profile.perms, '{}'::text[]) && array['can_view_account_balances', 'can_create_contra', 'can_manage_owner_equity']) then
    raise exception 'Profile is not permitted to view business money accounts' using errcode = '42501';
  end if;
  perform public.phase18_ensure_money_accounts(p_business_id);
  return query
    select a.id, a.account_key, a.name, a.balance_paisas, a.is_active
      from public.business_money_accounts a
     where a.business_id = p_business_id
     order by a.account_key;
end $$;

create or replace function public.list_business_money_activity(
  p_business_id uuid, p_actor_profile_id uuid
) returns table(id uuid, transaction_kind text, transaction_date date, amount_paisas numeric,
                reference text, note text, source_name text, destination_name text, equity_delta_paisas numeric)
language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles%rowtype;
begin
  v_profile := public.phase18_assert_active_profile(p_business_id, p_actor_profile_id);
  if not (v_profile.role in ('Owner', 'Admin', 'Owner/Admin', 'Accountant')
          or coalesce(v_profile.perms, '{}'::text[]) && array['can_view_account_balances', 'can_create_contra', 'can_manage_owner_equity']) then
    raise exception 'Profile is not permitted to view business money activity' using errcode = '42501';
  end if;
  return query select t.id, t.transaction_kind, t.transaction_date, t.amount_paisas, t.reference, t.note,
    s.name, d.name, t.equity_delta_paisas
  from public.business_money_transactions t
  left join public.business_money_accounts s on s.id = t.source_account_id
  left join public.business_money_accounts d on d.id = t.destination_account_id
  where t.business_id = p_business_id order by t.transaction_date desc, t.created_at desc limit 20;
end $$;

create or replace function public.post_contra_transfer(
  p_business_id uuid, p_source_account_id uuid, p_destination_account_id uuid,
  p_amount numeric, p_date date, p_note text, p_idempotency_key text, p_actor_profile_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles%rowtype; v_existing public.business_money_transactions%rowtype;
  v_source_balance numeric(20,0); v_count integer; v_transaction_id uuid; v_ref text; v_result jsonb; v_fingerprint text; v_locked record;
begin
  v_profile := public.phase18_assert_active_profile(p_business_id, p_actor_profile_id);
  if not public.phase18_can_contra(v_profile) then raise exception 'Profile is not permitted to post Contra' using errcode = '42501'; end if;
  if p_source_account_id is null or p_destination_account_id is null or p_source_account_id = p_destination_account_id then raise exception 'Source and destination accounts must differ'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> trunc(p_amount) then raise exception 'Amount must be a positive whole paisa value'; end if;
  if p_date is null or nullif(trim(coalesce(p_idempotency_key, '')), '') is null then raise exception 'Date and idempotency key are required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':' || p_idempotency_key, 0));
  v_fingerprint := encode(digest(concat_ws('|', 'contra', p_source_account_id::text, p_destination_account_id::text, p_amount::text, p_date::text, coalesce(p_note, '')), 'sha256'), 'hex');
  select * into v_existing from public.business_money_transactions where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then raise exception 'Idempotency key conflicts with a different Contra request' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent', true);
  end if;
  perform public.phase18_ensure_money_accounts(p_business_id);
  v_count := 0;
  for v_locked in select id from public.business_money_accounts where business_id = p_business_id and is_active and id in (p_source_account_id, p_destination_account_id) order by id for update loop v_count := v_count + 1; end loop;
  if v_count <> 2 then raise exception 'Both active business money accounts are required'; end if;
  select balance_paisas into v_source_balance from public.business_money_accounts where id = p_source_account_id and business_id = p_business_id;
  if v_source_balance < p_amount then raise exception 'Insufficient source account balance'; end if;
  update public.business_money_accounts set balance_paisas = balance_paisas - p_amount, updated_at = now() where id = p_source_account_id and business_id = p_business_id;
  update public.business_money_accounts set balance_paisas = balance_paisas + p_amount, updated_at = now() where id = p_destination_account_id and business_id = p_business_id;
  v_ref := 'CTR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  insert into public.business_money_transactions (business_id, transaction_kind, source_account_id, destination_account_id, amount_paisas, transaction_date, note, reference, idempotency_key, request_fingerprint, posted_by)
  values (p_business_id, 'contra', p_source_account_id, p_destination_account_id, p_amount, p_date, nullif(trim(coalesce(p_note, '')), ''), v_ref, p_idempotency_key, v_fingerprint, v_profile.id)
  returning id into v_transaction_id;
  v_result := jsonb_build_object('transaction_id', v_transaction_id, 'reference', v_ref, 'amount_paisas', p_amount, 'idempotent', false);
  update public.business_money_transactions set result = v_result where id = v_transaction_id;
  return v_result;
end $$;

create or replace function public.post_owner_capital(
  p_business_id uuid, p_destination_account_id uuid, p_amount numeric, p_date date,
  p_note text, p_idempotency_key text, p_actor_profile_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles%rowtype; v_existing public.business_money_transactions%rowtype;
  v_transaction_id uuid; v_ref text; v_result jsonb; v_fingerprint text;
begin
  v_profile := public.phase18_assert_active_profile(p_business_id, p_actor_profile_id);
  if not public.phase18_can_manage_owner_equity(v_profile) then raise exception 'Profile is not permitted to add owner capital' using errcode = '42501'; end if;
  if p_destination_account_id is null or p_amount is null or p_amount <= 0 or p_amount <> trunc(p_amount) then raise exception 'Destination account and positive whole paisa amount are required'; end if;
  if p_date is null or nullif(trim(coalesce(p_idempotency_key, '')), '') is null then raise exception 'Date and idempotency key are required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':' || p_idempotency_key, 0));
  v_fingerprint := encode(digest(concat_ws('|', 'capital', p_destination_account_id::text, p_amount::text, p_date::text, coalesce(p_note, '')), 'sha256'), 'hex');
  select * into v_existing from public.business_money_transactions where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then if v_existing.request_fingerprint <> v_fingerprint then raise exception 'Idempotency key conflicts with a different capital request' using errcode = '23505'; end if; return v_existing.result || jsonb_build_object('idempotent', true); end if;
  perform public.phase18_ensure_money_accounts(p_business_id);
  perform 1 from public.business_money_accounts where id = p_destination_account_id and business_id = p_business_id and is_active for update;
  if not found then raise exception 'Active destination business money account is required'; end if;
  update public.business_money_accounts set balance_paisas = balance_paisas + p_amount, updated_at = now() where id = p_destination_account_id and business_id = p_business_id;
  v_ref := 'CAP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  insert into public.business_money_transactions (business_id, transaction_kind, destination_account_id, amount_paisas, equity_delta_paisas, transaction_date, note, reference, idempotency_key, request_fingerprint, posted_by)
  values (p_business_id, 'capital', p_destination_account_id, p_amount, p_amount, p_date, nullif(trim(coalesce(p_note, '')), ''), v_ref, p_idempotency_key, v_fingerprint, v_profile.id) returning id into v_transaction_id;
  v_result := jsonb_build_object('transaction_id', v_transaction_id, 'reference', v_ref, 'amount_paisas', p_amount, 'idempotent', false);
  update public.business_money_transactions set result = v_result where id = v_transaction_id;
  return v_result;
end $$;

create or replace function public.post_owner_drawings(
  p_business_id uuid, p_source_account_id uuid, p_amount numeric, p_date date,
  p_note text, p_idempotency_key text, p_actor_profile_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles%rowtype; v_existing public.business_money_transactions%rowtype;
  v_source_balance numeric(20,0); v_transaction_id uuid; v_ref text; v_result jsonb; v_fingerprint text;
begin
  v_profile := public.phase18_assert_active_profile(p_business_id, p_actor_profile_id);
  if not public.phase18_can_manage_owner_equity(v_profile) then raise exception 'Profile is not permitted to post owner drawings' using errcode = '42501'; end if;
  if p_source_account_id is null or p_amount is null or p_amount <= 0 or p_amount <> trunc(p_amount) then raise exception 'Source account and positive whole paisa amount are required'; end if;
  if p_date is null or nullif(trim(coalesce(p_idempotency_key, '')), '') is null then raise exception 'Date and idempotency key are required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':' || p_idempotency_key, 0));
  v_fingerprint := encode(digest(concat_ws('|', 'drawings', p_source_account_id::text, p_amount::text, p_date::text, coalesce(p_note, '')), 'sha256'), 'hex');
  select * into v_existing from public.business_money_transactions where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then if v_existing.request_fingerprint <> v_fingerprint then raise exception 'Idempotency key conflicts with a different drawings request' using errcode = '23505'; end if; return v_existing.result || jsonb_build_object('idempotent', true); end if;
  perform public.phase18_ensure_money_accounts(p_business_id);
  select balance_paisas into v_source_balance from public.business_money_accounts where id = p_source_account_id and business_id = p_business_id and is_active for update;
  if not found then raise exception 'Active source business money account is required'; end if;
  if v_source_balance < p_amount then raise exception 'Insufficient source account balance'; end if;
  update public.business_money_accounts set balance_paisas = balance_paisas - p_amount, updated_at = now() where id = p_source_account_id and business_id = p_business_id;
  v_ref := 'DRW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  insert into public.business_money_transactions (business_id, transaction_kind, source_account_id, amount_paisas, equity_delta_paisas, transaction_date, note, reference, idempotency_key, request_fingerprint, posted_by)
  values (p_business_id, 'drawings', p_source_account_id, p_amount, -p_amount, p_date, nullif(trim(coalesce(p_note, '')), ''), v_ref, p_idempotency_key, v_fingerprint, v_profile.id) returning id into v_transaction_id;
  v_result := jsonb_build_object('transaction_id', v_transaction_id, 'reference', v_ref, 'amount_paisas', p_amount, 'idempotent', false);
  update public.business_money_transactions set result = v_result where id = v_transaction_id;
  return v_result;
end $$;

revoke all on function public.phase18_assert_active_profile(uuid, uuid) from public, anon, authenticated;
revoke all on function public.phase18_ensure_money_accounts(uuid) from public, anon, authenticated;
revoke all on function public.phase18_can_contra(public.profiles) from public, anon, authenticated;
revoke all on function public.phase18_can_manage_owner_equity(public.profiles) from public, anon, authenticated;
revoke all on function public.list_business_money_accounts(uuid, uuid) from public, anon;
revoke all on function public.list_business_money_activity(uuid, uuid) from public, anon;
revoke all on function public.post_contra_transfer(uuid, uuid, uuid, numeric, date, text, text, uuid) from public, anon;
revoke all on function public.post_owner_capital(uuid, uuid, numeric, date, text, text, uuid) from public, anon;
revoke all on function public.post_owner_drawings(uuid, uuid, numeric, date, text, text, uuid) from public, anon;
grant execute on function public.list_business_money_accounts(uuid, uuid), public.list_business_money_activity(uuid, uuid) to authenticated, service_role;
grant execute on function public.post_contra_transfer(uuid, uuid, uuid, numeric, date, text, text, uuid) to authenticated, service_role;
grant execute on function public.post_owner_capital(uuid, uuid, numeric, date, text, text, uuid) to authenticated, service_role;
grant execute on function public.post_owner_drawings(uuid, uuid, numeric, date, text, text, uuid) to authenticated, service_role;

commit;
