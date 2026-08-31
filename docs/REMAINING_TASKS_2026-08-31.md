# KhataPro ERP — Remaining Tasks with Reasons (2026-08-31)

This is the prioritized remaining-work list for the next chat/session. It deliberately separates **active work already in progress** from **work that should start only after that result is known**.

## Priority 0 — Wait for the active SOL task to finish

### Task
Counter Sale 10/10 POS redesign + shared payment-account integration for Counter / Online / Out-of-City / Other Sale.

### Why this is first
The confirmed payment-account bug is shared infrastructure: Business Accounts production management works, but sale screens still derive payment accounts from `/api/setup/coa`, which can return an empty legacy-incompatible result. Starting another shared accounting/payment refactor before SOL finishes risks duplicate or conflicting edits.

### Expected closure evidence
- supported Business Accounts source used by all sale channels;
- CASH 1060 visible/selectable;
- one active account auto-selects;
- zero-account state blocks upfront rather than trapping a built bill;
- Counter Sale two-panel POS at 1366×720;
- no default horizontal item scroll;
- sticky Net Sale + Post Sale;
- keyboard search/add preserved;
- same-bill returns, split payment, commission and attribution preserved;
- mobile remains usable;
- tests/TypeScript/lint/build/full regression green;
- commit pushed/synced.

Do not mark this task complete until SOL's final report arrives.

---

## Priority 1 — Legacy Accounting Compatibility Batch

### Problem
Several accounting screens still display `This accounting feature is currently unavailable` or fail on deeper requests despite production having usable legacy accounting data.

Observed examples:

- Expense Batch — fully unavailable;
- Accounts & Balances — useful money data present but accounting-unavailable banner still shown;
- Day Book — unavailable banner and empty voucher view;
- Trial Balance — main page opens, but drill-down/detail request returned `REQUEST_FAILED` with request ID `c9b7c4ed-53b1-4bb9-8600-3db7233ddc7e`.

### Likely reason
The app still has mixed assumptions between:

- generic UUID-ledger availability;
- legacy `accounts` / `account_categories` / `vouchers`;
- operational-money RPCs;
- legacy report RPCs;
- new Business Accounts RPCs.

Some pages still use `/api/setup/coa` or generic accounting capability checks that are not the correct source for legacy production.

### Correct direction
Do a bounded page-to-data-source map before editing:

1. identify every client-visible accounting screen that shows unavailable;
2. map the actual data it needs;
3. determine the correct legacy source for each;
4. fix shared compatibility at the appropriate layer rather than hiding banners page-by-page;
5. trace Trial Balance drill-down separately through its exact API/data-access path;
6. preserve business isolation, permissions, debit/credit correctness, and audit/accounting semantics.

### Why this is high priority
These are client-visible functional blockers, not cosmetic defects. The ERP cannot be handed over as an accounting-first product while core accounting pages appear disabled.

### Completion evidence
- Expense Batch loads and uses valid legacy payment/expense accounts;
- Accounts & Balances no longer claims accounting unavailable when usable data exists;
- Day Book loads real legacy voucher activity correctly;
- Trial Balance drill-down works or returns a legitimate business-facing empty state;
- no migration/schema/RPC/backend language exposed to client;
- browser runtime verified for Owner/Admin and Accountant where permissions allow;
- mobile readable;
- full regression/build green.

---

## Priority 2 — Owner Dashboard / Home 10/10 Redesign

### Problem
Senior review identified information-architecture and polish problems, not merely styling issues:

- repeated metrics;
- contradictory `NO DATA` vs populated balance cards;
- no distinction between genuine zero and unavailable/not-tracked data;
- full-page skeleton/reload behavior when changing date range;
- scroll position reset;
- mixed English and Roman Urdu headings;
- literal `\u00B7` escape rendering;
- too many equal-weight KPI cards;
- useful advanced activity buried below long scroll.

### Refined target
Treat Home as an **Owner Command Center**, not a report dump.

#### Tier 1 — Hero metrics
Approximately four headline numbers maximum, such as:

- Sales;
- Net Cash Movement;
- Receivables;
- Payables.

Each headline figure appears once only.

#### Tier 2 — Needs Attention
Short actionable queue only:

- low/negative stock;
- overdue receivables;
- overdue payables;
- missing setup/payment account;
- unsettled Rider/COD where relevant;
- workflow blockers.

Every item has a direct CTA. Hide the whole section when nothing needs attention.

#### Tier 3 — Breakdown / activity
Compact business-flow breakdowns for income sources, outflows, obligations and advanced activity. Do not bury all useful content behind collapsed accordions; one primary breakdown/recent activity strip may remain visible.

### Additional requirements
- period changes update values in place;
- scroll position preserved;
- no full-page skeleton flash;
- true `Rs 0` vs `Not tracked yet` visually distinct;
- one intentional UI language by default (English recommended);
- fix all literal raw unicode escape text;
- no duplicated headline figures;
- first viewport answers: **How is my business doing and what needs attention?**

### Why after accounting compatibility
Dashboard numbers and attention items depend on reliable accounting/report sources. Redesigning around unstable/unavailable data contracts would cause rework.

---

## Priority 3 — Global UX / Design-System Quality Pass

### Problem
Functionality is strong, but several screens still visually resemble a generic admin template.

Observed systemic issues:

- inconsistent density and spacing;
- cards nested inside cards;
- weak priority between action-needed and informational states;
- high-frequency workflows presented as long forms;
- inconsistent empty/loading/error behavior;
- client-safe wording not universal on fallback paths;
- tables/forms sometimes expose too much detail by default;
- help/AI/floating controls need consistency checks across pages;
- responsive/mobile behavior has not been visually signed off everywhere.

### Scope
Do a structured UI audit and prioritize high-traffic/high-stakes pages rather than redesigning everything equally.

Recommended order:

1. Home;
2. Daily Work / sales pages after Counter Sale;
3. Money/accounting pages;
4. inventory/products;
5. setup/users/permissions;
6. reports;
7. low-frequency diagnostics/admin-only surfaces.

### Global standards to enforce
- consistent page title/subtitle hierarchy;
- consistent card/table density;
- standard loading skeleton behavior;
- standard zero / empty / unavailable / error states;
- consistent action hierarchy (primary / secondary / destructive);
- no developer terminology;
- semantic `lucide-react` icons;
- keyboard/focus accessibility;
- desktop + mobile acceptance for every user-facing batch.

### Why this matters
Client confidence is affected by consistency as much as raw functionality. The final pass should make KhataPro feel like one coherent product rather than many individually-built pages.

---

## Priority 4 — Production QA/Test Product Cleanup

### Observed data
Visible production/demo list currently includes obvious test-looking items such as:

- `QA TEST FABRIC 01`;
- `QA TEST NEGATIVE STOCK 01`;
- `QA TEST TEMP ITEM 01`;
- duplicate-looking `vacuum` / `VACUUM`.

### Do not do
Do not blindly delete by name or prefix.

### Correct direction
1. inspect transaction / invoice / stock-movement linkage;
2. distinguish safe disposable test records from referenced history;
3. delete only truly unreferenced disposable data;
4. otherwise deactivate/archive/hide from normal active product selection through legitimate business rules;
5. preserve accounting and audit history.

### Why this matters
Test data makes the app look broken/unprofessional during demos, but destructive cleanup can corrupt historical references.

---

## Priority 5 — Actual Browser / Mobile / Print Visual Verification

### Required browser smoke matrix

#### Owner/Admin
- Home;
- Counter Sale;
- Online / Out-of-City / Other Sale;
- Business Accounts;
- Expense Batch;
- Accounts & Balances;
- Day Book;
- Trial Balance + drill-down;
- Contra;
- Users/Roles;
- Audit Log;
- onboarding restart.

#### Accountant
- permitted money/accounting/report pages;
- no owner-only control leakage.

#### Salesman
- allowed sales workflows;
- seller/commission attribution;
- no accounting/admin leakage.

#### Rider
- assigned orders;
- Delivered / Partial / Returned / Partial Return;
- remaining COD;
- mobile-first usability.

### Mobile acceptance
Every user-facing screen should be checked at a realistic narrow viewport for:

- no clipped content;
- no off-screen dialogs/dropdowns;
- adequate tap targets;
- readable tables/cards;
- appropriate navigation behavior;
- no desktop-only critical action.

### Print acceptance
Actual browser print preview still needs visual sign-off for:

- Half A4;
- Two-up A4;
- Full A4;
- 80mm receipt.

Check:

- no clipping;
- no unexpected blank pages;
- sensible page breaks;
- long-name wrapping;
- many-line invoices;
- no internal commission/accounting details on customer copy.

### Why this remains required
Build/tests cannot prove visual print layout, viewport behavior, or real browser interaction quality.

---

## Priority 6 — Final Client Credentials / Handover

### Current known test users
Repository seed/test credentials historically include:

- `owner@test.local` — Owner/Admin;
- `accountant@test.local` — Accountant;
- `salesman@test.local` — Salesman;
- `rider@test.local` — Rider.

Do not use shared test passwords as final client credentials.

### Final handover actions
- create/confirm proper client-named users;
- set strong unique passwords;
- verify role permissions;
- remove/disable unnecessary test access where safe;
- provide a short role-wise login sheet to the client;
- use the role-based onboarding tour for first login;
- explain how to restart the tour from My Profile;
- conduct final client UAT.

### Why last
Credentials should be finalized only after UI/runtime blockers are closed, otherwise the client receives a product that still exposes unfinished states.

---

## Pending / Caution Items That Must Not Be Forgotten

- `00033_mixed_sale_returns.sql` remains NOT APPLIED. Do not apply it casually; production legacy behavior is already handled through scoped later migrations where applicable.
- `00034` / `00035` are not direct legacy-production migrations.
- readable category/subcategory code-word management still needs final legacy-compatible/client acceptance review if the requirement remains in final scope.
- actual unpaid → collection → commission-earned end-to-end runtime verification remains useful in final UAT.
- real Rider financial/browser UAT should be done only with a safe test scenario.
- print visual approval remains pending.
- client sign-off has not happened yet.

---

## Recommended Next-Chat Work Order

1. **Read SOL's Counter Sale/payment final report first.**
2. Update the active implementation branch docs with its verified result.
3. Run the **legacy accounting compatibility batch** for Expense Batch, Accounts & Balances, Day Book, Trial Balance drill-down, and any other client-visible unavailable accounting pages.
4. Redesign **Owner Dashboard/Home** using the approved three-tier command-center model.
5. Run the **global UX/design-system audit and priority polish**.
6. Safely clean obvious QA/demo product data after linkage checks.
7. Perform full **browser/mobile/print smoke testing** role-by-role.
8. Finalize **client credentials + guided onboarding + client UAT**.

No new broad backend architecture phase should be started unless one of these runtime checks proves a real business-rule or data-integrity gap.
