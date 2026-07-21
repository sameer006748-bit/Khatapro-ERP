-- Phase 1 Foundation inspection (read-only).
-- Run this FIRST on project: ebcebxwpddltiwrqybqc
-- It must not modify any data or schema.
SELECT
  'products.commission_rate' AS object_name,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'commission_rate'
  ) AS exists,
  (SELECT data_type FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'commission_rate') AS type;

SELECT
  'products.commission_rate_non_negative' AS object_name,
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commission_rate_non_negative'
      AND conrelid = 'public.products'::regclass
  ) AS exists,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commission_rate_non_negative'
      AND conrelid = 'public.products'::regclass
  ) THEN pg_get_constraintdef(
    (SELECT oid FROM pg_constraint
     WHERE conname = 'commission_rate_non_negative'
       AND conrelid = 'public.products'::regclass)
  ) ELSE NULL END AS definition;

SELECT 'invoice_items.returned_qty' AS object_name,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoice_items' AND column_name = 'returned_qty') AS exists,
  (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoice_items' AND column_name = 'returned_qty') AS type;

SELECT 'invoice_items.original_invoice_item_id' AS object_name,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoice_items' AND column_name = 'original_invoice_item_id') AS exists,
  (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoice_items' AND column_name = 'original_invoice_item_id') AS type;

SELECT 'sales_returns.idempotency_key' AS object_name,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_returns' AND column_name = 'idempotency_key') AS exists,
  (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_returns' AND column_name = 'idempotency_key') AS type;

SELECT 'commission_events table' AS object_name,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'commission_events') AS exists;

SELECT 'identity_sequences table' AS object_name,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'identity_sequences') AS exists;

SELECT 'account_categories.parent_id' AS object_name,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'account_categories' AND column_name = 'parent_id') AS exists,
  (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'account_categories' AND column_name = 'parent_id') AS type;

SELECT 'account_categories_no_self_parent' AS object_name,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_categories_no_self_parent' AND conrelid = 'public.account_categories'::regclass) AS exists,
  CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_categories_no_self_parent' AND conrelid = 'public.account_categories'::regclass)
       THEN pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'account_categories_no_self_parent' AND conrelid = 'public.account_categories'::regclass))
       ELSE NULL END AS definition;

SELECT 'accounts.is_system' AS object_name,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'is_system') AS exists,
  (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'is_system') AS type;

SELECT 'delivery_orders.is_settled' AS object_name,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_orders' AND column_name = 'is_settled') AS exists,
  (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_orders' AND column_name = 'is_settled') AS type;

SELECT 'delivery_orders.ordered_qty' AS object_name,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_orders' AND column_name = 'ordered_qty') AS exists,
  (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_orders' AND column_name = 'ordered_qty') AS type;

SELECT 'delivery_orders.delivered_qty' AS object_name,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_orders' AND column_name = 'delivered_qty') AS exists,
  (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_orders' AND column_name = 'delivered_qty') AS type;

SELECT 'delivery_orders.returned_qty' AS object_name,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_orders' AND column_name = 'returned_qty') AS exists,
  (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_orders' AND column_name = 'returned_qty') AS type;

SELECT 'delivery_status_events.idempotency_key' AS object_name,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_status_events' AND column_name = 'idempotency_key') AS exists,
  (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_status_events' AND column_name = 'idempotency_key') AS type;

SELECT 'rider_cod_submissions.idempotency_key' AS object_name,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rider_cod_submissions' AND column_name = 'idempotency_key') AS exists,
  (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rider_cod_submissions' AND column_name = 'idempotency_key') AS type;

SELECT 'commission_events RLS' AS object_name,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'commission_events' AND rowsecurity = true) AS exists;

SELECT 'identity_sequences RLS' AS object_name,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'identity_sequences' AND rowsecurity = true) AS exists;

SELECT 'commission_events_select_own' AS object_name,
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'commission_events' AND policyname = 'commission_events_select_own') AS exists;

SELECT 'identity_sequences_select_own' AS object_name,
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'identity_sequences' AND policyname = 'identity_sequences_select_own') AS exists;

SELECT 'commission_events anon' AS object_name,
  has_table_privilege('anon', 'public.commission_events', 'SELECT') AS anon_select,
  has_table_privilege('anon', 'public.commission_events', 'INSERT') AS anon_insert;

SELECT 'commission_events authenticated' AS object_name,
  has_table_privilege('authenticated', 'public.commission_events', 'SELECT') AS authenticated_select,
  has_table_privilege('authenticated', 'public.commission_events', 'INSERT') AS authenticated_insert;

SELECT 'commission_events service_role' AS object_name,
  has_table_privilege('service_role', 'public.commission_events', 'SELECT') AS service_role_select,
  has_table_privilege('service_role', 'public.commission_events', 'INSERT') AS service_role_insert;

SELECT 'identity_sequences anon' AS object_name,
  has_table_privilege('anon', 'public.identity_sequences', 'SELECT') AS anon_select,
  has_table_privilege('anon', 'public.identity_sequences', 'INSERT') AS anon_insert;

SELECT 'identity_sequences authenticated' AS object_name,
  has_table_privilege('authenticated', 'public.identity_sequences', 'SELECT') AS authenticated_select,
  has_table_privilege('authenticated', 'public.identity_sequences', 'INSERT') AS authenticated_insert;

SELECT 'identity_sequences service_role' AS object_name,
  has_table_privilege('service_role', 'public.identity_sequences', 'SELECT') AS service_role_select,
  has_table_privilege('service_role', 'public.identity_sequences', 'INSERT') AS service_role_insert;

SELECT 'system accounts' AS object_name,
  COUNT(*) FILTER (WHERE is_system = true) AS system_account_count,
  COUNT(*) FILTER (WHERE is_system = true AND name = 'Rider Held COD') AS rider_held_cod_count
FROM public.accounts;
</parameter2name>
<task_progress>
- [x] Read failed migration
- [x] Identify invalid syntax: ADD CONSTRAINT IF NOT EXISTS
- [x] Create read-only inspection SQL
- [ ] Repair migration 00014 with DO $$ blocks
- [ ] Update tests for PostgreSQL compatibility
- [ ] Run final checks
- [ ] Commit, push
- [ ] Present recovery instructions
</parameter2name>
</write_to_file>