# KhataPro ERP — Client Requirements Source of Truth

Last updated: 2026-08-30

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
✅ High-speed two-panel POS redesign implemented and regression-tested.

Current design includes:
- fixed-height desktop workspace with independently scrolling product and bill panels;
- product finder/search with in-stock products presented first;
- keyboard navigation and Enter-to-add;
- stock/low-stock state;
- compact Owner/Salesman and optional-customer bill header;
- compact default Product / Qty / Total item rows;
- expandable returned quantity, net, rate, commission, stock, and remove controls;
- collapsed-by-default payment summary with explicit edit/full-payment action;
- always-visible Net Sale and Post Sale footer with a disabled reason.

### Remaining Counter Sale UI work
🟡 Automated and static verification is complete, but final 1366×720 and narrow-viewport browser sign-off remains pending because no browser session was connected in the implementation environment.

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

🟡 Pure historical return is implemented and locally runtime-verified. The shared Sales List → original invoice → original line flow supports Counter, Online, OFC, and Other invoices and shows original sold, previously returned, and remaining returnable quantities. It posts Sold 0 / Return X against the immutable original invoice item.

Implemented safety and accounting behavior:
- business and invoice-item linkage is verified server-side;
- cumulative over-return, zero/negative quantities, and duplicate lines are rejected;
- stock restoration, return voucher, return line, invoice returned-quantity cache, commission adjustment, refund/customer credit, SRT allocation, and idempotency are atomic;
- immediate refunds use an active user-managed business account;
- customer credit remains explicitly visible as due;
- original invoice sold quantities are never mutated.

Local disposable-database runtime verification posted `SRT-0001`, preserved original Sold 10, increased Returned by 1, restored stock by 1, and replayed the same SRT for the same idempotency key.

Production activation: additive migration `00037_legacy_historical_sales_returns.sql` was applied to production (2026-08-29) after a one-line schema correction (`v_invoice.status` → `v_invoice.is_cancelled`, because production `invoices` has no `status` column). The production schema was verified read-only. Production browser/UAT runtime verification of a real historical return remains pending (no safe isolated test business exists).

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
✅ Rider Phase A code and production schema are complete. Migration
`00039_legacy_rider_delivery_outcomes.sql` was applied and verified in production on
2026-08-30, including partial delivery/return, DO identities, Rider COD balances,
RDS settlements, legacy-table compatibility, and service-role-only database access.
🟡 Production financial/browser UAT remains pending because production contains only
the real `biz-default` business; no Rider/COD/voucher transaction was created for testing.
🟡 Final simplified rider UI acceptance remains pending.

## Entry Identity Numbers

### Requirement
Every accounting/business transaction category must have its own human-readable identity prefix and sequential number, for example:
- `INV-0001` invoice
- `PUR-0001` purchase
- `EXP-0001` expense

The identity must appear with the entry everywhere it is referenced.

### Current status
🟡 The verified production database uses the legacy/original schema. Existing
`INV`, `PUR`, and `EXP` numbers are already correct; historic `CV`, `RV`, `JV`,
`PRN`, and legacy sales-return references must remain unchanged.

🟡 Additive migration `00036_legacy_transaction_identity_bridge.sql` is prepared
but **NOT APPLIED**. It gives new legacy-schema postings `CON`, `REC`, `PAY`,
`JRV`, `PRT`, and `SRT`, keeps `INV`/`PUR`/`EXP`/`CS`, adds the missing
`sales_returns.return_no`, and provides business-scoped monotonic allocation
plus idempotent retry protection.

❌ `STA`, `STM`, `OPS`, `RDS`, `COM`, `CAP`, `DRW`, and `DO` remain pending where
the legacy application has no compatible readable-identity posting path. No
unrelated workflow is to be fabricated merely to issue a number.

Migrations 00033, 00034, and 00035 target later architecture and are not suitable
for direct application to the verified legacy production schema.

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
✅ Sale payment-account discovery now uses the supported Business Accounts API directly across Counter, Online, Out-of-City, and Other Sale; it no longer depends on Chart of Accounts or UUID-ledger availability.

Current behavior includes:
- user-created payment accounts;
- canonical account types;
- edit/activate/deactivate/guarded-delete;
- one cached active-account projection shared across all four sale channels;
- the linked ledger account ID/code/name used for posting and display;
- exactly one active account auto-selected, while multiple accounts require an explicit choice;
- inactive accounts excluded from new sale selection;
- Counter Sale loading state followed by an upfront zero-account setup guard before bill construction;
- account-ID persistence;
- split payment support.

The production-compatible legacy Business Accounts path is therefore eligible to supply accounts such as `CASH · 1060` to sale screens. Production/browser visual confirmation remains pending; no production financial write was made in this implementation batch.

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
- `00036_legacy_transaction_identity_bridge.sql` is applied in production.
- `00037_legacy_historical_sales_returns.sql` is APPLIED in production (2026-08-29); it is the scoped legacy-schema activation for partial/historical sales returns.
- `00038_legacy_contra_batch.sql` is APPLIED in production (2026-08-29).
- `00039_legacy_rider_delivery_outcomes.sql` is APPLIED in production (2026-08-30); its exact production definitions and unchanged historical Rider/COD row counts were verified read-only.
- `00040_legacy_business_accounts.sql` is APPLIED to production (2026-08-31); it is the additive legacy-schema Business Accounts compatibility path.
- `00041_legacy_business_accounts_type_fix.sql` is APPLIED to production (2026-08-31); it recreates the four Business Accounts RPCs with `p.id = p_actor_profile_id::text` (production `profiles.id` is TEXT, so the 00040 un-cast comparison failed at runtime with SQLSTATE 42883 `operator does not exist: text = uuid`). After 00041, Business Accounts list/create/update/deactivate/delete and idempotent-create retry were runtime verified (43/43) via the service-role data path; the temporary UAT account was cleaned up; no UUID-ledger dependency and no Prisma/SQLite production fallback.
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

## Transaction identities and readable accounting code words — implementation update (2026-08-28)

🟡 Implemented and test-verified in source: shared business-scoped identity allocation for Prisma sales/purchases/purchase returns; additive migration  0034 supplies the full readable prefix registry and account-subcategory code-word schema/RPCs; Account Categories UI includes Name + Code Word, displays code words, and supports code editing.

🟡 Migration-safe compatibility verified locally: without the optional migration, Account Categories returns a clear migration-required state and mutation returns 409 rather than crashing.

❌ Do not mark final client acceptance complete yet:  0034 has deliberately not been applied, so migration-backed category create/duplicate/edit and all Supabase transaction posting prefixes still require a disposable-local schema application and browser workflow verification.


## Verification update - 2026-08-29

Top-level fixed category families now expose canonical readable code words through the existing architecture. Persisted subcategories require normalized readable code words, with business-scoped uniqueness, duplicate validation, editable codes, and relational IDs preserved. Migration 00035 adds the fixed-parent mapping and does not add a parallel category table.

Focused tests pass against an isolated disposable SQLite copy. The localhost app shell returned 200 and the protected category API returned 401 without a session. Authenticated schema-backed CRUD and migration application remain pending because no project-configured local PostgreSQL endpoint was available; the non-local disposable URL was not used.

## Multi-row Contra / Internal Transfer + Owner Drawings — implementation update (2026-08-29)

Implemented in source and locally focused-test-verified: an expandable multi-row Contra
workflow that supports pure internal transfers (Bank/Cash/Petty Cash and business-account
moves; asset-to-asset with no income/expense/equity effect) and Owner Drawings (debit
Owner Drawings 3020, credit the selected source asset; never faked as an asset-to-asset
contra).

Additive migration `00038_legacy_contra_batch.sql` is APPLIED to production (2026-08-29) after
a one-line signature correction (all parameters are now required, matching the 00036 pattern).
It adds one readable CON batch identity per batch, an atomic multi-row posting RPC
(`post_contra_batch`), one balanced voucher per batch, server-side validation and business
isolation, and service_role-only grants; it also adds the legacy operational-money list
RPCs so the Contra screen can load accounts in production. The existing single-row contra
path (`post_contra_entry`) and all historic entries remain untouched.

Production schema verified read-only after application. Read-only screen loading verified
(accounts + historic activity resolve). A real multi-row / drawings batch remains unverified
in a browser because no safe isolated test business exists and no financial transaction was
created for testing.
