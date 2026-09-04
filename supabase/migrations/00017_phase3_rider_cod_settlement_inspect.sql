-- Read-only Phase 3 deployment inspection.  This file performs no DDL/DML.
-- Canonical signatures and SECURITY DEFINER/search-path posture.
select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in
  ('complete_cod_delivery', 'settle_rider_cod', 'get_rider_cod_balances',
   'mark_cod_out_for_delivery', 'return_rider_delivery')
order by p.proname, arguments;

-- Text invoice identity and UUID business/rider identity are required.
select c.relname as table_name, a.attname as column_name,
       format_type(a.atttypid, a.atttypmod) as data_type
from pg_class c join pg_attribute a on a.attrelid = c.oid
where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped
  and ((c.relname = 'invoices' and a.attname in ('id', 'business_id', 'rider_id'))
    or (c.relname = 'riders' and a.attname in ('id', 'business_id', 'profile_id'))
    or (c.relname = 'rider_cash_ledger' and a.attname in ('business_id', 'rider_id', 'invoice_id', 'idempotency_key', 'settlement_batch_id')))
order by c.relname, a.attname;

-- Idempotency and settlement-batch support indexes/constraints.
select c.relname as table_name, i.relname as index_name, pg_get_indexdef(i.oid) as index_definition
from pg_index x join pg_class c on c.oid = x.indrelid join pg_class i on i.oid = x.indexrelid
where c.relnamespace = 'public'::regnamespace
  and (i.relname ilike '%idempotency%' or i.relname ilike '%settlement_batch%')
order by c.relname, i.relname;

-- PUBLIC/anon must have no execute privilege; authenticated/service_role only.
select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       has_function_privilege('public', p.oid, 'execute') as public_execute,
       has_function_privilege('anon', p.oid, 'execute') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'execute') as service_role_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('complete_cod_delivery', 'settle_rider_cod', 'get_rider_cod_balances')
order by p.proname;

-- No stale unsafe delivery/COD settlement overload may remain.
select p.proname, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in
  ('mark_order_delivered', 'mark_order_returned', 'create_cod_submission', 'confirm_cod_submission')
order by p.proname, arguments;

-- Guard against the production tables that intentionally do not exist here.
select relname as forbidden_table_present
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('accounts', 'roles', 'permissions', 'role_permissions', 'salesmen', 'vouchers');
