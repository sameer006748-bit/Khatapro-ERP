-- Phase 1 Foundation inspection (read-only and safe before migration).
-- Uses catalog views and to_regclass(); it never selects application rows.
-- Run FIRST on project: ebcebxwpddltiwrqybqc
--
-- Checks only production tables. Prisma-only tables (accounts,
-- account_categories, delivery_orders, delivery_status_events,
-- rider_cod_submissions) are excluded.

select 'base table: businesses' as area, 'businesses' as object_name, 'table' as object_type,
       to_regclass('public.businesses') is not null as exists, null::text as details
union all select 'base table: products', 'products', 'table', to_regclass('public.products') is not null, null::text
union all select 'base table: invoices', 'invoices', 'table', to_regclass('public.invoices') is not null, null::text
union all select 'base table: invoice_items', 'invoice_items', 'table', to_regclass('public.invoice_items') is not null, null::text
union all select 'base table: profiles', 'profiles', 'table', to_regclass('public.profiles') is not null, null::text
union all select 'base table: riders', 'riders', 'table', to_regclass('public.riders') is not null, null::text
union all select 'base table: delivery_events', 'delivery_events', 'table', to_regclass('public.delivery_events') is not null, null::text
union all select 'base table: rider_cash_ledger', 'rider_cash_ledger', 'table', to_regclass('public.rider_cash_ledger') is not null, null::text
union all
select 'Prisma-only table ABSENT: accounts', 'accounts', 'table', to_regclass('public.accounts') is not null, 'expected absent — confirmed production has none'
union all select 'Prisma-only table ABSENT: account_categories', 'account_categories', 'table', to_regclass('public.account_categories') is not null, 'expected absent — confirmed production has none'
union all select 'Prisma-only table ABSENT: business', 'business', 'table', to_regclass('public.business') is not null, 'expected absent — use businesses'
union all select 'Prisma-only table ABSENT: delivery_orders', 'delivery_orders', 'table', to_regclass('public.delivery_orders') is not null, 'expected absent — confirmed production has none'
union all select 'Prisma-only table ABSENT: delivery_status_events', 'delivery_status_events', 'table', to_regclass('public.delivery_status_events') is not null, 'expected absent — confirmed production has none'
union all select 'Prisma-only table ABSENT: rider_cod_submissions', 'rider_cod_submissions', 'table', to_regclass('public.rider_cod_submissions') is not null, 'expected absent — confirmed production has none'
union all
select 'invoices PK is composite (business_id, id)', 'invoices', 'constraint',
       exists (select 1 from pg_constraint where conname = 'invoices_pkey' and conrelid = to_regclass('public.invoices') and pg_get_constraintdef(oid) = 'PRIMARY KEY (business_id, id)'),
       (select pg_get_constraintdef(oid) from pg_constraint where conname = 'invoices_pkey' and conrelid = to_regclass('public.invoices'))
union all
select 'invoice_items PK is single-column id', 'invoice_items', 'constraint',
       exists (select 1 from pg_constraint where conname = 'invoice_items_pkey' and conrelid = to_regclass('public.invoice_items') and pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'),
       (select pg_get_constraintdef(oid) from pg_constraint where conname = 'invoice_items_pkey' and conrelid = to_regclass('public.invoice_items'))
union all
select 'production identifier map', 'businesses.id', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'businesses' and column_name = 'id' and data_type = 'uuid'), 'uuid'
union all select 'production identifier map', 'invoices.business_id', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name = 'business_id' and data_type = 'uuid'), 'uuid'
union all select 'production identifier map', 'invoices.id', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name = 'id' and data_type = 'text'), 'text'
union all select 'production identifier map', 'invoice_items.business_id', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_items' and column_name = 'business_id' and data_type = 'uuid'), 'uuid'
union all select 'production identifier map', 'invoice_items.id', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_items' and column_name = 'id' and data_type = 'text'), 'text'
union all select 'production identifier map', 'products.id', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'id' and data_type = 'uuid'), 'uuid'
union all select 'production identifier map', 'profiles.id', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'id' and data_type = 'uuid'), 'uuid'
union all select 'production identifier map', 'riders.id', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'riders' and column_name = 'id' and data_type = 'uuid'), 'uuid'
union all select 'production identifier map', 'delivery_events.id', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'delivery_events' and column_name = 'id' and data_type = 'uuid'), 'uuid'
union all select 'production identifier map', 'rider_cash_ledger.id', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rider_cash_ledger' and column_name = 'id' and data_type = 'uuid'), 'uuid'
union all
select 'products.commission_rate', 'products', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'commission_rate'),
       (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'commission_rate')
union all
select 'products.commission_rate_non_negative', 'products', 'constraint',
       exists (select 1 from pg_constraint where conname = 'commission_rate_non_negative' and conrelid = to_regclass('public.products')),
       null
union all
select 'invoice_items.returned_qty', 'invoice_items', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_items' and column_name = 'returned_qty'),
       (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'invoice_items' and column_name = 'returned_qty')
union all
select 'invoice_items NO original_invoice_item_id column', 'invoice_items', 'column',
       not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_items' and column_name = 'original_invoice_item_id'),
       'absent by design — sale_return_lines has the relation'
union all
select 'sale_return_documents table', 'sale_return_documents', 'table', to_regclass('public.sale_return_documents') is not null, null
union all
select 'sale_return_documents composite invoice FK (business_id, original_invoice_id) -> invoices(business_id, id)', 'sale_return_documents', 'foreign key',
       exists (select 1 from pg_constraint where conname = 'sale_return_documents_invoice_fkey' and conrelid = to_regclass('public.sale_return_documents')
               and pg_get_constraintdef(oid) = 'FOREIGN KEY (business_id, original_invoice_id) REFERENCES invoices(business_id, id) ON DELETE RESTRICT'),
       (select pg_get_constraintdef(oid) from pg_constraint where conname = 'sale_return_documents_invoice_fkey' and conrelid = to_regclass('public.sale_return_documents'))
union all
select 'sale_return_documents NO single-column invoice FK', 'sale_return_documents', 'foreign key',
       not exists (select 1 from pg_constraint where conrelid = to_regclass('public.sale_return_documents') and contype = 'f'
                    and pg_get_constraintdef(oid) ~ 'FOREIGN KEY [(][^)]*original_invoice_id[^)]*[)] REFERENCES invoices[(]id[)]'),
       'must not reference invoices(id) alone'
union all
select 'sale_return_documents idempotency constraint', 'sale_return_documents', 'constraint',
       exists (select 1 from pg_constraint where conname = 'sale_return_documents_business_idempotency_key_key' and conrelid = to_regclass('public.sale_return_documents')), null
union all
select 'sale_return_documents original invoice index', 'sale_return_documents', 'index',
       exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'sale_return_documents' and indexname = 'sale_return_documents_original_invoice_idx'), null
union all
select 'sale_return_documents uuid PK type', 'sale_return_documents', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sale_return_documents' and column_name = 'id' and data_type = 'uuid'),
       null
union all
select 'sale_return_documents business_id uuid type', 'sale_return_documents', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sale_return_documents' and column_name = 'business_id' and data_type = 'uuid'),
       null
union all
select 'sale_return_documents original_invoice_id text type', 'sale_return_documents', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sale_return_documents' and column_name = 'original_invoice_id' and data_type = 'text'), null
union all
select 'sale_return_documents RLS', 'sale_return_documents', 'rls',
       exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'sale_return_documents' and rowsecurity), null
union all
select 'sale_return_documents service_role INSERT', 'sale_return_documents', 'grant',
       exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'sale_return_documents' and grantee = 'service_role' and privilege_type = 'INSERT'), null
union all
select 'sale_return_documents anon SELECT', 'sale_return_documents', 'grant',
       exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'sale_return_documents' and grantee = 'anon' and privilege_type = 'SELECT'), null
union all
select 'sale_return_lines table', 'sale_return_lines', 'table', to_regclass('public.sale_return_lines') is not null, null
union all
select 'sale_return_lines original invoice item FK (single-column, invoice_items has simple PK)', 'sale_return_lines', 'foreign key',
       exists (select 1 from pg_constraint where conrelid = to_regclass('public.sale_return_lines') and contype = 'f'
               and pg_get_constraintdef(oid) = 'FOREIGN KEY (original_invoice_item_id) REFERENCES invoice_items(id) ON DELETE RESTRICT'),
       null
union all
select 'sale_return_lines original_invoice_item_id text type', 'sale_return_lines', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sale_return_lines' and column_name = 'original_invoice_item_id' and data_type = 'text'), null
union all
select 'sale_return_lines uuid PK type', 'sale_return_lines', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sale_return_lines' and column_name = 'id' and data_type = 'uuid'),
       null
union all
select 'sale_return_lines business_id uuid type', 'sale_return_lines', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sale_return_lines' and column_name = 'business_id' and data_type = 'uuid'),
       null
union all
select 'sale_return_lines returned_qty positive constraint', 'sale_return_lines', 'constraint',
       exists (select 1 from pg_constraint where conname = 'sale_return_lines_returned_qty_positive' and conrelid = to_regclass('public.sale_return_lines')), null
union all
select 'sale_return_lines RLS', 'sale_return_lines', 'rls',
       exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'sale_return_lines' and rowsecurity), null
union all
select 'sale_return_lines service_role INSERT', 'sale_return_lines', 'grant',
       exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'sale_return_lines' and grantee = 'service_role' and privilege_type = 'INSERT'), null
union all
select 'commission_events table', 'commission_events', 'table', to_regclass('public.commission_events') is not null, null
union all
select 'commission_events business-scoped idempotency index', 'commission_events', 'index',
       exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'commission_events' and indexname = 'commission_events_business_idempotency_key_idx'), null
union all
select 'commission_events biz-invoice index', 'commission_events', 'index',
       exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'commission_events' and indexname = 'commission_events_biz_invoice_idx'), null
union all
select 'commission_events salesman index', 'commission_events', 'index',
       exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'commission_events' and indexname = 'commission_events_salesman_idx'), null
union all
select 'commission_events invoice-item index', 'commission_events', 'index',
       exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'commission_events' and indexname = 'commission_events_invoice_item_idx'), null
union all
select 'commission_events uuid PK type', 'commission_events', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'commission_events' and column_name = 'id' and data_type = 'uuid'),
       null
union all
select 'commission_events business_id uuid type', 'commission_events', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'commission_events' and column_name = 'business_id' and data_type = 'uuid'),
       null
union all
select 'commission_events invoice_id text type', 'commission_events', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'commission_events' and column_name = 'invoice_id' and data_type = 'text'), null
union all select 'commission_events invoice_item_id text type', 'commission_events', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'commission_events' and column_name = 'invoice_item_id' and data_type = 'text'), null
union all select 'commission_events original_invoice_item_id text type', 'commission_events', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'commission_events' and column_name = 'original_invoice_item_id' and data_type = 'text'), null
union all
select 'commission_events RLS', 'commission_events', 'rls',
       exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'commission_events' and rowsecurity), null
union all
select 'commission_events anon SELECT', 'commission_events', 'grant',
       exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'commission_events' and grantee = 'anon' and privilege_type = 'SELECT'), null
union all
select 'commission_events anon INSERT', 'commission_events', 'grant',
       exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'commission_events' and grantee = 'anon' and privilege_type = 'INSERT'), null
union all
select 'commission_events authenticated SELECT', 'commission_events', 'grant',
       exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'commission_events' and grantee = 'authenticated' and privilege_type = 'SELECT'), null
union all
select 'commission_events authenticated INSERT', 'commission_events', 'grant',
       exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'commission_events' and grantee = 'authenticated' and privilege_type = 'INSERT'), null
union all
select 'commission_events service_role INSERT', 'commission_events', 'grant',
       exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'commission_events' and grantee = 'service_role' and privilege_type = 'INSERT'), null
union all
select 'identity_sequences table', 'identity_sequences', 'table', to_regclass('public.identity_sequences') is not null, null
union all
select 'identity_sequences composite PK (business_id, prefix)', 'identity_sequences', 'constraint',
       exists (select 1 from pg_constraint where conname = 'identity_sequences_pkey' and conrelid = to_regclass('public.identity_sequences')), null
union all
select 'identity_sequences business_id uuid type', 'identity_sequences', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'identity_sequences' and column_name = 'business_id' and data_type = 'uuid'),
       null
union all
select 'identity_sequences business_id FK', 'identity_sequences', 'foreign key',
       exists (select 1 from pg_constraint where conrelid = to_regclass('public.identity_sequences') and contype = 'f' and pg_get_constraintdef(oid) like '%businesses%'), null
union all
select 'identity_sequences RLS', 'identity_sequences', 'rls',
       exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'identity_sequences' and rowsecurity), null
union all
select 'identity_sequences anon SELECT', 'identity_sequences', 'grant',
       exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'identity_sequences' and grantee = 'anon' and privilege_type = 'SELECT'), null
union all
select 'identity_sequences anon INSERT', 'identity_sequences', 'grant',
       exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'identity_sequences' and grantee = 'anon' and privilege_type = 'INSERT'), null
union all
select 'identity_sequences authenticated SELECT', 'identity_sequences', 'grant',
       exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'identity_sequences' and grantee = 'authenticated' and privilege_type = 'SELECT'), null
union all
select 'identity_sequences authenticated INSERT', 'identity_sequences', 'grant',
       exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'identity_sequences' and grantee = 'authenticated' and privilege_type = 'INSERT'), null
union all
select 'identity_sequences service_role INSERT', 'identity_sequences', 'grant',
       exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'identity_sequences' and grantee = 'service_role' and privilege_type = 'INSERT'), null
union all
select 'delivery_events.idempotency_key', 'delivery_events', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'delivery_events' and column_name = 'idempotency_key'),
       null
union all
select 'delivery_events_idempotency_key_idx', 'delivery_events', 'index',
       exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'delivery_events' and indexname = 'delivery_events_idempotency_key_idx'), null
union all
select 'rider_cash_ledger.idempotency_key', 'rider_cash_ledger', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rider_cash_ledger' and column_name = 'idempotency_key'),
       null
union all
select 'rider_cash_ledger_idempotency_key_idx', 'rider_cash_ledger', 'index',
       exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'rider_cash_ledger' and indexname = 'rider_cash_ledger_idempotency_key_idx'), null
union all
select 'rider_cash_ledger.settlement_batch_id', 'rider_cash_ledger', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rider_cash_ledger' and column_name = 'settlement_batch_id'),
       null
union all
select 'rider_cash_ledger_settlement_batch_idx', 'rider_cash_ledger', 'index',
       exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'rider_cash_ledger' and indexname = 'rider_cash_ledger_settlement_batch_idx'), null
union all
select 'Phase 1 foreign keys have compatible column types', 'Phase 1 tables', 'foreign key',
       not exists (
         select 1
         from pg_constraint c
         cross join lateral unnest(c.conkey) with ordinality child(attnum, position)
         join pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = child.attnum
         join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[child.position]
         where c.contype = 'f'
           and c.conrelid in (
             to_regclass('public.sale_return_documents'),
             to_regclass('public.sale_return_lines'),
             to_regclass('public.commission_events'),
             to_regclass('public.identity_sequences')
           )
           and ca.atttypid <> pa.atttypid
       ), 'catalog-only comparison of every Phase 1 FK column pair';
