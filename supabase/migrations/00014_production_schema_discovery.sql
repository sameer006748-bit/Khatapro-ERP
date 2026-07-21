-- Phase 1 production schema discovery (read-only; not a migration).
-- Run on project ebcebxwpddltiwrqybqc before changing 00014 base-table mappings.
-- This reads PostgreSQL metadata only and never reads application rows.

with relevant_tables as (
  select t.table_name
  from information_schema.tables t
  where t.table_schema = 'public'
    and t.table_type = 'BASE TABLE'
    and (
      t.table_name ~* '(business|company|tenant|account|category|ledger|delivery|rider|cod|courier|profile|user|salesman|invoice|product)'
      or exists (
        select 1
        from information_schema.columns c
        where c.table_schema = t.table_schema
          and c.table_name = t.table_name
          and c.column_name ~* '(business|company|tenant|account|category|ledger|delivery|rider|cod|courier|profile|user|salesman|invoice|product)'
      )
    )
)
select
  c.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default,
  case
    when (c.table_name || ' ' || c.column_name) ~* '(business|company|tenant)' then 'business/company/tenant'
    when (c.table_name || ' ' || c.column_name) ~* '(account|category|ledger)' then 'account/category/ledger'
    when (c.table_name || ' ' || c.column_name) ~* '(delivery|rider|cod|courier)' then 'delivery/rider/COD/courier'
    when (c.table_name || ' ' || c.column_name) ~* '(profile|user|salesman)' then 'profile/user/salesman'
    when (c.table_name || ' ' || c.column_name) ~* 'invoice' then 'invoice'
    when (c.table_name || ' ' || c.column_name) ~* 'product' then 'product'
    else 'related table'
  end as likely_domain
from information_schema.columns c
join relevant_tables r on r.table_name = c.table_name
where c.table_schema = 'public'
order by c.table_name, c.ordinal_position;

with relevant_tables as (
  select t.table_name
  from information_schema.tables t
  where t.table_schema = 'public'
    and t.table_type = 'BASE TABLE'
    and (
      t.table_name ~* '(business|company|tenant|account|category|ledger|delivery|rider|cod|courier|profile|user|salesman|invoice|product)'
      or exists (
        select 1
        from information_schema.columns c
        where c.table_schema = t.table_schema
          and c.table_name = t.table_name
          and c.column_name ~* '(business|company|tenant|account|category|ledger|delivery|rider|cod|courier|profile|user|salesman|invoice|product)'
      )
    )
)
select
  tc.table_name as child_table_name,
  kcu.column_name as child_column_name,
  ccu.table_name as parent_table_name,
  ccu.column_name as parent_column_name,
  tc.constraint_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_catalog = kcu.constraint_catalog
 and tc.constraint_schema = kcu.constraint_schema
 and tc.constraint_name = kcu.constraint_name
join information_schema.constraint_column_usage ccu
  on tc.constraint_catalog = ccu.constraint_catalog
 and tc.constraint_schema = ccu.constraint_schema
 and tc.constraint_name = ccu.constraint_name
where tc.table_schema = 'public'
  and tc.constraint_type = 'FOREIGN KEY'
  and tc.table_name in (select table_name from relevant_tables)
  and ccu.table_name in (select table_name from relevant_tables)
order by tc.table_name, tc.constraint_name, kcu.ordinal_position;
