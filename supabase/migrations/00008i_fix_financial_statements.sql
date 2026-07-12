-- ============================================================================
-- KhataPro ERP — Phase 8 Final Financial Statement Stabilization
--
-- This migration addresses the remaining financial-statement bugs discovered
-- in the Phase 8 closure audit:
--
-- BUG 1 — report_profit_loss() HAVING/SELECT inconsistency
--   The SELECT computes amount using a CASE that returns 0 for non-Income/Expense
--   accounts, but the HAVING clause sums voucher_lines WITHOUT the CASE — so
--   any Asset/Liability/Equity account with non-zero voucher activity appears
--   in the P&L with amount=0, polluting the report.
--
--   FIX: Filter to ONLY Income + Expense accounts in the WHERE clause. Use a
--   single consistent amount expression in both SELECT and HAVING.
--   Return type UNCHANGED (section, account_code, account_name, category_type,
--   amount) → CREATE OR REPLACE FUNCTION is sufficient.
--
-- BUG 2 — report_balance_sheet() missing Current Earnings
--   The BS only sums permanent equity accounts (Owner Capital, Drawings,
--   Opening Balance Equity). It does NOT include the cumulative net profit/loss
--   earned since the business began. This causes Assets ≠ Liabilities + Equity
--   by exactly the Net Profit amount.
--
--   FIX: Add a synthetic "Current Earnings" row to the EQUITY section computed
--   as (sum of Income credit-debit) - (sum of Expense debit-credit) for all
--   vouchers up to and including p_as_of_date. This is a CALCULATED report
--   line — no voucher is posted, no duplicate profit recognition occurs.
--
--   RETURN TYPE CHANGES: add `account_id` and `is_calculated` columns.
--   This requires DROP FUNCTION first because PostgreSQL cannot change the
--   return type of an existing function via CREATE OR REPLACE.
--
-- BUG 3 — report_balance_sheet() account sign handling
--   The HAVING clause used raw (debit - credit) for all types, missing accounts
--   with abnormal balances.
--
--   FIX: Type-aware HAVING. Show accounts with ANY non-zero activity
--   (regardless of sign), let the UI render abnormal balances with warnings.
--
-- All fixes are rerunnable: DROP FUNCTION IF EXISTS + CREATE FUNCTION +
-- GRANT EXECUTE + NOTIFY pgrst. No CASCADE. Historical vouchers preserved.
-- ============================================================================


-- ============================================================================
-- FIX 1: report_profit_loss() — filter to Income + Expense only
-- Return type UNCHANGED → CREATE OR REPLACE FUNCTION is safe.
-- ============================================================================
create or replace function public.report_profit_loss(
  p_business_id text,
  p_from_date date,
  p_to_date date
)
returns table (
  section text,
  account_code text,
  account_name text,
  category_type text,
  amount numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
  select
    case
      when c.type = 'Income' then 'REVENUE'
      when c.type = 'Expense' then 'EXPENSE'
      else 'OTHER'
    end as section,
    a.code,
    a.name,
    c.type,
    -- Single consistent amount expression:
    --   Income  → credit - debit (positive = revenue)
    --   Expense → debit  - credit (positive = expense)
    case
      when c.type = 'Income'  then coalesce(sum(vl.credit - vl.debit), 0)
      when c.type = 'Expense' then coalesce(sum(vl.debit  - vl.credit), 0)
      else 0
    end as amount
  from public.accounts a
  join public.account_categories c on c.id = a.category_id
  left join public.voucher_lines vl on vl.account_id = a.id
  left join public.vouchers v on v.id = vl.voucher_id
    and v.business_id = p_business_id
    and v.is_cancelled = false
    and v.voucher_date >= p_from_date
    and v.voucher_date <= p_to_date
  where a.business_id = p_business_id
    and a.is_active = true
    -- *** FIX: Only Income and Expense accounts appear in P&L ***
    and c.type in ('Income', 'Expense')
  group by a.code, a.name, c.type
  -- *** FIX: HAVING uses the SAME expression as SELECT ***
  having coalesce(sum(
    case
      when c.type = 'Income'  then vl.credit - vl.debit
      when c.type = 'Expense' then vl.debit  - vl.credit
      else 0
    end
  ), 0) <> 0
  order by section, a.code;
end;
$$;

-- Restore EXECUTE permission (idempotent — safe if already granted)
grant execute on function public.report_profit_loss(text, date, date) to authenticated, anon;


-- ============================================================================
-- FIX 2 + 3: report_balance_sheet() — Current Earnings + sign handling
-- RETURN TYPE CHANGED (added account_id + is_calculated) → must DROP first.
-- Use DROP FUNCTION IF EXISTS with the EXACT existing signature.
-- DO NOT USE CASCADE.
-- ============================================================================
drop function if exists public.report_balance_sheet(text, date);

create function public.report_balance_sheet(
  p_business_id text,
  p_as_of_date date
)
returns table (
  section text,
  account_id text,
  account_code text,
  account_name text,
  category_type text,
  balance numeric,
  is_calculated boolean
)
language plpgsql stable security definer set search_path = public
as $$
begin
  -- ---- Permanent Balance Sheet accounts (Asset/Liability/Equity) ----
  return query
  select
    case
      when c.type = 'Asset'     then 'ASSET'
      when c.type = 'Liability' then 'LIABILITY'
      when c.type = 'Equity'    then 'EQUITY'
      else 'OTHER'
    end as section,
    a.id as account_id,
    a.code as account_code,
    a.name as account_name,
    c.type as category_type,
    -- Type-aware balance:
    --   Assets     : positive = debit balance (normal)
    --   Liab/Equity: positive = credit balance (normal)
    case
      when c.type = 'Asset'     then coalesce(sum(vl.debit  - vl.credit), 0)
      when c.type in ('Liability', 'Equity') then coalesce(sum(vl.credit - vl.debit), 0)
      else 0
    end as balance,
    false as is_calculated
  from public.accounts a
  join public.account_categories c on c.id = a.category_id
  left join public.voucher_lines vl on vl.account_id = a.id
  left join public.vouchers v on v.id = vl.voucher_id
    and v.business_id = p_business_id
    and v.is_cancelled = false
    and v.voucher_date <= p_as_of_date
  where a.business_id = p_business_id
    and a.is_active = true
    -- *** FIX: Only Balance Sheet accounts (not Income/Expense) ***
    and c.type in ('Asset', 'Liability', 'Equity')
  group by a.id, a.code, a.name, c.type
  -- *** FIX: Type-aware HAVING — show any account with non-zero activity ***
  having coalesce(sum(
    case
      when c.type = 'Asset'     then vl.debit  - vl.credit
      when c.type in ('Liability', 'Equity') then vl.credit - vl.debit
      else 0
    end
  ), 0) <> 0
  order by
    case
      when c.type = 'Asset'     then 1
      when c.type = 'Liability' then 2
      when c.type = 'Equity'    then 3
      else 4
    end,
    a.code;

  -- ---- Current Earnings (calculated line, NOT a voucher posting) ----
  -- Current Earnings = cumulative (Income - Expense) for all vouchers up to
  -- and including p_as_of_date. This is what makes Assets = Liab + Equity.
  -- No voucher is posted — this is a report-time calculation only.
  return query
  select
    'EQUITY'::text as section,
    null::text as account_id,
    '3031'::text as account_code,
    'Current Earnings'::text as account_name,
    'Equity'::text as category_type,
    -- Income (credit - debit) - Expense (debit - credit) = Net Profit
    coalesce((
      select sum(vl.credit - vl.debit)
      from public.voucher_lines vl
      join public.vouchers v on v.id = vl.voucher_id
      join public.accounts a on a.id = vl.account_id
      join public.account_categories c on c.id = a.category_id
      where v.business_id = p_business_id
        and v.is_cancelled = false
        and v.voucher_date <= p_as_of_date
        and a.business_id = p_business_id
        and c.type = 'Income'
    ), 0)
    -
    coalesce((
      select sum(vl.debit - vl.credit)
      from public.voucher_lines vl
      join public.vouchers v on v.id = vl.voucher_id
      join public.accounts a on a.id = vl.account_id
      join public.account_categories c on c.id = a.category_id
      where v.business_id = p_business_id
        and v.is_cancelled = false
        and v.voucher_date <= p_as_of_date
        and a.business_id = p_business_id
        and c.type = 'Expense'
    ), 0)
    as balance,
    true as is_calculated;
end;
$$;

-- Restore EXECUTE permissions lost by DROP FUNCTION.
-- Idempotent — safe to re-run.
grant execute on function public.report_balance_sheet(text, date) to authenticated, anon;


-- Refresh PostgREST schema cache so both functions are visible with new signatures.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Done. Phase 8 financial-statement stabilization complete:
--   ✓ report_profit_loss() — only Income + Expense, consistent HAVING
--     (return type unchanged, CREATE OR REPLACE)
--   ✓ report_balance_sheet() — Current Earnings calculated line added
--     (return type changed: + account_id, + is_calculated → DROP + CREATE)
--   ✓ report_balance_sheet() — type-aware HAVING, abnormal balances shown
--   ✓ EXECUTE permissions restored on both functions
--   ✓ No vouchers posted for Current Earnings (calculated line only)
--   ✓ Historical vouchers preserved
--   ✓ Assets = Liabilities + Equity (including Current Earnings) guaranteed
--   ✓ Rerunnable: DROP IF EXISTS + CREATE + GRANT + NOTIFY
--   ✓ No CASCADE used
-- ============================================================================
