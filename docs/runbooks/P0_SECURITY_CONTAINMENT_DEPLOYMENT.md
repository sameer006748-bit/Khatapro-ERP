# P0 Security Containment Deployment

## Purpose and scope

This runbook packages the clone-validated emergency containment for the live findings covering broad report/mutation RPC execution, direct profile UPDATE grants, vendor-payment tenant/vendor/overpayment trust, and purchase-return source/account trust. It does not repair historical financial data, change posting RPC bodies, alter UI behavior, or deploy migration `00009_phase9_discount_support.sql`.

Expected live Supabase project ref: `ebcebxwpddltiwrqybqc`.

The application currently calls the classified RPCs through a server-side `service_role` boundary. The migration therefore removes PUBLIC/`anon`/`authenticated` execution from 41 exact signatures while explicitly retaining `service_role` execution. Schedule a maintenance window because the three new guards briefly acquire schema locks and vendor/return posting must be smoke-tested before reopening traffic.

## Prerequisites

- Approved incident/change ticket, named deployer, peer reviewer, incident commander, and rollback owner.
- Repository checked out at the reviewed containment commit; no local edits to either SQL file.
- Confirm the approved destination is project ref `ebcebxwpddltiwrqybqc`. Stop on any mismatch.
- PostgreSQL client tools available and `psql` configured to fail rather than prompt for a password.
- An approved placeholder connection variable named `KHATAPRO_APPROVED_DATABASE_URL` available only in the operator session. Never print it, write it to a report, or substitute another database variable.
- A schema backup stored under `%USERPROFILE%\Documents\KhataPro-Backups\P0-PreContainment-<YYYYMMDD-HHMMSS>\`, with its hash and restore-list validation recorded in the incident log.
- A full-data backup or provider point-in-time recovery checkpoint is strongly recommended before deployment. Encrypt and retain it under the organization backup policy; do not put it in Git.
- A maintenance window with sale, receipt, vendor-payment, purchase-return, delivery/COD, voucher, and reporting owners available for smoke testing.
- Migration 00009 must be absent and must remain unapplied throughout this deployment.

## Pre-deployment read-only checks

Run the following through an approved read-only session. All Boolean results must be `true`, `target_signature_count` must be `41`, and every `missing_signature` result set must be empty. Stop on any difference.

```sql
BEGIN READ ONLY;

SELECT current_database() AS database_name,
       current_user AS connected_role,
       inet_server_addr() AS server_address,
       pg_is_in_recovery() AS is_replica;

SELECT to_regclass('public.receipt_allocations') IS NULL AS receipt_allocations_absent,
       NOT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name IN ('invoices', 'receipts')
           AND column_name = 'idempotency_key'
       ) AS idempotency_columns_absent,
       NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('_block_receipt_allocation_update', '_block_receipt_allocation_delete',
                             '_post_salesman_collection_commission', '_require_posting_auth')
       ) AS migration_00009_functions_absent,
       to_regprocedure('public.post_sale(text,text,date,jsonb,jsonb,text,text,text,text,text,text,text,uuid)') IS NOT NULL
         AS old_post_sale_present,
       to_regprocedure('public.post_receipt_voucher(text,date,text,text,numeric,text,text,text,uuid)') IS NOT NULL
         AS old_post_receipt_present;

WITH target(signature) AS (VALUES
  ('public.account_ledger(text,text,date,date)'),
  ('public.day_book(text,date,date,text)'),
  ('public.negative_stock_report(text)'),
  ('public.pending_stock_report(text)'),
  ('public.report_balance_sheet(text,date)'),
  ('public.report_cash_flow(text,date,date)'),
  ('public.report_customer_outstanding(text)'),
  ('public.report_expense_summary(text,date,date)'),
  ('public.report_inventory_valuation(text)'),
  ('public.report_profit_loss(text,date,date)'),
  ('public.report_sales_summary(text,date,date)'),
  ('public.report_vendor_outstanding(text)'),
  ('public.rider_dashboard_summary(text,text)'),
  ('public.rider_ledger(text,text,date,date)'),
  ('public.trial_balance(text,date,date)'),
  ('public.vendor_ledger(text,text,date,date)'),
  ('public.assign_rider_to_order(text,text,text,uuid)'),
  ('public.cancel_voucher(text,uuid,text)'),
  ('public.confirm_cod_submission(text,text,numeric,text,numeric,text,uuid)'),
  ('public.create_cod_submission(text,text,jsonb,text,numeric,text,uuid)'),
  ('public.create_stock_movement(text,text,text,integer,text,date,uuid,numeric)'),
  ('public.mark_order_delivered(text,text,numeric,text,text,uuid)'),
  ('public.mark_order_returned(text,text,text,uuid)'),
  ('public.post_advance_application(text,text,text,numeric,date,text,uuid)'),
  ('public.post_contra_entry(text,date,text,text,numeric,text,text,uuid)'),
  ('public.post_expense_batch(text,date,text,jsonb,text,text,uuid)'),
  ('public.post_journal_voucher(text,date,text,jsonb,text,uuid)'),
  ('public.post_payment_voucher(text,date,text,text,numeric,text,text,text,uuid)'),
  ('public.post_purchase(text,text,date,text,jsonb,jsonb,numeric,numeric,text,uuid)'),
  ('public.post_purchase_replacement(text,text,jsonb,date,text,uuid)'),
  ('public.post_purchase_return(text,text,jsonb,text,text,date,text,uuid)'),
  ('public.post_receipt_voucher(text,date,text,text,numeric,text,text,text,uuid)'),
  ('public.post_sale(text,text,date,jsonb,jsonb,text,text,text,text,text,text,text,uuid)'),
  ('public.post_sales_return(text,text,date,text,uuid)'),
  ('public.post_vendor_advance(text,text,text,numeric,date,text,uuid)'),
  ('public.post_vendor_payment(text,text,text,numeric,date,text,text,uuid)'),
  ('public.post_voucher(text,text,date,text,jsonb,text,text,uuid)'),
  ('public.recalculate_product_cost(text)'),
  ('public.reject_cod_submission(text,text,uuid,text)'),
  ('public.reverse_voucher_safe(text,text,uuid,text)'),
  ('public.update_delivery_status(text,text,text,text,uuid)')
)
SELECT count(*) AS target_signature_count,
       count(*) FILTER (WHERE to_regprocedure(signature) IS NULL) AS missing_signature_count
FROM target;

WITH required(table_name, column_name) AS (VALUES
  ('profiles','display_name'), ('profiles','phone'),
  ('purchases','id'), ('purchases','business_id'), ('purchases','vendor_id'), ('purchases','outstanding_amount'),
  ('purchase_payments','purchase_id'), ('purchase_payments','business_id'), ('purchase_payments','vendor_id'),
  ('purchase_payments','amount'), ('purchase_payments','payment_type'),
  ('purchase_returns','id'), ('purchase_returns','business_id'), ('purchase_returns','purchase_id'),
  ('purchase_returns','settlement_type'), ('purchase_returns','settlement_account_id'),
  ('purchase_items','id'), ('purchase_items','business_id'), ('purchase_items','purchase_id'),
  ('purchase_items','product_id'), ('purchase_items','unit_cost'), ('purchase_items','quantity'),
  ('purchase_items','returned_quantity'),
  ('purchase_return_items','purchase_return_id'), ('purchase_return_items','purchase_item_id'),
  ('purchase_return_items','product_id'), ('purchase_return_items','unit_cost'),
  ('purchase_return_items','quantity'), ('purchase_return_items','business_id'),
  ('accounts','id'), ('accounts','business_id'), ('accounts','is_active')
)
SELECT r.table_name, r.column_name
FROM required r
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = r.table_name
 AND c.column_name = r.column_name
WHERE c.column_name IS NULL;

SELECT rolname
FROM (VALUES ('anon'), ('authenticated'), ('service_role')) expected(rolname)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = expected.rolname);

SELECT t.tgname, c.relname AS table_name, p.proname AS function_name,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND t.tgname IN ('contain_purchase_payment_tenant', 'contain_purchase_return_header',
                   'contain_purchase_return_item');

ROLLBACK;
```

If the containment trigger query returns rows, each must be the expected enabled `BEFORE INSERT FOR EACH ROW` trigger on, respectively, `purchase_payments`, `purchase_returns`, and `purchase_return_items`. The migration independently enforces the same condition and aborts on a name collision.

## Backup

Create and validate a schema-only custom-format backup in the approved path. Record the command, destination, SHA-256, tool version, start/end time, and `pg_restore --list` result in the incident log. Take or confirm a full-data backup/provider recovery point as well. Do not continue if either the approved recovery control or its owner is unavailable.

## Apply

From the repository root, execute exactly:

```powershell
psql --dbname="$env:KHATAPRO_APPROVED_DATABASE_URL" -X -w -v ON_ERROR_STOP=1 --file="supabase/migrations/00008k_p0_security_containment.sql"
```

The SQL is transactional, uses a 5-second lock timeout and 30-second statement timeout, and has no `CASCADE`. Any error must leave the deployment unapplied. Do not rerun until the incident log identifies whether the failure was a transient lock or a schema/preflight mismatch.

## Post-deployment checks

Run these checks immediately. The object-count query is an inventory signal; compare tables/policies with the pre-deployment capture and expect exactly three additional functions and three additional triggers.

```sql
BEGIN READ ONLY;

SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p')) AS public_tables,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public') AS public_functions,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND NOT t.tgisinternal) AS public_triggers,
  (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public') AS public_policies;

WITH classified(kind, signature) AS (VALUES
  ('report','public.account_ledger(text,text,date,date)'),
  ('report','public.day_book(text,date,date,text)'),
  ('report','public.negative_stock_report(text)'),
  ('report','public.pending_stock_report(text)'),
  ('report','public.report_balance_sheet(text,date)'),
  ('report','public.report_cash_flow(text,date,date)'),
  ('report','public.report_customer_outstanding(text)'),
  ('report','public.report_expense_summary(text,date,date)'),
  ('report','public.report_inventory_valuation(text)'),
  ('report','public.report_profit_loss(text,date,date)'),
  ('report','public.report_sales_summary(text,date,date)'),
  ('report','public.report_vendor_outstanding(text)'),
  ('report','public.rider_dashboard_summary(text,text)'),
  ('report','public.rider_ledger(text,text,date,date)'),
  ('report','public.trial_balance(text,date,date)'),
  ('report','public.vendor_ledger(text,text,date,date)'),
  ('mutation','public.assign_rider_to_order(text,text,text,uuid)'),
  ('mutation','public.cancel_voucher(text,uuid,text)'),
  ('mutation','public.confirm_cod_submission(text,text,numeric,text,numeric,text,uuid)'),
  ('mutation','public.create_cod_submission(text,text,jsonb,text,numeric,text,uuid)'),
  ('mutation','public.create_stock_movement(text,text,text,integer,text,date,uuid,numeric)'),
  ('mutation','public.mark_order_delivered(text,text,numeric,text,text,uuid)'),
  ('mutation','public.mark_order_returned(text,text,text,uuid)'),
  ('mutation','public.post_advance_application(text,text,text,numeric,date,text,uuid)'),
  ('mutation','public.post_contra_entry(text,date,text,text,numeric,text,text,uuid)'),
  ('mutation','public.post_expense_batch(text,date,text,jsonb,text,text,uuid)'),
  ('mutation','public.post_journal_voucher(text,date,text,jsonb,text,uuid)'),
  ('mutation','public.post_payment_voucher(text,date,text,text,numeric,text,text,text,uuid)'),
  ('mutation','public.post_purchase(text,text,date,text,jsonb,jsonb,numeric,numeric,text,uuid)'),
  ('mutation','public.post_purchase_replacement(text,text,jsonb,date,text,uuid)'),
  ('mutation','public.post_purchase_return(text,text,jsonb,text,text,date,text,uuid)'),
  ('mutation','public.post_receipt_voucher(text,date,text,text,numeric,text,text,text,uuid)'),
  ('mutation','public.post_sale(text,text,date,jsonb,jsonb,text,text,text,text,text,text,text,uuid)'),
  ('mutation','public.post_sales_return(text,text,date,text,uuid)'),
  ('mutation','public.post_vendor_advance(text,text,text,numeric,date,text,uuid)'),
  ('mutation','public.post_vendor_payment(text,text,text,numeric,date,text,text,uuid)'),
  ('mutation','public.post_voucher(text,text,date,text,jsonb,text,text,uuid)'),
  ('mutation','public.recalculate_product_cost(text)'),
  ('mutation','public.reject_cod_submission(text,text,uuid,text)'),
  ('mutation','public.reverse_voucher_safe(text,text,uuid,text)'),
  ('mutation','public.update_delivery_status(text,text,text,text,uuid)')
)
SELECT role_name, kind, count(*) FILTER (WHERE has_function_privilege(role_name, signature, 'EXECUTE')) AS executable
FROM classified
CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) roles(role_name)
GROUP BY role_name, kind
ORDER BY role_name, kind;

SELECT count(*) AS public_executable_security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND has_function_privilege('public', p.oid, 'EXECUTE');

SELECT has_table_privilege('anon', 'public.profiles', 'UPDATE') AS anon_table_update,
       has_table_privilege('authenticated', 'public.profiles', 'UPDATE') AS authenticated_table_update,
       has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE') AS authenticated_display_update,
       has_column_privilege('authenticated', 'public.profiles', 'phone', 'UPDATE') AS authenticated_phone_update,
       has_column_privilege('authenticated', 'public.profiles', 'role_id', 'UPDATE') AS authenticated_role_update,
       has_table_privilege('service_role', 'public.profiles', 'UPDATE') AS service_role_table_update;

SELECT p.proname,
       has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('_contain_purchase_payment_tenant', '_contain_purchase_return_header',
                    '_contain_purchase_return_item')
ORDER BY p.proname;

SELECT to_regclass('public.receipt_allocations') IS NULL AS receipt_allocations_absent,
       to_regprocedure('public._require_posting_auth(text,text,uuid)') IS NULL AS posting_auth_absent,
       to_regprocedure('public.post_sale(text,text,date,jsonb,jsonb,text,text,text,text,text,text,text,uuid)') IS NOT NULL
         AS old_post_sale_present,
       to_regprocedure('public.post_receipt_voucher(text,date,text,text,numeric,text,text,text,uuid)') IS NOT NULL
         AS old_post_receipt_present;

ROLLBACK;
```

Expected privilege transitions:

| Control | Before | After |
|---|---:|---:|
| PUBLIC-executable SECURITY DEFINER functions | 52 | 11 |
| `anon` mutation RPCs | 25 | 0 |
| `anon` report RPCs | 16 | 0 |
| `authenticated` mutation/report RPCs | 25/16 | 0/0 |
| `service_role` mutation/report RPCs | 25/16 | 25/16 |

The three containment trigger functions must report `false` for direct execution by PUBLIC, `anon`, `authenticated`, and `service_role`. The old 13-argument sale and 9-argument receipt signatures must remain present; all migration 00009 markers must remain absent.

## Application smoke tests

- Confirm anonymous and normal authenticated clients are denied `report_profit_loss`, `report_balance_sheet`, and representative mutation RPCs.
- Through the application server, open representative profit/loss and balance-sheet reports.
- Post and reverse a controlled voucher according to the production test protocol.
- Post a controlled sale and receipt without changing the current NextAuth + service-role caller path.
- Post a valid same-business vendor payment within outstanding; verify wrong-vendor, cross-business, and overpayment attempts are rejected transactionally.
- In two controlled sessions, contend on the same purchase and confirm the later-payment check serializes on the locked purchase and cannot overpay.
- Post a valid purchase return using a real source item and valid settlement account.
- Confirm forged/nonexistent/duplicate source items, product/cost substitution, excessive quantity, cross-business source, and cross-business settlement account are rejected.
- Confirm authenticated profile editing permits only `display_name` and `phone`; protected columns remain denied while service-side administration still works.
- Confirm `current_profile()`, `current_business_id()`, `has_permission(text)`, and `is_owner()` remain callable and business-scoped RLS reads still behave normally.
- Confirm no UI or responsive behavior changed; this package contains only SQL and documentation.

Use only approved, reversible production smoke fixtures and clean them up through normal application workflows. Do not repair the four historical over-return groups, 27 purchase outstanding inconsistencies, COD mismatches, or any other historical data during this deployment.

## Rollback decision and command

Rollback only with incident-commander approval when post-deployment privilege counts differ, required `service_role` paths fail, profile administration is blocked, a guard rejects a confirmed valid production workflow, or lock/latency impact cannot be safely mitigated. Do not roll back merely because known historical reconciliation candidates remain. Rollback deliberately reopens the captured pre-containment PUBLIC/role privileges, so restrict traffic while it is active and prepare a corrected forward containment before reopening.

Execute exactly from the repository root:

```powershell
psql --dbname="$env:KHATAPRO_APPROVED_DATABASE_URL" -X -w -v ON_ERROR_STOP=1 --file="supabase/rollback/00008k_p0_security_containment_rollback.sql"
```

After rollback, repeat the read-only inventory. Expect the three containment functions/triggers to be absent, profile column ACL residue to be absent, profile table UPDATE restored to `anon`/`authenticated`, and the captured privilege baseline restored. Preserve logs and take no further action until the incident commander decides whether to reapply or prepare a corrected migration.

## Remaining PUBLIC SECURITY DEFINER helpers

These eleven functions are intentionally unchanged in this emergency batch. Removing the four identity helpers without a dedicated RLS regression plan could break policy evaluation; the other helpers need caller mapping and authorization design before revocation.

| Function/signature | Why it remains PUBLIC now | RLS dependency | Numbering/bootstrap | Residual risk | Recommended future batch |
|---|---|---|---|---|---|
| `current_profile()` | Preserves the active-profile authentication contract. | Yes; identity/helper chain. | No. | SECURITY DEFINER identity lookup remains broadly callable, though it filters `auth.uid()` and `is_active`. | Identity/authorization and RLS contract hardening. |
| `current_business_id()` | Business-scoped policies directly depend on it. | Yes; direct policy dependency. | No. | Broad execution exposes the caller's resolved business context. | Identity/authorization and RLS contract hardening. |
| `has_permission(text)` | Permission-based policies require it. | Yes; direct policy dependency. | No. | Permission probing remains possible for the caller's JWT context. | Identity/authorization and RLS contract hardening. |
| `is_owner()` | Owner/admin policies require it. | Yes; direct policy dependency. | No. | Owner-state probing remains possible for the caller's JWT context. | Identity/authorization and RLS contract hardening. |
| `next_cod_submission_no(text)` | Caller mapping was outside the 41-RPC emergency classification. | No. | Numbering. | Caller-supplied business ID and concurrency/number disclosure surface. | Authorized, collision-safe numbering APIs. |
| `next_document_no(text,text,text,text)` | Dynamic generic helper needs a separate compatibility review. | No. | Numbering. | Caller-controlled business/table/column parameters create the largest residual numbering surface. | Remove dynamic identifiers; add allowlisted authorized numbering API. |
| `next_invoice_no(text)` | Required numbering caller mapping is not yet proven. | No. | Numbering. | Caller-supplied business ID and invoice-number disclosure/collision surface. | Authorized, collision-safe numbering APIs. |
| `next_purchase_no(text)` | Required numbering caller mapping is not yet proven. | No. | Numbering. | Caller-supplied business ID and purchase-number disclosure/collision surface. | Authorized, collision-safe numbering APIs. |
| `next_purchase_return_no(text)` | Required numbering caller mapping is not yet proven. | No. | Numbering. | Caller-supplied business ID and return-number disclosure/collision surface. | Authorized, collision-safe numbering APIs. |
| `next_replacement_no(text)` | Required numbering caller mapping is not yet proven. | No. | Numbering. | Caller-supplied business ID and replacement-number disclosure/collision surface. | Authorized, collision-safe numbering APIs. |
| `no_owner_exists()` | Initial-owner bootstrap semantics need a dedicated enrollment plan. | Bootstrap-related, not normal business RLS. | Bootstrap. | Publicly reveals whether the owner bootstrap condition exists. | Bootstrap lockdown and one-time enrollment controls. |

## Incident log requirements

Record the ticket/change ID; project ref; deployer/reviewer/incident commander; reviewed commit hash; maintenance-window start/end; client/server versions; backup path, hash, restore-list result and recovery-point ID; all pre/post query outputs; migration and rollback command exit codes; lock/statement timeout events; smoke-test cases and fixture identifiers; any exception text; rollback decision, approver and timestamps; final state; and explicit confirmation that migration 00009 remained unapplied. Never record passwords, connection strings, access tokens, service-role values, personal data, or financial row contents.
