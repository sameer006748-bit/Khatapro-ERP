-- Expected: every boolean is true. Stop on any false row.
select 'canonical tables exist' as check_name,
       bool_and(to_regclass('public.' || name) is not null) as ok
from (values
  ('ledger_account_categories'), ('ledger_accounts'),
  ('ledger_voucher_sequences'), ('ledger_vouchers'), ('ledger_voucher_lines')
) expected(name)
union all
select 'legacy tables not required',
       to_regclass('public.business') is null
       and to_regclass('public.accounts') is null
       and to_regclass('public.account_categories') is null
       and to_regclass('public.vouchers') is null
       and to_regclass('public.voucher_lines') is null
union all
select 'uuid business scope',
       bool_and(c.udt_name = 'uuid')
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in (
    'ledger_account_categories', 'ledger_accounts',
    'ledger_voucher_sequences', 'ledger_vouchers', 'ledger_voucher_lines'
  )
  and c.column_name = 'business_id'
union all
select 'rls enabled',
       bool_and(pc.relrowsecurity)
from pg_class pc
join pg_namespace pn on pn.oid = pc.relnamespace
where pn.nspname = 'public'
  and pc.relname like 'ledger\_%' escape '\'
union all
select 'authenticated has no table mutation',
       not has_table_privilege('authenticated', 'public.ledger_vouchers', 'INSERT,UPDATE,DELETE')
       and not has_table_privilege('authenticated', 'public.ledger_voucher_lines', 'INSERT,UPDATE,DELETE')
union all
select 'posted records immutable',
       exists (select 1 from pg_trigger where tgname = 'ledger_vouchers_immutable' and not tgisinternal)
       and exists (select 1 from pg_trigger where tgname = 'ledger_voucher_lines_immutable' and not tgisinternal);

-- Expected: composite business-scoped foreign keys are present.
select conrelid::regclass::text as table_name, conname,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in (
  to_regclass('public.ledger_accounts'),
  to_regclass('public.ledger_vouchers'),
  to_regclass('public.ledger_voucher_lines')
)
order by table_name, conname;
