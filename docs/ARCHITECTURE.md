# KhataPro ERP — Architecture

## Purpose
This document describes the current architecture and the invariants future work must preserve. When target architecture differs from current implementation, that distinction is explicit.

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
1. Running production code/database reality.
2. Verified deployed schema / migrations / RPC signatures.
3. Canonical architecture and current-state docs.
4. `CURRENT_WORK.md`.
5. Roadmap.
6. Historical notes and old summaries.

`VISION.md` is authoritative for product direction, not for claiming implementation status.

## Core invariant: deterministic ERP owns financial truth
**DATABASE / ACCOUNTING ENGINE = SOURCE OF TRUTH**

**AI = INTERPRETATION / INTELLIGENCE LAYER**

Authoritative values must come from deterministic code, ledgers, validated RPCs, database state, and explicit business rules.

AI must not independently become the calculator of record for balances, stock, receivables, payables, profit, cash, commission, tax, or rider settlements.

## Frontend and navigation
The ERP shell is centered in `src/components/erp/dashboard-shell.tsx` with role-aware navigation and page routing. Major operational views live under `src/components/erp/views/`.

Navigation is permission-aware and must fail closed. Role-specific simplification is intentional:
- Owner/Admin and Accountant share business-wide command-center patterns according to permission visibility.
- Salesman sees sales-oriented workspaces and own reports.
- Rider has a deliberately simplified mobile-first experience.

Deep-link authorization must never be implemented only by hiding UI controls.

## Backend / API boundary
App routes under `src/app/api/` are the primary server boundary. Sensitive production calls use server-side authorization and business scoping.

Important rules:
- session user must be resolved server-side,
- business isolation is mandatory,
- permission checks are authoritative on the server,
- UI filtering is not a security boundary,
- configured Supabase production must not silently fall back to local Prisma/SQLite behavior when a production feature is unavailable.

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
### Current
KhataPro already has AI-facing surfaces and an assistant integration, plus deterministic dashboard insights and explanatory UI. The current ERP foundation is more mature than the proactive-intelligence layer.

### Target
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

## Deployment boundary
`main` is the production source branch after the September 2026 handover merge. Vercel production must correspond to the intended `main` commit before client handover claims.

Stable client URL:
`https://khatapro-erp.vercel.app`

Never claim production success from a local build alone.

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
4. relevant canonical docs have been updated,
5. `CURRENT_WORK.md` reflects the exact next task,
6. the Git diff has been reviewed,
7. the final report states what was and was not verified.

Code and documentation must not knowingly describe different realities.
