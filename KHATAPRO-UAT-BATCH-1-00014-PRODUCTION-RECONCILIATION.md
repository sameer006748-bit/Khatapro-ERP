# KhataPro ERP — UAT Batch 1: Migration 00014 Production Reconciliation

## Starting point and interrupted work

- Starting HEAD for this correction: `1479f12ae6508062a28585af697cbf288573d92c`
- Branch: `fix/backend-stock-recovery`
- Interrupted work: none; the worktree was clean. Production rejected the prior precondition because its `invoice_items.id` and `products.id` expectations were stale.

## Verified production identifier map

| Table / column | Type | Evidence used |
| --- | --- | --- |
| `businesses.id` | `uuid` | Verified production fact |
| `invoices.business_id` | `uuid` | Verified production fact |
| `invoices.id` | `text` | Verified production fact |
| `invoice_items.business_id` | `uuid` | Production schema map |
| `invoice_items.id` | `uuid`, single-column PK | Proven production error and type map |
| `products.business_id` | `uuid` | Verified production fact |
| `products.id` | `text` | Proven production error and type map |
| `profiles.id`, `riders.id` | `uuid` | Verified production fact |

## Repairs

- `sale_return_documents` keeps UUID `id` and `business_id`; `original_invoice_id` is `text`.
- Its deterministic `sale_return_documents_invoice_fkey` is exactly `(business_id, original_invoice_id) -> invoices(business_id, id) ON DELETE RESTRICT`; no single-column invoice FK exists.
- `sale_return_lines.original_invoice_item_id` is `uuid` and retains its verified single-column FK to `invoice_items(id)`.
- `commission_events.business_id`, `salesman_id`, `invoice_item_id`, and `original_invoice_item_id` are UUID; `invoice_id` is text. `return_event_id` and `allocation_id` remain documented, unconstrained text trace fields. Only the verified business FK is added.
- The migration now preflights the production map and required invoice/invoice-item key shapes before DDL. Inspection SQL is read-only and verifies types, key definitions, exact composite FK definition, and FK type compatibility.

## Files changed

- `supabase/migrations/00014_phase1_foundation.sql`
- `supabase/migrations/00014_phase1_foundation_inspect.sql`
- `tests/phase1-foundation.test.ts`
- This reconciliation report

`prisma/schema.prisma` was reviewed but not changed: its Phase 1 `String` fields represent both UUID and text values correctly, so no Prisma semantic change was needed.

## Validation

- Focused Phase 1 test: `npx tsx --test tests/phase1-foundation.test.ts` passed (53 tests).
- `npx prisma format`, `npx prisma validate`, `npx prisma generate`, and `npx tsc --noEmit`: passed.
- `git diff --check`: passed.
- Migration was **not applied** and no production data was changed.

## Commit and push

- Prior repair commit SHA: `6904dfe167c2777ba1ace7a0a10202ad297bb147`.
- Corrected-map commit: `3f2b2c92240356242a42819a60d0705d7c214224` (`Correct Phase 1 production identifier map`).
- Push result: blocked by external-remote policy; the validated commits remain local on `fix/backend-stock-recovery`.

## Next action

After review, run the corrected migration once in Supabase project `ebcebxwpddltiwrqybqc`.
