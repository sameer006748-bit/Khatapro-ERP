# KhataPro ERP — Migration Instructions

**Last updated:** 2026-07-26

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

## Do not apply yet: blocked items

Do **not** attempt to build or apply a migration that wires Contra/Capital/Drawings or Account Subcategories into `public.accounts`/`public.vouchers`/`public.voucher_lines` until the following is resolved and confirmed against the live production database:

```sql
select to_regclass('public.accounts'),
       to_regclass('public.vouchers'),
       to_regclass('public.voucher_lines');
```

Migration `00014`'s header comment states these tables do not exist in production. Migration `00008i_fix_financial_statements.sql` (applied, and later than `00014`) fixes bugs in `report_profit_loss()`/`report_balance_sheet()`, both of which query `public.accounts` directly. This is an unresolved contradiction in the migration history itself, not a gap in this session's work — see `COMPLEX-ACCOUNTING-GAPS-CLOSEOUT.md` for full detail. Until the query above is run against production and the result recorded here, Phase 4 (double-entry voucher posting for Contra/Capital/Drawings) and Phase 6 (Account Subcategories → Trial Balance/P&L/Balance Sheet wiring) remain blocked.

## Commission Settlement

No `commission_settlements` table, RPC, or route exists in this codebase. Migration `00020` declares a `COMMISSION_SETTLEMENT` → `CMS` identity prefix, but nothing consumes it. Do not create migration scaffolding for this feature until an approved settlement workflow design exists — building the identity plumbing first would be speculative.
