# KhataPro ERP — Client UAT Batch 1 Architecture Audit

**Branch:** fix/backend-stock-recovery  
**HEAD:** dbbbd5348b9d9dc1a8051928d4f3aa1f948e020d  
**Production baseline:** 15804490a06d901ea6e771537051f788652284ea  
**Audit date:** 21 July 2026  
**Model used:** DeepSeek V4 Flash (with repository context from earlier handoff documentation + targeted file inspection)

---

## 1. Executive Findings

- **What exists:** Full ERP baseline with sales (Counter/Online/OFC), purchases, stock, accounting engine (voucher+ledger), contra, rider COD, reports (Trial Balance/P&L/Balance Sheet), AI assistant.
- **Can be extended:** Sale posting service (`src/lib/sales/data-access.ts`), Contra/Transfer API (`src/app/api/contra-entry/route.ts`), accounting voucher engine (`src/lib/accounting/voucher.ts`), delivery/Rider COD module (`src/lib/delivery/data-access.ts`), invoice print components (`src/components/invoice/`).
- **What is missing:** Sale-return line-level linking (SalesReturn lacks `items`/line references), product commission rate model/fields, commission eligibility/earning/payable ledger, Rider Held COD system account, settlement allocation table, identity-number generator for non-invoice transactions, account category parent/subcategory, multi-row Contra/Drawings batch UI.
- **Highest-risk areas:** Commission idempotency and allocation under partial payment/return; Rider Held COD accounting balancing; posted sale history immutability; concurrency on identity-number generation.
- **DeepSeek V4 Flash had sufficient repository context** due to the prior handoff documentation providing high-level feature maps plus targeted file inspection. However, the full Supabase RPC SQL and UI component tree was not deeply inspected — a stronger model may be preferred for accounting-posting RPC implementation phases.

---

## 2. Current Flow Map

| Area | File | Key Export | Responsibility |
|------|------|-----------|----------------|
| **Dashboard** | `src/app/api/dashboard/owner/route.ts` | `GET` | Today KPIs, recent invoices/purchases, stock alerts, collections, audit logs |
| **Sales post** | `src/lib/sales/data-access.ts` | `postSale()` | Dual-path (Supabase RPC / Prisma) sale posting with stock, voucher, payment allocation, commission |
| **Sales return** | `src/lib/sales/data-access.ts` | `postSalesReturn()` | Full-invoice return (not line-level), reverses stock + accounting + commissions |
| **Contra entry** | `src/app/api/contra-entry/route.ts` | `POST` | Single-pair account-to-account transfer |
| **Contra service** | `src/lib/vouchers/data-access.ts` | `postContraEntry()` | Calls Supabase RPC `post_contra_entry` |
| **Payment/Receipt/JV** | `src/lib/vouchers/data-access.ts` | `postPaymentVoucher()`, `postReceiptVoucher()`, `postJournalVoucher()` | Standard voucher posting via Supabase RPCs |
| **Expense batch** | `src/lib/vouchers/data-access.ts` | `postExpenseBatch()` | Multi-line expense posting |
| **Delivery/Rider** | `src/lib/delivery/data-access.ts` | `createDeliveryOrder()`, `assignRider()`, `markDelivered()`, `markReturned()` | COD delivery lifecycle via Supabase RPCs |
| **COD submission** | `src/lib/delivery/data-access.ts` | `createCodSubmission()`, `confirmCodSubmission()` | Settlement batches via Supabase RPCs |
| **Rider ledger** | `src/lib/delivery/data-access.ts` | `riderLedger()`, `riderDashboardSummary()` | Running COD balance by rider |
| **Reports** | `src/lib/reports/data-access.ts` | `reportProfitLoss()`, `reportBalanceSheet()`, `trialBalance()` | P&L, Balance Sheet, Trial Balance via RPCs |
| **Accounting engine** | `src/lib/accounting/voucher.ts` | `postVoucher()` | Prisma-side voucher posting (Supabase has equivalent RPC) |
| **Invoice print** | `src/components/invoice/invoice-print-dialog.tsx` | `InvoicePrintDialog` | Half-A4/two-up/full-A4 invoice printing |
| **Print button** | `src/components/invoice/print-invoice-button.tsx` | `PrintInvoiceButton` | Trigger print dialog |

---

## 3. Current Database Map

### Prisma Models (SQLite dev — Supabase has mirrored schema)

| Model | Table | Key Fields | Notes |
|-------|-------|-----------|-------|
| `AccountCategory` | `account_categories` | `id, businessId, code, name, type` | No `parentId` — flat hierarchy |
| `Account` | `accounts` | `id, businessId, code, name, categoryId, parentId, balanceCache` | `parentId` exists (self-referencing) but unused |
| `Voucher` | `vouchers` | `id, businessId, voucherNo, voucherType, referenceId, referenceType, totalDebit, totalCredit, isCancelled` | |
| `VoucherLine` | `voucher_lines` | `id, voucherId, accountId, debit, credit` | |
| `Invoice` | `invoices` | `id, businessId, invoiceNo, invoiceType, customerId, salesmanId, subtotal, total, paidAmount, isReturned, returnVoucherId` | No return- line links — only full-invoice `isReturned` flag |
| `InvoiceItem` | `invoice_items` | `id, invoiceId, productId, qty, unitPrice, lineTotal` | No `returnedQty` field |
| `SalesReturn` | `sales_returns` | `id, originalInvoiceId, returnVoucherId, total` | No line-level items — returns the entire invoice |
| `Salesman` | `salesmen` | `id, accountId, commissionPct` | Per-salesman percentage, NOT per-product rate |
| `SalesmanCommission` | `salesman_commissions` | `id, salesmanId, invoiceId, allocationId, collectedAmount, commissionPct, commissionAmount` | Tied to payment allocation — commission is **collection-based** |
| `PaymentAllocation` | `payment_allocations` | `id, invoiceId, accountId, amount, voucherId` | |
| `Product` | `products` | `id, name, salePrice, purchasePrice, currentStock` | No `commissionRate` field |
| `StockMovement` | `stock_movements` | `id, productId, movementType, quantity, balanceAfter, voucherId` | |
| `Customer` | `customers` | `id, accountId, name, phone` | |
| `Vendor` | `vendors` | `id, accountId, name` | |

### Supabase Tables (verified via migrations)

| Table | Source Migration | Notes |
|-------|-----------------|-------|
| `riders` | `00007_phase7_rider_cod.sql` | `user_id` links to Prisma User id |
| `delivery_orders` | `00007_phase7_rider_cod.sql` | Status check constraint: `pending,assigned,out_for_delivery,delivered,returned` |
| `delivery_status_events` | `00007_phase7_rider_cod.sql` | |
| `rider_cod_submissions` | `00007_phase7_rider_cod.sql` | |
| `rider_cod_submission_items` | `00007_phase7_rider_cod.sql` | Links submission to delivery order |

### Supabase RPCs (verified via migrations)

| RPC | Source | Purpose |
|-----|--------|---------|
| `post_sale` | `00004_phase4_sales.sql` | Full sale posting |
| `post_sales_return` | `00008f_fix_sales_return_variable_types.sql` | Full invoice return |
| `post_contra_entry` | `00006_phase6_vouchers_expenses.sql` | Contra between two accounts |
| `assign_rider_to_order` | `00007_phase7_rider_cod.sql` | Assign rider to delivery order |
| `mark_order_delivered` | `00007_phase7_rider_cod.sql` | Mark delivered + accounting |
| `mark_order_returned` | `00007_phase7_rider_cod.sql` | Mark returned + accounting |
| `create_cod_submission` | `00007_phase7_rider_cod.sql` | Create settlement request |
| `confirm_cod_submission` | `00007_phase7_rider_cod.sql` | Confirm + post settlement voucher |
| `rider_ledger` | `00007_phase7_rider_cod.sql` | Running COD balance per rider |
| `rider_dashboard_summary` | `00007_phase7_rider_cod.sql` | Assigned/delivered/pending counts |
| `report_profit_loss` | `00008_phase8_reports.sql` | P&L |
| `report_balance_sheet` | `00008_phase8_reports.sql` | Balance Sheet |
| `trial_balance` | `00008_phase8_reports.sql` | Trial Balance |
| `day_book` | `00006_phase6_vouchers_expenses.sql` | Day book with lines |
| `post_opening_stock` | `00012_post_opening_stock.sql` | Opening stock posting (already applied) |

---

## 4. Gaps Against Approved Requirements

| Requirement | Status | Reason |
|------------|--------|--------|
| **Home date range period selector** | Missing | Dashboard only supports `today` query param; no period selection UI/API |
| **Sale/return line-level linking** | Partially supported | `SalesReturn` exists but links only to whole invoice, not individual lines; no `InvoiceItem.returnedQty` |
| **Product-wise commission rate (Rs/piece)** | Missing | Commission is percentage-based per salesman; no per-product rupee rate field |
| **Net eligible quantity = sold - returned** | Missing | Current commission calculation uses `paymentAllocation.amount × salesman.commissionPct` — not product quantity-based |
| **Commission payable proportional to collection** | Partially supported | `SalesmanCommission` is created per payment allocation (collection-based), but no earning/payable status lifecycle |
| **Commission reduction on return** | Partial | Full-invoice return creates reversal; line-level return and partial return not supported |
| **Owner reporting-only commission** | Missing | No Owner salesman concept; commission is always expense post |
| **Rider Held COD system account** | Missing | No hidden system account; COD collected goes through customer receivable to delivery voucher |
| **Rider settlement UI** | Missing | API routes for COD submission exist but incomplete UI integration |
| **Partial delivery / partial return** | Missing | `delivery_orders` supports only integer `cod_collected_amount`; no line-level qty tracking |
| **Transaction identity numbers** | Partially supported | `Invoice.invoiceNo` (INV-XXXX) and auto-generated numbers exist; no centralized identity generator for all entity types |
| **Account category subcategories** | Missing | `Account.parentId` exists in schema but unused in UI/category CRUD |
| **Multi-row Contra & Drawings batch** | Missing | Single-pair contra only; no batch, no Drawing/Capital types |
| **Professional invoices** | Partially supported | Print component exists with half-A4/two-up but missing delivery/COD fields and return line rendering |

---

## 5. Proposed Additive Data Model

### A. Product Commission Rate (on `Product`)
- `commissionRate` (BigInt, paisas per piece) — NULL means no commission
- No separate commission-rate table needed for Batch 1; one rate per product is sufficient

### B. Sale Return Line Links (new table or columns)
**Option A (preferred):** Add to `InvoiceItem`:
- `returnedQty` (Int, default 0) — cumulative returned from this line
- `originalInvoiceItemId` (String?, FK to InvoiceItem) — for return lines that reference original

**Option B:** New `SalesReturnItem` table:
- `id, returnId (FK SalesReturn), originalInvoiceItemId (FK InvoiceItem), productId, qty, unitPrice`
- Links to original line for exact reversal

Recommend Option A for minimum schema change. Return lines would be stored as `InvoiceItem` with negative `qty` and a non-null `originalInvoiceItemId`.

### C. Commission Eligibility & Payable Ledger

New table: `commission_events`
| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | |
| `businessId` | FK | |
| `salesmanId` | FK (nullable for Owner) | NULL = Owner reporting-only |
| `invoiceId` | FK | Source invoice |
| `invoiceItemId` | FK | Source line (for product-level) |
| `originalInvoiceItemId` | FK? | NULL = new sale; non-NULL = return reversal |
| `eventType` | String | `earned`, `payable`, `paid`, `reversal` |
| `quantity` | Int | Net eligible qty for this event |
| `ratePaisas` | BigInt | Commission Rs per piece |
| `grossAmount` | BigInt | quantity × rate |
| `eligibleAmount` | BigInt | May differ if partial collection |
| `payableAmount` | BigInt | |
| `paidAmount` | BigInt | |
| `status` | String | `calculated`, `payable`, `paid`, `reversed` |
| `allocationId` | FK? | Links to payment allocation |
| `returnEventId` | FK? | Links back to original event for reversal |
| `idempotencyKey` | String? | Unique |
| `isOwnerOnly` | Boolean | TRUE = reporting-only, no expense/payable |

Unique constraint: `(idempotencyKey)` and `(allocationId, invoiceItemId, salesmanId)`.

### D. Rider Held COD System Account
- Insert a system account row in `accounts` with:
  - `code`: `1300` (or next available Current Asset code)
  - `name`: `Rider Held COD`
  - `categoryId`: Current Asset category
  - `isSystem`: true (column needs adding to Account, or use a fixed code convention)
  - `isHidden`: true (conceptual — exclude from normal account pickers)
- No separate editable table needed; protect via code convention and audit.

### E. Settlement Allocation Table
The existing `rider_cod_submission_items` already links submissions to delivery orders. Enhancement needed:
- Add `allocation_id` (FK to payments/allocations) for audit trail
- Add `is_settled` boolean to `delivery_orders`

### F. Identity Number Sequence (new table)
```sql
create table public.identity_sequences (
  business_id text not null,
  prefix text not null,
  last_seq int not null default 0,
  primary key (business_id, prefix)
);
```
- Entities: `INV` (sale shared), `PUR`, `RET`, `RCPT`, `PAY`, `JV`, `CTR`, `EXP`, `PC`, `STK`, `OSTK`, `COMM`, `RDRSTL`

### G. Account Category Parent
- Add `parentId` (FK to self) to `account_categories` (column already exists on accounts but not on categories)
- UI constraint: max depth 2 (root → child)

---

## 6. Accounting Posting Design

All amounts in paisas. Existing account codes assumed based on schema:
- `4010` = Sales Revenue
- `1200` = Accounts Receivable (Customer)
- `1300` = Rider Held COD (new proposal)
- `2010` = Accounts Payable
- `1010` = Cash (example)
- `3010` = Owner Equity
- `3020` = Drawings
- `5010` = Commission Expense (new if not existing)
- `5020` = Owner Commission Payable (new)
- `6010` = Cost of Goods Sold

### A. Credit Sale Before Collection
```
AR (1200) Dr       total
   Sales (4010) Cr   total
Commission event: calculated (not posted to GL)
```

### B. Cash Sale
```
Cash (1010) Dr     paid
AR (1200) Dr       outstanding (if any)
   Sales (4010) Cr   total
```

### C. Partial Collection
```
Cash Dr            collected
   AR Cr             collected
Commission event: payable created proportionally
```

### D. Sale Return Before Collection
```
Sales Cr (reverse)  lineTotal
   AR Dr (reverse)    lineTotal
Stock movement: reverse stock
Commission event: reversal of earned amount
```

### E. Sale Return After Partial Collection
```
Sales Cr (reverse)  lineTotal * (1 - collectedRatio)
Commission Expense Cr  (reverse payable portion if already paid)
Cash Cr                (refund if already collected)
   AR Cr (balance adjustment)
Commission event: reversal
```

### F. Online COD Delivered & Held by Rider
```
Rider Held COD (1300) Dr  collected
   AR (1200) Cr             collected
```

### G. Partial Delivery + Partial Return
```
Rider Held COD Dr  deliveredAmount
   AR Cr             deliveredAmount
```
No change for returned portion — AR remains until full settlement.

### H. Partial Rider Settlement
```
Cash (1010) Dr           received
   Rider Held COD (1300) Cr  received
```

### I. Final Rider Settlement
```
Cash (1010) Dr           allReceived
   Rider Held COD (1300) Cr  allReceived
```

### J. Salesman Commission Becoming Payable
```
Commission Expense Dr   amount
   Commission Payable Cr  amount
```

### K. Commission Reduction After Return
```
Commission Payable Dr   reversedAmount
   Commission Expense Cr  reversedAmount
```

### L. Owner Reporting-Only Commission
No GL posting. Stored in `commission_events` with `isOwnerOnly = true`.

### M. Pure Contra Transfer
```
Destination Account Dr   amount
   Source Account Cr       amount
```

### N. Owner Drawings (Simplified UI)
```
Drawings (3020) Dr   amount
   Cash (1010) Cr      amount
```

---

## 7. Core Invariants

| Invariant | Enforcement |
|-----------|-----------|
| Returned qty ≤ sold qty | Application + DB check (trigger or RPC) |
| Delivered + returned ≤ ordered | Application + RPC |
| Net commission qty ≥ 0 | Application |
| Earned commission ≤ eligible commission | Application |
| Rider Held COD ≤ actual collected COD | Application + RPC |
| Settlement ≤ rider outstanding | Application + RPC |
| Stock posts once per sale/return line | RPC atomic transaction |
| Voucher debit = credit | DB constraint + RPC validation |
| One active rider per order | RPC (assign_rider checks status) |
| Identity number unique (per prefix per business) | DB unique constraint |
| Owner commission never creates expense/payable | Application code (isOwnerOnly) |
| Drawings never affects P&L | Voucher type enforcement |
| Posted sale history immutable | `isCancelled` flag, no DELETE |

---

## 8. Exact Files to Change

### Phase 1 — Foundation & Identity
**New files:**
- Migration: `00014_identity_sequences.sql` (add `identity_sequences` table)
- Migration: `00014a_commission_fields.sql` (add `commission_rate` to products, create `commission_events` table)
- Migration: `00014b_account_category_parent.sql` (add `parent_id` to `account_categories`)
- Migration: `00014c_rider_held_cod_account.sql` (insert system account)
- `src/lib/identity/data-access.ts` (identity number generator)
- `src/lib/identity/generate.ts` (server-side counter logic)

**Modified files:**
- `prisma/schema.prisma` (new models)
- `src/lib/auth/permissions.ts` (new permission codes)
- `supabase/rollback/00014_rollback.sql`

### Phase 2 — Sale Return & Commission
**Modified files:**
- `src/lib/sales/data-access.ts` — add `postSalesReturnLines()`, `listSaleReturns()`, update `postSaleViaPrisma` for commissions
- `src/app/api/sales/[id]/return/route.ts` — update for line-level returns
- `src/lib/accounting/voucher.ts` — commission posting support
- `src/components/erp/views/invoice-detail-view.tsx` — return line display
- Supabase RPC: `post_sales_return` (update for line-level)

**New files:**
- `src/lib/commission/data-access.ts` (commission CRUD)
- `src/app/api/commissions/route.ts` (commission list API)

### Phase 3 — Rider Assignment & Delivery
**Modified files:**
- `src/lib/delivery/data-access.ts` — partial delivery/return support
- `src/app/api/rider-dashboard/route.ts` — updated dashboard
- Supabase RPC: `mark_order_delivered`, `mark_order_returned` — add line quantities

### Phase 4 — Rider Settlement
**Modified files:**
- `src/lib/delivery/data-access.ts` — enhanced settlement flow
- `src/app/api/rider-dashboard/route.ts`
- Supabase RPC: `confirm_cod_submission` — Rider Held COD account handling

### Phase 5 — Home Date Range
**Modified files:**
- `src/app/api/dashboard/owner/route.ts` — period-aware KPIs
- `src/app/page.tsx` or home component — period selector UI
- `src/lib/dates.ts` — range helpers

**New files:**
- `src/components/erp/views/date-range-selector.tsx`

### Phase 6 — Account Categories
**Modified files:**
- `src/app/api/account-categories/route.ts` — parent/child CRUD
- `src/lib/accounting/data-access.ts`
- UI components for Chart of Accounts

### Phase 7 — Expanded Contra & Drawings
**Modified files:**
- `src/app/api/contra-entry/route.ts` — multi-row batch
- `src/lib/vouchers/data-access.ts` — `postContraBatch()`
- Supabase RPC: `post_contra_entry` or new `post_contra_batch`

### Phase 8 — Professional Printing
**Modified files:**
- `src/components/invoice/invoice-print-dialog.tsx` — add rider/delivery/return fields
- `src/components/invoice/print-invoice-button.tsx`

### Files Never Touched
- `00009_phase9_discount_support.sql`
- `00012_post_opening_stock.sql`
- `00013_fix_post_opening_stock_execution.sql`
- `scripts/diag-opening-stock.mjs`
- All AI module files (`src/lib/ai/*`, `src/app/api/ai/*`)
- All PWA/service worker files
- All deployment/CI files

---

## 9. Migration Sequence

| Phase | Migration | Purpose | Risk | Rollback |
|-------|-----------|---------|------|----------|
| Foundation | `00014` | `identity_sequences` table | Low — new table only | `DROP TABLE` |
| Foundation | `00015` | `commission_rate` on products, `commission_events` table | Low — additive columns + new table | Drop columns + table |
| Foundation | `00016` | `parent_id` on `account_categories` | Low — nullable new FK | Drop column |
| Foundation | `00017` | Insert Rider Held COD system account | Low — data insert | DELETE row |
| RPC | `00018` | Update `post_sales_return` for line-level | Medium — existing RPC change | Revert to previous |
| RPC | `00019` | Update delivery RPCs for partial qty | Medium | Revert |
| RPC | `00020` | New commission calculation RPC | High — accounting | Revert |
| Permissions | `00021` | Add new permission codes | Low | Delete codes |

---

## 10. Implementation Phases

### Phase 1 — Foundational Schema & Identity (Cheapest suitable model)
- Files: 4 new migrations, `prisma/schema.prisma`, `src/lib/identity/*`
- Risk: Low
- Tests: Identity concurrency, sequence uniqueness
- Recommended model: DeepSeek V4 Flash — simple additive schema

### Phase 2 — Sale Return & Commission Engine (Strongest reasoning model)
- Files: `src/lib/sales/data-access.ts`, `src/lib/commission/*`, Supabase RPCs
- Risk: High — accounting accuracy, idempotency, partial return
- Tests: 10 sold/2 returned, mixed rates, partial payment/return, duplicate return
- Recommended model: DeepSeek V4 Pro or Anthropic (Claude) — complex accounting

### Phase 3 — Rider Assignment & Delivery (Cheapest suitable model)
- Files: `src/lib/delivery/*`, Supabase RPCs
- Risk: Medium — status transitions, RLS
- Tests: Assignment, reassignment, partial delivery, duplicate action
- Recommended model: DeepSeek V4 Flash

### Phase 4 — Rider Settlement (Strongest reasoning model)
- Files: `src/lib/delivery/*`, `src/app/api/rider-dashboard/*`
- Risk: High — Rider Held COD accounting, settlement idempotency
- Tests: Partial settlement, duplicate settlement, Balance Sheet inclusion
- Recommended model: DeepSeek V4 Pro or Anthropic

### Phase 5 — Home Date Range (Cheapest suitable model)
- Files: `src/app/api/dashboard/owner/route.ts`, home components
- Risk: Low — UI + API filter only
- Tests: One day, 3-day, month, custom range, timezone boundary
- Recommended model: DeepSeek V4 Flash

### Phase 6 — Account Subcategories (Cheapest suitable model)
- Files: API route, data-access, category UI
- Risk: Low — additive parent/child
- Tests: Create parent, create child, category cycle prevention, report grouping
- Recommended model: DeepSeek V4 Flash

### Phase 7 — Expanded Contra & Drawings (Strongest reasoning model)
- Files: `src/app/api/contra-entry/route.ts`, `src/lib/vouchers/data-access.ts`
- Risk: Medium — Drawings accounting, batch atomicity
- Tests: Multi-row batch, Drawing posting, duplicate prevention
- Recommended model: DeepSeek V4 Pro

### Phase 8 — Professional Printing (Cheapest suitable model)
- Files: `src/components/invoice/*`
- Risk: Low — presentation only
- Tests: Half-A4, two-up, long invoice, mobile preview
- Recommended model: DeepSeek V4 Flash

---

## 11. Test Matrix

| Test | Type | Area |
|------|------|------|
| 10 sold, 2 returned, commission on 8 | Integration | Commission |
| Mixed products with different rates | Integration | Commission |
| Zero commission rate | Unit | Commission |
| Partial customer payment | Integration | Commission + Accounting |
| Full return of invoice | Integration | Sales Return |
| Return after partial payment | Integration | Commission + Accounting |
| Duplicate sale return | Integration | Idempotency |
| Duplicate receipt | Integration | Idempotency |
| Owner sale (reporting-only) | Integration | Commission |
| Salesman sale (expense posting) | Integration | Commission |
| Online/OFC sale with commission | Integration | Sales |
| Rider assignment | Integration | Delivery |
| Rider reassignment before delivery | Integration | Delivery |
| Partial delivery | Database/RPC | Delivery |
| Partial return | Database/RPC | Delivery |
| Duplicate delivery action | Integration | Idempotency |
| Partial COD settlement | Database/RPC | Settlement |
| Duplicate settlement | Integration | Idempotency |
| Hidden Rider Held COD account | Permission/RLS | Accounting |
| Trial Balance with COD account | Accounting Recon | Reports |
| P&L without Owner commission | Accounting Recon | Reports |
| Balance Sheet with COD + Drawings | Accounting Recon | Reports |
| Category parent/child creation | Unit | Categories |
| Invalid category cycle prevention | Unit | Categories |
| Multi-row Contra batch | Integration | Contra |
| Owner Drawing (not posted as Contra) | Integration | Contra |
| Identity-number concurrency | Database/RPC | Identity |
| Half-A4 print | Browser/UAT | Printing |
| Two-up A4 print | Browser/UAT | Printing |
| Long invoice multi-page | Browser/UAT | Printing |
| Role isolation (Rider sees own only) | Permission/RLS | Security |

---

## 12. Opening-Stock Separation

- Migration `00013` is already applied to project `ebcebxwpddltiwrqybqc` — confirmed.
- Do not rerun or modify `00013`.
- Opening-stock production verification (creating a controlled product, posting opening stock, verifying WAC/accounting) remains separate from this UAT batch.
- No Client UAT migration should modify the `post_opening_stock` RPC unless an independently verified defect is found.

---

## 13. Final Recommendation

1. **Safest first implementation phase:** Phase 2 (Sale Return & Commission Engine) — this is the highest-risk accounting area and should be implemented and tested first while working on a clean branch before other features are added. However, Phase 1 (Foundation Schema) must precede it.

2. **Biggest unresolved technical risk:** Commission allocation under partial payment + partial return scenarios. The proportional allocation method (across net eligible line value) is mathematically sound but requires careful BigInt rounding and idempotency key enforcement. Owner reporting-only versus Salesman expense posting must be strictly separated in code paths.

3. **Model recommendation:** DeepSeek V4 Flash was sufficient for this bounded architecture audit given the prior handoff documentation context. For implementation: use Strongest reasoning model (DeepSeek V4 Pro or Anthropic Claude) for Phase 2 (commission accounting RPCs) and Phase 4 (Rider Held COD settlement), and Cheapest suitable model for all other phases.

4. **No reopening required** of these already approved decisions: commission trigger (net eligible qty-based), Owner commission reporting-only, linked Sale Return design, Rider Held COD system account treatment, Drawings posting as equity reduction.

**No code or database changes were made during this audit.**