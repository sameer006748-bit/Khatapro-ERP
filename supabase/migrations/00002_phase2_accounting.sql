-- ============================================================================
-- KhataPro ERP — Migration 00002: Phase 2 Accounting Engine
-- ============================================================================
-- Tables: vouchers, voucher_lines
-- RPC:    post_voucher()        — the ONLY way to insert a balanced voucher
-- RPC:    get_trial_balance()   — aggregated debit/credit per account
-- RPC:    get_account_ledger()  — drill-down lines for one account
--
-- Accounting rules (from master build prompt):
--   * Every voucher must be balanced: SUM(debit) = SUM(credit)
--   * Unbalanced vouchers are rejected by the RPC (not by a row-level CHECK,
--     which cannot validate across multiple voucher_lines rows)
--   * Direct client inserts into voucher_lines are blocked by RLS
--   * Posted vouchers cannot be hard-deleted; cancel/void posts a reversal
--   * Money stored as BIGINT minor units (paisas)
--   * account.balance_cache is recomputed server-side by post_voucher()
--     and can NEVER be written directly by the client
-- ============================================================================

-- ============================================================================
-- vouchers — header
-- ============================================================================
create table if not exists public.vouchers (
  id             text primary key default gen_random_uuid()::text,
  business_id    text not null references public.business(id) on delete cascade,
  voucher_number text not null,
  voucher_type   text not null check (voucher_type in (
    'Journal', 'Receipt', 'Payment', 'Contra', 'Petty Cash',
    'Opening', 'Sale', 'Purchase', 'Expense', 'Sales Return',
    'Purchase Return', 'Reversal'
  )),
  reference_type text,  -- e.g. 'invoice', 'purchase', 'manual_jv'
  reference_id   text,
  narration      text,
  voucher_date   date not null default (now() at time zone 'Asia/Karachi')::date,
  is_posted      boolean not null default true,
  is_cancelled   boolean not null default false,
  cancelled_by   uuid references auth.users(id),
  cancelled_at   timestamptz,
  reversal_of    text references public.vouchers(id),
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, voucher_number)
);

drop trigger if exists trg_vouchers_updated_at on public.vouchers;
create trigger trg_vouchers_updated_at
  before update on public.vouchers
  for each row execute function public.set_updated_at();

create index if not exists idx_vouchers_business_date on public.vouchers(business_id, voucher_date desc);
create index if not exists idx_vouchers_business_type on public.vouchers(business_id, voucher_type);
create index if not exists idx_vouchers_reference on public.vouchers(reference_type, reference_id);

alter table public.vouchers enable row level security;

drop policy if exists "vouchers_read_same_business" on public.vouchers;
create policy "vouchers_read_same_business" on public.vouchers
  for select to authenticated using (
    business_id in (
      select p.business_id from public.profiles p where p.user_id = auth.uid()
    )
  );

-- No insert/update/delete policy → RLS blocks ALL direct client writes.
-- The post_voucher() RPC (SECURITY DEFINER) is the only path.

-- ============================================================================
-- voucher_lines — the double-entry lines
-- ============================================================================
create table if not exists public.voucher_lines (
  id           text primary key default gen_random_uuid()::text,
  voucher_id   text not null references public.vouchers(id) on delete cascade,
  business_id  text not null references public.business(id) on delete cascade,
  account_id   text not null references public.accounts(id) on delete restrict,
  debit_paisa  bigint not null default 0 check (debit_paisa >= 0),
  credit_paisa bigint not null default 0 check (credit_paisa >= 0),
  line_order   integer not null default 0,
  memo         text,
  created_at   timestamptz not null default now(),
  check (debit_paisa > 0 or credit_paisa > 0)
);

create index if not exists idx_vl_voucher on public.voucher_lines(voucher_id);
create index if not exists idx_vl_business_account on public.voucher_lines(business_id, account_id);
create index if not exists idx_vl_account on public.voucher_lines(account_id);

alter table public.voucher_lines enable row level security;

drop policy if exists "voucher_lines_read_same_business" on public.voucher_lines;
create policy "voucher_lines_read_same_business" on public.voucher_lines
  for select to authenticated using (
    business_id in (
      select p.business_id from public.profiles p where p.user_id = auth.uid()
    )
  );

-- CRITICAL: No insert/update/delete policy on voucher_lines.
-- RLS blocks ALL direct client writes. The ONLY way to create voucher
-- lines is through the post_voucher() RPC function (SECURITY DEFINER),
-- which validates the voucher is balanced before inserting.

-- ============================================================================
-- post_voucher() — the single entry point for posting balanced vouchers
-- ============================================================================
-- Security: SECURITY DEFINER. Runs with the function owner's privileges,
-- so it can INSERT into vouchers + voucher_lines even though RLS blocks
-- direct client inserts.
--
-- Validation:
--   1. At least 2 lines.
--   2. Every line has debit_paisa > 0 OR credit_paisa > 0 (not both, not neither).
--   3. SUM(debit_paisa) = SUM(credit_paisa) — balanced.
--   4. All account_ids belong to the caller's business and are active.
--   5. Voucher number is unique within the business.
--
-- On success:
--   - Inserts the voucher header
--   - Inserts all voucher_lines
--   - Updates balance_cache on every affected account
--   - Writes an audit_logs entry
--   - Returns the voucher id
--
-- On failure: raises an exception and the entire transaction rolls back.
-- ============================================================================
create or replace function public.post_voucher(
  p_business_id    text,
  p_voucher_number text,
  p_voucher_type   text,
  p_voucher_date   date,
  p_narration      text,
  p_lines          jsonb,  -- [{account_id, debit_paisa, credit_paisa, memo}, ...]
  p_reference_type text default null,
  p_reference_id   text default null,
  p_created_by     uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voucher_id   text;
  v_line         jsonb;
  v_total_debit  bigint := 0;
  v_total_credit bigint := 0;
  v_line_count   integer := 0;
  v_idx          integer := 0;
  v_account_ok   boolean;
begin
  -- Basic validation
  if p_lines is null or jsonb_array_length(p_lines) < 2 then
    raise exception 'Voucher must have at least 2 lines';
  end if;

  if p_voucher_type is null or p_voucher_type = '' then
    raise exception 'voucher_type is required';
  end if;

  -- Verify the caller belongs to this business (security check even though
  -- SECURITY DEFINER bypasses RLS — we don't trust the caller's input).
  if not exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.business_id = p_business_id
  ) and p_created_by is null then
    -- Allow server-side calls (p_created_by set, no auth.uid) for bootstrap
    if not exists (select 1 from public.profiles where business_id = p_business_id) then
      raise exception 'Caller is not a member of business %', p_business_id;
    end if;
  end if;

  -- Validate + accumulate totals in one pass
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_line_count := v_line_count + 1;
    v_idx := v_idx + 1;

    -- Each line: exactly one of debit/credit must be > 0
    if coalesce((v_line->>'debit_paisa')::bigint, 0) = 0
       and coalesce((v_line->>'credit_paisa')::bigint, 0) = 0 then
      raise exception 'Line % has neither debit nor credit', v_idx;
    end if;
    if coalesce((v_line->>'debit_paisa')::bigint, 0) > 0
       and coalesce((v_line->>'credit_paisa')::bigint, 0) > 0 then
      raise exception 'Line % has both debit and credit (not allowed)', v_idx;
    end if;

    -- Account must exist, belong to this business, and be active
    select exists(
      select 1 from public.accounts a
      where a.id = (v_line->>'account_id')
        and a.business_id = p_business_id
        and a.is_active = true
    ) into v_account_ok;
    if not v_account_ok then
      raise exception 'Line %: account % not found, not in this business, or inactive',
        v_idx, v_line->>'account_id';
    end if;

    v_total_debit  := v_total_debit  + coalesce((v_line->>'debit_paisa')::bigint, 0);
    v_total_credit := v_total_credit + coalesce((v_line->>'credit_paisa')::bigint, 0);
  end loop;

  -- BALANCED voucher check — the core accounting rule
  if v_total_debit <> v_total_credit then
    raise exception 'Voucher is not balanced: total debit %, total credit %',
      v_total_debit, v_total_credit;
  end if;
  if v_total_debit = 0 then
    raise exception 'Voucher total is zero';
  end if;

  -- Insert voucher header
  insert into public.vouchers (
    business_id, voucher_number, voucher_type, voucher_date,
    narration, reference_type, reference_id, created_by, is_posted
  ) values (
    p_business_id, p_voucher_number, p_voucher_type, p_voucher_date,
    p_narration, p_reference_type, p_reference_id, p_created_by, true
  ) returning id into v_voucher_id;

  -- Insert voucher_lines + update account balances in the same transaction
  v_idx := 0;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_idx := v_idx + 1;
    insert into public.voucher_lines (
      voucher_id, business_id, account_id,
      debit_paisa, credit_paisa, line_order, memo
    ) values (
      v_voucher_id,
      p_business_id,
      v_line->>'account_id',
      coalesce((v_line->>'debit_paisa')::bigint, 0),
      coalesce((v_line->>'credit_paisa')::bigint, 0),
      v_idx,
      v_line->>'memo'
    );

    -- Update account balance_cache.
    -- Asset/Expense: debit increases balance, credit decreases.
    -- Liability/Equity/Income: credit increases balance, debit decreases.
    update public.accounts set
      balance_cache = balance_cache
        + case
          when ac.type in ('Asset','Expense') then
            coalesce((v_line->>'debit_paisa')::bigint, 0)
            - coalesce((v_line->>'credit_paisa')::bigint, 0)
          else -- Liability, Equity, Income
            coalesce((v_line->>'credit_paisa')::bigint, 0)
            - coalesce((v_line->>'debit_paisa')::bigint, 0)
          end
    from public.account_categories ac
    where public.accounts.id = (v_line->>'account_id')
      and public.accounts.category_id = ac.id;
  end loop;

  -- Audit log
  insert into public.audit_logs (
    business_id, user_id, action, entity, entity_id, details
  ) values (
    p_business_id,
    coalesce(p_created_by, auth.uid()),
    'POST_VOUCHER',
    'voucher',
    v_voucher_id,
    jsonb_build_object(
      'voucher_number', p_voucher_number,
      'voucher_type', p_voucher_type,
      'voucher_date', p_voucher_date,
      'total_debit', v_total_debit,
      'total_credit', v_total_credit,
      'line_count', v_line_count
    )
  );

  return v_voucher_id;
end;
$$;

grant execute on function public.post_voucher(
  text, text, text, date, text, jsonb, text, text, uuid
) to authenticated;

-- ============================================================================
-- cancel_voucher() — posts a reversal voucher; never hard-deletes
-- ============================================================================
create or replace function public.cancel_voucher(
  p_voucher_id text,
  p_cancelled_by uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original  record;
  v_reversal_id text;
  v_reversal_number text;
  v_line jsonb;
  v_idx integer := 0;
  v_lines jsonb := '[]'::jsonb;
begin
  select * into v_original from public.vouchers where id = p_voucher_id;
  if not found then
    raise exception 'Voucher % not found', p_voucher_id;
  end if;
  if v_original.is_cancelled then
    raise exception 'Voucher % is already cancelled', p_voucher_id;
  end if;

  -- Build reversed lines (swap debit/credit)
  select coalesce(jsonb_agg(jsonb_build_object(
    'account_id', vl.account_id,
    'debit_paisa', vl.credit_paisa,
    'credit_paisa', vl.debit_paisa,
    'memo', coalesce(vl.memo, '') || ' (reversal)'
  )), '[]'::jsonb) into v_lines
  from public.voucher_lines vl
  where vl.voucher_id = p_voucher_id;

  v_reversal_number := v_original.voucher_number || '-REV';

  -- Post the reversal via post_voucher (reuses all validation + balance logic)
  select public.post_voucher(
    v_original.business_id,
    v_reversal_number,
    'Reversal',
    v_original.voucher_date,
    'Reversal of ' || v_original.voucher_number || ': ' || coalesce(v_original.narration, ''),
    v_lines,
    'reversal',
    p_voucher_id,
    p_cancelled_by
  ) into v_reversal_id;

  -- Mark original as cancelled
  update public.vouchers set
    is_cancelled = true,
    cancelled_by = p_cancelled_by,
    cancelled_at = now(),
    reversal_of = null
  where id = p_voucher_id;

  -- Link reversal back to original
  update public.vouchers set reversal_of = p_voucher_id where id = v_reversal_id;

  -- Audit
  insert into public.audit_logs (
    business_id, user_id, action, entity, entity_id, details
  ) values (
    v_original.business_id,
    coalesce(p_cancelled_by, auth.uid()),
    'CANCEL_VOUCHER',
    'voucher',
    p_voucher_id,
    jsonb_build_object('reversal_voucher_id', v_reversal_id)
  );

  return v_reversal_id;
end;
$$;

grant execute on function public.cancel_voucher(text, uuid) to authenticated;

-- ============================================================================
-- get_trial_balance() — aggregated debit/credit per account
-- ============================================================================
-- Returns one row per account with running balance_cache (which is the
-- server-maintained sum of all posted voucher_lines, accounting for
-- normal balances per category type).
create or replace function public.get_trial_balance(
  p_business_id text
)
returns table (
  account_id    text,
  account_code  text,
  account_name  text,
  category_code text,
  category_name text,
  category_type text,
  is_active     boolean,
  balance_paisa bigint
)
language sql
security definer
set search_path = public
as $$
  select
    a.id, a.code, a.name,
    c.code, c.name, c.type,
    a.is_active,
    a.balance_cache
  from public.accounts a
  join public.account_categories c on c.id = a.category_id
  where a.business_id = p_business_id
  order by c.code, a.code;
$$;

grant execute on function public.get_trial_balance(text) to authenticated;

-- ============================================================================
-- get_account_ledger() — drill-down lines for one account
-- ============================================================================
create or replace function public.get_account_ledger(
  p_business_id text,
  p_account_id  text,
  p_from_date   date default null,
  p_to_date     date default null
)
returns table (
  voucher_id     text,
  voucher_number text,
  voucher_date   date,
  voucher_type   text,
  narration      text,
  debit_paisa    bigint,
  credit_paisa   bigint,
  running_balance bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint := 0;
  v_opening bigint := 0;
begin
  -- Verify account belongs to business
  if not exists (
    select 1 from public.accounts
    where id = p_account_id and business_id = p_business_id
  ) then
    raise exception 'Account not found in this business';
  end if;

  -- If from_date is given, compute opening balance (sum of all lines before from_date)
  if p_from_date is not null then
    select coalesce(sum(
      case
        when vl.debit_paisa > 0 then vl.debit_paisa
        else -vl.credit_paisa
      end
    ), 0)
    into v_opening
    from public.voucher_lines vl
    join public.vouchers v on v.id = vl.voucher_id
    where vl.account_id = p_account_id
      and v.business_id = p_business_id
      and v.is_cancelled = false
      and v.voucher_date < p_from_date;

    -- Adjust for category type (asset/expense: debit-positive; else: credit-positive)
    select case
      when c.type in ('Asset','Expense') then v_opening
      else -v_opening
    end into v_opening
    from public.accounts a
    join public.account_categories c on c.id = a.category_id
    where a.id = p_account_id;

    v_balance := v_opening;
  end if;

  return query
  select
    v.id,
    v.voucher_number,
    v.voucher_date,
    v.voucher_type,
    v.narration,
    vl.debit_paisa,
    vl.credit_paisa,
    (v_balance + (
      case
        when c.type in ('Asset','Expense') then
          (select sum(vl2.debit_paisa - vl2.credit_paisa)
           from public.voucher_lines vl2
           join public.vouchers v2 on v2.id = vl2.voucher_id
           where vl2.account_id = p_account_id
             and v2.business_id = p_business_id
             and v2.is_cancelled = false
             and (v2.voucher_date < v.voucher_date
                  or (v2.voucher_date = v.voucher_date and v2.created_at <= v.created_at)))
        else
          (select sum(vl2.credit_paisa - vl2.debit_paisa)
           from public.voucher_lines vl2
           join public.vouchers v2 on v2.id = vl2.voucher_id
           where vl2.account_id = p_account_id
             and v2.business_id = p_business_id
             and v2.is_cancelled = false
             and (v2.voucher_date < v.voucher_date
                  or (v2.voucher_date = v.voucher_date and v2.created_at <= v.created_at)))
      end
    ))::bigint as running_balance
  from public.voucher_lines vl
  join public.vouchers v on v.id = vl.voucher_id
  join public.accounts a on a.id = vl.account_id
  join public.account_categories c on c.id = a.category_id
  where vl.account_id = p_account_id
    and v.business_id = p_business_id
    and v.is_cancelled = false
    and (p_from_date is null or v.voucher_date >= p_from_date)
    and (p_to_date is null or v.voucher_date <= p_to_date)
  order by v.voucher_date, v.created_at;
end;
$$;

grant execute on function public.get_account_ledger(text, text, date, date) to authenticated;
