# KhataPro ERP — Current Implementation Status

Last updated: 2026-08-28

This file is the operational handoff/status document. Agents must read it together with:

- `docs/CLIENT_REQUIREMENTS.md`
- `docs/ACCOUNTING_CODES_AND_IDENTITIES.md`

before starting work on the current branch.

## Repository / Branch Context

Repository: `sameer006748-bit/Khatapro-ERP`

Primary active local branch during current recovery work:

`fix/backend-stock-recovery`

Important remote fact at the time this documentation branch was created:

- remote `fix/backend-stock-recovery` HEAD: `93451af7ef81f7b3bb37e8ac895e6205ce87d08d`
- local working branch had later unpushed work, including commit `26d1b98b24762ba4b6506c45553d37c3f2722d82` and additional uncommitted fixes

Do not assume GitHub remote HEAD equals the developer's local HEAD. Check before merging/pulling.

## Protected / Local-Only Files

Do not stage or overwrite without explicit instruction:

- `.env`
- `.env.local`
- `task_progress.md`
- `graphify-out/`
- `.vscode/`
- `db/custom.db`
- local database backups

## Production Supabase

Project ref:

`ebcebxwpddltiwrqybqc`

Do not apply migrations broadly. Always inspect exact pending versions and dependencies first.

Known migration notes:

- migration `00013` is already applied; do not treat it as pending;
- migration `00033_mixed_sale_returns.sql` is prepared but NOT applied;
- migration `00033_mixed_sale_returns_inspect.sql` is a read-only inspection companion;
- do not use a broad migration command that may unintentionally apply unrelated pending versions.

## Production Runtime Recovery

Major production page failures were fixed before the current feature batch.

Shared causes included:
- database contract drift;
- Prisma selecting columns absent from deployed DB;
- optional Supabase columns/RPCs not detected safely;
- inappropriate serverless fallback paths;
- retry behavior treating deterministic schema failures as transient;
- missing Customers API route.

Recovery commit pushed previously:

`93451af7ef81f7b3bb37e8ac895e6205ce87d08d` — `Fix production runtime page failures`

The recovery was runtime verified across core pages with zero unexplained API 400+/console failures at that time.

## Sales / Returns / Commission / Invoice Batch

Local implementation commit:

`26d1b98b24762ba4b6506c45553d37c3f2722d82` — `Complete sales returns commission and invoice workflow`

At the time of this document, that commit had not yet been pushed to the remote active branch.

### Implemented

- shared sale domain engine used across Counter, Online, OFC, and Other sale paths;
- professional Counter Sale two-panel POS redesign;
- sold / returned / net quantity model;
- stock effect from net quantity;
- per-product fixed commission;
- Owner versus Salesman commission attribution;
- invoice-linked, item-level commission visibility;
- professional invoice detail;
- print mode UI for Half A4, Two on A4, Full A4, and 80mm receipt;
- additive migration `00033` prepared for production mixed sale/return posting.

### Manually Verified Locally

Using test product `Black Cotton Shirt`:

- starting stock: 50;
- sold: 10;
- returned: 2;
- net billed: 8;
- unit rate: Rs 1,500;
- gross sale: Rs 15,000;
- return deduction: Rs 3,000;
- net sale: Rs 12,000;
- commission rate: Rs 20/piece;
- commission: Rs 160;
- stock after post: 42.

Owner attribution: verified.

Salesman attribution: verified.

Local invoice created:

`INV-0002`

Invoice detail showed:
- Sold 10;
- Returned 2;
- Remaining/Net 8;
- payment Rs 12,000;
- outstanding Rs 0;
- commission details and earned-on-collection status.

## Current Known Gap: Pure Historical Return Line

Current Counter Sale UX handles mixed sale/return on a line where returned quantity does not exceed sold quantity.

It does NOT yet provide the complete pure historical return workflow needed for:

- Sold 0;
- Return X;
- original invoice/item reference;
- remaining returnable quantity validation.

This is a required next implementation item.

## Payment UI / Business Accounts — Uncommitted Local Work

A later local session implemented payment UI simplification and user-managed payment accounts but did NOT commit/push it.

Reported work includes:

- `src/lib/sales/payment-allocation.ts`
- `src/components/erp/sales/use-payment-draft.ts`
- `src/components/erp/sales/payment-panel.tsx`
- business account management API and UI;
- Counter/Online/OFC/Other views converted to shared payment allocation;
- canonical business account types;
- edit / activate / deactivate / guarded delete;
- split payment support;
- no hard-coded Cash/JazzCash/Easypaisa payment assumptions.

Focused payment tests reported 14/14 passing.

Optional BusinessAccount description remains schema-dependent because the model currently has no description field.

## Local NextAuth Fix — Uncommitted

Local login failed with NextAuth v4 `NO_SECRET` when `NODE_ENV=production` was inherited by the dev process.

Fix made locally:

`src/lib/auth/authOptions.ts`

Explicitly set:

`secret: process.env.NEXTAUTH_SECRET`

Local Owner login was then verified successfully.

This fix was reported as NOT committed/pushed at the time of documentation.

## Counter Sale Post Button Fix — Uncommitted

Local Post Sale remained disabled because the client required payment account IDs to be UUIDs.

Local Prisma business-account IDs are CUIDs, so `isUuid(accountId)` always failed.

Fix made locally in:

`src/components/erp/views/counter-sale-view.tsx`

The client now validates payment account membership against the active business-account list instead of requiring UUID format.

Manual local POST then succeeded:

- invoice: `INV-0002`;
- same-key retry returned same invoice (idempotent);
- stock moved 50 → 42;
- no duplicate invoice.

This fix was reported as NOT committed/pushed at the time of documentation.

## Local DB Test Adjustments

Local test DB work was disclosed and is not production state.

Reported adjustments included:
- non-destructive local Prisma schema sync;
- correcting drifted AccountCategory datetime storage to Prisma-compatible values;
- seeding `IdentitySequence` so existing `INV-0001` would not collide;
- test users/password setup;
- test product commission Rs 20/piece and stock 50.

A local backup was created.

Never infer that these local DB mutations were applied to production.

## Tests / Validation from Feature Batch

Reported feature-batch gates before later uncommitted fixes:

- tests: 412 pass / 0 fail;
- lint: clean;
- `npx tsc --noEmit`: clean;
- build: success;
- `git diff --check`: only protected `.env` trailing-whitespace noise.

After later uncommitted auth/payment/button fixes, rerun focused tests, lint, TypeScript, diff check, and build before committing.

## Print Status

Invoice-detail UI is implemented and manually reviewed.

Print-mode selection UI is implemented.

Final actual browser print-output visual approval is still pending.

Do not mark print complete merely because the print modal opens.

## Accounting Codes / Identities Status

- Invoice identity prefix `INV` exists locally and was observed with `INV-0002`.
- identity-sequence foundation exists;
- all transaction classes do NOT yet have verified business prefixes;
- readable category/subcategory code words are NOT implemented end-to-end;
- numeric CoA codes such as `1010` are insufficient for the final requirement.

See `docs/ACCOUNTING_CODES_AND_IDENTITIES.md` for the authoritative policy.

## Contra Status

Expandable multi-row Contra remains pending.

This is a high-priority client workflow because internal transfers are a frequent daily operation.

## Rider Status

Rider/runtime foundation exists, but final client workflow remains incomplete/insufficiently verified for:

- multi-day rider settlement;
- delivered versus outstanding parcels;
- partial delivery / partial return;
- extremely simple rider-facing controls.

## Immediate Recommended Work Order

1. Bring these three source-of-truth docs into the local active branch without overwriting local feature work.
2. Commit the already completed local auth/payment/Post Sale fixes after re-running gates.
3. Implement pure historical return item UI.
4. Implement transaction-prefix coverage + readable category/subcategory code words.
5. Complete/verify Contra.
6. Complete/verify rider settlement and partial delivery/return.
7. Visually approve actual A4/80mm print output.
8. Review and safely apply migration `00033` only when its dependencies and production target are confirmed.
9. Push and perform final Vercel/production runtime verification.

## Agent Operating Rule

Every new implementation prompt should explicitly instruct the agent to read:

1. `docs/CLIENT_REQUIREMENTS.md`
2. `docs/ACCOUNTING_CODES_AND_IDENTITIES.md`
3. `docs/CURRENT_IMPLEMENTATION_STATUS.md`

before coding.

At the end of a completed task, update the relevant status sections in these docs so they remain the source of truth.