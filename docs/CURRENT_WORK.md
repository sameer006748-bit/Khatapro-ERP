# KhataPro ERP — Current Work

Last updated: **2026-09-10**

Read `docs/PROJECT_MEMORY.md` first for the complete A-to-Z handoff/history/future context.

## Current version
**Version 1 — Client UAT / Handover.**

Version 2 intelligent/proactive product work remains deferred until the client receives and approves Version 1.

## Current phase
**Client UAT / Handover freeze. Recovery implementation is complete and final user manual AI/print verification has passed.**

The deep-UAT recovery cycle closed its known release blockers: Trial Balance/report reconciliation, AI units/language/reliability, Rider false-empty loading, encoding, source-level performance, invoice/print output and isolation, Salesman access, and invoice settlement summaries. The official checkpoint is `v1.0.0-client-uat` on the final clean `main` commit for this documentation update. This is not final client approval.

## Current objective
Support Client UAT and handover. Handle client-reported defects only as bounded Version 1 hotfixes; do not add V1 features during the freeze.

The acceptance standard is not merely green tests. The live stable URL must behave correctly:

`https://khatapro-erp.vercel.app`

## Why this is next
The user confirmed the final AI and print fixes. Free AI-provider quota/rate-limit/latency remains an operational follow-up; a paid production key is planned, but it is not an application-code release blocker.

No agent should claim final client approval or create `v1.0.0` until explicit client acceptance.

---

# Already complete / do not re-audit by default

## Core release foundation
- sales/returns/commissions foundations,
- Cash/Bank business-account model,
- readable business-account identities,
- simple account categories + auto-linked ledgers,
- Expense Batch recovery,
- Rider identity/relinking and thumb-first UX,
- navigation/invoice recovery,
- permission denial response recovery,
- AI encryption/connectivity recovery,
- shared invoice print foundation.

## Settled production migration facts
Verified previously; do not re-verify/re-apply without new directly relevant evidence:
- `00037` applied,
- `00038` applied,
- `00039` applied,
- `00040` applied,
- `00041` applied,
- `00042` applied,
- business-account identity migration applied,
- `00012` opening stock not applied and remains an accepted Version 1 limitation with Stock Entry workaround.

## Recent important recovery commits
- `e9a7a93` — mobile More / invoice-navigation recovery work.
- `088128a` — Version 1 closeout batch / product-create recovery and broader release gates.
- `ffc5493` — guarded API denial 500→clean 403 recovery.
- `75319bc` — AI output-token budget 800→2048 to stop `MAX_TOKENS` truncation.

Check current `main` before treating these as HEAD; documentation commits may follow without changing application behavior.

## AI connectivity state
Live recovery achieved:
- Save Key PASS,
- Test Connection PASS,
- model `gemini-3.5-flash`,
- basic Ask PASS,
- business-data Ask PASS.

Do not reopen AI configuration/decryption/model-access unless live evidence shows that path failed again.

The remaining AI defects are **not connectivity**; Roman Urdu enforcement and retry/latency UX remain after the money-unit and period-semantics fixes below.

---

# Completed in this recovery

## P0 — accounting and deterministic trust

### 1. Trial Balance difference Rs 2,505.00 — fixed in source
Production evidence proved Day Book/source ledger balance. The legacy RPC omitted four debit lines held by inactive accounts: INV-0002 on Easypaisa 1040 for Rs 2,250 and INV-0007/8/9 on CASH 1060 for Rs 25/Rs 150/Rs 80. The replacement reader includes inactive accounts with posted history and applies cancellation/date filters to voucher lines before aggregation. Expected all-time result: Rs 206,306.55 debit = Rs 206,306.55 credit. No database rows changed.

### 2. AI money-unit scaling ~100× — fixed in source
Database/RPC/TypeScript stay in integer paisas. The AI boundary converts once to exact two-decimal rupee strings, uses explicit `*Rupees`/`amountRupees` names, and no longer allows raw paisa magnitudes as PKR answers. Exact regressions cover Rs 20,000.00, Rs 21,313.45 and Rs 150,100.00.

### 3. Today and Cash/Bank semantics — fixed in source
- Today sales/expenses/cash movement/profit/Trial Balance are period flows; Balance Sheet is as-of period end; receivables/payables/inventory are current snapshots.
- Financial Reports and Accounts & Balances both intend active configured business money. The report's stale fixed-code list omitted custom UBL 1061; it now uses the configured active Asset business-account set.

# Exact next step

**DEPLOY THE BOUNDED API TIMING CHANGE, VERIFY THE STABLE PRODUCTION ALIAS, AND CAPTURE CORRELATED SERVER LOGS.**

For each measured GET route (`/api/dashboard/owner`, `/api/sales/counter`, `/api/setup/business-accounts`, `/api/products`, `/api/salesmen`, `/api/customers`, and `/api/reports` overview/Profit & Loss):
- issue the already-known production request through `https://khatapro-erp.vercel.app`,
- retain the response `X-Request-Id`,
- locate its single `api_performance_timing` event,
- compare total route duration with session, each `loadSessionUser`, auth/profile/permission, compatibility/preflight, and endpoint workload stages,
- record `loadSessionUserCount`, `duplicateLoadSessionUser`, and any unexplained residual duration.

This instrumentation does not prove the latency root cause until those live correlated logs are captured. Do not remove duplicate hydration or begin a second optimization batch from source evidence alone.

---

## P1 — performance / perceived quality

### 4. Pervasive ERP slowness
User reports essentially A-to-Z navigation/actions are slow. Video confirms multi-second waits; Financial Reports was roughly 5–6 second class in the observed run.

Do not blame free Vercel/Supabase without measurements.

Performance recovery must measure:
- click-to-usable times across major screens,
- browser Network waterfall,
- Vercel/API TTFB and function time,
- Supabase query/RPC time,
- serial waterfalls,
- repeated shared-data refetches,
- region/connection latency,
- heavy report query plans where applicable,
- client render/loading-state time.

Use caching/prefetch only where correctness permits. Loading states must not lie about empty data.

No Hostinger/Supabase data migration should be proposed as the primary fix until profiling proves infrastructure is the bottleneck.

Bounded server-side instrumentation is now available for the seven measured GET routes. It emits one safe, request-correlated timing event with fixed stage names, per-call `loadSessionUser` timing/count, compatibility/preflight timing when a remote probe occurs, endpoint workload timing, and total server duration. It changes no session, cache, authorization, database, or response-body semantics. Live deployment/log capture is still required before assigning cause.

### 5. Riders false-empty loading state
Observed transition:
- `Riders (0)` / "No riders yet"
- moments later `Riders (3)` with actual records.

Fix loading/empty-state race so unresolved fetch state never renders as authoritative empty data.

### 6. Roman Urdu preference not honored
With Roman Urdu selected, a fresh AI answer appeared in English.

Ensure user-selected language is included/enforced in the generation contract and preserved on retry.

### 7. AI retry/latency UX
Observed long "response could not be completed, retrying" state before completion. Existing provider latency can also transiently timeout.

Improve bounded retry/status messaging without hiding real provider errors or creating duplicate requests.

### 8. Mojibake / encoding
Observed corrupted strings include:
- `Loading COD balancesâ€¦`
- `Todayâ€™s Movement`

Clean source strings and verify UTF-8 output.

---

## P1 — print / invoice professionalism

### 9. Print isolation and professional invoice code pass — complete in source
The former fragile seam used click-time `@page` injection, delayed `window.print()`, and a fixed cleanup timer beside an animated modal/backdrop, hidden print root, and off-screen measurement DOM. It is now lifecycle-based: the selected page rule is mounted before printing; the printable root is the only printable surface; app shell, modal, backdrop, portal siblings, and measurement DOM are excluded; cleanup follows `afterprint`/print-media signals; and no accounting/model values are recalculated. The final source recovery removed nested animation-frame deferral so `window.print()` stays in the click user-activation path, explicitly restores the root from screen-hidden to print-visible CSS, fixes thermal sizing from invalid `80mm auto` fallback to valid `80mm 297mm`, and lazy-loads optional owner commission only when an internal copy is selected.

Manual post-fix UI evidence found a separate Print Document workspace defect: the interactive dialog was mounted inside the animated invoice view, so its in-tree fixed backdrop did not own the shell viewport. The UI now portals to `document.body` as a solid, viewport-level workspace above the shell, locks background scrolling, and keeps its existing close/reset path. This does not alter the print engine or print-media CSS.

### 10. Salesman history / invoice settlement recovery — complete in source
Salesman `My Sales` now reaches Sales List through the shell’s own-sales permission path without receiving business-wide visibility; the existing server ownership checks remain authoritative. Invoice detail now shows Net Payable, Paid and Outstanding for paid, unpaid and partial invoices even when no payment-history table exists, while preserving return/net withholding behavior. The Salesman dashboard middle-dot literal is corrected. User verification passed.

The shared document structure now provides verified business identity, document title/number/channel, conditional Bill To/Supplier and document-detail blocks, ruled Item/Qty/Rate/Amount rows, preserved Sold/Ret./Net columns, totals/payment/status hierarchy, memo, timestamp, and an authorized-signature line. Half A4 uses compact print density with conservative overflow blocking; Two-up reuses the same half design; Full A4 uses the same hierarchy with more room; thermal keeps the shared model in receipt form. Customer copies still exclude internal commission unless the explicit internal-copy option is selected. Preview now reflects the same header/table/totals/footer hierarchy.

**Final user print verification passed. This is client-UAT status, not final client approval.**

---

# Current infrastructure position

## Vercel / Supabase / Hostinger
Current stack remains Vercel + Supabase.

Known position:
- free/serverless tier/cold-start/region latency may contribute,
- current evidence does not establish infrastructure as the primary cause,
- domain purchase does not make the ERP faster,
- generic Hostinger shared hosting is not an automatic improvement for this Next.js/API/Supabase architecture,
- a managed VPS/colocated DB may be faster but creates operational/security/backup/migration responsibilities,
- do not migrate production data until profiling proves benefit and auth/RLS/RPC/accounting behavior can be preserved.

---

# Version 1 rule
Until client approval:
- correctness before cosmetics,
- fix live bugs before adding features,
- performance/print professionalism are now valid V1 release work,
- do not begin Version 2 proactive AI,
- do not refactor stable accounting/posting paths without root-cause evidence,
- do not broad-apply migrations,
- do not weaken permissions,
- do not delete posted history,
- do not let AI become the calculator of record.

---

# Validation protocol

For runtime/visual tasks, use live production evidence:

**OBSERVE LIVE → NETWORK/LOG EVIDENCE → ROOT CAUSE → SMALLEST BOUNDED FIX → FOCUSED TESTS → FULL GATES → PUSH/DEPLOY → VERIFY STABLE ALIAS → RETEST LIVE.**

Required gates according to risk:
- focused tests,
- full `npm test` for cross-cutting/release work,
- `npx tsc --noEmit`,
- changed-file ESLint,
- `npm run build`,
- `git diff --check`,
- live browser/print UAT.

Never call a runtime-sensitive item PASS solely because source tests are green.

---

# Agent/model workflow requested by user
Before a coding prompt:
1. discuss direction,
2. state criticality,
3. recommend a suitable model,
4. user chooses/provides the model,
5. only then write the coding-agent prompt.

Do not spontaneously create the next coding prompt before the user approves the direction/model.

---

# Exact next decision / recommended sequence

The bounded AI reliability/answer-contract recovery is complete and user-verified. The free provider can still impose quota/rate-limit/latency; the planned paid production key is an operational improvement, not an application-code blocker.

**Exact next task:** collect Client UAT feedback. Apply only bounded V1 hotfixes for proven client defects, then obtain explicit client approval before final `v1.0.0` and any Version 2 work.

Do not start another whole-repo audit.

---

# Future agent bootstrap
Before meaningful work read:
1. `docs/PROJECT_MEMORY.md`
2. `docs/VISION.md`
3. `docs/ARCHITECTURE.md`
4. `docs/CURRENT_STATE.md`
5. this file
6. relevant `docs/ROADMAP.md` section
7. task-specific code/recent Git history only as needed.

After every meaningful milestone, update the canonical docs that changed in reality before declaring the task complete.
