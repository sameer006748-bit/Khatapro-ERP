-- Phase 2 RPC definition discovery. Read-only catalog queries only.
-- Run after 00015_phase2_accounting_discovery.sql.

-- Result 1: exact definitions for deployed sale, voucher, payment, stock,
-- return, cancellation, refund, and commission routines.
select n.nspname as schema_name, p.proname as function_name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
       pg_catalog.pg_get_function_result(p.oid) as return_type,
       p.prosecdef as security_definer,
       p.provolatile as volatility,
       pg_catalog.pg_get_functiondef(p.oid) as function_definition
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname ~* '(post_sale|sale|invoice|voucher|journal|payment|receipt|customer|balance|stock|return|cancel|refund|commission)'
       or pg_catalog.pg_get_functiondef(p.oid) ~* '(voucher|journal|ledger|account|payment|receipt|return|invoice|commission)')
order by p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);

-- Result 2: exact execute grants for every definition returned above.
select n.nspname as schema_name, p.proname as function_name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
       coalesce(grantee.rolname, 'PUBLIC') as grantee,
       acl.privilege_type
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
left join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl on true
left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
where n.nspname = 'public'
  and (p.proname ~* '(post_sale|sale|invoice|voucher|journal|payment|receipt|customer|balance|stock|return|cancel|refund|commission)'
       or pg_catalog.pg_get_functiondef(p.oid) ~* '(voucher|journal|ledger|account|payment|receipt|return|invoice|commission)')
order by p.proname, identity_arguments, grantee, acl.privilege_type;
