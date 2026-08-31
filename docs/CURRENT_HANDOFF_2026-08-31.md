# KhataPro ERP — Current Handoff (2026-08-31)

This document is the concise continuation handoff for the next chat/session. It was prepared on a docs-only branch while an active SOL implementation task was still running, so it intentionally distinguishes **verified completed work** from **work currently in progress**.

## Repository / Environment

- Repository: `sameer006748-bit/Khatapro-ERP`
- Main active implementation branch: `fix/backend-stock-recovery`
- Docs-only handoff branch: `docs/handoff-2026-08-31`
- Latest implementation commit verified before the current SOL task: `bf1c24ffcef44d7e5fe3648d4758554c1dad470f`
- Production Supabase project ref: `ebcebxwpddltiwrqybqc`
- Production schema: verified **legacy/original** schema rooted at `business`, not the newer UUID-ledger architecture.
- Vercel production app: `https://khatapro-erp.vercel.app`

## Protected / Local-Only Files

Never stage, overwrite, or expose these unless explicitly required:

- `.env`
- `.env.local`
- `.env.vercel-production`
- `db/custom.db`
- `db/custom.db.bak-before-stockrecover`
- `task_progress.md`
- `.vscode/`
- `graphify-out/`
- `supabase/.temp/`
- reconciliation/probe/generated artifacts

Secrets must never be pasted into chat, logs, commits, or test output.

## Production Migration State

Verified current production state:

- `00013` — already applied historically.
- `00033_mixed_sale_returns.sql` — prepared but **NOT APPLIED**; do not broad-apply it.
- `00034` / `00035` — later-architecture migrations and **not suitable for direct application** to verified legacy production.
- `00036_legacy_transaction_identity_bridge.sql` — **APPLIED + VERIFIED**.
- `00037_legacy_historical_sales_returns.sql` — **APPLIED + VERIFIED**.
- `00038_legacy_contra_batch.sql` — **APPLIED + VERIFIED**.
- `00039_legacy_rider_delivery_outcomes.sql` — **APPLIED + VERIFIED**.
- `00040_legacy_business_accounts.sql` — **APPLIED + VERIFIED**. The source-of-truth migration now correctly uses `extensions.digest(...)` while keeping `SET search_path = public`.
- `00041_legacy_business_accounts_type_fix.sql` — **APPLIED + VERIFIED**. It fixes the production `profiles.id` TEXT vs RPC UUID comparison via `p_actor_profile_id::text`.

Do not use broad migration commands. Production migration work must always be exact-file, preflighted, and scoped.

## Major Completed Work

### Sales / Returns / Commission

Implemented and test/runtime verified across the current architecture:

- shared sale domain engine for Counter, Online, OFC/Out-of-City, and Other Sale;
- same-bill Sold / Returned / Net arithmetic;
- historical/pure Sales Return linked to immutable original invoice item;
- stock restoration and over-return protection;
- item-level product commission;
- Owner vs Salesman commission attribution;
- earned-on-collection behavior;
- idempotency and business isolation;
- invoice-linked commission/return visibility.

Known manually verified example: Sold 10, Returned 2, Net 8, stock effect -8, commission Rs 20 × 8 = Rs 160.

### Rider Phase A

Closed and pushed before the final handover pass:

- partial delivery / partial return;
- remaining quantities;
- Rider COD balances;
- settlement flow;
- DO identities / RDS settlement support;
- legacy schema compatibility;
- service-role-only database access;
- simplified rider-facing controls.

Production financial/browser UAT remains part of final client-style verification where safe.

### Invoice / Print Phase B

Implemented:

- shared professional print renderer;
- Counter / Online / OFC invoices;
- Sales Return;
- Purchase Bill;
- Purchase Return;
- Half A4;
- Two-up A4;
- Full A4;
- existing 80mm thermal support;
- original-document references for returns;
- Online rider/COD/delivery fields where actual data exists;
- customer copies exclude internal account/commission mechanics.

Technical gates passed. **Actual browser print-preview visual sign-off remains pending.**

### Client Blocker Batch 1

Completed:

- Trial Balance main page recovered to the verified legacy report path;
- Audit Log recovered to a supported production source;
- page-level failures now preserve the application shell and show retryable inline states;
- client-visible migration/backend terminology was reduced;
- `Supabase live` was replaced with client-safe status wording such as `System Online`.

### Client Polish Batch 2

Completed:

- unified `lucide-react` icon system;
- semantic navigation icons;
- restrained green active states;
- improved hover/focus treatment;
- `Daily Work` wording;
- `Out-of-City Sale` wording;
- `Roles & Permissions` wording;
- `Biz-Day Test` removed from normal navigation while preserving the owner-only diagnostic route;
- floating and AI controls visually aligned;
- desktop/mobile navigation share the same icon language.

### Client Onboarding Batch

Completed:

- versioned user-scoped localStorage key: `khataPro:onboarding:v1:<user-id>`;
- Owner/Admin tour: 9 steps;
- Accountant: 7 steps;
- Salesman: 5 steps;
- Rider: 3 delivery-focused steps;
- contextual help on 18 major pages;
- restart action in My Profile;
- mobile navigation-aware tour behavior;
- keyboard/focus/reduced-motion accessibility support.

### Business Accounts Production Blocker

**CLOSED.**

Production legacy Business Accounts now support:

- list;
- create;
- idempotent create retry;
- update/rename;
- activate/deactivate;
- guarded delete;
- atomic linked `accounts` + `business_accounts` writes;
- concurrency-safe code allocation;
- audit history;
- no UUID-ledger dependency;
- no production Prisma/SQLite fallback when Supabase is configured.

Production UAT created a temporary account at code `1060`, verified retry/update/deactivate/delete, and cleaned the temporary account. Immutable audit/idempotency metadata remains by design.

Migration source-of-truth cleanup was completed at commit `bf1c24ffcef44d7e5fe3648d4758554c1dad470f`.

## Current Active SOL Task — DO NOT MARK COMPLETE YET

SOL is currently implementing one bounded batch:

**Counter Sale 10/10 POS redesign + shared sale payment-account integration fix.**

Confirmed root cause before implementation:

- Business Accounts page correctly sees the legacy production account (for example CASH / 1060).
- Counter Sale still sourced payment accounts indirectly from `/api/setup/coa`.
- `/api/setup/coa` still uses generic UUID-ledger accounting availability.
- On legacy production that can return `categories: []`, so Counter Sale incorrectly sees zero payment accounts and shows the accounting-unavailable / no-account state.

The active SOL task is intended to:

- use the supported Business Accounts source directly for payment accounts;
- share that payment-account source across Counter / Online / Out-of-City / Other Sale;
- auto-select the single active payment account;
- show a correct upfront zero-account setup state instead of trapping a half-built bill;
- redesign Counter Sale as a high-speed two-panel POS;
- eliminate default horizontal item-table scrolling;
- move return/rate/commission/stock detail behind row expansion;
- collapse payment by default with Edit access;
- keep Net Sale + Post Sale visible in a sticky bill footer;
- preserve keyboard product search/add;
- preserve same-bill returns, commission, split payments, Owner/Salesman attribution;
- preserve usable mobile behavior while optimizing desktop POS at 1366×720.

**Wait for SOL's final report before treating any of the above as completed or updating the active branch status.**

## Newly Observed Unresolved Production Problems

These were observed manually while SOL was still working and must be revisited after its result.

### 1. Expense Batch unavailable

Visible message:

`This accounting feature is currently unavailable.`

Confirmed current code reason:

- Expense Batch loads `/api/setup/coa`;
- derives Asset/payment accounts and Expense accounts from that response;
- if `availability.accounting === false`, it stops the entire page.

This is likely another legacy production compatibility issue, not merely a UI problem.

### 2. Accounts & Balances shows accounting unavailable

The page displays useful money data but still shows the accounting-unavailable banner. This indicates mixed operational/legacy data is available while one generic accounting capability flag remains false.

### 3. Day Book shows accounting unavailable

The Day Book currently shows the same unavailable banner and no vouchers under the observed state. It needs legacy-path verification rather than an assumption that the page is genuinely empty.

### 4. Trial Balance drill-down/detail request fails

The Trial Balance main page now opens, but clicking an entry/detail produced:

```json
{
  "error": "REQUEST_FAILED",
  "message": "The request could not be completed.",
  "requestId": "c9b7c4ed-53b1-4bb9-8600-3db7233ddc7e"
}
```

This suggests the main Trial Balance list path and its detail/drill-down path are not using the same compatible production contract. Trace the exact request ID / route before changing code.

### 5. Broader accounting compatibility risk

Multiple accounting pages still appear to depend on the generic `/api/setup/coa` or UUID-ledger availability model even though production is legacy-schema based. Do not patch each banner independently without first mapping which pages need:

- legacy Business Accounts;
- legacy Chart of Accounts/account categories;
- legacy vouchers/day book;
- legacy report RPCs;
- operational-money RPCs.

The next accounting batch should be a bounded compatibility audit/fix, not a cosmetic banner removal.

## Owner Dashboard / Home — Approved Redesign Direction

Senior review correctly identified that the current Home screen is not professional enough for final client handover. Key issues:

- same metrics repeated multiple times;
- `NO DATA` messaging can visually contradict current balances/alerts;
- `Rs 0` and `Not available` are not clearly distinguished;
- date-range changes can cause full-page skeleton flashes and reset scroll position;
- inconsistent English / Roman Urdu section naming;
- raw `\u00B7` escape text can render literally;
- too many KPI cards with equal weight;
- useful advanced activity is buried at the bottom.

Refined target architecture:

### Tier 1 — Owner hero metrics

Keep to roughly four high-value numbers, for example:

- Sales;
- Net Cash Movement;
- Receivables;
- Payables.

Do not repeat the exact same headline figure elsewhere on the page.

### Tier 2 — Needs Attention

An actionable queue only, for example:

- low / negative stock;
- overdue receivables;
- overdue payables;
- missing setup/payment account;
- unsettled Rider/COD where relevant;
- workflow blockers.

Every item should have a direct action. Hide the section entirely when there is nothing actionable.

### Tier 3 — Breakdowns / Activity

Use compact breakdown sections/accordions for:

- income sources;
- outflows;
- obligations;
- advanced activity.

Do not collapse every useful item by default. One primary business-flow breakdown may remain open, and recent meaningful activity can remain visible in compact form.

Additional requirements:

- filter changes update data in place and preserve scroll position;
- clearly distinguish true zero from not-tracked/unavailable;
- use one consistent UI language by default (English recommended);
- remove raw escape sequences such as literal `\u00B7`;
- no duplicated KPI figures;
- first viewport answers: **How is the business doing, and what needs attention?**

## Broader UI/UX Assessment

The project is functionally strong but still has a visible generic-admin-template feel in several places. The final quality pass should treat UI/UX as a system, not as random page-by-page decoration.

Patterns observed:

- inconsistent information density;
- too many cards / cards inside cards;
- weak prioritization of actionable vs informational data;
- long-form layouts for high-frequency workflows;
- generic/unavailable states leaking into otherwise usable pages;
- inconsistent empty/loading/error patterns;
- some technical wording still appears in fallback paths;
- dashboard hierarchy needs work;
- mobile must be explicitly verified for every user-facing batch.

The correct final direction is a **global UX audit + prioritized screen polish**, after the accounting compatibility blockers are closed.

## Mobile Acceptance Rule Going Forward

Every user-facing UI task must explicitly cover:

1. desktop behavior;
2. mobile/narrow behavior;
3. at least one actual narrow/mobile verification step when browser tooling is available.

Priority differs by workflow:

- Rider — mobile-first;
- Counter Sale — desktop POS first, mobile-safe;
- reports/accounting — desktop-primary, mobile-readable;
- onboarding — desktop + mobile;
- settings/business accounts — desktop + mobile.

## Test / Verification Baseline

Latest known full regression baseline before the currently running SOL task: **530/530 passing**.

Later migration-only source-of-truth cleanup had focused migration tests passing 12/12.

The current SOL Counter Sale/payment task is expected to rerun the relevant focused suites, full regression, TypeScript, ESLint, build, and `git diff --check` before completion.

## Final Handover Reality

Do **not** describe the system as 100% ready yet.

Major backend/product foundations are essentially complete, but client handover still requires:

- current SOL POS/payment task completion;
- accounting compatibility blockers closure;
- Home dashboard redesign;
- global UX consistency pass;
- actual browser/mobile/print visual verification;
- role-wise final smoke testing;
- final client credentials and client UAT.

No new broad backend architecture phase should be started unless final runtime testing exposes a real business-rule defect.
