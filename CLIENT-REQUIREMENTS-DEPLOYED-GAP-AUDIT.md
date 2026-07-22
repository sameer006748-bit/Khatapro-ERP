# KhataPro ERP — Client Requirements Deployed Gap Audit

**Audit date:** 2026-07-23 (Asia/Karachi)
**Scope:** graph-first, bounded static trace and deployed-runtime availability check only. No production data, SQL, migration, deployment or push was performed.

## Evidence standard and limitation

The required deployment URL is `https://khatapro-erp.vercel.app`. No callable browser/session was available, so authenticated UI clicks, persistence, role checks, print preview and production figures could not be verified. Per the locked definition, static components, routes, commits and tests are not runtime acceptance evidence. Every otherwise traceable workflow is therefore **BLOCKED FROM RUNTIME VERIFICATION** rather than COMPLETE.

The graph identifies `dashboard-shell.tsx`, owner dashboard/API, sale routes/data access, rider/COD routes, Setup routes/views and AI context/ask route as the relevant connected paths. `git log -S'Other Sale'` finds only the historical Phase 1 handoff commit; targeted `git grep` finds Other Sale in the requirement files and no `src/` implementation.

## Status totals

| COMPLETE | PARTIAL | MISSING | PLACEHOLDER / DISCONNECTED | BLOCKED FROM RUNTIME VERIFICATION |
|---:|---:|---:|---:|---:|
| 0 | 8 | 1 | 1 | 23 |

No overall percentage is shown.

## Requirement matrix

| ID | Requirement | Previous or New | UI / navigation evidence | Backend / accounting evidence | Runtime evidence | Status | Exact gap / files | Risk | Fix batch |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Home date range and summary | Previous | `OwnerDashboard`; sidebar Home; `?page=home` | `/api/dashboard/owner?from&to`, Karachi date utility | Browser unavailable | PARTIAL | UI presets are Today, **Yesterday**, This Week, This Month, Custom—not required Last 3/Last 7. Current snapshots are labelled. Missing proven client sections/period audit. `owner-dashboard.tsx`, `dates.ts` | High reporting mismatch | P1 |
| 2 | Counter Sale | Existing, not new credit | Daily Work → `counter-sale` → `CounterSaleView` | graph: `/api/sales/counter`, sale data access | Blocked | BLOCKED | Screen/API trace exists; save, stock, posting, permission and print need live proof. | High | P0 smoke |
| 3 | Online Sale | Existing, not new credit | Daily Work → `online-sale` | graph: `/api/sales/online`, delivery creation | Blocked | BLOCKED | Live rider assignment/COD/accounting not proven. | High | P0 smoke |
| 4 | OFC Sale | Existing, not new credit | Daily Work → `ofc-sale` | graph-linked sale data access | Blocked | BLOCKED | Live save/post/print/permission not proven. | High | P0 smoke |
| 5 | Other Sale | **New** | No nav key, route or view in `NAV_CATEGORIES`/ViewRouter | No targeted `src` match | None | MISSING | Dedicated screen, workflow, invoice type, print and integrations absent. | Critical | P1 |
| 6 | Linked sale return/net activity | Previous | Invoice/sales list return entry is statically present | Phase 2 linked-return RPC/static tests | Blocked | PARTIAL | Static evidence is a linked return flow, not proof of required mixed positive/negative current bill and period net presentation. | High | P1 |
| 7 | Product commission | Previous | No dedicated client acceptance UI proven | Phase 2 static path is collection-based; client baseline requires accrual on sale/return | Blocked | PARTIAL | Trigger/settlement semantics and all four sale types, especially Other Sale, are not proven aligned. | Critical | P1 |
| 8 | Owner sale attribution | Previous | Sale screens expose salesman selection (graph) | Phase 2 has owner-only branch | Blocked | BLOCKED | Owner posting/payable and reporting need live proof. | High | P1 |
| 9 | Online rider assignment | Previous | Delivery/Riders page exists | graph: `/api/sales/online`, riders/delivery routes | Blocked | BLOCKED | Assignment visibility and safe reassignment not verified. | High | P1 |
| 10 | Rider mobile assigned orders | Previous | `RiderDashboard`, Delivery view; mobile shell maps Rider Work to Delivery | `/api/rider-dashboard`, delivery routes | Blocked | BLOCKED | Cross-rider isolation and real status actions require authenticated proof. | Critical | P0 smoke |
| 11 | Partial delivery/partial return | Previous | Delivery UI exists | Phase 3 test covers return as non-financial | Blocked | PARTIAL | Quantity-level customer/stock/accounting effects for partial delivery are not proven. | High | P1 |
| 12 | Rider COD settlement batch | Previous | Delivery view/COD submit modal (graph) | `/api/rider-cod/balances`, `/settle`; static idempotency/security tests | Blocked | BLOCKED | Batch/accounting/role behavior must be executed on safe data. | Critical | P0 smoke |
| 13 | Readable identity for every transaction | Previous | Invoices show invoice number | Mixed identity sequences/RPC history | Blocked | PARTIAL | No bounded proof for all listed entities, print and concurrency rules. | Medium | P2 |
| 14 | Account categories/subcategories | Previous | Money accounts grouping | `account-subcategories.ts`; static assertions | Blocked | BLOCKED | Create/move/disable/persistence/report grouping need browser/database proof. | Medium | P2 |
| 15 | Multi-row Contra | Previous | Advanced Accounting → `contra-entry` | `/api/contra-entry`, operational-money/owner-equity; static atomicity tests | Blocked | BLOCKED | Runtime batch add/remove/save/print not proven. | High | P2 |
| 16 | Capital and Drawings | Previous | Money → `owner-capital` | `/api/owner-equity`, static posting tests | Blocked | BLOCKED | Correct live equity/cash entries require proof. | High | P2 |
| 17 | Professional documents | Previous | Shared invoice print dialog wired to sales list | Print component; static print tests | Blocked | PARTIAL | Counter/Online/OFC static only; Other Sale, purchase/return/receipt/payment/Contra documents and printer scaling absent/unverified. | High | P2 |
| 18 | Setup functionality | Client correction | Setup Overview cards now use the existing guarded `?page=` shell navigation: Business Accounts → `business-accounts`, Chart of Accounts → `coa`, Users & Roles → `users`, Permission Matrix → `permissions`, Audit Log → `audit`, Biz-Day Test → `biz-day-test`. Cards are semantic buttons only when their registered page is visible to the current user. | Some real APIs: business accounts GET/POST, roles GET/PUT, users, permissions, CoA, audit | Browser unavailable | BLOCKED FROM RUNTIME VERIFICATION | Static trace confirms every target is in `PAGE_REGISTRY`, resolves in `ViewRouter`, and retains the existing visibility gate. Click/back behavior, mobile tap use and authenticated page persistence remain unverified. `setup-view.tsx`, `dashboard-shell.tsx` | Critical misleading UI repaired; runtime proof outstanding | P0 |
| 19 | Roles/configurable permissions | Previous | Users/Permission Matrix sidebar entries, Owner gated | `/api/setup/roles` checks Owner and business ID; permissions route | Blocked | BLOCKED | Role changes/reload and enforcement across actual mutations not proven. | Critical | P0 |
| 20 | Customer ledger | Previous | Accounts/Sales paths | report/data-access graph links | Blocked | BLOCKED | UI/ledger reconciliation and permissions not proven. | High | P0 smoke |
| 21 | Vendor ledger | Previous | Vendors path | purchases data access graph links | Blocked | BLOCKED | UI/ledger reconciliation and permissions not proven. | High | P0 smoke |
| 22 | Trial Balance | Previous | Advanced Accounting → `trial-balance` | report data access/AI loader | Blocked | BLOCKED | Live debit=credit and drilldown not proven. | Critical | P0 smoke |
| 23 | General Ledger | Previous | Day Book/detail/ledger query guarded in shell | accounting/report data access | Blocked | BLOCKED | Live balance and role guard not proven. | High | P0 smoke |
| 24 | Profit & Loss | Previous | Reports path | `reportProfitLoss` used by AI context | Blocked | BLOCKED | Period/reconciliation not proven. | Critical | P0 smoke |
| 25 | Balance Sheet | Previous | Reports path | `reportBalanceSheet` used by AI context | Blocked | BLOCKED | As-of balance/reconciliation not proven. | Critical | P0 smoke |
| 26 | Accounts/balances | Previous | Money → Accounts & Balances | CoA/business-account queries | Blocked | BLOCKED | Real balance reload/reconciliation not proven. | High | P0 smoke |
| 27 | Petty Cash | Previous | Money → `petty-cash` | voucher/account paths | Blocked | BLOCKED | Mutation and ledger impact not proven. | High | P0 smoke |
| 28 | Opening balances | Previous | Advanced Accounting → `opening-balance` | posting path exists graph-side | Blocked | BLOCKED | Posting/idempotency needs live proof. | High | P0 smoke |
| 29 | Opening stock | Previous | Inventory/opening interfaces exist | closeout says migration 00013 applied; verification deferred | Blocked | BLOCKED | Controlled production proof (qty/WAC/value/voucher/retry) has not occurred. | Critical | P0 |
| 30 | Purchase and Purchase Return | Previous | Daily Work → Purchases/Vendors | `/api/purchases`; purchase data access | Blocked | PARTIAL | Purchase is traceable; a separate purchase-return client workflow/print is not proven. | High | P1 |
| 31 | Stock in/out/adjustment | Previous | Inventory route | product/stock data access graph links | Blocked | BLOCKED | Exact once mutation/live permissions not proven. | High | P0 smoke |
| 32 | Negative stock and temporary products | Previous | Stock/sale screens expose related UI per graph | products/sale data access | Blocked | BLOCKED | Required behavior across all sale types, especially missing Other Sale, not proven. | High | P1 |
| 33 | KhataPro AI accuracy/read-only | Client correction | AI panel now sends the Home-selected period (or labelled This Month default); responses display the active Karachi period. | `/api/ai/ask` resolves a strict server-side period using the session only; context reloads authorized business/role data and supplies labelled allowed financial values. Unsupported currency figures fall back safely. | Browser unavailable | BLOCKED FROM RUNTIME VERIFICATION | Proven root cause was a missing AI request period while `buildAiContext()` forced month-to-date. Focused static tests cover period validation, Home wiring, role/business guards, read-only rejection, snapshot labels and invented-number fallback. Authenticated reconciliation remains unverified. `ai-period.ts`, `ai-context.ts`, `ask/route.ts` | Critical decision risk reduced; runtime proof outstanding | P0 |

## Route and navigation reality map

All shell navigation is query-page based (`/?page=<key>`), not separate Next page routes. `resolveInitialPage` denies invisible page keys; invoice/ledger/voucher deep links are separately guarded. Mobile offers Home, role-resolved Work, Stock, Reports and More. Other Sale has no desktop, mobile or query-page entry.

| Sidebar group | Label / page key | Component / backend family | Permission gate | Reality |
|---|---|---|---|---|
| Home | Dashboard / `home` | `OwnerDashboard`; `/api/dashboard/owner` | role dashboard | Partial (wrong required presets) |
| Daily Work | Counter, Online, OFC / sale keys | respective views; sales counter/online routes | `can_create_sales` | Runtime blocked |
| Daily Work | Sales List, Delivery, Purchases, Vendors, Expense, Salesman Reports | views; sales/delivery/purchases/voucher APIs | listed `can_*` permission | Runtime blocked |
| Money | Accounts, Petty Cash, Capital & Drawings | views; accounting/operational money/equity APIs | listed permission / Owner | Runtime blocked |
| Inventory | Products & Stock | `InventoryView`; product/stock APIs | `can_view_products` | Runtime blocked |
| Advanced Accounting | Day Book, JV, Receipt, Payment, Contra, TB, Opening, CoA, Reports | listed views; voucher/report APIs | listed `can_*` permission | Runtime blocked |
| Settings | Setup Overview | `SetupView` | `can_view_setup` | Placeholder/disconnected cards |
| Settings | Business Accounts, Users, Permission Matrix, Audit, AI Settings, Biz-Day, Profile | listed views; Setup/audit/AI APIs | listed permission / Owner | Runtime blocked; card navigation disconnected |

## Setup card verdict

`SetupView` renders six cards—Business Accounts, Chart of Accounts, Users & Roles, Permission Matrix, Audit Log and Biz-Day Test—but each unlocked card is a non-interactive `div`; its “Open” label has no target or handler. This is a user-facing disconnected overview. It must become a real link/button (or stop implying action). Static trace also proves that it would be wrong to call every individual Setup page fake: Business Accounts sends POST to `/api/setup/business-accounts`, whose server route scopes `businessId`, requires `can_manage_setup`, creates account plus linked ledger in a transaction and writes an audit record. Roles PUT scopes the role to the current business, requires Owner and writes audit. Their deployed persistence and usability remain blocked.

## AI grounding verdict

The audit cannot attribute the reported figures to a live request without a browser/session/request ID. Static code rules out an obvious unscoped client call: the ask route loads the authenticated session; business context calls reports with `session.businessId`; Salesman and Rider have separate scopes; write-style prompts are rejected. However, Home selection is never an input to `buildAiContext`; `currentPeriod()` forces first-of-month through today. The assistant can therefore answer MTD while Home displays Today/custom. This is an unresolved, serious grounding and label-contract defect: answers must disclose the selected period/source or refuse unsupported figures. It remains P0 until a controlled live comparison proves no cross-business, stale or fallback data.

## Biggest false completion claims

1. “Counter/Online/OFC exist” was treated as completing the separate **Other Sale** requirement; it does not.
2. “Home date range complete” concealed wrong presets (Yesterday/This Week versus required Last 3/Last 7) and lacks runtime proof.
3. “Setup complete” conflated sidebar routes/APIs with a non-clickable overview card grid.
4. Static tests/commits were represented as client completion despite no authenticated runtime accounting, permission, mobile or printer evidence.

## Smallest safe implementation order

| Batch | Scope / exact files | DB/RPC and invariants | Focused tests and runtime acceptance | Risk / recommended model |
|---|---|---|---|---|
| P0-A | Repair Setup overview navigation: `src/components/erp/views/setup-view.tsx`; inspect only linked Setup views/routes. | No schema. Preserve existing permission gates; use real buttons/links. | Route click, forbidden role, create/update/reload each supported card. | Medium / GPT-5.6 Tera |
| P0-B | AI grounding: `src/lib/ai/ai-context.ts`, `src/app/api/ai/ask/route.ts`, Home range contract. | No writes. Pass/label explicit business-local period; retain business/role scope; never invent numbers. | Fixture comparison Home vs AI for Today/custom/MTD, Owner/Salesman/Rider isolation, unsupported data response; authenticated live capture with request ID. | Critical / GPT-5.6 Tera |
| P0-C | Controlled production smoke only, no feature work: graph-linked sales, rider, accounting/report endpoints. | No migration. Disposable labelled data only; check exact-once, balances, permissions and reports. | Owner/Rider/restricted-role browser run, preserve IDs/results. | Critical / GPT-5.6 Tera |
| P1-A | Other Sale foundation: new view/nav/query key; shared sale API/type/print entry points identified from Counter/OFC/Online. | Likely invoice type and server/RPC extension—first write an approved migration/RPC design. Shared sequence; customer mandatory; zero/partial payment; receivable; idempotent stock/accounting/commission/returns. | Unit/API/RPC tests plus customer credit/receipt/return/negative-stock/temp-item/runtime print flow. | Critical / GPT-5.6 Tera |
| P1-B | Home compliance: `owner-dashboard.tsx`, `use-owner-dashboard.ts`, `dates.ts`, owner API. | No duplicated formula; Karachi date labels; snapshots stay current. | Last 3/Last 7 boundaries, one shared range, live KPI reconcile. | High / GPT-5.6 Tera |
| P1-C | Return/commission/rider/purchase-return gaps across sale/data-access/rider routes. | Confirm exact accrual semantics before migration; immutable originals; one stock/voucher/commission movement. | Repeated submit, partials, Owner/Salesman, all four sales, settlement and ledger reconciliation. | Critical / GPT-5.6 Tera |
| P2 | Identity coverage, subcategories, Contra/capital/drawings and complete document matrix. | Preserve posting invariants; no fake contra; printable identity consistent. | Concurrency, report grouping, atomic batch, browser/PDF at 100% A4. | High / GPT-5.6 Tera |

## Validation performed

- Graph/document path check: completed; no unrestricted repository scan.
- Targeted route/navigation static trace: completed.
- Browser runtime check: blocked because no callable browser/session was available.
- Targeted static suites: **105/108 assertions passed**. Three failures are historical harness assertions: two compare an old baseline before committed migration `00018`; one expects a stale Phase 2 SQL text signature. They are not runtime proof and were not altered.
- `git diff --check`: passed before audit documentation. `git diff --name-only -- supabase/migrations`: empty. No migrations were changed by this audit.

## Required runtime evidence before any COMPLETE status

Use disposable labelled data and authenticated Owner, Rider and restricted-role sessions. For each claimed workflow record screen, route, request ID/identity, saved/reloaded result, stock/balance/voucher/report impact, and denied access result. For print, capture browser/PDF preview at A4 portrait 100% scaling. Stop on unexplained accounting, authorization or AI result.
