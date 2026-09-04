# KhataPro UAT Batch 1 — Account Subcategories

## Storage decision

Production discovery and the Phase 1 inspection prove `accounts` and `account_categories` are Prisma-only/absent in production. Existing Money/CoA data access is therefore local compatibility, not a safe production category store. No safe persisted custom-category mechanism was proven. No migration was created.

## Implementation

- Added a shared, typed, system-defined parent → one-level-subcategory classification source.
- Added compact expandable categories and one-click filtering to Money Summary, based only on already-loaded recent operational voucher activity.
- Parent totals include classified children. Unknown records are safely `Uncategorized`.
- Classification is presentation-only: no balances, payments, invoices, vouchers, or stock movements are created or changed.
- Existing Money and Advanced Accounting navigation/permissions are unchanged; no new financial access is introduced.

## Verification and limitations

- Focused tests are static UI/classification tests; no production database test or SQL was run. Result: 9/9 passed.
- Targeted lint and `git diff --check` passed. The production build passed.
- `tsc --noEmit` reports only the known baseline diagnostics: `TS2741` at `src/lib/products/data-access.ts:235:3`, `:401:9`, and `:456:5`, plus `TS2367` at `src/lib/supabase/rpc-compatibility.ts:194:7`. No task-caused diagnostic is introduced.
- Custom persisted labels are deferred until production provides a proven settings/configuration mechanism.
