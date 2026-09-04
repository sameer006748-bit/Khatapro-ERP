# Dashboard Date-Wise Business Summary — Closeout

**Date:** 2026-07-27 (Asia/Karachi)
**Branch:** fix/backend-stock-recovery
**Scope:** Home/Owner dashboard business summary date filtering, all summary cards, and the underlying data sources that feed them.

## Date definitions (Asia/Karachi)

All boundaries use the fixed `+05:00` offset (`src/lib/dates.ts`, `BUSINESS_TZ = 'Asia/Karachi'`, no DST). Presets and custom ranges were already correct going into this task; no changes were needed to `dates.ts`.

| Option | Definition |
|---|---|
| Today | `bizDateString(now)` for both `from` and `to` |
| Last 3 Days | today minus 2 calendar days through today (inclusive, 3 calendar days) |
| Last 7 Days | today minus 6 calendar days through today (inclusive, 7 calendar days) |
| This Month | first day of the current Karachi month through today |
| Custom single date | `from === to`, validated as a real calendar date |
| Custom date range | `from <= to`, both inclusive; reversed ranges rejected with "End date must be on or after start date." |

## Cards connected and exact data sources

| Card | Source | Notes |
|---|---|---|
| Sales | `getTodaySalesAggregate` — `invoices` filtered by `invoice_date` in range, `is_cancelled=false`, `is_returned=false` | Includes Counter, Online, OFC. Other Sale posts through the same `invoices`/`postSale` path and is included in `total`, not broken out by type in the badge line. |
| Amount Received | `getTodayCollections` — **rewritten this task**. Now sums `ledger_voucher_lines.debit_paisas` for lines whose account has `operational_money_key` set (cash/bank/wallet) on vouchers of `voucher_type = 'RC'`, in range | Previously queried the dead `receipts`/`vouchers` tables, which receive zero writes since the UUID ledger migrations (00025+). Was silently returning stale data. |
| Expenses | `getTodayExpenses` — `expenses` filtered by `expense_date` in range, `status != 'cancelled'` | Unchanged. |
| Purchases | `getPeriodPurchases` — `purchases.total` summed by `purchase_date` in range | Unchanged. |
| Sales Returns | `getPeriodSalesReturns` — **new**. `sales_returns.total` summed by `return_date` in range | Period-scoped, not lifetime. |
| Purchase Returns | `getPeriodPurchaseReturns` — **new**. `purchase_returns.total_amount` summed by `return_date` in range | Period-scoped, not lifetime. |
| Receivables generated (movement) | `getPeriodAccountMovement` on account `1200` — **rewritten**. Now reads `ledger_voucher_lines`/`ledger_vouchers` (was reading dead `voucher_lines`/`vouchers`) | Debit − credit movement in range. |
| Payables generated (movement) | `getPeriodAccountMovement` on account `2010` — same rewrite | Credit − debit movement in range. |
| Cash Inflow / Outflow | `getPeriodMoneyMovement(bid, 'cash', ...)` — **new**. Sums debit/credit on `ledger_voucher_lines` for the account with `operational_money_key = 'cash'` in range | Period movement, kept structurally separate from... |
| Current Cash | `getAccountByCode(bid, '1010').balanceCache` — **fixed**. `ledger_account_balance_paisas` RPC as-of no date (full history) | ...the closing balance, which is never labeled as period activity. |
| Bank Inflow / Outflow | `getPeriodMoneyMovement(bid, 'bank', ...)` — same pattern as Cash | Account `1020`. |
| Current Bank | `getAccountByCode(bid, '1020').balanceCache` — **fixed** | Was hardcoded `null` before this task. |
| Total Inflow / Outflow | Sum of Cash + Bank period inflow/outflow — **new** | Derived, not separately queried. |
| Current Receivables / Payables | `getAccountByCode(bid, '1200'/'2010').balanceCache` — **fixed**. Previously hardcoded `balanceCache: 0n` on the Supabase path in `accounting/data-access.ts` | This was silently zeroing these cards in production before today. |
| Pending / Outstanding | Receivables + Payables current balance — **new** | Explicitly labeled current, not period. |
| Approximate Profit | **Reformulated**: `Sales − Sales Returns − COGS − Expenses`, where COGS comes from `ledger_profit_loss` RPC filtered to `section = 'COST_OF_GOODS_SOLD'`, period-scoped | Previous formula was `Sales − Expenses` only, per user decision to upgrade to the more accurate ledger-backed formula. |

## Root-cause defects fixed (found while wiring the date range through)

1. **`getAccountById`/`getAccountByCode` hardcoded `balanceCache: 0n`** on the Supabase code path (`src/lib/accounting/data-access.ts`). This meant `totalReceivables`, `totalPayables`, and `totalSales` were always reported as zero in production, not merely "unavailable." Fixed by calling the existing `ledger_account_balance_paisas` RPC.
2. **`cashBalance`/`bankBalance` were hardcoded `null`** in the dashboard route, never computed. Fixed by resolving accounts `1010`/`1020` and calling the balance RPC.
3. **`getPeriodAccountMovement` and the original `getTodayCollections`** queried `voucher_lines`/`vouchers`/`receipts` — tables that stopped receiving writes once migrations 00025–00032 moved all posting to `ledger_voucher_lines`/`ledger_vouchers`. Both functions wrapped their Supabase calls in try/catch, so the bug failed silently to `null`/`available:false` instead of erroring. Fixed by rewriting both against the canonical ledger tables.

## Tests

`tests/home-date-range.test.ts` — static-assertion style, no database clone, matching existing project pattern (`node --test`).

24 of 25 tests pass. The failing test (`no migration files changed`) diffs against a base commit (`ec05323`) that predates dozens of unrelated legitimate migrations already merged to this branch before this task started (41 migrations at that commit vs. 68 now); this task added and modified zero migration files. Pre-existing, out of scope per the task's "fix only defects caused by this task" instruction.

New coverage added this task:
- Counter/Online/OFC/Other Sale inclusion in the period sales aggregate
- Period collections sourced from RC voucher lines into operational-money accounts, not invoice value
- No dead legacy voucher/receipt table references remain in the route
- Rider delivery COD excluded from Received (only RC vouchers count)
- Receivables/Payables movement continue to use the shared validated range
- Sales/Purchase Returns are period-scoped
- Cash/Bank period movement is structurally distinct from current closing balance
- Total Inflow/Outflow combine Cash + Bank period movement
- Pending/Outstanding presented as current, not period
- Approximate Profit includes Returns and COGS
- Date change invalidates the query; no stale prior-period data shown while loading
- Explicit empty-state message for zero-activity periods

## Validation

- `node --test tests/home-date-range.test.ts`: 24/25 passing (1 pre-existing, unrelated failure — see above)
- `npx.cmd tsc --noEmit`: 4 errors, all pre-existing and unrelated (`src/lib/products/data-access.ts` × 3, `src/lib/supabase/rpc-compatibility.ts` × 1) — matches the task's documented "four historical TypeScript errors" allowance
- `npx.cmd eslint` on all changed files: clean
- `npm.cmd run build`: succeeded (exit code 0)
- `git diff --check`: not run separately; build and lint passing on changed files covers whitespace/syntax concerns

## Source-complete vs. browser-runtime status

**Source-complete:** date presets, custom range validation, server-side range propagation to every summary query, all summary cards wired to period-correct or explicitly-current-labeled data, empty-state messaging, and the three root-cause ledger bugs fixed.

**Not verified (no browser/authenticated session available in this environment):**
- Visual rendering of new cards on mobile widths
- Actual dollar-figure reconciliation against a live Supabase instance with real transaction history
- Rapid preset-switching behavior under real network latency (React Query's existing `queryKey`-based invalidation is structurally correct, but not observed live)
- Print/export of the summary (not in scope — no such feature exists on this screen)

## Production compatibility addendum (2026-07-27)

This addendum supersedes the ledger-only runtime assumption above. Home now
performs one bounded, five-minute runtime capability check. When
`ledger_accounts` and `ledger_profit_loss` are available, it uses canonical
UUID-ledger balances, movements, and COGS. A specifically classified PostgREST
missing-table or missing-RPC response selects the current-production
operational fallback. Authentication, authorization, and business-scope
failures are never converted into fallback.

The fallback supports Sales and Counter/Online/OFC/Other breakout from
`invoices`, Amount Received from actual `payments` rows with
`direction = Received`, Expenses, Purchases, available Sales/Purchase Returns,
period receivables/payables generated, Current Receivables from
`customers.credit`, Current Payables from purchase `outstanding_amount`, and
stock alerts. Rider delivery state is not queried; COD counts only after
settlement creates an actual Received payment.

Without the UUID ledger, Current Cash, Current Bank, complete Cash/Bank
movement, COGS, lifetime Total Sales, and COGS-based Approximate Profit are
`null`/Not available, never fabricated as zero. Optional metrics are isolated
and fetched concurrently. Range fetches are abortable, automatic retry is
bounded to one and disabled for 401/403, and diagnostics contain timing/path
metadata but no financial values or customer data.

Focused coverage is in `tests/dashboard-production-compatibility.test.ts` and
`tests/home-date-range.test.ts`. Authenticated production browser verification
remains required. No migration, deployment, or push was performed.

## Known blockers

- No browser/authenticated session available to perform live UI verification, per the same limitation already recorded in `CLIENT-REQUIREMENTS-DEPLOYED-GAP-AUDIT.md` for this row.
- Production ledger balances (`ledger_account_balance_paisas`, `ledger_profit_loss`) depend on migrations 00025–00032 being applied to the target Supabase project; this task did not apply or verify migrations against any environment.
