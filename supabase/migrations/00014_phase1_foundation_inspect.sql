-- Phase 1 Foundation inspection (read-only and safe before migration).
-- Uses catalog views and to_regclass(); it never selects application rows.
-- Run FIRST on project: ebcebxwpddltiwrqybqc

select 'base table: products' as area, 'products' as object_name, 'table' as object_type,
       to_regclass('public.products') is not null as exists, null::text as details
union all select 'base table: invoice_items', 'invoice_items', 'table', to_regclass('public.invoice_items') is not null, null::text
union all select 'base table: business', 'business', 'table', to_regclass('public.business') is not null, null::text
union all select 'base table: invoices', 'invoices', 'table', to_regclass('public.invoices') is not null, null::text
union all select 'base table: account_categories', 'account_categories', 'table', to_regclass('public.account_categories') is not null, null::text
union all select 'base table: accounts', 'accounts', 'table', to_regclass('public.accounts') is not null, null::text
union all select 'base table: delivery_orders', 'delivery_orders', 'table', to_regclass('public.delivery_orders') is not null, null::text
union all select 'base table: delivery_status_events', 'delivery_status_events', 'table', to_regclass('public.delivery_status_events') is not null, null::text
union all select 'base table: rider_cod_submissions', 'rider_cod_submissions', 'table', to_regclass('public.rider_cod_submissions') is not null, null::text
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
select 'invoice_items.original_invoice_item_id', 'invoice_items', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_items' and column_name = 'original_invoice_item_id'),
       (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'invoice_items' and column_name = 'original_invoice_item_id')
union all
select 'invoice_items_original_idx', 'invoice_items', 'index',
       exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'invoice_items' and indexname = 'invoice_items_original_idx'), null
union all
select 'invoice_items_original_invoice_item_fk', 'invoice_items', 'constraint',
       exists (select 1 from pg_constraint where conname = 'invoice_items_original_invoice_item_fk' and conrelid = to_regclass('public.invoice_items')), null
union all
select 'sale_return_documents table', 'sale_return_documents', 'table', to_regclass('public.sale_return_documents') is not null, null
union all
select 'sale_return_documents original invoice relation', 'sale_return_documents', 'foreign key',
       exists (select 1 from pg_constraint where conname = 'sale_return_documents_original_invoice_id_fkey' and conrelid = to_regclass('public.sale_return_documents')), null
union all
select 'sale_return_documents idempotency constraint', 'sale_return_documents', 'constraint',
       exists (select 1 from pg_constraint where conname = 'sale_return_documents_business_idempotency_key_key' and conrelid = to_regclass('public.sale_return_documents')), null
union all
select 'sale_return_documents original invoice index', 'sale_return_documents', 'index',
       exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'sale_return_documents' and indexname = 'sale_return_documents_original_invoice_idx'), null
union all
select 'sale_return_documents RLS', 'sale_return_documents', 'rls',
       exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'sale_return_documents' and rowsecurity), null
union all
select 'sale_return_documents service_role INSERT', 'sale_return_documents', 'grant',
       exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'sale_return_documents' and grantee = 'service_role' and privilege_type = 'INSERT'), null
union all
select 'sale_return_lines table', 'sale_return_lines', 'table', to_regclass('public.sale_return_lines') is not null, null
union all
select 'sale_return_lines original invoice item relation', 'sale_return_lines', 'foreign key',
       exists (select 1 from pg_constraint where conname = 'sale_return_lines_original_invoice_item_id_fkey' and conrelid = to_regclass('public.sale_return_lines')), null
union all
select 'sale_return_lines returned quantity', 'sale_return_lines', 'column',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sale_return_lines' and column_name = 'returned_qty'),
       (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'sale_return_lines' and column_name = 'returned_qty')
union all
select 'sale_return_lines document relation', 'sale_return_lines', 'foreign key',
       exists (select 1 from pg_constraint where conname = 'sale_return_lines_sale_return_id_fkey' and conrelid = to_regclass('public.sale_return_lines')), null
union all
select 'sale_return_lines RLS', 'sale_return_lines', 'rls',
       exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'sale_return_lines' and rowsecurity), null
union all
select 'sale_return_lines service_role INSERT', 'sale_return_lines', 'grant',
       exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'sale_return_lines' and grantee = 'service_role' and privilege_type = 'INSERT'), null
union all
select 'commission_events table', 'commission_events', 'table', to_regclass('public.commission_events') is not null, null
union all
select 'commission_events idempotency index', 'commission_events', 'index', exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'commission_events' and indexname = 'commission_events_idempotency_key_idx'), null
union all
select 'commission_events biz-invoice index', 'commission_events', 'index', exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'commission_events' and indexname = 'commission_events_biz_invoice_idx'), null
union all
select 'commission_events salesman index', 'commission_events', 'index', exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'commission_events' and indexname = 'commission_events_salesman_idx'), null
union all
select 'commission_events invoice-item index', 'commission_events', 'index', exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'commission_events' and indexname = 'commission_events_invoice_item_idx'), null
union all
select 'commission_events RLS', 'commission_events', 'rls', exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'commission_events' and rowsecurity), null
union all
select 'commission_events_select_own', 'commission_events', 'policy', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'commission_events' and policyname = 'commission_events_select_own'), null
union all
select 'commission_events anon SELECT', 'commission_events', 'grant', exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'commission_events' and grantee = 'anon' and privilege_type = 'SELECT'), null
union all
select 'commission_events anon INSERT', 'commission_events', 'grant', exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'commission_events' and grantee = 'anon' and privilege_type = 'INSERT'), null
union all
select 'commission_events authenticated SELECT', 'commission_events', 'grant', exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'commission_events' and grantee = 'authenticated' and privilege_type = 'SELECT'), null
union all
select 'commission_events authenticated INSERT', 'commission_events', 'grant', exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'commission_events' and grantee = 'authenticated' and privilege_type = 'INSERT'), null
union all
select 'commission_events service_role SELECT', 'commission_events', 'grant', exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'commission_events' and grantee = 'service_role' and privilege_type = 'SELECT'), null
union all
select 'commission_events service_role INSERT', 'commission_events', 'grant', exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'commission_events' and grantee = 'service_role' and privilege_type = 'INSERT'), null
union all
select 'identity_sequences table', 'identity_sequences', 'table', to_regclass('public.identity_sequences') is not null, null
union all
select 'identity_sequences RLS', 'identity_sequences', 'rls', exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'identity_sequences' and rowsecurity), null
union all
select 'identity_sequences_select_own', 'identity_sequences', 'policy', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'identity_sequences' and policyname = 'identity_sequences_select_own'), null
union all
select 'identity_sequences anon SELECT', 'identity_sequences', 'grant', exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'identity_sequences' and grantee = 'anon' and privilege_type = 'SELECT'), null
union all
select 'identity_sequences anon INSERT', 'identity_sequences', 'grant', exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'identity_sequences' and grantee = 'anon' and privilege_type = 'INSERT'), null
union all
select 'identity_sequences authenticated SELECT', 'identity_sequences', 'grant', exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'identity_sequences' and grantee = 'authenticated' and privilege_type = 'SELECT'), null
union all
select 'identity_sequences authenticated INSERT', 'identity_sequences', 'grant', exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'identity_sequences' and grantee = 'authenticated' and privilege_type = 'INSERT'), null
union all
select 'identity_sequences service_role SELECT', 'identity_sequences', 'grant', exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'identity_sequences' and grantee = 'service_role' and privilege_type = 'SELECT'), null
union all
select 'identity_sequences service_role INSERT', 'identity_sequences', 'grant', exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'identity_sequences' and grantee = 'service_role' and privilege_type = 'INSERT'), null
union all
select 'account_categories.parent_id', 'account_categories', 'column', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'account_categories' and column_name = 'parent_id'), null
union all
select 'account_categories parent index', 'account_categories', 'index', exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'account_categories' and indexname = 'account_categories_parent_idx'), null
union all
select 'account_categories_no_self_parent', 'account_categories', 'constraint', exists (select 1 from pg_constraint where conname = 'account_categories_no_self_parent' and conrelid = to_regclass('public.account_categories')), null
union all
select 'accounts.is_system', 'accounts', 'column', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'accounts' and column_name = 'is_system'), null
union all
select 'delivery_orders.is_settled', 'delivery_orders', 'column', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'delivery_orders' and column_name = 'is_settled'), null
union all
select 'delivery_orders.ordered_qty', 'delivery_orders', 'column', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'delivery_orders' and column_name = 'ordered_qty'), null
union all
select 'delivery_orders.delivered_qty', 'delivery_orders', 'column', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'delivery_orders' and column_name = 'delivered_qty'), null
union all
select 'delivery_orders.returned_qty', 'delivery_orders', 'column', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'delivery_orders' and column_name = 'returned_qty'), null
union all
select 'delivery_orders_settled_idx', 'delivery_orders', 'index', exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'delivery_orders' and indexname = 'delivery_orders_settled_idx'), null
union all
select 'delivery_status_events.idempotency_key', 'delivery_status_events', 'column', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'delivery_status_events' and column_name = 'idempotency_key'), null
union all
select 'delivery_events_idempotency_key_idx', 'delivery_status_events', 'index', exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'delivery_status_events' and indexname = 'delivery_events_idempotency_key_idx'), null
union all
select 'rider_cod_submissions.idempotency_key', 'rider_cod_submissions', 'column', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rider_cod_submissions' and column_name = 'idempotency_key'), null
union all
select 'cod_submissions_idempotency_key_idx', 'rider_cod_submissions', 'index', exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'rider_cod_submissions' and indexname = 'cod_submissions_idempotency_key_idx'), null
union all
select 'system accounts', 'accounts', 'data', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'accounts' and column_name = 'is_system'), null;
