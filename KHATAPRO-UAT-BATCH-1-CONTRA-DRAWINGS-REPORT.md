# KhataPro UAT Batch 1 — Expanded Contra + Owner Drawings

## Production storage decision

Production inspection already proves that Prisma-only `accounts`, `account_categories`, `vouchers`, and `voucher_lines` are absent. The old Contra UI depended on those local compatibility structures, so it is not production-safe. No proven production transfer/account-balance store exists. This change therefore adds the smallest independent operational store: per-business Cash, Bank, and Wallet balances plus immutable operational transaction records. It is not a Chart of Accounts or voucher engine.

## Migration and inspection

- `supabase/migrations/00018_contra_drawings.sql`
- `supabase/migrations/00018_contra_drawings_inspect.sql`

The migration is additive only and was **not applied**. It references only proven `businesses` and `profiles` identities; it does not reference absent legacy accounting tables. The inspection is catalog-only and verifies table shape, constraints/indexes, RPC signatures, SECURITY DEFINER status, ACLs, and absence of legacy table dependencies.

## Flows

- `post_contra_transfer`: locks both same-business active money accounts in a deterministic order; decreases the source and increases the destination exactly once. It has no equity, income, expense, payment, or P&L effect.
- `post_owner_capital`: increases the selected business account and records a positive owner-equity delta. It has no sales/income/P&L effect.
- `post_owner_drawings`: locks and decreases the selected business account, records a negative owner-equity delta, and never creates an expense row or P&L effect.
- All three RPCs use business-scoped idempotency keys, request fingerprints, advisory locks, row locks, immutable history, whole-paisa numeric values, and same-business checks.

## UI and permissions

- Replaced the routed Contra form with Cash/Bank/Wallet operational accounts, confirmation impact, double-submit prevention, and recent transfers.
- Added Owner-only `Capital & Drawings` with compact Add Capital / Withdraw controls, mobile-stacked fields, balances, impact labels, and recent activity.
- Owner/Admin is allowed; Accountant is only allowed if a future explicitly assigned `can_manage_owner_equity` permission exists. Salesman/Rider are denied server-side. Existing Contra permission remains required by the route.

## Files changed

- `src/app/api/contra-entry/route.ts`
- `src/app/api/operational-money/route.ts`
- `src/app/api/owner-equity/route.ts`
- `src/lib/money/operational-money.ts`
- `src/components/erp/views/voucher-forms-view.tsx`
- `src/components/erp/dashboard-shell.tsx`
- `supabase/migrations/00018_contra_drawings.sql`
- `supabase/migrations/00018_contra_drawings_inspect.sql`
- `tests/contra-drawings.test.ts`

## Verification

- Focused Contra/Drawings tests: **10/10 passed**.
- Targeted lint: passed.
- `git diff --check`: passed.
- Production build: passed (after permitted Google Fonts network access).
- `tsc --noEmit`: only the known baseline diagnostics, with no task-caused error:
  - `src/lib/products/data-access.ts:235:3` — TS2741 `commissionRatePaisas` missing.
  - `src/lib/products/data-access.ts:401:9` — TS2741 `commissionRatePaisas` missing.
  - `src/lib/products/data-access.ts:456:5` — TS2741 `commissionRatePaisas` missing.
  - `src/lib/supabase/rpc-compatibility.ts:194:7` — TS2367 literal comparison `16` and `8`.

## Remaining production risk

The additive migration must first be inspected and then applied in the intended production environment before the new UI can transact. No production SQL, deployment, or production mutation was performed. Migrations `00009` through `00017`, accounting formulas, returns, rider settlement, and commission logic remain unchanged.
