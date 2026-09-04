-- Expected: every row has ok = true. Stop if any row is false.
select 'account_subcategories' object_name,
       to_regclass('public.account_subcategories') is not null ok
union all select 'account_subcategory_assignments',
       to_regclass('public.account_subcategory_assignments') is not null
union all select 'account_classification_audit',
       to_regclass('public.account_classification_audit') is not null
union all select 'one-level parent constraint',
       exists (
         select 1 from pg_constraint
         where conname = 'account_subcategories_name_key'
           and conrelid = to_regclass('public.account_subcategories')
       )
union all select 'list RPC service only',
       has_function_privilege('service_role', 'public.list_account_subcategories(uuid,uuid)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.list_account_subcategories(uuid,uuid)', 'EXECUTE')
union all select 'manage RPC service only',
       has_function_privilege('service_role', 'public.manage_account_subcategory(uuid,uuid,text,text,uuid,text,text)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.manage_account_subcategory(uuid,uuid,text,text,uuid,text,text)', 'EXECUTE');

-- Classification reconciliation (expected: zero rows):
select a.business_id, a.account_ref
from public.account_subcategory_assignments a
left join public.account_subcategories s on s.id = a.subcategory_id
where a.subcategory_id is not null
  and (s.id is null or s.business_id <> a.business_id or s.parent_code <> a.parent_code);
