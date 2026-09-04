-- Phase 2 accounting and permission discovery. Read-only metadata queries only.
-- Run this file first in Supabase project ebcebxwpddltiwrqybqc.

-- Result 1: relevant public-table columns and their likely accounting domain.
with relevant_tables as (
  select t.table_name
  from information_schema.tables t
  where t.table_schema = 'public'
    and t.table_type = 'BASE TABLE'
    and (
      t.table_name ~* '(voucher|journal|ledger|account|chart|debit|credit|customer|receivable|payable|payment|receipt|cash|bank|expense|revenue|inventory|stock|return|refund|credit.?note|invoice|profile|role|permission|seller|salesman)'
      or exists (
        select 1 from information_schema.columns c
        where c.table_schema = t.table_schema and c.table_name = t.table_name
          and c.column_name ~* '(voucher|journal|ledger|account|chart|debit|credit|balance|receivable|payable|payment|receipt|cash|bank|expense|revenue|inventory|stock|return|refund|credit|invoice|business|owner|role|permission|seller|salesman|created_by)'
      )
    )
)
select c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default,
  case
    when (c.table_name || ' ' || c.column_name) ~* '(voucher|journal|ledger|debit|credit)' then 'voucher/journal/ledger'
    when (c.table_name || ' ' || c.column_name) ~* '(account|chart|receivable|payable|cash|bank)' then 'account/balance'
    when (c.table_name || ' ' || c.column_name) ~* '(payment|receipt)' then 'payment/receipt'
    when (c.table_name || ' ' || c.column_name) ~* '(inventory|stock)' then 'inventory/stock'
    when (c.table_name || ' ' || c.column_name) ~* '(return|refund|credit)' then 'return/refund/credit'
    when (c.table_name || ' ' || c.column_name) ~* '(invoice|salesman|seller)' then 'invoice/seller'
    when (c.table_name || ' ' || c.column_name) ~* '(profile|role|permission|owner|business)' then 'access/attribution'
    else 'related accounting metadata'
  end as likely_domain
from information_schema.columns c
join relevant_tables r on r.table_name = c.table_name
where c.table_schema = 'public'
order by c.table_name, c.ordinal_position;

-- Result 2: primary and unique constraints, including ordered key columns.
with relevant_tables as (
  select distinct c.table_name
  from information_schema.columns c
  where c.table_schema = 'public'
    and (c.table_name || ' ' || c.column_name) ~* '(voucher|journal|ledger|account|chart|debit|credit|customer|receivable|payable|payment|receipt|cash|bank|expense|revenue|inventory|stock|return|refund|credit|invoice|profile|role|permission|seller|salesman)'
)
select tc.constraint_name, tc.table_name as child_table,
       tc.constraint_type, kcu.ordinal_position,
       kcu.column_name as child_column
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_catalog = kcu.constraint_catalog
 and tc.constraint_schema = kcu.constraint_schema
 and tc.constraint_name = kcu.constraint_name
where tc.table_schema = 'public'
  and tc.constraint_type in ('PRIMARY KEY', 'UNIQUE')
  and tc.table_name in (select table_name from relevant_tables)
order by tc.table_name, tc.constraint_name, kcu.ordinal_position;

-- Result 3: foreign keys, ordered child/parent columns, and referential actions.
with relevant_tables as (
  select distinct c.table_name
  from information_schema.columns c
  where c.table_schema = 'public'
    and (c.table_name || ' ' || c.column_name) ~* '(voucher|journal|ledger|account|chart|debit|credit|customer|receivable|payable|payment|receipt|cash|bank|expense|revenue|inventory|stock|return|refund|credit|invoice|profile|role|permission|seller|salesman)'
)
select con.conname as constraint_name,
       child.relname as child_table,
       child_att.attname as child_column,
       child_key.ordinality as ordinal_position,
       parent.relname as parent_table,
       parent_att.attname as parent_column,
       case con.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as delete_action,
       case con.confupdtype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as update_action
from pg_catalog.pg_constraint con
join pg_catalog.pg_class child on child.oid = con.conrelid
join pg_catalog.pg_namespace child_ns on child_ns.oid = child.relnamespace
join pg_catalog.pg_class parent on parent.oid = con.confrelid
join unnest(con.conkey) with ordinality child_key(attnum, ordinality) on true
join pg_catalog.pg_attribute child_att on child_att.attrelid = child.oid and child_att.attnum = child_key.attnum
join pg_catalog.pg_attribute parent_att on parent_att.attrelid = parent.oid and parent_att.attnum = con.confkey[child_key.ordinality]
where con.contype = 'f' and child_ns.nspname = 'public'
  and (child.relname in (select table_name from relevant_tables) or parent.relname in (select table_name from relevant_tables))
order by child.relname, con.conname, child_key.ordinality;

-- Result 4: indexes on the discovered tables, including full index definitions.
with relevant_tables as (
  select distinct c.table_name
  from information_schema.columns c
  where c.table_schema = 'public'
    and (c.table_name || ' ' || c.column_name) ~* '(voucher|journal|ledger|account|chart|debit|credit|customer|receivable|payable|payment|receipt|cash|bank|expense|revenue|inventory|stock|return|refund|credit|invoice|profile|role|permission|seller|salesman)'
)
select i.schemaname, i.tablename as table_name, i.indexname as index_name, i.indexdef as index_definition
from pg_catalog.pg_indexes i
where i.schemaname = 'public' and i.tablename in (select table_name from relevant_tables)
order by i.tablename, i.indexname;

-- Result 5: relevant deployed ordinary public functions and their metadata.
-- The materialized source filter excludes aggregates (a) and window functions
-- (w) before any pg_get_function* helper can be evaluated.
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
       pg_catalog.pg_get_function_arguments(f.oid) as argument_signature,
       pg_catalog.pg_get_function_result(f.oid) as return_type,
       f.lanname as language, f.prosecdef as security_definer,
       f.provolatile as volatility, pg_catalog.pg_get_userbyid(f.proowner) as owner
from relevant_functions f
order by f.proname, pg_catalog.pg_get_function_identity_arguments(f.oid);

-- Result 6: routine parameters and execute grants for the same routine set.
with ordinary_public_functions as materialized (
  select p.oid, n.nspname, p.proname
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
), relevant_routines as materialized (
  select f.oid, f.nspname, f.proname, pg_catalog.pg_get_function_identity_arguments(f.oid) as identity_arguments
  from ordinary_public_functions f
  where f.proname ~* '(post_sale|sale|invoice|voucher|journal|payment|receipt|customer|balance|stock|return|cancel|refund|commission)'
     or pg_catalog.pg_get_functiondef(f.oid) ~* '(voucher|journal|ledger|account|payment|receipt|return|invoice|commission)'
)
select r.nspname as schema_name, r.proname as function_name, r.identity_arguments,
       prm.ordinal_position, prm.parameter_name, prm.data_type, prm.parameter_mode,
       coalesce(g.grantee, 'PUBLIC') as grantee, coalesce(g.privilege_type, 'EXECUTE') as privilege_type
from relevant_routines r
left join information_schema.parameters prm
  on prm.specific_schema = r.nspname and prm.specific_name like r.proname || '\_%'
left join information_schema.role_routine_grants g
  on g.routine_schema = r.nspname and g.routine_name = r.proname
order by r.proname, r.identity_arguments, prm.ordinal_position, g.grantee;

-- Result 7: RLS state, policies, and table grants for accounting/access tables.
with relevant_tables as (
  select distinct c.table_name
  from information_schema.columns c
  where c.table_schema = 'public'
    and (c.table_name || ' ' || c.column_name) ~* '(voucher|journal|ledger|account|chart|debit|credit|customer|receivable|payable|payment|receipt|cash|bank|expense|revenue|inventory|stock|return|refund|credit|invoice|profile|role|permission|seller|salesman)'
)
select cls.relname as table_name, cls.relrowsecurity as rls_enabled,
       pol.policyname as policy_name, pol.cmd as policy_command, pol.roles as policy_roles,
       pol.qual as using_expression, pol.with_check as with_check_expression,
       grants.grantee, grants.privilege_type
from pg_catalog.pg_class cls
join pg_catalog.pg_namespace ns on ns.oid = cls.relnamespace
left join pg_catalog.pg_policies pol on pol.schemaname = ns.nspname and pol.tablename = cls.relname
left join information_schema.role_table_grants grants on grants.table_schema = ns.nspname and grants.table_name = cls.relname
where ns.nspname = 'public' and cls.relkind in ('r', 'p')
  and cls.relname in (select table_name from relevant_tables)
order by cls.relname, pol.policyname, grants.grantee, grants.privilege_type;

-- Result 8: role, permission, business-ownership, and seller-attribution metadata.
select c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default,
  case
    when (c.table_name || ' ' || c.column_name) ~* '(permission|perm)' then 'permission storage'
    when (c.table_name || ' ' || c.column_name) ~* '(role|owner|admin|accountant)' then 'role/authorization'
    when (c.table_name || ' ' || c.column_name) ~* '(salesman|seller|invoice|created_by)' then 'invoice seller attribution'
    when (c.table_name || ' ' || c.column_name) ~* '(business|profile|user|status)' then 'business membership/status'
    else 'access metadata'
  end as likely_domain
from information_schema.columns c
where c.table_schema = 'public'
  and (c.table_name || ' ' || c.column_name) ~* '(profile|role|permission|perm|owner|admin|accountant|business|user|status|salesman|seller|invoice|created_by)'
order by c.table_name, c.ordinal_position;
