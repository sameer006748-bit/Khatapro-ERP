-- Phase 1 Foundation inspection (read-only, pre-migration safe).
-- Uses to_regclass() and catalog views only.
-- Never SELECTs from Phase 1 application tables.
-- Run FIRST on project: ebcebxwpddltiwrqybqc
SELECT 'products.commission_rate' AS area,
       'products' AS object_name,
       'column' AS object_type,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'commission_rate') AS exists,
       (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'commission_rate') AS details
UNION ALL
SELECT 'products.commission_rate_non_negative', 'products', 'constraint',
       EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_rate_non_negative' AND conrelid = to_regclass('public.products')),
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_rate_non_negative' AND conrelid = to_regclass('public.products'))
            THEN pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'commission_rate_non_negative' AND conrelid = to_regclass('public.products')))
            ELSE NULL END
UNION ALL
SELECT 'invoice_items.returned_qty', 'invoice_items', 'column',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoice_items' AND column_name = 'returned_qty'),
       (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoice_items' AND column_name = 'returned_qty')
UNION ALL
SELECT 'invoice_items.original_invoice_item_id', 'invoice_items', 'column',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoice_items' AND column_name = 'original_invoice_item_id'),
       (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoice_items' AND column_name = 'original_invoice_item_id')
UNION ALL
SELECT 'invoice_items_original_idx', 'invoice_items', 'index',
       EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'invoice_items' AND indexname = 'invoice_items_original_idx'),
       NULL
UNION ALL
SELECT 'sales_returns.idempotency_key', 'sales_returns', 'column',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_returns' AND column_name = 'idempotency_key'),
       (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_returns' AND column_name = 'idempotency_key')
UNION ALL
SELECT 'sales_returns_idempotency_key_idx', 'sales_returns', 'index',
       EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'sales_returns' AND indexname = 'sales_returns_idempotency_key_idx'),
       NULL
UNION ALL
SELECT 'commission_events table', 'commission_events', 'table',
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'commission_events'),
       NULL
UNION ALL
SELECT 'commission_events idempotency index', 'commission_events', 'index',
       EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'commission_events' AND indexname = 'commission_events_idempotency_key_idx'),
       NULL
UNION ALL
SELECT 'commission_events biz-invoice index', 'commission_events', 'index',
       EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'commission_events' AND indexname = 'commission_events_biz_invoice_idx'),
       NULL
UNION ALL
SELECT 'commission_events salesman index', 'commission_events', 'index',
       EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'commission_events' AND indexname = 'commission_events_salesman_idx'),
       NULL
UNION ALL
SELECT 'commission_events invoice-item index', 'commission_events', 'index',
       EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'commission_events' AND indexname = 'commission_events_invoice_item_idx'),
       NULL
UNION ALL
SELECT 'commission_events RLS', 'commission_events', 'rls',
       EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'commission_events' AND rowsecurity = true),
       NULL
UNION ALL
SELECT 'commission_events_select_own', 'commission_events', 'policy',
       EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'commission_events' AND policyname = 'commission_events_select_own'),
       NULL
UNION ALL
SELECT 'commission_events anon SELECT', 'commission_events', 'grant',
       EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'commission_events' AND grantee = 'anon' AND privilege_type = 'SELECT'),
       NULL
UNION ALL
SELECT 'commission_events anon INSERT', 'commission_events', 'grant',
       EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'commission_events' AND grantee = 'anon' AND privilege_type = 'INSERT'),
       NULL
UNION ALL
SELECT 'commission_events authenticated SELECT', 'commission_events', 'grant',
       EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'commission_events' AND grantee = 'authenticated' AND privilege_type = 'SELECT'),
       NULL
UNION ALL
SELECT 'commission_events authenticated INSERT', 'commission_events', 'grant',
       EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'commission_events' AND grantee = 'authenticated' AND privilege_type = 'INSERT'),
       NULL
UNION ALL
SELECT 'commission_events service_role SELECT', 'commission_events', 'grant',
       EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'commission_events' AND grantee = 'service_role' AND privilege_type = 'SELECT'),
       NULL
UNION ALL
SELECT 'commission_events service_role INSERT', 'commission_events', 'grant',
       EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'commission_events' AND grantee = 'service_role' AND privilege_type = 'INSERT'),
       NULL
UNION ALL
SELECT 'identity_sequences table', 'identity_sequences', 'table',
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'identity_sequences'),
       NULL
UNION ALL
SELECT 'identity_sequences RLS', 'identity_sequences', 'rls',
       EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'identity_sequences' AND rowsecurity = true),
       NULL
UNION ALL
SELECT 'identity_sequences_select_own', 'identity_sequences', 'policy',
       EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'identity_sequences' AND policyname = 'identity_sequences_select_own'),
       NULL
UNION ALL
SELECT 'identity_sequences anon SELECT', 'identity_sequences', 'grant',
       EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'identity_sequences' AND grantee = 'anon' AND privilege_type = 'SELECT'),
       NULL
UNION ALL
SELECT 'identity_sequences anon INSERT', 'identity_sequences', 'grant',
       EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'identity_sequences' AND grantee = 'anon' AND privilege_type = 'INSERT'),
       NULL
UNION ALL
SELECT 'identity_sequences authenticated SELECT', 'identity_sequences', 'grant',
       EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'identity_sequences' AND grantee = 'authenticated' AND privilege_type = 'SELECT'),
       NULL
UNION ALL
SELECT 'identity_sequences authenticated INSERT', 'identity_sequences', 'grant',
       EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'identity_sequences' AND grantee = 'authenticated' AND privilege_type = 'INSERT'),
       NULL
UNION ALL
SELECT 'identity_sequences service_role SELECT', 'identity_sequences', 'grant',
       EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'identity_sequences' AND grantee = 'service_role' AND privilege_type = 'SELECT'),
       NULL
UNION ALL
SELECT 'identity_sequences service_role INSERT', 'identity_sequences', 'grant',
       EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'identity_sequences' AND grantee = 'service_role' AND privilege_type = 'INSERT'),
       NULL
UNION ALL
SELECT 'account_categories.parent_id', 'account_categories', 'column',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'account_categories' AND column_name = 'parent_id'),
       (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'account_categories' AND column_name = 'parent_id')
UNION ALL
SELECT 'account_categories parent index', 'account_categories', 'index',
       EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'account_categories' AND indexname = 'account_categories_parent_idx'),
       NULL
UNION ALL
SELECT 'account_categories_no_self_parent', 'account_categories', 'constraint',
       EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_categories_no_self_parent' AND conrelid = to_regclass('public.account_categories')),
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_categories_no_self_parent' AND conrelid = to_regclass('public.account_categories'))
            THEN pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'account_categories_no_self_parent' AND conrelid = to_regclass('public.account_categories')))
            ELSE NULL END
UNION ALL
SELECT 'accounts.is_system', 'accounts', 'column',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'is_system'),
       (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'is_system')
UNION ALL
SELECT 'delivery_orders.is_settled', 'delivery_orders', 'column',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_orders' AND column_name = 'is_settled'),
       (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_orders' AND column_name = 'is_settled')
UNION ALL
SELECT 'delivery_orders.ordered_qty', 'delivery_orders', 'column',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_orders' AND column_name = 'ordered_qty'),
       (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_orders' AND column_name = 'ordered_qty')
UNION ALL
SELECT 'delivery_orders.delivered_qty', 'delivery_orders', 'column',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_orders' AND column_name = 'delivered_qty'),
       (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_orders' AND column_name = 'delivered_qty')
UNION ALL
SELECT 'delivery_orders.returned_qty', 'delivery_orders', 'column',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_orders' AND column_name = 'returned_qty'),
       (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_orders' AND column_name = 'returned_qty')
UNION ALL
SELECT 'delivery_orders_settled_idx', 'delivery_orders', 'index',
       EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'delivery_orders' AND indexname = 'delivery_orders_settled_idx'),
       NULL
UNION ALL
SELECT 'delivery_status_events.idempotency_key', 'delivery_status_events', 'column',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_status_events' AND column_name = 'idempotency_key'),
       (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_status_events' AND column_name = 'idempotency_key')
UNION ALL
SELECT 'delivery_events_idempotency_key_idx', 'delivery_status_events', 'index',
       EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'delivery_status_events' AND indexname = 'delivery_events_idempotency_key_idx'),
       NULL
UNION ALL
SELECT 'rider_cod_submissions.idempotency_key', 'rider_cod_submissions', 'column',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rider_cod_submissions' AND column_name = 'idempotency_key'),
       (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rider_cod_submissions' AND column_name = 'idempotency_key')
UNION ALL
SELECT 'cod_submissions_idempotency_key_idx', 'rider_cod_submissions', 'index',
       EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'rider_cod_submissions' AND indexname = 'cod_submissions_idempotency_key_idx'),
       NULL
UNION ALL
SELECT 'system accounts', 'accounts', 'data',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'is_system'),
       NULL;