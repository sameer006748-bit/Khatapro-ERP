-- Phase 2 RPC definition discovery. Read-only catalog queries only.
-- Run after 00015_phase2_accounting_discovery.sql.

-- Result 1: exact definitions for deployed sale, voucher, payment, stock,
-- return, cancellation, refund, and commission functions. The materialized
-- source relation excludes aggregates and window functions before helpers run.
with ordinary_public_functions as materialized (
  select p.oid, n.nspname, p.proname, p.prosecdef, p.provolatile, p.proowner, l.lanname
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_language l on l.oid = p.prolang
  where n.nspname = 'public' and p.prokind = 'f'
), relevant_functions as materialized (
  select f.*
  from ordinary_public_functions f
  where f.proname ~* '(post_sale|sale|invoice|voucher|journal|payment|receipt|customer|balance|stock|return|cancel|refund|commission)'
     or pg_catalog.pg_get_functiondef(f.oid) ~* '(voucher|journal|ledger|account|payment|receipt|return|invoice|commission)'
)
select f.nspname as schema_name, f.proname as function_name,
       pg_catalog.pg_get_function_identity_arguments(f.oid) as identity_arguments,
       pg_catalog.pg_get_function_result(f.oid) as return_type,
       f.lanname as language, f.prosecdef as security_definer, f.provolatile as volatility,
       pg_catalog.pg_get_functiondef(f.oid) as function_definition
from relevant_functions f
order by f.proname, pg_catalog.pg_get_function_identity_arguments(f.oid);

-- Result 2: exact execute grants for every definition returned above.
with ordinary_public_functions as materialized (
  select p.oid, n.nspname, p.proname, p.proowner, p.proacl
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
), relevant_functions as materialized (
  select f.*
  from ordinary_public_functions f
  where f.proname ~* '(post_sale|sale|invoice|voucher|journal|payment|receipt|customer|balance|stock|return|cancel|refund|commission)'
     or pg_catalog.pg_get_functiondef(f.oid) ~* '(voucher|journal|ledger|account|payment|receipt|return|invoice|commission)'
)
select f.nspname as schema_name, f.proname as function_name,
       pg_catalog.pg_get_function_identity_arguments(f.oid) as identity_arguments,
       coalesce(grantee.rolname, 'PUBLIC') as grantee,
       acl.privilege_type
from relevant_functions f
left join lateral aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) acl on true
left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
order by f.proname, identity_arguments, grantee, acl.privilege_type;
