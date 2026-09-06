# KhataPro ERP — Current Work

Last updated: **2026-09-06**

Read `docs/PROJECT_MEMORY.md` first for the complete A-to-Z handoff/history/future context.

## Current version
**Version 1 — deep UAT recovery / professional release polish.**

Version 2 intelligent/proactive product work remains deferred until the client receives and approves Version 1.

## Current phase
**Production-evidence recovery after deep manual UAT.**

The previous state recorded here — "manual UAT only / no code blockers" — is obsolete. A deep user-recorded production UAT on 2026-09-06 exposed new real client-facing problems in accounting correctness, AI units/language, performance, loading states, encoding, print isolation, and invoice professionalism.

## Current objective
Make Version 1 genuinely client-ready by resolving the newly proven/suspected issues with bounded production-evidence tasks, not another broad "audit everything" loop.

The acceptance standard is not merely green tests. The live stable URL must behave correctly:

`https://khatapro-erp.vercel.app`

## Why this is next
Earlier closeout/recovery work successfully fixed several blockers live, but the user's latest deep UAT shows the product still does not feel/behave like a finished professional ERP in all important areas.

No agent should now claim "READY FOR CLIENT HANDOVER" until the current list is closed or deliberately accepted by the user/client.

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

The current AI defects are **not connectivity**; they are data-unit/language/period/latency behavior described below.

---

# Current blockers / priorities

## P0 — accounting and deterministic trust

### 1. Trial Balance difference Rs 2,505.00
Deep UAT shows Trial Balance/Financial Reports out of balance by **Rs 2,505.00**.

Required approach:
- reproduce on stable production,
- identify exact ledger/journal/posting rows causing the difference,
- compare Trial Balance reader vs Day Book/ledger truth,
- determine whether this is bad UAT data, a posting defect, or a report/query defect,
- fix only the real root cause,
- never force-balance totals cosmetically.

### 2. AI money-unit scaling ~100×
Observed AI answers treat rupee/paisa values incorrectly, e.g. amounts around Rs 20,000 being explained as ~PKR 2,000,000 and similar 100× errors for profit/payables.

Required approach:
- inspect deterministic AI fact payload,
- make currency units explicit/normalized before the LLM,
- reuse trusted money-format/serialization logic,
- add tests that prove exact rupee values,
- never ask the LLM to infer whether a raw integer means paisas or rupees.

### 3. Verify suspicious semantics before changing accounting
Not yet proven solely from video:
- AI period scoping may mix Today/current/period facts,
- Financial Reports Cash/Bank figure vs Accounts & Balances total may represent different definitions.

Verify definitions and source payloads first. Do not "fix" a deliberate semantic difference by visual guess.

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

### 9. Print background/transition glitch
User-recorded print UAT shows visible app/background glitching/ghosting around print invocation.

Current print mechanism combines animated modal/backdrop, hidden print root, body print class, dynamic `@page`, delayed `window.print()` and delayed cleanup.

Required result:
- printable document isolated cleanly,
- app/sidebar/modal/background cannot leak into print experience,
- no visible ghost/flicker during print transition,
- all four modes still work.

### 10. Professional invoice redesign
Existing print serialization/content foundation should be preserved, but the document must look like a real professional business invoice.

All sale channels/formats should share one master document identity:
- verified business header/logo/contact,
- invoice title/no/date,
- Bill To/customer block,
- contextual seller/channel/Rider fields,
- professional ruled item grid,
- aligned totals hierarchy,
- payment/status block,
- notes/terms where appropriate,
- optional signature/authorized lines where useful,
- professional footer,
- no app-like cards/shadows/pills on printed paper,
- customer copies never expose internal commission/accounting,
- Half A4 remains compact but fully professional,
- Two-up / Full A4 / 80mm adapt density consistently.

The print preview should represent the actual final document more faithfully than the current tiny simplified mini-preview.

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

No coding task is currently authorized merely by this document refresh. The next step is to choose the first bounded recovery task with the user.

Recommended sequence:
1. **P0 deterministic correctness:** Trial Balance Rs 2,505 + AI 100× unit bug (may be split into two prompts if evidence surfaces different roots).
2. **Performance recovery/profile** across representative major screens.
3. **Print isolation + professional invoice redesign** across all formats.
4. Rider false-empty + Roman Urdu + retry/latency + mojibake cleanup.
5. Final all-role/mobile/print UAT.
6. Client handover/approval.
7. Only then advance `CURRENT_WORK.md` to Version 2.

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
