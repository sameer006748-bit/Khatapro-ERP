# KhataPro ERP — Client Requirements Source of Truth

Last updated: 2026-08-28

This file is the authoritative client-requirements checklist for current implementation work. Agents must read this file before changing sales, rider, accounting, contra, invoice, identity, or dashboard workflows.

## Status legend

- ✅ Done and manually/runtime verified
- 🟡 Implemented or partially implemented, but final runtime/client verification is still required
- ❌ Not complete

## Home / Dashboard

### Requirement
The owner must be able to change the reporting period directly from Home, including short ranges such as 3 days and month-level summaries, without going to a separate report.

### Current status
✅ Implemented: Today, Last 3 Days, Last 7 Days, This Month, custom single date, and custom range. Asia/Karachi date handling was fixed for production compatibility.

## Counter Sale

### Requirement
Counter Sale must be a professional POS-style screen, not a basic scrolling form.

### Current status
✅ Major redesign implemented and manually reviewed.

Current design includes:
- product finder/search;
- keyboard navigation and Enter-to-add;
- stock/low-stock state;
- active bill panel;
- Owner/Salesman attribution;
- sold / returned / net quantities;
- rate, discount, total;
- commission per piece and total commission;
- stock impact;
- payment summary;
- visible Post Sale action.

### Remaining Counter Sale UI work
🟡 Final visual polish is still desirable for spacing, density, column readability, and print-quality presentation.

## Same-Bill Sale + Return

### Requirement
Sale and return must be adjustable in the same bill. Example: 10 pieces sold and 2 returned should result in net billed quantity 8.

This rule is not only for Counter Sale. Shared business logic must be reused by all applicable sale/bill channels.

### Current status
✅ Same-line mixed sale/return arithmetic implemented and manually verified:
- Sold 10
- Returned 2
- Net 8
- Stock effect -8

🟡 Production same-bill mixed posting requires migration `00033_mixed_sale_returns.sql`, which is prepared but not yet applied.

❌ Pure historical return line UI is still incomplete. A line such as Sold 0 / Return 3 must use an original invoice/item reference and enforce remaining returnable quantity.

Required future flow:
1. Add Return Item
2. Search/select original invoice
3. Select original invoice item
4. Show remaining returnable quantity
5. Enter return quantity
6. Add negative adjustment line into the active bill

## Product-Wise Commission

### Requirement
The owner defines a fixed commission amount per product, for example Rs 20 per piece. Commission is calculated on net eligible quantity after returns.

Example:
- Sold 10
- Returned 2
- Net eligible 8
- Rs 20 per piece
- Commission = Rs 160

### Current status
✅ Implemented and manually verified with Rs 20 × 8 = Rs 160.

Commission details must remain item-level and linked to bill/invoice references.

## Owner vs Salesman Commission Attribution

### Requirement
If a Salesman performs the sale, commission belongs to that salesman. If the Owner personally performs the sale, commission belongs to the Owner and must not be assigned to a default/random salesman.

### Current status
✅ Owner attribution manually verified.
✅ Salesman attribution manually verified.

## Commission Timing / Visibility

### Requirement
Commission entries must be separately visible with invoice/bill reference and detailed calculation. Commission is earned according to collection/payment policy, not merely by creating an unpaid invoice.

### Current status
✅ Invoice detail displays commission details including seller, sold, returned, net, per-piece rate, amount, and status.
✅ Earned-on-collection behavior exists in the current implementation.
🟡 Final end-to-end unpaid → collection → earned runtime verification should remain part of final UAT.

## Online Sale

### Requirements
- Same commission rules as Counter Sale.
- Rider assignment option.
- Delivery/COD assigned to rider.
- Channel-specific customer/source/delivery fields retained.

### Current status
🟡 Shared sales/commission engine implemented.
🟡 Final Online Sale runtime verification is still required.
🟡 Rider assignment/COD behavior requires requirement-level verification.

## OFC Sale

### Requirement
Use the same shared commission and sale/return calculation rules as Counter/Online, while retaining OFC-specific fields.

### Current status
🟡 Shared engine implemented.
🟡 Final OFC runtime verification is still required.

## Other Sale

### Requirement
Where a seller is assigned, shared sale/commission logic must remain consistent.

### Current status
🟡 Shared engine implemented; final regression verification still required.

## Delivery / Rider Workflow

### Requirements
Riders may settle only every 2–3 days. The system must show delivered, returned, settled, and still-outstanding parcels/money clearly.

Example:
- Rider has 40 parcels
- 35 delivered/settled
- 5 remain outstanding/payable

Partial delivery must also work:
- Customer ordered 2 pieces
- Customer keeps 1
- 1 returns with rider

Rider UI must be extremely simple because riders may not be comfortable using apps. Ideally the rider sees the order and simple action buttons only.

### Current status
🟡 Rider foundation and runtime compatibility exist.
❌ Full client-approved rider settlement workflow is not yet considered complete.
❌ Partial delivery/partial return end-to-end verification remains.
❌ Final simplified rider UI acceptance remains.

## Entry Identity Numbers

### Requirement
Every accounting/business transaction category must have its own human-readable identity prefix and sequential number, for example:
- `INV-0001` invoice
- `PUR-0001` purchase
- `EXP-0001` expense

The identity must appear with the entry everywhere it is referenced.

### Current status
🟡 Identity sequence foundation exists and invoices use `INV-xxxx`.
❌ All relevant transaction types have not yet been standardized and verified.

The full identity-prefix policy is defined in `docs/ACCOUNTING_CODES_AND_IDENTITIES.md`.

## Account Categories and Subcategories

### Requirement
Accounts must support categories and subcategories.

### Current status
🟡 Accounting category foundation exists.
❌ Final category/subcategory management UX is not complete/verified.

## Readable Code Words for Categories/Subcategories

### Requirement
Numeric chart-of-account codes such as `1010`, `1020`, `1030` are not sufficient by themselves.

Every relevant category and subcategory must also have a readable code word, e.g.:
- `CASH`
- `BANK-MZN`
- `BANK-JAZZ`
- `EXP-SALARY`
- `EXP-COMM`
- `EXP-DELIVERY`
- `ASSET-STOCK`
- `LIAB-PAYABLE`
- `DRAW-OWNER`

### Current status
❌ Not complete.

Rules are defined in `docs/ACCOUNTING_CODES_AND_IDENTITIES.md`.

## Contra

### Requirement
Contra is a major daily workflow and must support fast, expandable, multi-row internal money movements such as:
- bank → petty cash;
- petty cash → drawings;
- bank → drawings;
- account A → account B;
- multiple internal transfers during the day.

It must be easy and quick to use.

### Current status
❌ Expandable multi-entry Contra workflow is still pending.

## Payment Accounts

### Requirement
Payment accounts must be user-managed business data, not hard-coded Cash/JazzCash/Easypaisa/Bank labels inside sale screens.

### Current status
🟡 Shared payment-allocation engine and business-account management were implemented locally after current HEAD but are not yet committed/pushed.

Current work includes:
- user-created payment accounts;
- canonical account types;
- edit/activate/deactivate/guarded-delete;
- shared payment UI across sale channels;
- account-ID persistence;
- split payment support.

Optional account description currently requires a schema migration because the current BusinessAccount model has no description column.

## Invoice / Receipt

### Requirement
Invoices and bills must be professional and complete, with properly aligned details.

Required customer-facing information includes:
- business details;
- invoice identity;
- date/time;
- channel;
- seller;
- customer where applicable;
- product lines;
- sold / returned / net;
- rate;
- discount;
- totals;
- payments;
- outstanding balance;
- rider/COD where relevant;
- notes/footer.

### Current status
✅ Professional invoice detail page implemented and manually reviewed.
✅ `INV-0002` manually verified with Sold 10 / Returned 2 / Net 8, Rs 12,000 payment, Rs 0 outstanding, and Rs 160 commission internally.
🟡 Print-mode UI exists for Half A4, Two on A4, Full A4, and 80mm receipt.
❌ Final actual browser print-output visual approval is still required.

Internal commission details must not appear on the customer copy unless explicitly enabled by an owner-only internal print option.

## Migration / Production Notes

- Migration `00013` is already applied. Do not treat it as pending.
- `00033_mixed_sale_returns.sql` is prepared but NOT applied.
- Do not broadly apply pending migrations without explicit preflight and approval.
- Production Supabase project ref used by current project: `ebcebxwpddltiwrqybqc`.

## Completion Rule

A requirement is not considered complete merely because code/tests/build pass.

For user-facing workflows, completion requires as applicable:
1. backend implementation;
2. UI implementation;
3. focused tests;
4. runtime verification;
5. client/manual acceptance.

Agents must update this file when a requirement changes status.