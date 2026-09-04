# KhataPro ERP — Current State

Last reconciled: 2026-09-05

This is the concise factual snapshot. Use repository/database reality over this document if they ever conflict, then update this file.

## Repository / deployment
- Repository: `sameer006748-bit/Khatapro-ERP`
- Default / production branch: `main`
- Production URL: `https://khatapro-erp.vercel.app`
- Production Supabase project ref: `ebcebxwpddltiwrqybqc`
- Production accounting schema: legacy/original schema rooted at `business`, not the newer UUID-ledger architecture.

## Current maturity
KhataPro is a substantial working ERP in late handover / stabilization, not a greenfield build. Core sales, accounting, money, rider, reporting, audit, onboarding, and print foundations exist. The immediate priority is release correctness and closing client-facing regressions before broader AI-intelligence expansion.

AI maturity is currently closest to **Level 1–2** from `VISION.md`: read/explain/summary capability exists, while trustworthy anomaly detection and proactive owner intelligence remain a future phase.

## Major implemented systems
### Sales / returns / commissions
Implemented across Counter, Online, OFC, and Other sale paths:
- shared sale engine,
- sold/returned/net model,
- stock restoration and over-return protection,
- historical sale returns linked to original invoice items,
- product-level commission and attribution,
- earned-on-collection behavior,
- split payments / change handling,
- invoice detail and print modes.

### Money / business accounts
Implemented:
- client-facing Cash / Bank model,
- unlimited user-created money accounts,
- legacy seeded money-account bridging without duplicating ledger rows,
- guarded delete / deactivate behavior,
- readable persisted business-account identities separate from numeric ledger codes,
- Accounts & Balances professional grouped view.

Latest identity-persistence migration was applied and verified in production before handover work.

### Account categories / expense
Implemented:
- five fixed accounting roots,
- simple user-defined categories under each root,
- automatic linked ledger account creation,
- simplified Expense Batch category selection,
- server-side category/account validation,
- category-aware Trial Balance / report grouping where semantically safe.

### Accounting / reports
Implemented/recovered on legacy production:
- Trial Balance,
- Day Book,
- Accounts & Balances,
- Business Accounts,
- Expense Batch,
- Vouchers consolidation,
- financial report compatibility,
- audit log recovery,
- readable transaction/account identities.

### Dashboard
Owner/Admin command center includes deterministic KPI foundations, attention items, recent activity, insights, trend/comparison support where the source is trustworthy, cash position, and operational pulse. Rule-based insights are intentionally separate from AI-generated accounting truth.

### Rider
Rider hotfix is deployed to production:
- session-to-rider identity resolution handles legacy user ID/Auth UUID/profile ID safely,
- owner can connect/change rider account mapping,
- rider UI is mobile-first, action-first, plain-language, four-item navigation,
- Delivered / Partial / Returned / Cash With You flows are implemented.

Known production data fact from the hotfix validation: `rider@test.local` was not linked to a Rider row and production had zero delivery orders at that point. Code was not the remaining cause of the empty dashboard.

### Permissions / onboarding / audit
Implemented:
- role/permission-aware navigation and server gates,
- onboarding tours and contextual help,
- readable audit events for important admin/accounting mutations,
- protected destructive-action behavior.

## Recent production/release commits
Recent main history includes:
- `84953bd` — safe Rider account relinking,
- `79675c0` — Rider data recovery + simplified mobile workflow,
- `45df677` — verified release merge to main,
- `029df0b` — persisted readable money account identities,
- preceding Money / Account Categories / Expense UX and compatibility commits.

Check current `main` before relying on these as the latest HEAD.

## Validation status
Most recent reported Rider hotfix gates:
- focused Rider tests: 39/39,
- full regression: 678/678,
- TypeScript: pass,
- changed-file ESLint: pass,
- build: pass,
- diff-check: pass,
- production deployment: Ready.

A later client-found navigation hotfix is currently being worked separately; `CURRENT_WORK.md` is authoritative for the exact active task.

## Known open / deferred items
- Client-found mobile navigation regression for non-Rider roles and desktop post-sale View Invoice route regression are active release blockers until fixed and manually verified.
- Final QA/demo data cleanup remains pending; do not blind-delete referenced production records.
- Rider real-data UAT requires an actual rider mapping and assigned real delivery orders.
- Final browser/mobile/print role smoke and client credential handover remain release steps.
- Historical documentation contains stale branch/migration status and should not override this canonical set.
- Opening-stock migration `00012` has been repeatedly mentioned as not applied; verify against current production before any action.

## Important production rules
- Never broad-apply migrations.
- Never assume UUID-ledger migrations match production.
- Configured Supabase production must not silently fall back to Prisma/SQLite.
- Posted financial history is not casually hard-deleted.
- Numeric ledger codes are not the user-facing immutable identity.
- Browser/source-contract/testing evidence must be described accurately; implemented does not automatically mean production-verified.

## Read next
For ongoing work read, in order:
1. `docs/VISION.md`
2. `docs/ARCHITECTURE.md`
3. this file
4. `docs/CURRENT_WORK.md`
5. relevant `docs/ROADMAP.md` section
6. task-specific code / historical docs only as needed
