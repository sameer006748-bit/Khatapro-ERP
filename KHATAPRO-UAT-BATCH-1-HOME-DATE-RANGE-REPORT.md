# KhataPro UAT Batch 1 — Home Date Range

- Added Today, Yesterday, This Week, This Month, and validated Custom Range to Owner Business Summary.
- One Karachi date-only `{ from, to }` range keys the existing Home query and reaches the existing summary API.
- Sales, receipts, expenses, purchases, receivable/payable ledger movement, approximate profit, and period online-order activity share that range.
- Cash, bank, receivables, payables, and stock are clearly labelled current snapshots; no historical balance is inferred.
- Focused tests and targeted lint pass. The production build passes.

## TypeScript baseline verification

`tsc --noEmit` reports these four diagnostics:

- `src/lib/products/data-access.ts:235:3` — `TS2741`: `commissionRatePaisas` is missing from a value required to satisfy `ProductRow`.
- `src/lib/products/data-access.ts:401:9` — `TS2741`: `commissionRatePaisas` is missing from a value required to satisfy `ProductRow`.
- `src/lib/products/data-access.ts:456:5` — `TS2741`: `commissionRatePaisas` is missing from a value required to satisfy `ProductRow`.
- `src/lib/supabase/rpc-compatibility.ts:194:7` — `TS2367`: comparison of literal types `16` and `8` has no overlap.

Classification: pre-existing and unrelated (proof B). `git diff --name-only` contains only the Owner dashboard route/view/hook/date utility; neither affected file is changed. `git show HEAD:src/lib/products/data-access.ts` and `git show HEAD:src/lib/supabase/rpc-compatibility.ts` contain the exact source at all four locations. The Home changes add no import, type, or API dependency to either affected file. No new TypeScript error was introduced by this task.

## Remaining risk

Production smoke testing is deferred; receipt/voucher schemas should be verified against production data before release.
