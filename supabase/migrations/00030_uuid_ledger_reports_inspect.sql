-- Expected: all functions exist, are SECURITY DEFINER, and are service-only.
select p.proname,
       p.prosecdef as security_definer,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute,
       not has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_denied
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'ledger_general_ledger', 'ledger_trial_balance',
    'ledger_profit_loss', 'ledger_balance_sheet',
    'ledger_account_balances', 'ledger_day_book'
  )
order by p.proname;

-- Expected: one row, ok=true. These totals are ledger invariants, independent
-- of report presentation and subcategory assignments.
select
  coalesce(sum(total_debit_paisas), 0)
  = coalesce(sum(total_credit_paisas), 0) as ok
from public.ledger_vouchers;

-- Controlled deterministic fixture checks:
-- * Trial Balance closing debit total equals closing credit total.
-- * Contra, Capital, and Drawings are absent from ledger_profit_loss.
-- * Balance Sheet Assets = Liabilities + Equity including Current Earnings.
-- * Moving an account subcategory changes only grouping labels, never totals.
