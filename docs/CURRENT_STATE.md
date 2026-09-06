# KhataPro ERP — Current State

Last reconciled: **2026-09-06**

This is the concise factual snapshot. Use running production/database/browser evidence over this document if they ever conflict, then update this file.

For the complete handoff/history/future context, read `docs/PROJECT_MEMORY.md` first.

## Repository / deployment
- Repository: `sameer006748-bit/Khatapro-ERP`
- Production/default branch: `main`
- Stable production URL: `https://khatapro-erp.vercel.app`
- Production Supabase project ref: `ebcebxwpddltiwrqybqc`
- Production accounting schema: legacy/original schema rooted at `business`, not the newer UUID-ledger architecture.
- Last live-tested application code commit before this docs refresh: `75319bc`.

## Current maturity
KhataPro is a substantial live **Version 1 ERP in deep UAT recovery / release polish**, not a greenfield build and not yet a closed client handover.

Major operational foundations exist across sales, purchases, accounting, money, Rider, audit, reporting, onboarding, permissions, printing, and AI. Several earlier production blockers were fixed live, but deep user UAT on 2026-09-06 exposed additional correctness, performance, loading, encoding, AI, and print/document-quality issues that must be resolved before final client approval.

Version 2 proactive/intelligent expansion remains deferred until Version 1 is accepted.

## Major implemented systems

### Sales / returns / commissions
Implemented across Counter, Online, OFC, and Other sale paths:
- shared sale engine,
- historical sale returns and stock restoration,
- over-return protection,
- sold/returned/net print model,
- product-level commission and attribution,
- earned-on-collection behavior,
- split payments/change handling,
- Sales List + invoice detail.

Accepted V1 limitations still fail closed: sale discounts, mixed same-bill returns, and opening stock at product creation.

### Money / business accounts
Implemented:
- top-level Cash / Bank model,
- unlimited business money accounts,
- legacy seeded account bridging,
- guarded delete/deactivate behavior,
- readable immutable business-account identities distinct from ledger codes,
- Accounts & Balances grouped view.

### Account categories / expense
Implemented:
- five fixed accounting roots,
- simple categories below each root,
- auto-linked ledgers,
- Expense Batch category-to-ledger server resolution,
- category-aware report grouping where safe.

### Accounting / reports
Implemented/recovered on legacy production:
- Trial Balance,
- Day Book,
- Accounts & Balances,
- Business Accounts,
- Expense Batch,
- vouchers,
- financial reports compatibility,
- audit log,
- readable transaction/account identities.

**Accounting truth recovery implemented; live acceptance pending:** the Rs 2,505 difference was exactly the posted debit history of inactive Easypaisa 1040 (Rs 2,250) and CASH 1060 (Rs 255). Day Book/source lines were balanced. The legacy Trial Balance reader now retains inactive accounts with history and correctly filters posted vouchers by cancellation/date. Reconciled production source rows total Rs 206,306.55 debit and credit; no data was changed.

### Rider
Major Rider recovery is deployed:
- legacy identity mapping/resolution,
- Owner Connect/Change Rider account,
- Salesman can select and first-assign same-business active Rider,
- Rider receives assigned delivery,
- Delivered / Partial / Returned / Cash/COD paths,
- four-item mobile navigation: Home / Deliveries / Cash / Profile.

**New live UX issue:** Riders list can briefly show a false authoritative empty state (`Riders (0) / No riders yet`) before the real roster arrives (`Riders (3)`). Loading and empty states must be separated.

### Permissions / denial behavior
Server gates remain authoritative and fail closed. A live defect where denied guarded routes returned empty HTTP 500s was fixed in `ffc5493`; tested denials now return clean 403 responses with request IDs.

### AI
Live AI configuration recovery completed:
- encrypted per-business provider setting path restored,
- Gemini key Save passed live,
- Test Connection passed live,
- actual working model: `gemini-3.5-flash`,
- basic/business-data Ask returned live 200 after recovery,
- `75319bc` raised output-token budget from 800 to 2048 to stop `MAX_TOKENS` / `AI_RESPONSE_INCOMPLETE` truncation.

**Deep-UAT AI status:**
- the observed ~100× paisa/rupee defect is fixed in source with explicit rupee-decimal AI facts and a rupee-only financial allow-list; live acceptance remains,
- Roman Urdu selection is not reliably honored,
- retry/latency UX can remain visible for many seconds,
- Today semantics are now explicit: period flows are separated from as-of and current snapshots.

AI is not allowed to become the accounting calculator; unit/period values must be normalized deterministically before interpretation.

## Performance / UX state
The user reports the entire ERP feels slow, not just one module. Deep UAT shows routine screen transitions taking multiple seconds, with Financial Reports around 5–6 second class in the observed run.

Current evidence does **not** prove free Vercel/Supabase hosting is the sole cause. The repo already contains caching work added after prior navigation refetch storms, while many screens still perform server-backed fetches on mount.

A dedicated performance recovery/profile is now required before any decision to move data/hosting. Domain purchase alone does not improve speed; do not migrate Supabase to Hostinger/VPS by guess.

A bounded application-side performance code pass is complete on `main` (parallel financial-report reads, longer master-data caching). Browser/network performance acceptance is still pending for the final Claude Opus 5 consolidated UAT, so performance is not yet marked solved.

## Print / invoice state
A shared print foundation exists for:
- Half A4,
- Two-up A4,
- Full A4,
- 80mm thermal,
- deterministic shared print model,
- internal/customer copy separation.

Deep user print UAT shows:
- visible background/transition glitch around browser printing,
- invoice visual quality is not yet professional enough for a real business document.

Required direction: clean print isolation and one professional master invoice identity across all sale channels/formats with proper business header, customer block, ruled item table, totals hierarchy, payment/status area, footer/signature/terms where appropriate, and no app-like visual chrome on paper.

## Encoding / small UX defect
Broken mojibake strings are visible in production, e.g. `Loading COD balancesâ€¦` and `Todayâ€™s Movement`. UTF-8 text cleanup is required.

## Settled migration facts — do not reopen without new evidence
- `00037` applied.
- `00038` applied.
- `00039` applied.
- `00040` applied.
- `00041` applied.
- `00042` applied.
- `20260904161347_persist_business_account_identity.sql` applied.
- `00012` opening stock not applied; accepted V1 limitation with Stock Entry workaround.

Never broad-apply migrations.

## Current release status
**NOT YET CLIENT-CLOSED.**

Previous "manual UAT only / no code blockers" status is obsolete after deep UAT.

Current blockers/priorities:
1. **Claude Opus 5 live browser verification** of Trial Balance balance, AI rupee values, Today semantics and Financial Reports/Accounts money totals.
2. Pervasive performance/slowness recovery — application-side code pass complete; browser/network acceptance pending.
3. Rider false-empty loading state.
4. Roman Urdu preference enforcement + AI retry/latency UX.
5. Mojibake/encoding cleanup.
6. Print glitch/isolation fix.
7. Professional invoice redesign across Half A4 / Two-up / Full A4 / 80mm.
8. Final role/mobile/print UAT + client approval.

## Validation posture
For runtime-sensitive tasks, live browser evidence is the acceptance authority. Use:

**observe live → capture network/log evidence → root cause → bounded fix → tests/gates → deploy → verify stable alias → retest live.**

Static/unit/source tests remain necessary but are not sufficient.

## Important production rules
- Never broad-apply migrations.
- Never assume UUID-ledger migrations match production.
- Configured Supabase production must not silently fall back to Prisma/SQLite.
- Posted financial history is not casually hard-deleted.
- Numeric ledger codes are not user-facing immutable identities.
- AI is interpretation, not authoritative accounting truth.
- Do not start Version 2 before Version 1 client approval.
- Do not claim production readiness from green tests alone.

## Read next
1. `docs/PROJECT_MEMORY.md`
2. `docs/VISION.md`
3. `docs/ARCHITECTURE.md`
4. this file
5. `docs/CURRENT_WORK.md`
6. relevant `docs/ROADMAP.md` section
7. task-specific code / recent Git history only as needed
