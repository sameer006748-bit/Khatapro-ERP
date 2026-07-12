-- ============================================================================
-- KhataPro ERP — Phase 8 Fix: report_balance_sheet() date filter bug
--
-- BUG (proven live):
--   Migration 00008i moved the voucher date filter into the LEFT JOIN ON
--   clause for `vouchers v`. This does NOT filter voucher_lines — when the
--   date condition fails, v.* becomes NULL but the vl row is still in the
--   result set, so sum(vl.debit - vl.credit) still includes voucher_lines
--   from AFTER p_as_of_date.
--
--   Symptom: Assets at 2026-07-10 and 2026-07-12 were IDENTICAL despite 216
--   vouchers between those dates. Historical BS difference was 1,519,473
--   instead of 0.
--
-- FIX:
--   Move the voucher business_id / is_cancelled / voucher_date filters into
--   the WHERE clause with the standard `OR IS NULL` pattern (matching the
--   original 00008 migration style). This correctly excludes voucher_lines
--   whose voucher is cancelled, belongs to another business, or is dated
--   after p_as_of_date.
--
--   The Current Earnings subquery is NOT affected (it uses scalar subqueries
--   with explicit WHERE clauses, not LEFT JOINs) — no change needed there.
--
-- Return type UNCHANGED → could use CREATE OR REPLACE. But because we already
-- DROP+CREATE'd in 00008i, we use CREATE OR REPLACE here for simplicity.
-- No DROP needed. No CASCADE. Rerunnable.
-- ============================================================================

create or replace function public.report_balance_sheet(
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
  where a.business_id = p_business_id
    and a.is_active = true
    and c.type in ('Asset', 'Liability', 'Equity')
    -- *** FIX: Date/business/cancel filters in WHERE, not LEFT JOIN ON ***
    -- This correctly excludes voucher_lines from future/cancelled/foreign vouchers.
    -- The OR ... IS NULL pattern preserves accounts that have NO voucher_lines
    -- (so they appear with balance 0 and are filtered out by HAVING).
    and (v.business_id = p_business_id or v.business_id is null)
    and (v.is_cancelled = false or v.is_cancelled is null)
    and (v.voucher_date <= p_as_of_date or v.voucher_date is null)
  group by a.id, a.code, a.name, c.type
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
  -- Uses scalar subqueries with explicit WHERE — already correct, unchanged.
  return query
  select
    'EQUITY'::text as section,
    null::text as account_id,
    '3031'::text as account_code,
    'Current Earnings'::text as account_name,
    'Equity'::text as category_type,
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

-- Permissions (idempotent)
grant execute on function public.report_balance_sheet(text, date) to authenticated, anon;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Done. Historical BS now correctly filters voucher_lines by p_as_of_date.
--   ✓ Assets/Liabilities/Equity now reflect balances AS OF the selected date
--   ✓ Current Earnings subquery was already correct (unchanged)
--   ✓ Return type unchanged (7 columns)
--   ✓ CREATE OR REPLACE — no DROP, no CASCADE, rerunnable
--   ✓ Historical BS difference will now be 0
-- ============================================================================
