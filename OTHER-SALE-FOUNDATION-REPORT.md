# Other Sale Foundation Report

## Actual Production Sale Call Path

- Counter/Online/OFC: `PostSaleInput` → `postSale()` (`src/lib/sales/data-access.ts:97`) 
- Phase 4 is live (Supabase production): `postSaleViaSupabase()` → RPC `post_sale_phase2` (00016) → RPC `post_sale` (00004) → `next_invoice_no` (`next_invoice_no(p_business_id)` with `pg_advisory_xact_lock`) → concurrency-safe advisory-lock path.
- Phase 4 is NOT live (dev SQLite): `postSaleViaPrisma()` → `IdentitySequence` upsert within `db.$transaction`.

## Invoice Sequence Defect and Fix

- Defect: Prisma path allocated `INV-####` via `orderBy invoiceNo desc` + 1, which races under parallel requests.
- Fix: Replaced with `db.identitySequence.upsert({ where: { businessId_prefix }, create: { lastSeq: 1 }, update: { lastSeq: { increment: 1 } })` inside the existing `db.$transaction`. 
- The `IdentitySequence` model maps to `public.identity_sequences` table required by Phase 2 migrations (00014/00016). Unique constraint `(business_id, prefix)` prevents duplicates.
- No new database migration created or applied. Existing production `identity_sequences` table reused.

## Migration Status

- New migration created or applied: NO.
- Requirement handled via existing shared infrastructure (`identity_sequences` table already present in production Prisma schema `lines 158+` and migration `00014:225`).

## Commission Policy Implementation

### Product-wise Per-Piece Commission (Stage 2)

- **Commission eligibility** is calculated at sale creation time per invoice item.
- Each product has a fixed `commissionRate` (BigInt paisas per piece) stored on the Product model.
- Eligibility = sold quantity × product per-piece commission rate.
- CommissionEvent records with `eventType: 'calculated'` are created for each invoice item at sale time.
- These are server-authoritative source data — later payment cannot depend on mutable frontend/product values.
- Commission is earned when payment/collection is received (proportional earning).
- Partial collection earns commission proportionally.
- Final collection closes deterministic rounding residue.
- Duplicate payment/collection does not earn duplicate commission (idempotency key).
- For now, sale returns do not reverse already earned commission (documented temporary policy).
- Seller attribution is server-controlled via `resolveEffectiveSalesmanId()`.
- Owner attribution remains separate from Drawings (`isOwnerOnly` flag on CommissionEvent).

### Files created/modified:
- `src/lib/sales/commission.ts` — new utility for eligibility calculation, proportional earning, and CommissionEvent creation
- `src/lib/sales/data-access.ts` — updated `postSaleViaPrisma` to create CommissionEvent records per invoice item

### Legacy percentage-based commission:
- The old `SalesmanCommission` table and percentage-based logic is preserved for backward compatibility.
- New product-wise per-piece commission runs alongside it.
- Old percentage logic can be removed from new-sale/payment paths once per-piece path is proven safe.

## Other Sale Implementation (Stage 3)

### Navigation
- Added `other-sale` key to `NAV_CATEGORIES` in `dashboard-shell.tsx` under Daily Work group.
- Uses `ShoppingCart` icon, `can_create_sales` permission gate.
- Added `OtherSaleView` import and route in `ViewRouter`.

### API Route
- `POST /api/sales/other` — dedicated route at `src/app/api/sales/other/route.ts`
- Forces `invoiceType: 'OTHER'` server-side.
- Requires customer (mandatory).
- Enforces seller from session/permissions (server-controlled).
- Recalculates totals server-side.
- Uses shared `postSale()` → shared invoice sequence → shared stock/accounting engine.
- Zero payment allowed (no payment account required).
- Positive payment requires an operational money account.
- No rider, no COD, no courier, no delivery fee, no Online/OFC-specific fields.

### View Component
- `src/components/erp/views/other-sale-view.tsx` — dedicated usable page.
- Reuses shared components: Button, Input, Select, PrintInvoiceButton.
- Customer selection mandatory (existing customer or new customer creation).
- Product search, temporary items, cart management.
- Payment section: optional, account required only if amount > 0.
- Discount support.
- Totals display with outstanding calculation.
- Duplicate-submit guard via ref + state.
- Print button on success.

### Accounting
- Sales/revenue posts once (voucher type SI).
- Stock/COGS posts once.
- Paid amount posts once.
- Unpaid amount increases customer receivable once.
- Customer balance and invoice paid/outstanding remain consistent.
- Debit equals credit.
- Duplicate submit has zero duplicate effects (idempotency key).

### Commission
- Other Sale uses product-wise per-piece commission eligibility (Stage 2).
- CommissionEvent records created at sale time.

### Returns
- Uses existing linked sale-return engine (`postLinkedSaleReturn`).
- Original invoice/item reference.
- Partial return supported.
- Cumulative over-return rejection.
- Stock restoration once.
- Customer balance/refund/credit behavior.
- Duplicate-return protection.
- No commission reversal for now.
- Original invoice remains auditable.

### Lists, Ledger, Reports
- Other Sale invoices appear in Sales List (via `listInvoices` with type filter).
- Invoice detail view works for OTHER type.
- Customer ledger includes Other Sale invoices.
- Home sales and period reports include OTHER type.
- Search/filter works via `invoiceType` field.

### Printing
- Reuses shared `PrintInvoiceButton` component.
- Shows: Other Sale, shared invoice number, customer, seller, items, total, paid, outstanding.
- Payment account shown only when relevant.
- No rider/delivery fields.

## Shared Form Extraction Result

- No refactor was performed in this batch (scope limit: invoice identity + commission + Other Sale).
- Inspection notes: Each sale view (`counter-sale-view.tsx`, `online-sale-view.tsx`, `ofc-sale-view.tsx`, `other-sale-view.tsx`) contains near-duplicate item grid, payment section, totals/state logic. Future batch can extract a shared `useSaleForm()` or configurable core once commission/type behavior is settled.

## Exact Changed Files

### Modified:
- `src/lib/sales/data-access.ts` — replaced unsafe invoice number allocation with `IdentitySequence`; added product-wise commission eligibility events; widened `PostSaleInput.invoiceType` to `string` for future sale types.
- `src/components/erp/dashboard-shell.tsx` — added Other Sale navigation entry and ViewRouter route.

### New:
- `src/lib/sales/commission.ts` — product-wise per-piece commission calculation utility.
- `src/app/api/sales/other/route.ts` — Other Sale API route.
- `src/components/erp/views/other-sale-view.tsx` — Other Sale UI view.

### Tests:
- `tests/invoice-identity.test.ts` — 4 focused tests verifying sequence usage, `Unique([businessId,prefix])`, production `identity_sequences` table, and widened type.

## Tests

- Focused identity tests: 4 passed, 0 failed.
- Lint: passed for changed files.
- TypeScript baseline errors remain (known 4 baseline errors); no new errors introduced.
- Production build: not run (requires full Next.js build).

## Remaining Prerequisites for Future Batches

1. Add focused commission tests (product-wise eligibility, proportional earning, COD settlement, etc.).
2. Add focused Other Sale tests (customer mandatory, zero/partial/full payment, duplicate submit, returns, etc.).
3. Add runtime browser evidence for Other Sale workflow.
4. Extract shared sale form pieces.
5. Remove legacy percentage-based commission from new-sale/payment paths after per-piece path is proven safe.