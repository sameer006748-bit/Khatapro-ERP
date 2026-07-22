# KhataPro ERP — UAT Batch 1: Migration 00014 Production Reconciliation

## Starting point and interrupted work

- Starting HEAD: `a3e4714c292884cbf5ee0abf199d987c036388e6`
- Branch: `fix/backend-stock-recovery`
- Interrupted work: only `00014_phase1_foundation.sql` was modified. Its valid invoice-ID correction was incomplete, incorrectly changed UUID business/document IDs to text, and included a pasted `REPLACE` artifact. No unrelated temporary files were present.

## Verified production identifier map

| Table / column | Type | Evidence used |
| --- | --- | --- |
| `businesses.id` | `uuid` | Verified production fact |
| `invoices.business_id` | `uuid` | Verified production fact |
| `invoices.id` | `text` | Verified production fact |
| `invoice_items.business_id` | `uuid` | Production schema map |
| `invoice_items.id` | `text`, single-column PK | Historical invoice-item definition plus production PK fact |
| `products.id`, `profiles.id`, `riders.id` | `uuid` | Production schema map |
| `delivery_events.id`, `rider_cash_ledger.id` | `uuid` | Production schema map |

## Repairs

- `sale_return_documents` keeps UUID `id` and `business_id`; `original_invoice_id` is `text`.
- Its deterministic `sale_return_documents_invoice_fkey` is exactly `(business_id, original_invoice_id) -> invoices(business_id, id) ON DELETE RESTRICT`; no single-column invoice FK exists.
- `sale_return_lines.original_invoice_item_id` is `text` and retains its verified single-column FK to `invoice_items(id)`.
- `commission_events.business_id` is UUID; its salesman, invoice, invoice-item, and original-invoice-item trace IDs are text. Only the verified business FK is added.
- The migration now preflights the production map and required invoice/invoice-item key shapes before DDL. Inspection SQL is read-only and verifies types, key definitions, exact composite FK definition, and FK type compatibility.

## Files changed

- `supabase/migrations/00014_phase1_foundation.sql`
- `supabase/migrations/00014_phase1_foundation_inspect.sql`
- `tests/phase1-foundation.test.ts`
- This reconciliation report

`prisma/schema.prisma` was reviewed but not changed: the Phase 1 identifier fields are already represented as `String`, matching both UUID and text database values at the Prisma layer; its invoice-related fields therefore need no semantic change.

## Validation

- Focused Phase 1 test: `npx tsx --test tests/phase1-foundation.test.ts` passed (52 assertions/tests).
- `npx prisma format`, `npx prisma validate`, `npx prisma generate`, and `npx tsc --noEmit`: passed.
- `git diff --check`: passed.
- Migration was **not applied** and no production data was changed.

## Commit and push

- Repair commit SHA: `6904dfe167c2777ba1ace7a0a10202ad297bb147` (`Fix Phase 1 production identifier types`).
- Push result: pending push.

## Next action

After review, run the corrected migration once in Supabase project `ebcebxwpddltiwrqybqc`.
