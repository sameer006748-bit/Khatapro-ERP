# KhataPro ERP — Complex Accounting Gaps Closeout

**Date:** 2026-07-26
**Branch:** fix/backend-stock-recovery
**Starting HEAD:** 3227a50
**Scope:** Fix only the complex gaps verified by the read-only consolidated audit (rider partial delivery/COD, readable transaction identities, account subcategories, Contra/Capital/Drawings, Purchase Return, core accounting reports). No push, no deploy, no migrations applied to any database.

## Exact defects fixed

### 1. Rider delivery assignment authorization wiring
`assign_rider_to_order()` (migration 00007) only ever wrote `delivery_orders.rider_id`. The Phase 3+ rider workflows — `mark_cod_out_for_delivery`, `complete_cod_delivery`, `record_delivery_outcome`, `return_rider_delivery` (migrations 00017, 00019) — authorize against `invoices.rider_id`, which nothing in the codebase ever set. A correctly assigned rider was rejected by every one of those calls with "Invoice is not assigned to this rider."

**Fix:** migration `00022_rider_assignment_sync.sql` — `assign_rider_to_order()` now also updates `invoices.rider_id` to match, using the existing `delivery_orders.invoice_id` foreign key. `delivery_orders.rider_id` remains the single authoritative assignment; `invoices.rider_id` is a synced projection kept consistent on every assignment call, including reassignment. No new assignment UI, no second competing assignment path.

### 2. Rider COD balance partial-settlement reconciliation
`get_rider_cod_balances()`'s `oldest_outstanding_delivery_date` column used a heuristic: whether any *single* settlement row had `amount >= collection.amount`. Partial settlements against the same collection can span multiple `rider_cash_ledger` rows (one per settlement batch), so a collection fully settled via two or more partial installments was still counted as outstanding.

**Fix:** migration `00023_rider_cod_balance_reconciliation.sql` — replaced the single-row check with a per-entry sum of all settlement rows tied to that collection via `related_entry_id`. Collected/settled/outstanding totals, permission checks, and business-scope isolation are unchanged.

### 3. Purchase and Purchase Return numbering (Prisma fallback)
`postPurchaseViaPrisma()` and `postPurchaseReturn()`'s Prisma fallback path used an unsafe `findFirst(orderBy desc)` + regex + increment pattern — the same class of concurrency bug already fixed for Sales in commit `0f67a1f`, never mirrored here.

**Fix:** both now use the atomic `IdentitySequence.upsert()` pattern inside the existing `$transaction`, identical to the Sales implementation. No change to the Supabase RPC path, which was already hardened by migration 00020.

### 4. Contra/Capital/Drawing readable identity
`post_contra_transfer`, `post_owner_capital`, `post_owner_drawings` (migration 00018) generated references as `gen_random_uuid()` fragments (`CTR-`, `CAP-`, `DRW-`) instead of using `allocate_transaction_identity()` — the migration 00020 allocator every other transaction type uses. Migration 00020 declared `CONTRA_BATCH`/`CAPITAL_INTRODUCED`/`OWNER_DRAWING` prefixes but never rewired these three RPCs to call it.

**Fix:** modified migration `00018_contra_drawings.sql` directly (pre-application; this migration was never applied to any database, so editing it in place rather than layering a patch on top is safe and correct) to call `public.allocate_transaction_identity(p_business_id, '...')` for each of the three transaction kinds. No change to balance updates, locking, or idempotency behavior.

### 5. Purchase Return idempotency
`post_purchase_return()` had no idempotency parameter or unique constraint. A network retry of the same return request would create a second `purchase_returns` row, decrement stock a second time, and post the vendor settlement a second time. Sale Return already requires an `idempotencyKey` (`src/app/api/sales/[id]/return/route.ts`); Purchase Return had no equivalent.

**Fix:** migration `00024_purchase_return_idempotency.sql` adds an `idempotency_key`/`request_fingerprint` column pair and a unique index, and requires the key end to end: route schema (`idempotencyKey: z.string().uuid()`), `postPurchaseReturn()` data-access call, and the RPC itself. Same-key-same-payload returns the original result; same-key-different-payload is rejected with a `23505` conflict. Cumulative over-return protection, stock decrement, and vendor settlement logic are otherwise unchanged.

## Design decisions

- **Rider ownership stays single-sourced.** Rather than introducing a second assignment mechanism, `delivery_orders.rider_id` remains authoritative and `invoices.rider_id` is kept in sync by the same function that already owns assignment. This avoids two independently-mutable sources of rider ownership that could drift.
- **Contra/Capital/Drawings identity fix applied in place, not layered.** Migration 00018 was never applied to any database (confirmed: it is additive-only DDL guarded by existence checks, and no evidence exists anywhere in the repo, environment files, or deployment scripts that it has been run against a live database). Editing it directly is therefore equivalent to a not-yet-applied migration being corrected before first use, not a retroactive change to production history.
- **No speculative Commission Settlement feature.** Migration 00020 declares a `COMMISSION_SETTLEMENT` → `CMS` prefix, but no `commission_settlements` table, RPC, or route exists anywhere in the codebase. Per the audit's own instruction, this was confirmed absent and documented as a real future requirement rather than built speculatively.

## Migrations created

- `00022_rider_assignment_sync.sql`
- `00023_rider_cod_balance_reconciliation.sql`
- `00024_purchase_return_idempotency.sql`
- (`00018_contra_drawings.sql` was modified in place, not newly created — see above.)

**Migrations applied: NO.** None of migrations 00019 through 00024 have been applied to any database. All validation in this closeout is static (source-text assertions against the SQL) plus TypeScript compilation and a production build. No dev or staging database was available in this environment to execute and runtime-verify these migrations.

## What remains BLOCKED

### Phase 4 — Contra/Capital/Drawings double-entry integration (voucher posting)
**Not implemented.** Wiring `post_contra_transfer`/`post_owner_capital`/`post_owner_drawings` to also post a balanced voucher against `accounts`/`voucher_lines` requires knowing whether those tables exist, and in what form, in the current production schema. Evidence is contradictory:
- Migration `00014_phase1_foundation.sql`'s own header states: *"Uses only proven production tables. No Prisma-only tables (accounts, account_categories, delivery_orders, delivery_status_events, rider_cod_submissions) are referenced"* and *"No Rider Held COD account is created (no accounts table in production)."*
- Migration `00008i_fix_financial_statements.sql` (later than 00014) is entirely about fixing bugs in `report_profit_loss()` and `report_balance_sheet()`, both of which query `from public.accounts` directly, with no Prisma fallback in `src/lib/reports/data-access.ts`.

This contradiction was not resolved by inference. It requires running `select to_regclass('public.accounts'), to_regclass('public.vouchers'), to_regclass('public.voucher_lines');` against the actual production database and confirming the result before any accounting-bridge code is written.

### Phase 6 — Account Subcategories → Trial Balance/P&L/Balance Sheet wiring
**Not implemented**, blocked for the identical reason as Phase 4: `account_parent_report_class()` (migration 00021) exists as classification metadata, but wiring it into the report queries requires knowing which report implementation is actually live in production, which is exactly the unresolved question above.

## Tests

All focused suites for completed work pass:

| Suite | Result |
|---|---|
| `tests/rider-assignment-sync.test.ts` | 6/6 pass |
| `tests/rider-cod-balance-reconciliation.test.ts` | 6/6 pass |
| `tests/contra-drawings.test.ts` | 11/11 pass |
| `tests/purchase-return-idempotency.test.ts` | 8/8 pass |
| `tests/invoice-identity.test.ts` | pass (bounded reconciliation cross-check) |
| `tests/rider-partial-delivery.test.ts` | pass (bounded reconciliation cross-check) |
| Full suite (`tests/**/*.test.ts`) | 290/297 pass |

The 7 full-suite failures are not regressions from this work:
- 2 are static "no migration files changed since a fixed commit" guards, which correctly and expectedly trip now that migrations 00022–00024 were legitimately added.
- 5 (`rpc-compatibility.test.ts` / Phase 8-9 argument-count assertions) were confirmed pre-existing on the original `3227a50` HEAD via `git stash` before any of this session's changes were applied.

## Static vs. runtime evidence

Everything in this closeout is **static, source-level evidence**: SQL text assertions, TypeScript compilation, and a production build. Nothing was executed against a database. Before any of the fixed areas can be marked runtime-verified:
- Migrations 00019 through 00024 must be applied to a controlled dev/staging database and their inspect files run.
- Rider assignment → out-for-delivery → partial delivery → COD collection → settlement must be exercised end to end with a real assigned rider to confirm the `invoices.rider_id` sync actually unblocks the previously-failing authorization checks.
- Purchase and Purchase Return numbering must be exercised under concurrent requests to confirm no duplicate numbers are issued.
- Purchase Return idempotency must be exercised with a genuine duplicate network retry to confirm the same-key-same-payload path returns the original result rather than erroring.

## TypeScript, lint, build

- **TypeScript:** only the 4 pre-existing historical errors remain, unchanged: 3× `TS2741` in `src/lib/products/data-access.ts` (missing `commissionRatePaisas`), 1× `TS2367` in `src/lib/supabase/rpc-compatibility.ts`. No new errors introduced.
- **Build:** `npm run build` succeeds, exit code 0.
- **`git diff --check`:** clean on all touched files.

## Corrections carried forward

- Migration `00013` is applied. Only Opening Stock production verification (not migration 00013 itself) remains pending.
- No Commission Settlement workflow exists. This is documented as a real future requirement, not built speculatively.

## Risks and stop conditions

- **Highest remaining accounting risk:** Contra/Capital/Drawings currently posts to `business_money_transactions` only. If `public.accounts`/`voucher_lines` genuinely exist in production and are what Trial Balance/P&L/Balance Sheet/General Ledger actually read (per the `00008i` evidence), then every Contra transfer, Capital introduction, and Owner Drawing since migration 00018 was deployed is invisible in those four reports today, in production, right now — independent of anything in this closeout. This is a live discrepancy, not a hypothetical one, and resolving the accounts/vouchers schema question is the fastest path to knowing its true size.
- **Stop condition triggered and respected:** "a migration depends on a table absent from the verified schema" — this halted Phase 4 and Phase 6 exactly as instructed, rather than guessing.
- **Safe for controlled dev migration testing:** yes, for migrations 00022, 00023, and 00024 — each is additive, guarded by `to_regclass()` existence checks, and does not rewrite historical data. Recommend applying them in a disposable dev/staging copy of the schema first, in numeric order, and running each corresponding inspect query before promoting further.

## Push status

**NOT PUSHED.**
