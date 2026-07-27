# KhataPro ERP — Production UUID Ledger Closeout

**Date:** 2026-07-27  
**Branch:** `fix/backend-stock-recovery`  
**Starting HEAD:** `9cd8511627816f3c43ea4e11d7fa40de3c76c430`  
**Scope:** additive production-compatible double-entry engine; no push, deploy, database migration, or historical backfill.

## Production discovery and canonical decision

Read-only production discovery established:

- `public.businesses` exists and `businesses.id` is UUID.
- `public.profiles`, `public.business_money_accounts`, and `public.business_money_transactions` exist.
- Both `business_money_*` tables had zero rows at inspection time.
- Legacy `public.business`, `public.accounts`, `public.account_categories`, `public.vouchers`, and `public.voucher_lines` are absent.
- Migration `00013` is applied; only Opening Stock production verification remains pending.

The safe target is a separate UUID model: `ledger_account_categories`, `ledger_accounts`, `ledger_voucher_sequences`, `ledger_vouchers`, and `ledger_voucher_lines`. No legacy accounting table is recreated.

## Canonical invariants

- Business scope is a UUID foreign-key chain rooted at `businesses(id)`.
- Amounts are whole paisas in `numeric(20,0)`; no float calculations are used.
- Every line has exactly one positive debit or credit; every voucher has at least two lines and balances.
- Account, voucher, and line composite foreign keys reject cross-business joins.
- Readable numbers, source identity, and idempotency keys are unique per business.
- A canonical fingerprint makes same-key/same-payload return the original voucher and same-key/changed-payload fail.
- Posting and identity allocation share one transaction; rollback cannot leave an orphan number, voucher, or line.
- Posted vouchers and lines are immutable. Corrections use a new reversal voucher.
- Direct `anon`/`authenticated` mutations and posting execution are revoked; service-side actor validation is required.
- System accounts cannot be archived or reclassified across financial-statement classes.

## System chart

| Code | Account | Class | Purpose |
|---|---|---|---|
| 1010 / 1020 / 1030 / 1040 | Cash / Bank / Wallet / Petty Cash | Asset | Operational money |
| 1100 / 1200 / 1300 | Inventory / Accounts Receivable / Rider Held COD | Asset | Stock, customer credit, rider-held collection |
| 2010 / 2020 / 2030 | Accounts Payable / Rider Settlement Payable / Salesman Commission Payable | Liability | Proven current obligations |
| 3010 / 3020 / 3030 / 3031 | Owner Capital / Owner Drawings / Opening Balance Equity / Current Earnings | Equity | Capital, drawings, opening and calculated earnings |
| 4000 / 4010 | Sales / Other Income | Income | Revenue |
| 5000 / 5090 | Cost of Goods Sold / Inventory Adjustment | Cost or Expense | Stock value effects |
| 6000 / 6010 / 6020 | General / Commission / Delivery Expense | Expense | Operating costs |

Seeding is idempotent for every existing business and inserts no financial amount.

## Posting matrix

| Workflow | Debit | Credit | Status |
|---|---|---|---|
| Manual receipt | Cash/Bank/Wallet | selected account | Connected |
| Manual payment | selected account | Cash/Bank/Wallet | Connected |
| Journal voucher | supplied balanced lines | supplied balanced lines | Connected |
| Expense batch | expense lines | payment account | Connected |
| Internal transfer | destination money account | source money account | Connected |
| Capital introduced | selected money account | Owner Capital | Connected |
| Owner drawing | Owner Drawings | selected money account | Connected |
| Sale, paid portion | payment accounts | Sales | Connected |
| Sale, unpaid portion | Accounts Receivable | Sales | Connected |
| Sale cost | Cost of Goods Sold | Inventory | Connected where sale-time cost exists |
| Collection-earned commission | Commission Expense | Commission Payable | Connected to approved commission events |
| Linked sale return | Sales | customer credit or Cash/Bank refund | Connected |
| Return cost reversal | Inventory | Cost of Goods Sold | Connected |
| Return commission reversal | Commission Payable | Commission Expense | Connected |
| Invoice collection | Cash/Bank/Wallet | Accounts Receivable | Connected |
| COD delivery collection | Rider Held COD | Accounts Receivable | Connected; delivery does not debit business cash |
| Rider COD settlement | actual Cash/Bank/Wallet | Rider Held COD | Connected |
| Opening stock | Inventory | Opening Balance Equity | Connected; live verification pending |
| Purchase / Purchase Return | — | — | Blocked: production row/cost/settlement shapes were not sufficiently proven for a safe atomic bridge |
| General stock adjustment | — | — | Blocked: approved gain/loss source semantics and exact operational mutation shape remain unverified |

All connected operational wrappers execute the existing operational RPC and the canonical ledger post in the same PostgreSQL transaction. UI mutation keys remain stable across retry and rotate only for a new action.

## Reports rebuilt

Migration `00030` provides canonical General Ledger, Trial Balance, Profit & Loss, Balance Sheet, Account Balances, and Day Book functions. They consume only `ledger_vouchers`/`ledger_voucher_lines`/`ledger_accounts`, preserve readable identities, apply business and date scope, and expose UUID subcategory grouping. Balance Sheet Current Earnings is calculated from cumulative canonical income and expense; there is no active app-side patch or legacy-table fallback.

## Account subcategories

Migration `00021` preserves the original user-work intent but stores an unsafe text account reference. Migration `00029` supersedes that linkage with `account_id UUID`, a composite same-business foreign key to `ledger_accounts`, report-class validation, audit, one-level grouping, archived-history support, and presentation-only reclassification. Any unresolved legacy text assignment is a migration stop condition.

## Migrations created

- `00025_production_uuid_ledger.sql` plus inspection
- `00026_seed_ledger_system_chart.sql` plus inspection
- `00027_atomic_ledger_posting.sql` plus inspection
- `00028_owner_money_to_uuid_ledger.sql` plus inspection
- `00029_ledger_account_subcategories.sql` plus inspection
- `00030_uuid_ledger_reports.sql` plus inspection
- `00031_verified_workflows_to_uuid_ledger.sql` plus inspection
- `00032_uuid_ledger_reconciliation.sql` plus inspection
- `supabase/reconciliation/UUID_LEDGER_MANUAL_BACKFILL_TEMPLATE.sql`

**Migrations applied: NO.**

## Historical reconciliation policy

`ledger_reconciliation(business_id, mode)` is aggregate-only and exposes counts, date ranges, missing/duplicate/malformed candidates, proposed totals, and invariants without customer PII or raw source payloads. `DRY_RUN_ONLY` is the only executable mode. `MANUAL_APPROVED_BACKFILL` raises until a future, separately reviewed approval. The template also raises before mutation and ends in rollback. No source row is silently rewritten and no historical voucher is fabricated automatically.

## Static validation

- Focused UUID-ledger, subcategory, owner-money, opening-stock, sales/return, and rider suites: **68/69 pass**; the one failure is a historical Phase 2 SQL-text regex, not a ledger behavior regression.
- Full suite: **312/319 pass**. The seven failures are the two expected “no migrations changed” guards, the same stale Phase 2 SQL-text regex, and four pre-existing Phase 8 compatibility assertions against the repository’s Phase 16 boundary.
- Targeted ESLint on changed application files: pass.
- TypeScript: the four allowed, unchanged historical errors remain (three `TS2741` product mappings and one `TS2367` phase literal).
- `git diff --check` excluding preserved `.env`, `task_progress.md`, and `graphify-out/`: pass.
- Production build: pass after external Google Font access was enabled.
- Database execution: not performed.
- Authenticated browser/UAT: not performed.

## Controlled migration and UAT gate

Follow `CLIENT-REQUIREMENTS-MIGRATION-INSTRUCTIONS.md` exactly. In a disposable production-shaped database:

1. Apply migrations `00014` through `00032` in numeric order and run every inspection immediately.
2. Stop on any non-green inspection, unresolved text account reference, unexpected legacy table, cross-business row, imbalance, or unexplained reconciliation total.
3. Run dry reconciliation for all four businesses before considering any manual history proposal.
4. Exercise valid/unbalanced/cross-business/inactive-account posts, retry and changed-payload conflict, concurrent identities, rollback, and reversal.
5. Exercise Contra, Capital, Drawings, all sale types and payment states, linked return, invoice collection, COD delivery/settlement, expenses, and Opening Stock.
6. Reconcile General Ledger, Trial Balance, P&L, Balance Sheet, Account Balances, and Day Book to the same vouchers.
7. Verify Owner/Admin/Accountant access and restricted-role denial with authenticated sessions.
8. Verify Opening Stock quantity, WAC, inventory value, voucher, retry result, and rollback. It remains production-unverified.

## Residual risks

The highest remaining accounting risk is runtime compatibility of the operational RPCs wrapped by migration `00031`, especially the not-yet-applied Phase 2 sale/return functions. Static schema evidence is strong, but only controlled PostgreSQL execution can prove their signatures, row shapes, locks, and rollback behavior together.

Purchase, Purchase Return, and general stock-adjustment ledger integration remain intentionally blocked rather than guessed. Commission Settlement remains absent and was not invented. Runtime status must not be marked COMPLETE until controlled database and authenticated UAT evidence exists.

## Delivery status

- Safe for controlled dev migration testing: **YES, sequentially with inspection and stop conditions.**
- Safe for production application now: **NO; runtime migration/UAT evidence is pending.**
- Historical backfill executed: **NO.**
- Pushed: **NO.**
- Deployed: **NO.**
