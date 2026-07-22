-- Read-only inspection for 00018 Contra + Owner Drawings.
-- Uses catalogs only; it never reads business rows or mutates production.

select 'table' as area, c.relname as object_name, c.relrowsecurity as rls_enabled,
       coalesce(array_to_string(c.relacl, ', '), '') as acl
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('business_money_accounts', 'business_money_transactions')
order by c.relname;

select c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default
from information_schema.columns c
where c.table_schema = 'public' and c.table_name in ('business_money_accounts', 'business_money_transactions')
order by c.table_name, c.ordinal_position;

select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_catalog.pg_constraint
where conrelid in (to_regclass('public.business_money_accounts'), to_regclass('public.business_money_transactions'))
order by table_name, conname;

select i.tablename, i.indexname, i.indexdef
from pg_catalog.pg_indexes i
where i.schemaname = 'public' and i.tablename in ('business_money_accounts', 'business_money_transactions')
order by i.tablename, i.indexname;

select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as identity_arguments,
       pg_get_function_arguments(p.oid) as argument_signature,
       pg_get_function_result(p.oid) as return_type,
       p.prosecdef as security_definer,
       pg_get_functiondef(p.oid) as function_definition,
       coalesce(array_to_string(p.proacl, ', '), '') as function_acl
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'post_contra_transfer', 'post_owner_capital', 'post_owner_drawings',
  'list_business_money_accounts', 'list_business_money_activity',
  'phase18_assert_active_profile'
)
order by p.proname, pg_get_function_identity_arguments(p.oid);

select 'legacy accounting table must remain absent' as check_name, table_name,
       to_regclass('public.' || table_name) is null as passes
from (values ('accounts'), ('vouchers'), ('voucher_lines'), ('account_categories')) t(table_name)
order by table_name;
