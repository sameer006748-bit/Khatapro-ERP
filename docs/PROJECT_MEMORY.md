# KhataPro ERP — Canonical A-to-Z Project Memory

Last reconciled: **2026-09-07**

This file is the fastest complete handoff for a new ChatGPT session, Claude/Codex agent, developer, or future maintainer. It records the durable vision, important past work, verified production architecture, current live problems, release boundary, and next priorities.

If this file conflicts with running production or verified database reality, production wins and this file must be updated.

---

## 1. Read-first rule

For any meaningful KhataPro task, read in this order:

1. `docs/PROJECT_MEMORY.md` — this A-to-Z handoff.
2. `docs/VISION.md` — durable product direction.
3. `docs/ARCHITECTURE.md` — architecture and invariants.
4. `docs/CURRENT_STATE.md` — current factual snapshot.
5. `docs/CURRENT_WORK.md` — active release phase and exact next work.
6. `docs/ROADMAP.md` — Version 1 exit and Version 2 path.
7. Task-specific code/docs and recent Git history only as needed.

Do not restart broad repository audits merely to rediscover facts already recorded here unless new production evidence directly contradicts them.

---

# PART A — PRODUCT / VERSION BOUNDARY

## 2. Product vision

KhataPro is a real-business ERP with accounting, sales, purchases, expenses, money accounts, reporting, audit, Rider workflows, permissions, printing, and an AI assistant.

Long-term USP:

> **KhataPro understands your business and tells you what needs attention.**

Core rule:

> **Deterministic ERP/database/accounting logic is the source of truth. AI is the interpretation/intelligence layer.**

AI must not invent authoritative balances, stock, profit, receivables, payables, cash, commission, tax, or Rider settlements.

## 3. Version boundary

### Version 1 — current client ERP
Version 1 is the current client-facing ERP. It must be stable, fast enough to feel professional, financially correct, role-safe, printable, and visually acceptable before handover/approval.

### Version 2 — intelligent/proactive ERP
Version 2 starts **only after Version 1 is accepted by the client**. It includes deeper natural-language business querying, anomaly detection, proactive owner intelligence, recommendations, and eventually controlled approval-gated actions.

Do not start Version 2 while Version 1 has known client-facing correctness, performance, print, or UX defects.

---

# PART B — REPOSITORY / PRODUCTION REALITY

## 4. Repository and stable production

- GitHub: `sameer006748-bit/Khatapro-ERP`
- Production/default branch: `main`
- Stable client URL: `https://khatapro-erp.vercel.app`
- Production Supabase project ref: `ebcebxwpddltiwrqybqc`
- Production accounting lineage: **legacy/original schema rooted at `business`**, not the newer UUID-ledger architecture.
- Last live-tested application code commit before this documentation refresh: `75319bc` (`fix(ai): raise output token budget to stop MAX_TOKENS truncation`).

Important local-worktree history:
- `C:\Users\Dell\Downloads\KhataPro ERP` has previously been on non-production work branches such as `fix/backend-stock-recovery`.
- `main` was also checked out in a separate local worktree named `KhataPro ERP Rider Hotfix` during emergency recovery work.
- **Do not infer source-of-truth from a folder name. Always verify Git branch/HEAD. Production source is `main`.**

## 5. Deployment rule

A Vercel deployment-specific preview URL is not the final client endpoint.

Every release must verify that the intended Ready deployment is actually serving:

`https://khatapro-erp.vercel.app`

Do not claim production success from a local build, preview URL, or Ready deployment that is not aliased to the stable URL.

---

# PART C — CURRENT STACK / ARCHITECTURE

## 6. Current stack

- Next.js 16
- React 19
- TypeScript
- Tailwind / Radix / Lucide / Framer Motion
- TanStack Query client fetching/cache
- NextAuth v4
- Supabase/Postgres production data path
- server-side API/data-access layer
- Vercel production hosting
- Prisma/local compatibility only where explicitly supported

## 7. Security / tenant invariants

- Session/user resolution is server-side.
- Business scoping is mandatory.
- Permissions are enforced server-side; hidden buttons are not a security boundary.
- Cross-business data leakage is never acceptable.
- Posted accounting history is not casually hard-deleted.
- Secrets/API keys/passwords/tokens are never committed or logged.
- Configured Supabase production must not silently fall back to local Prisma/SQLite behavior.

## 8. Migration rules

Never broad-apply the migration directory.

Known settled production migration facts:
- `00037` applied.
- `00038` applied.
- `00039` applied.
- `00040` applied.
- `00041` applied.
- `00042` applied.
- readable business-account identity migration `20260904161347_persist_business_account_identity.sql` applied.
- `00012` opening-stock migration is **not applied** and is an accepted Version 1 limitation. Product-creation opening quantity fails closed and directs the user to Stock Entry; `create_stock_movement` exists.

Do not re-audit/re-apply these unless new production evidence directly proves a relevant contradiction.

---

# PART D — MAJOR COMPLETED WORK / HISTORY

## 9. Sales / returns / commissions

Major implemented work includes:
- shared sale engine for Counter / Online / OFC / Other,
- historical return linking,
- stock restoration and over-return protection,
- sold/returned/net print model,
- product-level commission,
- owner/salesman attribution,
- earned-on-collection behavior,
- split payments/change handling,
- invoice detail and sales list paths.

Accepted Version 1 limitations:
- sale discounts are refused/fail closed,
- mixed same-bill returns are refused/fail closed,
- opening stock at product creation is refused/fail closed.

## 10. Money / business accounts

Implemented:
- client-facing top-level Cash and Bank groups,
- unlimited money accounts below them,
- legacy seeded-ledger bridge without duplicates,
- safe delete/deactivate behavior,
- readable immutable business-account identities separate from numeric ledger codes,
- grouped Accounts & Balances view.

Relevant completed commits include `b7029d0`, `947c7c8`, and identity-persistence work around `029df0b`.

## 11. Account categories / expenses

User-facing design was simplified to:
- five fixed accounting roots: Asset, Liability, Capital/Equity, Revenue, Expense,
- simple categories directly under roots,
- no visible subcategory tier,
- automatic linked ledger per category,
- Expense Batch category-to-ledger server-side resolution,
- category-aware reporting/grouping where safe.

## 12. Dashboard / accounting / admin

Major areas implemented/recovered:
- owner dashboard / command center,
- Trial Balance,
- Day Book,
- Accounts & Balances,
- Business Accounts,
- Expense Batch,
- financial reports compatibility,
- vouchers,
- audit log,
- onboarding tours/contextual help,
- permission-aware navigation.

## 13. Rider recovery

Rider work completed over several hotfixes:
- identity resolver handles legacy user ID/Auth UUID/profile ID safely,
- business-scoped, active-only, ambiguity fails closed,
- Owner can Connect/Change Rider account,
- Rider Home is action-first,
- delivery outcomes Delivered / Partial / Returned,
- Cash With You / COD settlement paths,
- exactly four Rider nav items: Home / Deliveries / Cash / Profile,
- no accounting jargon in Rider UX.

Later live recovery proved Salesman can select/assign a same-business active Rider and the Rider receives the order.

## 14. Navigation / invoice recovery history

A previous production regression was traced to shell navigation behavior and invoice-detail reads. Hotfix work around `e9a7a93` restored mobile `More` navigation and improved invoice detail failure handling.

Later live recovery found that source/static tests were still insufficient, so the workflow changed: production browser evidence must be treated as the final gate for runtime-sensitive work.

## 15. Production-blocker recovery / permission responses

Live recovery after earlier "green" reports found and fixed:
- Salesman Rider dropdown/first assignment path,
- invoice detail / Sales List production behavior,
- AI configuration path,
- denied API routes returning empty HTTP 500 instead of clean 403.

Commit `ffc5493` wrapped guarded handlers through observability so live permission denials return clean `403 { error: "FORBIDDEN", requestId: ... }` instead of empty 500 responses.

## 16. AI connectivity recovery

AI configuration was debugged live, not only statically.

Resolved facts:
- AI provider settings are encrypted server-side per business.
- `AI_SETTINGS_ENCRYPTION_KEY` / key-id configuration was repaired/rotated in Vercel; secret values are not documented here.
- Owner re-saved the Gemini key after the encryption configuration change.
- live Save Key passed,
- live Test Connection passed,
- actual working model reported by the provider path: `gemini-3.5-flash`,
- basic Ask and supported business-data Ask returned live 200 responses after recovery.
- `75319bc` raised AI output-token budget from 800 to 2048 to stop intermittent `MAX_TOKENS` / `AI_RESPONSE_INCOMPLETE` failures.

Residual observation:
- Gemini can still occasionally hit transient provider/latency timeout behavior. Do not confuse a transient provider timeout with `AI_NOT_CONFIGURED`/decryption/model-configuration failure.

The temporary Gemini test credential used during recovery must never be preserved in docs/code/logs and should be rotated/replaced by the owner.

---

# PART E — DEEP MANUAL UAT FINDINGS ON 2026-09-06

## 17. Release status changed: Version 1 is NOT yet handover-closed

A deep user-recorded UAT video was reviewed movement-by-movement. It reopened Version 1 release work because several real client-facing issues are visible.

Do **not** tell the user/client "everything is ready" merely because test/build gates are green.

## 18. Historical deep-UAT issues — closed for the client-UAT checkpoint

### P0 / accounting correctness — closed
1. **Trial Balance Rs 2,505.00 root cause was proven and fixed in the reader.**
   - Day Book and the 95 posted production ledger lines were balanced at Rs 206,306.55 per side.
   - Legacy `trial_balance` excluded inactive accounts even when they retained posted history. It omitted Easypaisa 1040 (INV-0002, Rs 2,250 debit) and CASH 1060 (INV-0007/8/9, Rs 25 + Rs 150 + Rs 80 debit).
   - The same RPC also failed to apply cancellation/date filters because the voucher predicates were on a `LEFT JOIN` while unfiltered lines were summed.
   - The shared legacy reader now selects posted in-period lines directly, retains inactive accounts with history, and produces Rs 206,306.55 debit = credit on the reconciled production data. No financial data was changed.

2. **AI money scaling was proven and fixed at the deterministic boundary.**
   - Database/RPC/TypeScript amounts remain integer paisas.
   - AI context now receives only explicit `*Rupees` decimal strings and `amountRupees` allow-list values; raw paisa magnitudes are no longer accepted as PKR answers.
   - Period flows, selected-period-end snapshots, and current snapshots are separated and labelled in the AI fact object.

### P1 / functional + UX — closed
3. **Roman Urdu selected but a fresh AI answer appears in English.**
   - Language preference is not being honored reliably.

4. **AI retry/latency UX is poor.**
   - User-visible "response could not be completed, retrying" state lasted many seconds before completion.
   - Existing provider timeout/latency behavior should be handled gracefully.

5. **Riders tab shows a false empty state before data arrives.**
   - During one transition the UI showed `Riders (0)` / "No riders yet" even though assigned Rider data existed; moments later it showed `Riders (3)`.
   - This is a loading-state/race UX bug. Loading must not masquerade as an empty authoritative state.

6. **Broken text encoding / mojibake is visible.**
   Examples: `Loading COD balancesâ€¦`, `Todayâ€™s Movement`.
   - Replace corrupted strings and verify UTF-8 rendering.

7. **Pervasive application slowness.**
   - User reports essentially every screen/action feels slow.
   - Video shows routine navigation with multiple-second waits; Financial Reports was especially slow (~5–6 second class in the observed run), with other screens also taking several seconds.
   - This is a Version 1 UX/release issue, not something to dismiss as "free hosting is normal".

## 19. Previously suspicious semantics — resolved and verified

8. **AI Today scoping:** sales, expenses, cash movement, profit and Trial Balance activity are selected-period flows. Receivables, payables and inventory are current snapshots; Balance Sheet is an as-of-period-end snapshot. The AI context now exposes these scopes separately instead of attaching every figure ambiguously to Today.

9. **Cross-screen Cash/Bank:** both screens intend current available configured business money. Financial Reports used a stale fixed code list (`1010`–`1040`) and omitted custom active accounts such as UBL 1061; Accounts & Balances used all active Asset business accounts. Financial Reports now uses the configured-account definition too.

---

# PART F — PERFORMANCE / HOSTING POSITION

## 20. Do not migrate infrastructure by guess

Current hosting is Vercel + Supabase. Free/serverless tiers and cold starts/region distance can add latency, but current evidence does **not** prove that free infrastructure is the sole or primary cause of the app feeling slow.

Repository history already shows client refetch pressure existed: TanStack Query global `staleTime` was increased because navigation previously caused a refetch storm. Many screens still fetch server data on mount.

Therefore the next performance decision must be evidence-based.

## 21. Dedicated performance recovery requirements

Before moving the database or hosting:
- measure click-to-usable time on 10–15 major screens,
- capture browser Network waterfall and exact slow API durations,
- separate client rendering delay, Vercel function TTFB, API orchestration, Supabase query/RPC time, and network-region latency,
- identify serial request waterfalls,
- identify repeated/refetched shared data,
- profile heavy financial-report queries,
- check Vercel/Supabase deployment regions and connection strategy,
- add/preserve useful caching/prefetch without serving stale financial truth,
- use skeleton/progressive UI rather than blank/false-empty states.

Performance target direction:
- common navigation should feel near-instant when data is already available/cache-safe,
- routine server-backed screens should generally feel sub-second to ~1 second class where practical,
- heavy reports should not routinely require 5–6 seconds without a proven reason.

## 22. Hostinger decision

- Buying a **domain** does not materially improve application speed.
- Moving only the frontend to generic shared hosting does not automatically solve a Next.js + API + Supabase ERP latency problem.
- A properly managed VPS / colocated application+database can be fast, but introduces database operations, backups, security, connection pooling, deployment and recovery responsibilities.
- **Do not migrate Supabase data to Hostinger/VPS until profiling proves infrastructure is the bottleneck and a migration plan preserves auth/RLS/RPC/accounting behavior.**

Current recommendation: optimize/profile the existing stack first; make an infrastructure decision only from measurements.

### Application-side performance pass — completed (code-only)

A bounded source-level performance pass landed on `main` (Phase V1-B, application side), without any infrastructure change:
- Financial Reports (`/api/reports`) now runs the report RPC and the account-classification overlay in parallel (previously serialized) for profit-loss, balance-sheet and expense.
- Products master data is cached longer (5 min) across Counter/Online/OFC/Other sale and Inventory; stock correctness is preserved because every posting/return/product edit still invalidates the shared `['products']` key.

This checkpoint closes the source-level performance recovery work. It does not claim that a paid AI key or infrastructure change guarantees any particular latency; client feedback may justify a bounded V1 hotfix.

---

# PART G — PRINT / INVOICE CURRENT POSITION

## 23. Existing print foundation

The code has a shared invoice print system with:
- Half A4,
- Two copies on A4,
- Full A4,
- 80mm thermal,
- shared deterministic print serialization,
- customer/internal-copy separation,
- overflow measurement for half-A4.

The shared foundation is useful and should be preserved.

## 24. Confirmed print UX problem

A user-recorded print video shows a visible background/transition glitch around opening the browser print flow.

The former implementation combined an animated dialog/backdrop, a hidden print root, click-time `@page` injection, delayed `window.print()`, and a fixed delayed cleanup. That cleanup race could restore the application while the browser was still compositing the native dialog.

**2026-09-07 source recovery, user-verified:** print sizing is now mounted with the selected document before printing; the print surface is isolated through deterministic print CSS; app roots, portal siblings, modal/backdrop, and the off-screen measurement container are excluded; and restoration follows `afterprint`/print-media lifecycle signals rather than a guessed timeout. The final recovery removed the nested animation-frame deferral that could lose Chromium's click user activation, made print-media visibility explicitly reverse the screen-hidden root, and replaced invalid thermal `80mm auto` sizing (which falls back to Letter) with explicit `80mm 297mm`. Owner-only commission now loads only if an internal copy is requested, so customer print selection is not delayed. The shared invoice serialization remains unchanged.

**2026-09-07 print-workspace recovery, user-verified:** the interactive Print Document UI was mounted inside the animated invoice view and shell scroll container, so its in-tree `fixed z-50` backdrop could be constrained by that local stacking context while the shell header/sidebar remained visible. The interactive workspace now renders through a `document.body` portal as an opaque, viewport-level `z-[100]` surface with body-scroll lock; the print document DOM and print-media rules were not changed.

**2026-09-07 sales workflow recovery, user-verified:** Salesman `My Sales` correctly requested `sales-list`, but the shell registry admitted that page only for `can_view_sales` and rewrote an own-sales user back to Home. The registry now permits either `can_view_sales` or `can_view_own_sales`; the existing sales-list and invoice-detail API ownership checks continue to restrict a Salesman to their linked records. Invoice settlement totals were incorrectly rendered only when payment-history rows existed, hiding the summary for unpaid invoices; the deterministic invoice fields now render an always-present Net Payable / Paid / Outstanding summary while retaining return-unavailable withholding. Literal `\u00B7` dashboard text was replaced with the actual middle dot.

## 25. Professional invoice redesign requirement

The existing invoice is functionally structured but not yet at the visual standard expected of a professional business document.

Required direction for **all sale invoice formats** (Counter / Online / OFC / Other):
- one master professional document identity,
- professional business header with verified business information/logo where available,
- clear invoice title / invoice number / date,
- clean Bill To/customer block,
- seller/channel/rider only where relevant,
- proper item table/grid with strong column alignment,
- clearly boxed/ruled totals,
- payment/status area,
- notes/terms where appropriate,
- professional footer and optional signature/authorized-receipt lines,
- consistent line/border hierarchy,
- no app-like cards/shadows/pills in the printed paper design,
- internal commission/accounting never appears on customer copies,
- Half A4 remains compact but still looks like a real professional invoice,
- Full A4 / Two-up / 80mm adapt density while preserving the same brand/document language.

Preview should represent the real final document more faithfully; a tiny simplified mini-preview is not sufficient as the sole visual assurance.

---

# PART H — CURRENT VERSION 1 PRIORITIES

## 26. Current phase

**Version 1 — Client UAT / Handover.**

The previous "manual UAT only / no code blockers" state is obsolete after the September 6 deep UAT findings.

## 27. Current priority buckets

Recovery implementation and user verification are complete. The client-UAT freeze permits only bounded client-reported V1 hotfixes; it does not authorize V1 feature expansion or Version 2 work.

Do not combine these into another uncontrolled "audit everything" loop. Use bounded production-evidence tasks.

## 28. Exact next decision

Collect client-UAT feedback, convert a proven defect into a bounded V1 hotfix when needed, and seek explicit client approval before creating final `v1.0.0` or starting Version 2.

---

# PART I — VALIDATION / AGENT WORKFLOW

## 29. Runtime-sensitive work must be browser-proven

Previous sessions repeatedly produced green tests while live production still failed. Therefore:

For production-sensitive tasks:

**OBSERVE LIVE → capture network/error evidence → root cause → smallest fix → focused tests → full gates → push/deploy → verify stable alias → retest live.**

Static/source tests are necessary but not sufficient.

## 30. Model/prompt workflow requested by the user

For coding-agent work:
1. discuss direction first,
2. state criticality and recommend a suitable model,
3. user chooses/provides the model,
4. only then write the coding-agent prompt.

Do not automatically generate coding prompts before the user approves the direction/model.

Recent high-risk production recovery has commonly used Claude Opus 5 High with Claude Desktop/Claude Code browser access. Model choice remains a user decision.

## 31. Testing gates

Use risk-appropriate gates:
- focused tests,
- full `npm test` for cross-cutting/release changes,
- `npx tsc --noEmit`,
- changed-file ESLint,
- `npm run build`,
- `git diff --check`,
- live browser UAT where runtime/visual behavior matters.

Do not equate 100% unit tests with live correctness.

---

# PART J — DO NOT REGRESS

## 32. Durable do-not-touch rules

- No broad migration application.
- No casual move to incompatible UUID-ledger architecture.
- No weakening server permissions to make UI work.
- No hard-delete of posted accounting history.
- No secrets/passwords/API keys in commits/docs/logs.
- No numeric ledger code as the primary user-facing immutable money-account identity.
- No AI-generated authoritative accounting truth.
- Do not break Rider four-item mobile navigation.
- Do not rewrite stable posting paths unless live evidence proves they are the root cause.
- Do not start Version 2 before client acceptance of Version 1.

## 33. Test/demo data and credentials

Historical test accounts/QA rows exist. Their passwords/API keys must not be documented here.

Known QA rows with posted references must be deactivated/archived rather than blindly deleted:
- `QA TEST FABRIC 01`
- `QA TEST TEMP ITEM 01`
- `QA TEST VENDOR 01`

Test-account retirement uses the supported password-reset path because in-app user deactivation is an accepted Version 1 limitation.

---

# PART K — FUTURE AFTER VERSION 1

## 34. Version 2 sequence

Only after client approval:

1. consolidate deterministic ERP truth/readers,
2. reliable natural-language answers over verified facts,
3. comparisons/explanations/owner summaries,
4. deterministic/statistical anomaly detection,
5. proactive owner intelligence,
6. recommendations/action preparation,
7. human-approved controlled execution,
8. productization/pilot scale.

Trust order:

**TRUST → USEFULNESS → INTELLIGENCE → AUTOMATION**

---

# PART L — HANDOFF SUMMARY

## 35. 2026-09-07 AI answer-contract recovery

Final user-run AI UAT established that Test Connection can pass while real Ask requests still fail: six Ask responses were upstream-style `AI_TEMPORARILY_UNAVAILABLE` 429s, one was the conflated `AI_RESPONSE_INCOMPLETE` 502, and one Roman Urdu request returned the hard-coded English missing-data sentence. The local limiter uses the distinct `RATE_LIMITED` code, so the observed 429 class originated at Gemini as `RESOURCE_EXHAUSTED`; the prior route did not retain enough safe detail to distinguish the historical project quota bucket from a provider rate bucket. Test Connection sends one tiny `OK` probe; Ask loads business aggregates and sends a much larger structured financial prompt.

The bounded source recovery makes the backend the only automatic retry owner: a normal Ask uses one provider attempt, with one extra attempt only for timeout/network/provider-unavailable failures; 429, auth, `MAX_TOKENS`, blocked, malformed and locally invalid outputs do not retry. Structured JSON response configuration and safe failure observability distinguish `MAX_TOKENS`, malformed/blocked output and local completeness failures. Specific Home financial questions now load only relevant reports; missing or denied requested facts stop before the model with an explicit application error, while present zero values count as data. The provider is forbidden from returning a missing-data fallback when the requested deterministic facts exist. Roman Urdu now has its own Latin-script missing-data response and preserves numbers, names and codes. Existing exact paisa-to-rupee conversion and 100× rejection remain unchanged and covered. No accounting formula, posting path, model, timeout or credential changed. The user subsequently confirmed correct real AI answers; free-provider quota/rate-limit/latency remains an operational follow-up, with a paid production key planned, not an application-code blocker.

## 36. 2026-09-08 Version 1 client-UAT checkpoint

The recovery cycle is complete and the deep-UAT release blockers are closed, including Trial Balance/report reconciliation, AI units/language/reliability, Rider loading, encoding, performance source pass, professional invoice/print output and workspace isolation, Salesman access, and invoice settlement summary. User manual verification passed for the final AI and print fixes. Version 1 is now in **Client UAT / Handover** at checkpoint commit/tag `v1.0.0-client-uat`; this is not final client approval. Freeze new V1 feature expansion, handle client-reported issues only as bounded V1 hotfixes, and do not begin Version 2 until explicit client approval.

## 37. One-paragraph state for a new agent

KhataPro ERP is a substantial live Version 1 ERP on `main`, Vercel + Supabase legacy production schema, with major sales/accounting/money/Rider/audit/print/AI foundations implemented. The deep-UAT recovery cycle closed the known release blockers without changing financial data: reporting preserves historical truth, AI receives exact rupees, print is isolated and professional across formats, Rider/loading and Salesman/invoice-summary workflows are restored, and final user manual AI/print verification passed. The product is now in **Client UAT / Handover**, tagged `v1.0.0-client-uat`; it is not client-approved or final-released. Client feedback may receive bounded V1 hotfixes, while Version 2 remains deferred.

---

## 38. Update discipline

After every meaningful milestone:
- update `PROJECT_MEMORY.md` if overall project reality changed,
- update `CURRENT_STATE.md` if factual status changed,
- update `CURRENT_WORK.md` with the exact active/next task,
- update `ROADMAP.md` only when sequencing/phase reality changed,
- keep architecture/vision docs aligned where invariants or product direction changed.

A future session should not require the user to explain the whole project again if these canonical docs are kept current.
