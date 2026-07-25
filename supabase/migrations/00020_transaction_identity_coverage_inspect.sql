-- Expected: every row has ok = true. Stop if any row is false.
select 'identity_sequences table' object_name,
       to_regclass('public.identity_sequences') is not null ok
union all
select 'transaction_identity_audit table',
       to_regclass('public.transaction_identity_audit') is not null
union all
select 'allocator security definer',
       exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'allocate_readable_identity'
           and p.prosecdef
       )
union all
select 'allocator public denied',
       not has_function_privilege(
         'public', 'public.allocate_readable_identity(uuid,text)', 'EXECUTE'
       )
union all
select 'allocator anon denied',
       not has_function_privilege(
         'anon', 'public.allocate_readable_identity(uuid,text)', 'EXECUTE'
       )
union all
select 'allocator service role',
       has_function_privilege(
         'service_role', 'public.allocate_readable_identity(uuid,text)', 'EXECUTE'
       )
union all
select 'sale return trigger',
       not exists (select 1 where to_regclass('public.sale_return_documents') is null)
       and exists (
         select 1 from pg_trigger
         where tgname = 'phase20_sale_return_identity' and not tgisinternal
       )
union all
select 'stock readable identity',
       not exists (select 1 where to_regclass('public.stock_movements') is null)
       and exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'stock_movements'
           and column_name = 'readable_no'
       );

-- Manual concurrency check (run in two SQL sessions inside transactions):
-- select public.allocate_transaction_identity('<business uuid>', 'PURCHASE');
-- Expected: distinct PUR numbers. Roll one session back, retry, and verify the
-- rolled-back value can be reused and no transaction row exists.
