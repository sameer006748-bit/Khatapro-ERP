-- Expected: every row has ok = true. Stop if unresolved_account_ref is false;
-- those rows require a manual mapping decision, never a guessed conversion.
select 'uuid ledger account foreign key' as check_name,
       exists (
         select 1 from pg_constraint
         where conrelid = to_regclass('public.account_subcategory_assignments')
           and conname = 'account_subcategory_assignments_ledger_account_fkey'
       ) as ok
union all
select 'no unresolved text account references',
       not exists (
         select 1 from public.account_subcategory_assignments
         where account_id is null
       )
union all
select 'business isolation',
       not exists (
         select 1
         from public.account_subcategory_assignments a
         join public.ledger_accounts la on la.id = a.account_id
         where la.business_id <> a.business_id
       )
union all
select 'report class protected',
       not exists (
         select 1
         from public.account_subcategory_assignments a
         join public.ledger_accounts la
           on la.business_id = a.business_id and la.id = a.account_id
         where la.report_class <> public.account_parent_report_class(a.parent_code)
       )
union all
select 'archived categories retained',
       not exists (
         select 1
         from public.account_subcategory_assignments a
         left join public.account_subcategories s on s.id = a.subcategory_id
         where a.subcategory_id is not null and s.id is null
       )
union all
select 'manage RPC service only',
       has_function_privilege(
         'service_role',
         'public.manage_account_subcategory(uuid,uuid,text,text,uuid,text,uuid)',
         'EXECUTE'
       )
       and not has_function_privilege(
         'authenticated',
         'public.manage_account_subcategory(uuid,uuid,text,text,uuid,text,uuid)',
         'EXECUTE'
       );
