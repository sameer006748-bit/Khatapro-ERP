-- KhataPro ERP - legacy-compatible multi-row Contra batch + Owner Drawings.
--
-- Additive and scoped to the verified legacy production schema (business /
-- accounts / vouchers / contra_entries / legacy_transaction_identity_sequences).
-- It adds a batch header + one row per leg, one atomic multi-row RPC
-- (post_contra_batch), and the RLS/grants for the new tables. It does NOT
-- rewrite historic contra_entries and does not depend on 00033, 00034, or 00035.
--
-- Applied explicitly only after preflight; application code never runs migrations.

begin;

-- Preflight: fail before changing anything when the verified legacy contract is
-- not present.
do $$
begin
  if to_regclass('public.accounts') is null
     or to_regclass('public.contra_entries') is null
     or to_regclass('public.vouchers') is null
     or to_regclass('public.legacy_transaction_identity_sequences') is null then
    raise exception '00038 preflight failed: required legacy relations are missing';
  end if;
  if to_regprocedure('public.allocate_legacy_transaction_identity(text,text)') is null
     or to_regprocedure('public.post_voucher(text,text,date,text,jsonb,text,text,uuid)') is null
     or to_regprocedure('public.claim_legacy_transaction_request(text,text,text)') is null then
    raise exception '00038 preflight failed: required legacy helpers or migration 00036 are missing';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. contra_batches - one readable CON identity per batch.
-- ---------------------------------------------------------------------------
create table if not exists public.contra_batches (
  id text primary key default gen_random_uuid()::text,
  business_id text not null references public.business(id) on delete cascade,
  batch_no text not null,
  batch_date date not null,
  voucher_id text references public.vouchers(id) on delete set null,
  total numeric(20,0) not null,
  reference text,
  notes text,
  status text not null default 'posted',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contra_batches_business_batch_no_key unique (business_id, batch_no)
);
create index if not exists contra_batches_biz_date_idx
  on public.contra_batches(business_id, batch_date desc);

-- ---------------------------------------------------------------------------
-- 2. contra_batch_entries - one row per contra / drawings leg.
--    amount is whole paisa numeric(20,0). to_account_id is the destination for
--    a pure transfer and the Drawings / Owner Equity account for drawings.
-- ---------------------------------------------------------------------------
create table if not exists public.contra_batch_entries (
  id text primary key default gen_random_uuid()::text,
  business_id text not null references public.business(id) on delete cascade,
  contra_batch_id text not null references public.contra_batches(id) on delete cascade,
  line_no integer not null,
  entry_kind text not null check (entry_kind in ('contra','drawings')),
  from_account_id text not null references public.accounts(id) on delete restrict,
  to_account_id text references public.accounts(id) on delete restrict,
  amount numeric(20,0) not null check (amount > 0),
  reason text,
  created_at timestamptz not null default now(),
  constraint contra_batch_entries_batch_line_key unique (contra_batch_id, line_no),
  constraint contra_batch_entries_diff_accounts check (from_account_id <> to_account_id)
);
create index if not exists contra_batch_entries_batch_idx
  on public.contra_batch_entries(contra_batch_id);

-- ---------------------------------------------------------------------------
-- 3. RLS + grants - no anon/authenticated/public access.
-- ---------------------------------------------------------------------------
alter table public.contra_batches enable row level security;
alter table public.contra_batch_entries enable row level security;
revoke all on table public.contra_batches from public, anon, authenticated;
revoke all on table public.contra_batch_entries from public, anon, authenticated;
grant select, insert on table public.contra_batches to service_role;
grant select, insert on table public.contra_batch_entries to service_role;

-- ---------------------------------------------------------------------------
-- 4. post_contra_batch() - atomic multi-row Contra / Owner Drawings posting.
--    p_lines: [{kind, from_account_id, to_account_id?, amount_paisas, notes?}, ...]
--      kind = 'contra'    -> debit destination asset, credit source asset (no
--                            income/expense/equity effect).
--      kind = 'drawings'  -> debit Owner Drawings (3020), credit source asset.
--    One readable CON identity per batch; one balanced voucher for all rows.
-- ---------------------------------------------------------------------------
create or replace function public.post_contra_batch(
  p_business_id text,
  p_contra_date date,
  p_lines jsonb,
  p_reference text default null,
  p_notes text default null,
  p_created_by uuid default null,
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
  v_line jsonb;
  v_kind text;
  v_from text;
  v_to text;
  v_amount numeric(20,0);
  v_reason text;
  v_total numeric(20,0) := 0;
  v_lines jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_batch_id text;
  v_batch_no text;
  v_voucher_id text;
  v_drawings_account_id text;
begin
  if p_contra_date is null then
    raise exception 'Contra date is required';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one contra line is required';
  end if;

  -- Idempotency claim (rejects unknowable re-use; replays the original result).
  select claimed, replay into v_claimed, v_result
  from public.claim_legacy_transaction_request(p_business_id, 'contra_batch', p_idempotency_key);
  if not v_claimed then
    return v_result || jsonb_build_object('idempotent', true);
  end if;

  -- Resolve the Drawings (Owner Equity) account for the business.
  select id into v_drawings_account_id
  from public.accounts
  where business_id = p_business_id and code = '3020' and is_active = true;
  if not found then
    raise exception 'Owner Drawings account (3020) not found for this business';
  end if;

  -- Validate every line and build the one balanced voucher.
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_count := v_count + 1;
    v_kind := upper(coalesce(v_line->>'kind', ''));
    v_from := v_line->>'from_account_id';
    v_to := v_line->>'to_account_id';
    v_reason := v_line->>'notes';
    begin
      v_amount := (v_line->>'amount_paisas')::numeric(20,0);
    exception when others then
      raise exception 'Line % amount must be a positive whole number', v_count;
    end;
    if v_amount is null or v_amount <= 0 or v_amount <> trunc(v_amount) then
      raise exception 'Line % amount must be a positive whole number', v_count;
    end if;
    if nullif(btrim(v_from), '') is null then
      raise exception 'Line % source account is required', v_count;
    end if;
    -- Source must be an active business/money account of this business.
    if not exists (select 1 from public.accounts a
        where a.id = v_from and a.business_id = p_business_id
          and a.is_active = true and a.is_business_account = true) then
      raise exception 'Line % source account is invalid or not an active business account', v_count;
    end if;

    if v_kind = 'CONTRA' then
      if nullif(btrim(v_to), '') is null then
        raise exception 'Line % destination account is required for a transfer', v_count;
      end if;
      if v_from = v_to then
        raise exception 'Line % source and destination accounts must differ', v_count;
      end if;
      if not exists (select 1 from public.accounts a
          where a.id = v_to and a.business_id = p_business_id
            and a.is_active = true and a.is_business_account = true) then
        raise exception 'Line % destination account is invalid or not an active business account', v_count;
      end if;
      v_lines := v_lines || jsonb_build_object('account_id', v_to,
        'debit', v_amount::text, 'credit', '0', 'memo', 'Contra in (line ' || v_count || ')');
      v_lines := v_lines || jsonb_build_object('account_id', v_from,
        'debit', '0', 'credit', v_amount::text, 'memo', 'Contra out (line ' || v_count || ')');
    elsif v_kind = 'DRAWINGS' then
      -- Not an asset-to-asset transfer: debit Owner Drawings, credit source.
      v_to := v_drawings_account_id;
      if v_from = v_to then
        raise exception 'Line % source account cannot be the drawings account', v_count;
      end if;
      v_lines := v_lines || jsonb_build_object('account_id', v_to,
        'debit', v_amount::text, 'credit', '0', 'memo', 'Owner drawings (line ' || v_count || ')');
      v_lines := v_lines || jsonb_build_object('account_id', v_from,
        'debit', '0', 'credit', v_amount::text, 'memo', 'Owner drawings (line ' || v_count || ')');
    else
      raise exception 'Line % kind must be CONTRA or DRAWINGS', v_count;
    end if;
    v_total := v_total + v_amount;
  end loop;
  -- One readable CON identity for the whole batch.
  v_batch_id := gen_random_uuid()::text;
  v_batch_no := public.allocate_legacy_transaction_identity(p_business_id, 'CON');

  v_voucher_id := public.post_voucher(
    p_business_id, 'CT', p_contra_date,
    'Contra Batch ' || v_batch_no, v_lines, v_batch_id, 'contra_batch', p_created_by
  );

  insert into public.contra_batches (id, business_id, batch_no, batch_date,
    voucher_id, total, reference, notes, status, created_by)
  values (v_batch_id, p_business_id, v_batch_no, p_contra_date,
    v_voucher_id, v_total, p_reference, p_notes, 'posted', p_created_by);

  -- Persist the rows (deterministic line_no).
  v_count := 0;
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_count := v_count + 1;
    v_kind := upper(coalesce(v_line->>'kind', ''));
    v_from := v_line->>'from_account_id';
    v_to := v_line->>'to_account_id';
    v_amount := (v_line->>'amount_paisas')::numeric(20,0);
    v_reason := v_line->>'notes';
    if v_kind = 'DRAWINGS' then
      v_to := v_drawings_account_id;
    end if;
    insert into public.contra_batch_entries (business_id, contra_batch_id,
      line_no, entry_kind, from_account_id, to_account_id, amount, reason)
    values (p_business_id, v_batch_id, v_count, lower(v_kind),
      v_from, v_to, v_amount, v_reason);
  end loop;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'POST_CONTRA_BATCH', 'contra_batch', v_batch_id,
    jsonb_build_object('batch_no', v_batch_no, 'total', v_total,
      'voucher_id', v_voucher_id, 'lines', jsonb_array_length(p_lines)));

  v_result := jsonb_build_object('batch_id', v_batch_id, 'batch_no', v_batch_no,
    'voucher_id', v_voucher_id, 'total', v_total, 'idempotent', false);
  update public.legacy_transaction_identity_requests set result = v_result
  where business_id = p_business_id and operation = 'contra_batch'
    and idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;

revoke all on function public.post_contra_batch(
  text, date, jsonb, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.post_contra_batch(
  text, date, jsonb, text, text, uuid, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Legacy operational-money listing (reads the legacy accounts / contra
--    stores so the Contra screen works against the verified legacy schema).
-- ---------------------------------------------------------------------------
create or replace function public.list_business_money_accounts(
  p_business_id text,
  p_actor_profile_id uuid
)
returns table (
  id text, account_key text, name text, balance_paisas numeric, is_active boolean
)
language sql
security definer
set search_path = public
as $$
  select a.id,
    case a.code
      when '1010' then 'cash'
      when '1020' then 'petty'
      when '1030' then 'bank'
      when '1040' then 'wallet'
      when '1050' then 'wallet'
      else 'cash'
    end as account_key,
    a.name,
    coalesce(a.balance_cache, 0) as balance_paisas,
    a.is_active
  from public.accounts a
  where a.business_id = p_business_id and a.is_business_account = true
  order by a.code;
$$;

create or replace function public.list_business_money_activity(
  p_business_id text,
  p_actor_profile_id uuid
)
returns table (
  id text, transaction_kind text, transaction_date date, amount_paisas numeric,
  reference text, note text, source_name text, destination_name text,
  equity_delta_paisas numeric
)
language sql
security definer
set search_path = public
as $$
  select ce.id, 'contra' as transaction_kind, ce.contra_date as transaction_date,
    ce.amount as amount_paisas, ce.contra_no as reference, ce.notes as note,
    fa.name as source_name, ta.name as destination_name, 0::numeric as equity_delta_paisas
  from public.contra_entries ce
  join public.accounts fa on fa.id = ce.from_account_id
  join public.accounts ta on ta.id = ce.to_account_id
  where ce.business_id = p_business_id
  union all
  select cbe.id, cbe.entry_kind as transaction_kind, cb.batch_date as transaction_date,
    cbe.amount as amount_paisas, cb.batch_no as reference, cbe.reason as note,
    fa.name as source_name, ta.name as destination_name,
    case when cbe.entry_kind = 'drawings' then -cbe.amount else 0::numeric end as equity_delta_paisas
  from public.contra_batch_entries cbe
  join public.contra_batches cb on cb.id = cbe.contra_batch_id
  join public.accounts fa on fa.id = cbe.from_account_id
  join public.accounts ta on ta.id = cbe.to_account_id
  where cbe.business_id = p_business_id
  order by transaction_date desc, reference desc
  limit 100;
$$;

revoke all on function public.list_business_money_accounts(text, uuid) from public, anon, authenticated;
grant execute on function public.list_business_money_accounts(text, uuid) to service_role;
revoke all on function public.list_business_money_activity(text, uuid) from public, anon, authenticated;
grant execute on function public.list_business_money_activity(text, uuid) to service_role;

commit;


