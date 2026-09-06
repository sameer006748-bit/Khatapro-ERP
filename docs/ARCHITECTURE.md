# KhataPro ERP — Architecture

Last reconciled: **2026-09-06**

## Purpose
This document describes the current architecture and the invariants future work must preserve. When target architecture differs from current implementation, that distinction is explicit.

Read `docs/PROJECT_MEMORY.md` first for the complete project history/current/future handoff.

## Current application stack
Repository evidence shows:
- Next.js 16 / React 19 / TypeScript frontend and API routes,
- Tailwind / Radix / Lucide / Framer Motion UI stack,
- NextAuth v4 authentication,
- TanStack Query for client data fetching/caching,
- Supabase/Postgres for configured production data paths,
- Prisma for local / compatibility paths where explicitly supported,
- Vercel for production deployment,
- server-only data-access helpers for sensitive Supabase access.

Production is not a greenfield UUID-ledger deployment. The live accounting path is the legacy/original schema rooted at `business` with TEXT identifiers in important areas. New work must respect deployed-schema reality.

## Architectural source of truth
Precedence for implementation facts:
1. Running production code/database/browser evidence.
2. Verified deployed schema / migrations / RPC signatures / runtime logs.
3. `PROJECT_MEMORY.md` + canonical architecture/current-state docs.
4. `CURRENT_WORK.md`.
5. Roadmap.
6. Historical notes and old summaries.

`VISION.md` is authoritative for product direction, not for claiming implementation status.

## Core invariant: deterministic ERP owns financial truth
**DATABASE / ACCOUNTING ENGINE = SOURCE OF TRUTH**

**AI = INTERPRETATION / INTELLIGENCE LAYER**

Authoritative values must come from deterministic code, ledgers, validated RPCs, database state, and explicit business rules.

AI must not independently become the calculator of record for balances, stock, receivables, payables, profit, cash, commission, tax, or Rider settlements.

This also means unit semantics are architectural, not prompt trivia. Money passed to AI must carry explicit/normalized rupee/paisa meaning. A raw integer cannot be left for the model to infer.

## Frontend and navigation
The ERP shell is centered in `src/components/erp/dashboard-shell.tsx` with role-aware navigation and page routing. Major operational views live under `src/components/erp/views/`.

Navigation is permission-aware and must fail closed. Role-specific simplification is intentional:
- Owner/Admin and Accountant share business-wide command-center patterns according to permission visibility.
- Salesman sees sales-oriented workspaces and own reports.
- Rider has a deliberately simplified mobile-first experience.

Deep-link authorization must never be implemented only by hiding UI controls.

## Client data fetching / loading-state invariant
TanStack Query is the primary client cache/fetch layer. Global defaults currently include a non-zero `staleTime` because earlier zero-stale behavior caused a refetch storm on navigation. Individual hooks may override according to data semantics.

Important rules:
- do not refetch stable/shared setup data on every page mount without reason,
- do not serialize independent API calls when they can safely run in parallel,
- do not treat `loading` as `empty`,
- cached financial data must have an explicit freshness policy,
- UI should preserve the shell and use honest skeleton/progressive states instead of blank pages or false authoritative empty messages.

The deep UAT finding where Riders briefly showed `Riders (0) / No riders yet` before real data arrived is a direct example of why loading and empty states must be distinct.

## Performance architecture / measurement rule
As of 2026-09-06, pervasive perceived slowness is an active Version 1 issue. Do not solve it by infrastructure guesswork.

Performance diagnosis must separate:
- browser/client render time,
- React Query cache/refetch behavior,
- Next.js/Vercel function TTFB and execution,
- API orchestration/serial waterfalls,
- Supabase query/RPC time,
- database indexing/query-plan cost,
- connection-pool/region latency,
- serverless cold-start/resource-tier effects.

A domain purchase does not change these layers. Moving to Hostinger/VPS is an architecture decision only after profiling proves a benefit and an operational plan preserves auth, RLS, RPCs, backups, tenant isolation and accounting behavior.

## Backend / API boundary
App routes under `src/app/api/` are the primary server boundary. Sensitive production calls use server-side authorization and business scoping.

Important rules:
- session user must be resolved server-side,
- business isolation is mandatory,
- permission checks are authoritative on the server,
- UI filtering is not a security boundary,
- configured Supabase production must not silently fall back to local Prisma/SQLite behavior when a production feature is unavailable,
- permission denials should return bounded, observable 401/403 responses rather than generic/empty 500s.

Commit `ffc5493` is historical evidence of the last rule: guarded denial paths were recovered to clean 403 responses with request IDs.

## Accounting model
Current live production uses the verified legacy accounting path. Relevant concepts include:
- fixed accounting roots,
- account categories / user categories,
- ledger accounts with numeric accounting codes,
- readable transaction/account identities layered separately from internal IDs and numeric CoA codes,
- audited posting workflows,
- service-role RPCs for production-safe mutations.

Numeric CoA codes remain accounting references, not the user-facing business identity.

Money accounts intentionally expose two client-facing groups: **Cash** and **Bank**. Readable persisted business-account identities are immutable and separate from renameable display names.

A report must never be cosmetically force-balanced. If Trial Balance differs from Day Book/ledger truth, identify the exact reader/posting/data mismatch.

## Migrations
Never broad-apply the migration directory to production.

Production migrations must be:
- exact-file,
- preflighted against the actual live schema,
- dependency-checked,
- transaction-owned,
- `ON_ERROR_STOP` / fail-closed,
- post-apply verified.

A migration file existing in Git does not mean it is suitable for the current production schema.

Historical UUID-ledger migrations must not be assumed compatible with the verified legacy production deployment.

Settled current facts are summarized in `PROJECT_MEMORY.md` / `CURRENT_STATE.md`; do not repeatedly reopen them without new evidence.

## Auditability and destructive actions
Posted financial history is not casually hard-deleted.

General rule:
- unreferenced setup/master rows may be hard-deleted when explicitly safe,
- referenced records should be deactivated/archived,
- posted accounting documents should use cancel/void/reversal semantics where supported,
- audit history should survive deletion of allowed master rows.

Important mutations should preserve actor, business, readable entity identity, timestamp, and safe before/after context.

Secrets, passwords, API keys, auth tokens, and raw credential payloads must never be written to audit metadata.

## AI integration — current vs target
### Current Version 1
KhataPro has a live Gemini-backed assistant with encrypted per-business provider settings. Live recovery has proven Save Key, Test Connection and Ask paths; the working model reported in production was `gemini-3.5-flash`. Output budget was raised in `75319bc` after live `MAX_TOKENS` truncation.

Current V1 AI work is still a correctness/UX layer, not Version 2 proactive intelligence. Deep UAT has exposed unit scaling, language preference, period-scoping and retry/latency issues that must be fixed while preserving deterministic source facts.

### Target Version 2
AI should progressively sit on top of trusted ERP facts and provide:
- natural-language querying,
- explanations and comparisons,
- anomaly / exception detection,
- proactive owner attention items,
- recommendations,
- carefully controlled action preparation.

Low-risk execution may come later under explicit policy and approval. AI must not bypass accounting controls.

## Rider architecture invariant
Rider workflows are mobile-first and role-constrained. Identity resolution must handle production's legacy user/profile/auth IDs safely, remain business-scoped, active-only, and fail closed on ambiguity.

Rider UI must not expose accounting terminology or unrelated ERP modules.

Rider list/assignment UX must not show an authoritative empty roster while the request is unresolved.

## Print / document architecture
The shared invoice print foundation lives around `src/components/invoice/invoice-print-dialog.tsx` and the shared sale print model.

Current supported layout families:
- Half A4,
- Two-up A4,
- Full A4,
- 80mm thermal.

Durable print invariants:
- every format consumes the same deterministic invoice/document model,
- printed totals must match invoice/accounting detail,
- customer copies never expose internal commission/accounting unless explicitly producing an internal owner copy,
- layout density may vary by paper size but document semantics must not diverge,
- half-A4 overflow must fail safely rather than clip silently.

### Print isolation requirement
Deep print UAT shows visible background/modal glitching around print invocation. The current implementation uses animated dialog/backdrop, a hidden actual print root, body print class, dynamically injected `@page`, delayed `window.print()` and delayed cleanup.

Future print work must isolate the printable DOM cleanly so the application shell/sidebar/backdrop cannot ghost/flicker into print UX or output.

### Professional document requirement
The content model should be preserved, but the printed paper must look like a professional business invoice: business header, customer/Bill To block, clear invoice identity, ruled item grid, aligned totals, payment/status area, footer, and appropriate signature/terms hierarchy. Avoid app-like cards/shadows/pills on paper.

The preview should be a trustworthy representation of the final document, not only a tiny simplified mock.

## Testing strategy
Meaningful changes should run the narrowest relevant focused tests plus project gates appropriate to risk:
- focused regression tests,
- broader/full test suite for cross-cutting work,
- `npx tsc --noEmit`,
- changed-file ESLint,
- `npm run build`,
- `git diff --check`,
- browser/manual UAT when the task is visual/runtime-sensitive.

A source-contract test is useful but is not equivalent to live RPC/browser verification.

## Runtime-sensitive acceptance rule
Previous release attempts showed that green tests can coexist with production failure. For runtime-sensitive work the authoritative loop is:

**OBSERVE LIVE → CAPTURE NETWORK/LOG EVIDENCE → ROOT CAUSE → BOUNDED FIX → TEST/GATES → DEPLOY → VERIFY STABLE ALIAS → RETEST LIVE.**

## Deployment boundary
`main` is the production source branch. Vercel production must correspond to the intended `main` state before client handover claims.

Stable client URL:
`https://khatapro-erp.vercel.app`

Never claim production success from a local build or a deployment-specific preview alone.

## Protected local files
Do not stage or expose local/protected artifacts such as:
- `.env`
- `.env.local`
- `.env.vercel-production`
- `db/custom.db`
- database backups
- `task_progress.md`
- `.vscode/`
- `graphify-out/`
- `supabase/.temp/`
- temporary probe/reconciliation artifacts

## Agent completion protocol
No meaningful task is complete until:
1. implementation is complete,
2. relevant tests/checks have run,
3. regressions have been considered,
4. runtime/visual behavior was verified when relevant,
5. relevant canonical docs have been updated,
6. `CURRENT_WORK.md` reflects the exact next task/decision,
7. the Git diff has been reviewed,
8. the final report states what was and was not verified.

Code and documentation must not knowingly describe different realities.
