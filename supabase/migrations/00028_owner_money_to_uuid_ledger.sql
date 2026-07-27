-- Replace the unapplied/legacy-only 00018 posting behavior through a new
-- additive migration. Operational rows and canonical vouchers commit together.
begin;

do $$
begin
  if to_regclass('public.business_money_accounts') is null
     or to_regclass('public.business_money_transactions') is null
     or to_regclass('public.ledger_accounts') is null
     or to_regprocedure(
       'public.post_ledger_voucher(uuid,text,date,text,jsonb,text,text,text,uuid,text,text,uuid)'
     ) is null then
    raise exception 'Owner-money ledger integration requires migrations 00018 and 00025-00027';
  end if;
end $$;

alter table public.business_money_accounts
  add column if not exists ledger_account_id uuid;
alter table public.business_money_transactions
  add column if not exists ledger_voucher_id uuid;

update public.business_money_accounts bma
set ledger_account_id = la.id
from public.ledger_accounts la
where la.business_id = bma.business_id
  and la.operational_money_key = bma.account_key
  and bma.ledger_account_id is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.business_money_accounts')
      and conname = 'business_money_accounts_ledger_account_fkey'
  ) then
    alter table public.business_money_accounts
      add constraint business_money_accounts_ledger_account_fkey
      foreign key (business_id, ledger_account_id)
      references public.ledger_accounts(business_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.business_money_transactions')
      and conname = 'business_money_transactions_ledger_voucher_fkey'
  ) then
    alter table public.business_money_transactions
      add constraint business_money_transactions_ledger_voucher_fkey
      foreign key (business_id, ledger_voucher_id)
      references public.ledger_vouchers(business_id, id) on delete restrict;
  end if;
end $$;

create unique index if not exists business_money_accounts_ledger_account_key
  on public.business_money_accounts(business_id, ledger_account_id)
  where ledger_account_id is not null;
create unique index if not exists business_money_transactions_ledger_voucher_key
  on public.business_money_transactions(business_id, ledger_voucher_id)
  where ledger_voucher_id is not null;

create or replace function public.ledger_account_id_by_code(
  p_business_id uuid, p_account_code text
) returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  select id into v_id
  from public.ledger_accounts
  where business_id = p_business_id
    and account_code = p_account_code
    and is_active and is_postable;
  if v_id is null then
    raise exception 'Required active ledger account % is missing', p_account_code;
  end if;
  return v_id;
end $$;

create or replace function public.ledger_account_balance_paisas(
  p_business_id uuid, p_account_id uuid, p_as_of_date date default null
) returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(l.debit_paisas - l.credit_paisas), 0)
  from public.ledger_voucher_lines l
  join public.ledger_vouchers v
    on v.business_id = l.business_id and v.id = l.voucher_id
  where l.business_id = p_business_id
    and l.account_id = p_account_id
    and (p_as_of_date is null or v.transaction_date <= p_as_of_date)
$$;

create or replace function public.phase18_ensure_money_accounts(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_ledger_system_chart(p_business_id);
  insert into public.business_money_accounts (
    business_id, account_key, name, ledger_account_id
  )
  select p_business_id, x.account_key, x.account_name, la.id
  from (values
    ('cash', 'Cash'), ('bank', 'Bank'), ('wallet', 'Wallet')
  ) x(account_key, account_name)
  join public.ledger_accounts la
    on la.business_id = p_business_id
   and la.operational_money_key = x.account_key
  on conflict (business_id, account_key) do update
    set ledger_account_id = excluded.ledger_account_id,
        updated_at = now();
end $$;

create or replace function public.list_business_money_accounts(
  p_business_id uuid, p_actor_profile_id uuid
) returns table(
  id uuid, account_key text, name text, balance_paisas numeric, is_active boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_profile public.profiles%rowtype;
begin
  v_profile := public.phase18_assert_active_profile(p_business_id, p_actor_profile_id);
  if not (
    v_profile.role in ('Owner', 'Admin', 'Owner/Admin', 'Accountant')
    or coalesce(v_profile.perms, '{}'::text[]) &&
       array['can_view_account_balances', 'can_create_contra', 'can_manage_owner_equity']
  ) then
    raise exception 'Profile is not permitted to view business money accounts'
      using errcode = '42501';
  end if;
  perform public.phase18_ensure_money_accounts(p_business_id);
  return query
  select
    a.id, a.account_key, a.name,
    public.ledger_account_balance_paisas(
      p_business_id, a.ledger_account_id, null
    ) as balance_paisas,
    a.is_active
  from public.business_money_accounts a
  where a.business_id = p_business_id
  order by a.account_key;
end $$;

create or replace function public.post_business_money_to_ledger(
  p_business_id uuid,
  p_transaction_kind text,
  p_source_account_id uuid,
  p_destination_account_id uuid,
  p_amount numeric,
  p_date date,
  p_note text,
  p_idempotency_key text,
  p_actor_profile_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_existing public.business_money_transactions%rowtype;
  v_source public.business_money_accounts%rowtype;
  v_destination public.business_money_accounts%rowtype;
  v_source_balance numeric(20,0);
  v_transaction_id uuid := gen_random_uuid();
  v_reference text;
  v_fingerprint text;
  v_lines jsonb;
  v_voucher jsonb;
  v_voucher_id uuid;
  v_result jsonb;
  v_kind text := lower(trim(coalesce(p_transaction_kind, '')));
begin
  v_profile := public.phase18_assert_active_profile(p_business_id, p_actor_profile_id);
  if v_kind = 'contra' then
    if not public.phase18_can_contra(v_profile) then
      raise exception 'Profile is not permitted to post Contra' using errcode = '42501';
    end if;
  elsif v_kind in ('capital', 'drawings') then
    if not public.phase18_can_manage_owner_equity(v_profile) then
      raise exception 'Profile is not permitted to manage owner equity' using errcode = '42501';
    end if;
  else
    raise exception 'Unsupported business money transaction';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> trunc(p_amount)
     or p_date is null
     or nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Positive whole-paisa amount, date, and idempotency key are required';
  end if;
  if v_kind = 'contra' and (
    p_source_account_id is null
    or p_destination_account_id is null
    or p_source_account_id = p_destination_account_id
  ) then
    raise exception 'Contra source and destination accounts must differ';
  elsif v_kind = 'capital' and (
    p_source_account_id is not null or p_destination_account_id is null
  ) then
    raise exception 'Capital requires one destination money account';
  elsif v_kind = 'drawings' and (
    p_source_account_id is null or p_destination_account_id is not null
  ) then
    raise exception 'Drawings requires one source money account';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_business_id::text || ':' || trim(p_idempotency_key), 0)
  );
  v_fingerprint := encode(digest(concat_ws('|',
    v_kind, p_source_account_id::text, p_destination_account_id::text,
    p_amount::text, p_date::text, coalesce(trim(p_note), '')
  ), 'sha256'), 'hex');
  select * into v_existing
  from public.business_money_transactions
  where business_id = p_business_id and idempotency_key = trim(p_idempotency_key);
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'Idempotency key conflicts with a different owner-money request'
        using errcode = '23505';
    end if;
    if v_existing.ledger_voucher_id is null then
      raise exception 'Historical owner-money row requires manual ledger reconciliation';
    end if;
    return v_existing.result || jsonb_build_object('idempotent', true);
  end if;

  perform public.phase18_ensure_money_accounts(p_business_id);
  if p_source_account_id is not null then
    select * into v_source
    from public.business_money_accounts
    where business_id = p_business_id
      and (id = p_source_account_id or ledger_account_id = p_source_account_id)
      and is_active and ledger_account_id is not null
    for update;
    if not found then
      raise exception 'Active same-business source money account is required';
    end if;
    v_source_balance := public.ledger_account_balance_paisas(
      p_business_id, v_source.ledger_account_id, null
    );
    if v_source_balance < p_amount then
      raise exception 'Insufficient source account balance';
    end if;
  end if;
  if p_destination_account_id is not null then
    select * into v_destination
    from public.business_money_accounts
    where business_id = p_business_id
      and (id = p_destination_account_id or ledger_account_id = p_destination_account_id)
      and is_active and ledger_account_id is not null
    for update;
    if not found then
      raise exception 'Active same-business destination money account is required';
    end if;
  end if;

  if v_kind = 'contra' then
    v_reference := public.allocate_transaction_identity(p_business_id, 'CONTRA_BATCH');
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id', v_destination.ledger_account_id,
        'debit_paisas', p_amount, 'credit_paisas', 0,
        'line_narration', 'Transfer into ' || v_destination.name
      ),
      jsonb_build_object(
        'account_id', v_source.ledger_account_id,
        'debit_paisas', 0, 'credit_paisas', p_amount,
        'line_narration', 'Transfer from ' || v_source.name
      )
    );
  elsif v_kind = 'capital' then
    v_reference := public.allocate_transaction_identity(p_business_id, 'CAPITAL_INTRODUCED');
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id', v_destination.ledger_account_id,
        'debit_paisas', p_amount, 'credit_paisas', 0,
        'line_narration', 'Owner capital received'
      ),
      jsonb_build_object(
        'account_id', public.ledger_account_id_by_code(p_business_id, '3010'),
        'debit_paisas', 0, 'credit_paisas', p_amount,
        'line_narration', 'Owner capital'
      )
    );
  else
    v_reference := public.allocate_transaction_identity(p_business_id, 'OWNER_DRAWING');
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id', public.ledger_account_id_by_code(p_business_id, '3020'),
        'debit_paisas', p_amount, 'credit_paisas', 0,
        'line_narration', 'Owner drawing'
      ),
      jsonb_build_object(
        'account_id', v_source.ledger_account_id,
        'debit_paisas', 0, 'credit_paisas', p_amount,
        'line_narration', 'Funds withdrawn from ' || v_source.name
      )
    );
  end if;

  v_voucher := public.post_ledger_voucher(
    p_business_id,
    case v_kind when 'contra' then 'CT' when 'capital' then 'CAPITAL' else 'DRAWING' end,
    p_date, coalesce(nullif(trim(p_note), ''), initcap(v_kind)),
    v_lines, 'business_money_transaction', v_transaction_id::text,
    'business-money:' || trim(p_idempotency_key), v_profile.id,
    v_reference, v_reference, null
  );
  v_voucher_id := (v_voucher->>'voucher_id')::uuid;
  v_result := jsonb_build_object(
    'transaction_id', v_transaction_id,
    'voucher_id', v_voucher_id,
    'reference', v_reference,
    'amount_paisas', p_amount,
    'idempotent', false
  );

  insert into public.business_money_transactions (
    id, business_id, transaction_kind, source_account_id,
    destination_account_id, amount_paisas, equity_delta_paisas,
    transaction_date, note, reference, idempotency_key,
    request_fingerprint, posted_by, ledger_voucher_id, result
  ) values (
    v_transaction_id, p_business_id, v_kind, v_source.id,
    v_destination.id, p_amount,
    case v_kind when 'capital' then p_amount when 'drawings' then -p_amount else 0 end,
    p_date, nullif(trim(coalesce(p_note, '')), ''), v_reference,
    trim(p_idempotency_key), v_fingerprint, v_profile.id, v_voucher_id, v_result
  );

  if p_source_account_id is not null then
    update public.business_money_accounts
    set balance_paisas = public.ledger_account_balance_paisas(
          p_business_id, v_source.ledger_account_id, null
        ),
        updated_at = now()
    where id = v_source.id and business_id = p_business_id;
  end if;
  if p_destination_account_id is not null then
    update public.business_money_accounts
    set balance_paisas = public.ledger_account_balance_paisas(
          p_business_id, v_destination.ledger_account_id, null
        ),
        updated_at = now()
    where id = v_destination.id and business_id = p_business_id;
  end if;
  return v_result;
end $$;

create or replace function public.post_contra_transfer(
  p_business_id uuid, p_source_account_id uuid, p_destination_account_id uuid,
  p_amount numeric, p_date date, p_note text, p_idempotency_key text,
  p_actor_profile_id uuid
) returns jsonb
language sql security definer set search_path = public, pg_temp
as $$
  select public.post_business_money_to_ledger(
    p_business_id, 'contra', p_source_account_id, p_destination_account_id,
    p_amount, p_date, p_note, p_idempotency_key, p_actor_profile_id
  )
$$;

create or replace function public.post_owner_capital(
  p_business_id uuid, p_destination_account_id uuid, p_amount numeric,
  p_date date, p_note text, p_idempotency_key text, p_actor_profile_id uuid
) returns jsonb
language sql security definer set search_path = public, pg_temp
as $$
  select public.post_business_money_to_ledger(
    p_business_id, 'capital', null, p_destination_account_id,
    p_amount, p_date, p_note, p_idempotency_key, p_actor_profile_id
  )
$$;

create or replace function public.post_owner_drawings(
  p_business_id uuid, p_source_account_id uuid, p_amount numeric,
  p_date date, p_note text, p_idempotency_key text, p_actor_profile_id uuid
) returns jsonb
language sql security definer set search_path = public, pg_temp
as $$
  select public.post_business_money_to_ledger(
    p_business_id, 'drawings', p_source_account_id, null,
    p_amount, p_date, p_note, p_idempotency_key, p_actor_profile_id
  )
$$;

revoke all on function public.ledger_account_id_by_code(uuid, text)
  from public, anon, authenticated;
revoke all on function public.ledger_account_balance_paisas(uuid, uuid, date)
  from public, anon, authenticated;
revoke all on function public.post_business_money_to_ledger(
  uuid, text, uuid, uuid, numeric, date, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.post_contra_transfer(
  uuid, uuid, uuid, numeric, date, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.post_owner_capital(
  uuid, uuid, numeric, date, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.post_owner_drawings(
  uuid, uuid, numeric, date, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.ledger_account_id_by_code(uuid, text) to service_role;
grant execute on function public.ledger_account_balance_paisas(uuid, uuid, date) to service_role;
grant execute on function public.post_contra_transfer(
  uuid, uuid, uuid, numeric, date, text, text, uuid
) to service_role;
grant execute on function public.post_owner_capital(
  uuid, uuid, numeric, date, text, text, uuid
) to service_role;
grant execute on function public.post_owner_drawings(
  uuid, uuid, numeric, date, text, text, uuid
) to service_role;

commit;
notify pgrst, 'reload schema';
