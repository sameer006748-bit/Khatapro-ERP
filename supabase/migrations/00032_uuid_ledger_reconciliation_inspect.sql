-- Catalog-only checks. The dry run itself is read-only and returns aggregate
-- counts/totals without customer names, phone numbers, addresses, or raw rows.
select 'dry run service only' as check_name,
       has_function_privilege(
         'service_role',
         'public.ledger_reconciliation(uuid,text)',
         'EXECUTE'
       )
       and not has_function_privilege(
         'authenticated',
         'public.ledger_reconciliation(uuid,text)',
         'EXECUTE'
       ) as ok
union all
select 'function is stable',
       exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'ledger_reconciliation'
           and p.provolatile = 's'
       );

-- Run only after choosing a controlled business UUID:
-- select public.ledger_reconciliation('<business uuid>', 'DRY_RUN_ONLY');
-- Expected: mutationPerformed=false and containsCustomerPii=false.
--
-- This must fail closed:
-- select public.ledger_reconciliation(
--   '<business uuid>', 'MANUAL_APPROVED_BACKFILL'
-- );
