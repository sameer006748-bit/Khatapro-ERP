# KhataPro ERP — Migration Instructions

**Last updated:** 2026-07-27

## Authoritative production UUID ledger sequence

Production inspection resolved the former accounting-schema contradiction:

- `businesses.id` is UUID and is the authoritative tenant key.
- Legacy `public.accounts`, `public.account_categories`, `public.vouchers`, and `public.voucher_lines` are absent.
- Migration `00013` is applied.
- Migrations `00014` onward remain unapplied.
- `business_money_accounts` and `business_money_transactions` exist but had zero production rows at inspection time.

No migration was applied during the UUID-ledger implementation. Use a disposable production-shaped database first. Apply each mutation migration and immediately run its paired inspection before continuing:

1. `00014_phase1_foundation.sql` -> `00014_phase1_foundation_inspect.sql`
2. `00015_phase2_accounting_discovery.sql` and `00015_phase2_rpc_discovery.sql` (discovery only)
3. `00016_phase2_returns_commission.sql`
4. `00017_phase3_rider_cod_settlement.sql` -> `00017_phase3_rider_cod_settlement_inspect.sql`
5. `00018_contra_drawings.sql` -> `00018_contra_drawings_inspect.sql`
6. `00019_rider_partial_delivery.sql` -> `00019_rider_partial_delivery_inspect.sql`
7. `00020_transaction_identity_coverage.sql` -> `00020_transaction_identity_coverage_inspect.sql`
8. `00021_account_subcategories.sql` -> `00021_account_subcategories_inspect.sql`
9. `00022_rider_assignment_sync.sql`
10. `00023_rider_cod_balance_reconciliation.sql`
11. `00024_purchase_return_idempotency.sql`
12. `00025_production_uuid_ledger.sql` -> `00025_production_uuid_ledger_inspect.sql`
13. `00026_seed_ledger_system_chart.sql` -> `00026_seed_ledger_system_chart_inspect.sql`
14. `00027_atomic_ledger_posting.sql` -> `00027_atomic_ledger_posting_inspect.sql`
15. `00028_owner_money_to_uuid_ledger.sql` -> `00028_owner_money_to_uuid_ledger_inspect.sql`
16. `00029_ledger_account_subcategories.sql` -> `00029_ledger_account_subcategories_inspect.sql`
17. `00030_uuid_ledger_reports.sql` -> `00030_uuid_ledger_reports_inspect.sql`
18. `00031_verified_workflows_to_uuid_ledger.sql` -> `00031_verified_workflows_to_uuid_ledger_inspect.sql`
19. `00032_uuid_ledger_reconciliation.sql` -> `00032_uuid_ledger_reconciliation_inspect.sql`

Migration `00021` remains in sequence because it creates the classification metadata, but its text `account_ref` linkage is not canonical. Migration `00029` supersedes that linkage with a business-scoped UUID foreign key to `ledger_accounts`; do not expose account-subcategory mutations between those two migrations.

Stop immediately if an inspect query is not wholly green, if an unproven legacy accounting table appears, if an unresolved subcategory reference remains, or if reconciliation totals do not explain. Do not run `supabase/reconciliation/UUID_LEDGER_MANUAL_BACKFILL_TEMPLATE.sql`: it intentionally raises before mutation and requires a separately reviewed, manually approved copy.

## Status correction

Migration `00013` is already applied. Do not treat it as pending. **Only Opening Stock production verification** (confirming migration 00012/00013's `post_opening_stock` RPC behaves correctly against live data) remains pending on project `ebcebxwpddltiwrqybqc`.

## Applied vs. not applied

Migrations `00001` through `00013` (and their lettered fix variants, e.g. `00006a`, `00008k`) are applied to production. Everything from `00014` onward — including `00017` through `00024` — has **not** been applied to any database as of this document. This has not changed as a result of the 2026-07-26 complex-accounting-gaps closeout work; no migration was applied during that session.

## Exact order for migrations 00019 through 00024

Apply in this numeric order, running each corresponding `_inspect.sql` file immediately after and confirming every row reads `ok = true` (or equivalent) before proceeding to the next:

1. `00019_rider_partial_delivery.sql` → `00019_rider_partial_delivery_inspect.sql`
2. `00020_transaction_identity_coverage.sql` (no separate inspect file; this migration seeds `identity_sequences` from existing readable numbers — confirm row counts look sane after applying)
3. `00021_account_subcategories.sql` → `00021_account_subcategories_inspect.sql`
4. `00022_rider_assignment_sync.sql` — new 2026-07-26. Replaces `assign_rider_to_order()` only; no new tables. Confirm by assigning a rider to a test delivery order and checking both `delivery_orders.rider_id` and `invoices.rider_id` were set to the same value.
5. `00023_rider_cod_balance_reconciliation.sql` — new 2026-07-26. Replaces `get_rider_cod_balances()` only; no new tables. Confirm by running a partial settlement against a test collection and checking `oldest_outstanding_delivery_date` no longer flags it once fully settled across multiple settlement rows.
6. `00024_purchase_return_idempotency.sql` — new 2026-07-26. Adds `idempotency_key`/`request_fingerprint` columns to `purchase_returns` and replaces `post_purchase_return()`. Confirm by submitting the same return request twice with the same key and verifying only one row is created.

`00018_contra_drawings.sql` was **modified in place** on 2026-07-26 (not re-numbered) to rewire its three RPCs onto the shared identity allocator introduced in `00020`. Since `00018` itself has never been applied, this is a correction to an unapplied migration, not a change to applied production history. If `00018` is applied at any point before this correction is picked up, re-pull the file before applying — do not apply an older cached copy.

## Resolved historical blocker (superseded)

The production query below was run during the 2026-07-27 read-only inspection and returned no legacy accounting tables. The old blocking text retained in this subsection is historical context only; it is not an active instruction. Migrations `00025` through `00032` implement the replacement UUID-scoped `ledger_*` model without recreating those absent tables.

Historical stop condition (now satisfied): Contra/Capital/Drawings and Account Subcategories were not to be wired into `public.accounts`/`public.vouchers`/`public.voucher_lines` until the following production query was resolved:

```sql
select to_regclass('public.accounts'),
       to_regclass('public.vouchers'),
       to_regclass('public.voucher_lines');
```

Migration `00014`'s header and the production query agree that these tables do not exist. The applied legacy report repair in `00008i_fix_financial_statements.sql` is therefore historical code, not proof of a deployed legacy ledger. Phase 4 and Phase 6 are now implemented on the replacement `ledger_*` model in migrations `00025` through `00032`; controlled execution and runtime verification remain pending.

## Commission Settlement

No `commission_settlements` table, RPC, or route exists in this codebase. Migration `00020` declares a `COMMISSION_SETTLEMENT` → `CMS` identity prefix, but nothing consumes it. Do not create migration scaffolding for this feature until an approved settlement workflow design exists — building the identity plumbing first would be speculative.
