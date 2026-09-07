# KhataPro ERP — Current State

Last reconciled: **2026-09-07**

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

**2026-09-07 Salesman workflow / invoice summary recovery:** Salesman `My Sales` had an allowed destination but the shell page registry required business-wide `can_view_sales`, so it rewrote the own-sales user to Home. Sales List now permits `can_view_own_sales` as well; its existing API and invoice-detail API ownership checks continue to return only the linked Salesman’s invoices. Invoice detail now always renders deterministic Net Payable, Paid and Outstanding values even when payment history is empty; return-unavailable cases still withhold derived net/outstanding values. The Salesman dashboard now uses an actual middle-dot separator rather than literal `\u00B7`. Manual user verification remains required.

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
- final user UAT produced six `AI_TEMPORARILY_UNAVAILABLE` 429s, one `AI_RESPONSE_INCOMPLETE` 502 and one English no-data answer despite Roman Urdu selection,
- the observed 429 code can only come from Gemini `RESOURCE_EXHAUSTED` in the current route; the local eight-per-minute limiter returns the distinct `RATE_LIMITED` code. Historical logs did not safely retain the exact provider quota/rate sub-bucket, so provider-side quota health remains manually unresolved,
- the historical 502 was also not uniquely diagnosable because the prior wrapper conflated provider `MAX_TOKENS`, local incomplete validation and other unusable output. Those paths now have distinct safe codes/log classifications,
- one normal Ask now makes one provider attempt; only timeout/network/provider-unavailable receives one backend-owned retry. Auth, quota/rate limit, `MAX_TOKENS`, blocked/malformed and locally invalid output do not retry,
- specific Home financial questions load only their relevant deterministic reports. Missing/denied requested facts return an explicit application error before any provider request, and available zero-valued facts cannot be treated as absent,
- Roman Urdu now remains Latin-script end to end, has a Roman Urdu missing-data sentence instead of the previous hard-coded English instruction, and preserves exact numbers/entity names/codes,
- Ask requests now request schema-constrained JSON output; Test Connection remains a separate one-call tiny `OK` probe,
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

Deep user print UAT showed a visible background/transition glitch and an invoice that did not yet meet professional-document quality.

**2026-09-07 source pass complete, live acceptance pending:** the fixed-delay cleanup and click-time style injection were replaced by lifecycle-based print isolation; application roots, portal siblings, modal/backdrop, and the off-screen measurement DOM are excluded from print. The final blocker recovery calls `window.print()` directly from the Print click instead of after nested animation frames, gives the print root an explicit screen-hidden/print-visible CSS contract, and uses valid explicit thermal `80mm 297mm` sizing instead of invalid `80mm auto` (which Chromium discarded to Letter). Customer selection no longer waits for optional owner commission data; it loads only after the internal-copy option is selected. The shared document model still renders the same deterministic header, Bill To/Supplier and document-detail blocks, ruled items, totals/payment hierarchy, status, signature line, and footer across Half A4, Two-up, Full A4, and thermal. No accounting or serialization logic changed. Manual visual and physical-printer validation remains required for every format.

**2026-09-07 Print Document UI recovery:** manual verification found the dialog was visibly layered over the invoice/shell because it was mounted inside the animated invoice view and shell scrolling container. The interactive UI now uses a solid, viewport-level `document.body` portal above shell layers with body-scroll lock. The print engine, document content, CSS print isolation, and page sizing are unchanged. Manual UI verification remains required.

## Encoding / mojibake (fixed)
Fixed in the remaining-UAT bug batch: the broken mojibake strings (`Loading COD balances…`, `Settling…`, `Today’s Movement`) were replaced with proper Unicode characters. No mojibake remains in client-facing source.

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
3. Rider false-empty loading state — code pass complete; browser acceptance pending.
4. AI financial answer reliability, Roman Urdu and retry ownership — bounded code pass complete; user-run manual answer/quota acceptance pending.
5. Mojibake/encoding cleanup — code pass complete.
6. Claude Opus 5 consolidated browser/physical-print acceptance of the professional print/invoice code pass.
7. Remaining UAT bug batch — code pass complete; browser acceptance pending.
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
