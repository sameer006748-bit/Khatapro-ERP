# KhataPro ERP — Current Implementation Status

Last updated: 2026-08-29

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

Production is verified to use the legacy/original schema rooted at `business`.
It is not the newer UUID-ledger schema. Do not apply migrations broadly. Always
inspect exact pending versions and dependencies first.

Known migration notes:

- migration `00013` is already applied; do not treat it as pending;
- migration `00033_mixed_sale_returns.sql` is prepared but NOT applied;
- migration `00033_mixed_sale_returns_inspect.sql` is a read-only inspection companion;
- migrations `00033`, `00034`, and `00035` are not suitable for direct application
  to the verified legacy production schema;
- migration `00036_legacy_transaction_identity_bridge.sql` is the additive
  legacy-compatible identity bridge and is **APPLIED** in production;
- migration `00037_legacy_historical_sales_returns.sql` is **APPLIED** in production (2026-08-29);
- do not use a broad migration command that may unintentionally apply unrelated pending versions.

## Legacy Transaction Identity Bridge

Migration 00036 preserves every existing transaction number and adds one shared,
business-scoped high-water-mark allocator for new legacy-schema entries. New
posting prefixes are:

| Flow | Existing history | New prefix after 00036 |
|---|---|---|
| Sales invoice | `INV` | `INV` |
| Purchase | `PUR` | `PUR` |
| Expense | `EXP` | `EXP` |
| Receipt | `RV` remains unchanged | `REC` |
| Payment | `PV` remains unchanged | `PAY` |
| Contra | `CV` remains unchanged | `CON` |
| Journal | `JV` remains unchanged | `JRV` |
| Purchase return | `PRN` remains unchanged | `PRT` |
| Sales return | stable `SR` backfill | `SRT` |
| COD submission | `CS` | `CS` |

The migration adds only `sales_returns.return_no`: nullable first, deterministic
`SR-xxxx` historical backfill, unique per business, then NOT NULL. A trigger
allocates `SRT-xxxx` for new rows. Identity-aware RPC overloads make retries
idempotent; before 00036 is applied, existing payment/receipt/journal/contra/
expense/purchase-return pages retry the original signatures. Sales Return fails
with an actionable HTTP 409 migration-required response instead of posting an
unidentified return or returning a generic 500.

Pending because no compatible legacy posting path currently exists: stock
adjustment (`STA`), stock movement/transfer document (`STM`), opening stock
(`OPS`), rider settlement (`RDS`), commission settlement (`COM`), capital
introduced (`CAP`), owner drawings (`DRW`), and delivery outcome (`DO`).

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

## Historical / Pure Sales Return

Implemented in source and locally runtime-verified:

- one shared Sales List workflow searches/selects the original invoice across Counter, Online, OFC, and Other;
- invoice detail selects the immutable original invoice item and shows sold, previously returned, and remaining returnable quantities;
- a pure return posts Sold 0 / Return X and preserves both original invoice and item linkage;
- local Prisma posting is one transaction with business checks, cumulative over-return guards, compare-and-swap protection, exact-once stock restoration, SRT allocation, immutable commission reversal events, user-managed refund accounts, explicit customer-credit status, and idempotent replay;
- invoice detail shows SRT references, returned total, and Refunded / Customer credit due status;
- focused historical, mixed-return, and commission tests pass;
- disposable-database runtime verification created `SRT-0001`, preserved original Sold 10, increased Returned and stock by exactly 1, and replayed the same SRT on retry.

Production activation: migration `00037_legacy_historical_sales_returns.sql` was applied to production (2026-08-29) after a one-line schema correction (`v_invoice.status` → `v_invoice.is_cancelled`, because production `invoices` has no `status` column). Production schema was verified read-only: `returned_qty`, `sales_return_lines`, new `sales_returns` columns, `request_fingerprint`, and the 9-argument `post_sales_return` (SECURITY DEFINER, `search_path = public`, service_role-only grants) all present; 5-arg/6-arg overloads intact. Production browser/UAT runtime verification of a real historical return remains pending (no safe isolated test business exists).

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

## Accounting Codes / Identities Implementation Update — 2026-08-28

- Added shared Prisma IdentitySequence allocator and routed Prisma sales (INV), purchases (PUR), and purchase returns (PRT) through it.
- Created, but did **not** apply, additive migration  0034_code_words_and_prefix_registry.sql. It preserves historic/legacy prefixes while issuing new readable registry prefixes (SRT, PRT, REC, PAY, CON, JRV, STA, STM, OPS, RDS, COM) on the Supabase paths.
- Added required readable code-word design for persisted account subcategories: canonical uppercase letters/numbers/hyphens, unique by business, collision-safe backfill, editable code, relational IDs preserved.
- Account-category UI/API includes Code Word input/display/edit and clear duplicate/invalid validation contracts.
- Migration-absent compatibility was runtime verified on localhost: authenticated category GET returns ACCOUNTING_MIGRATION_REQUIRED data (200) and attempted create returns CODE_WORD_SCHEMA_REQUIRED (409), never 500.
- Focused tests passed. Full test sweep has one known pre-existing Counter Sale keyboard assertion failure in an unrelated already-modified file; full lint process did not complete in this environment.
px tsc --noEmit and build passed.
- Remaining before final completion claim: explicitly apply  0034 only to a disposable/local approved database, then browser-verify category/subcategory create, duplicate rejection, edit, hierarchy display, and each supported Supabase document posting prefix.


## Accounting code-word verification update - 2026-08-29

Implemented: all fixed top-level category families have readable codes; persisted subcategories have normalized, business-unique readable codes; numeric CoA codes remain separate; migration 00035 preserves existing IDs and hierarchy. Focused tests, lint, TypeScript, and build passed.

Not runtime-verified: authenticated category/subcategory CRUD, PostgreSQL migration application, and transaction posting workflows. The local app shell returned 200 and the protected category endpoint returned 401 without a session. No local PostgreSQL endpoint was configured; the non-local disposable URL was not used.


## Migration 00036 applied to production — 2026-08-29

`00036_legacy_transaction_identity_bridge.sql` was applied directly to production ref
`ebcebxwpddltiwrqybqc` via exact-file `psql --single-transaction` (no db push, no broad
migration up, no repair, no reset). Only 00036 was executed.

Schema verified: `sales_returns.return_no` (text, NOT NULL, business-scoped unique) added;
bridge tables `legacy_transaction_identity_sequences` (seeded INV=6/PUR=1/EXP=2, others 0)
and `legacy_transaction_identity_requests` created; identity-aware idempotent overloads +
base overloads coexist for all eight posting functions; sales-return trigger installed;
service_role-only grants, no anon/authenticated grants, no UUID-ledger tables.

Historic identities preserved: INV-0001..0006, PUR-0001, EXP-0001/0002, CV-0001, RV-0001,
JV-0001.. all unchanged.

New-prefix capability verified in a rollback-only transaction (CON/REC/PAY/PRT/SRT/JRV plus
continuing INV/PUR/EXP); no identity consumed. Live application-layer posting NOT verified —
production has only the real business `biz-default` and no safe test business, so no
customer-impacting transaction was created.

Migration history: `supabase_migrations.schema_migrations` does not exist (unmanaged);
00036 applied directly, history reconciliation pending separately, no mass repair.

## Migration 00037 applied to production — 2026-08-29

`00037_legacy_historical_sales_returns.sql` was applied directly to production ref
`ebcebxwpddltiwrqybqc` via exact-file `psql` (no db push, no migration up, no repair).
Only 00037 was executed; the file's own `begin;`/`commit;` provided the single transaction.

Preflight correction applied before application: `if v_invoice.status = 'Cancelled'` was
changed to `if v_invoice.is_cancelled` because production `invoices` has no `status` column.

Production schema verified read-only after application:

- `invoice_items.returned_qty` integer NOT NULL default 0 with check
  `returned_qty >= 0 and returned_qty <= qty`;
- `sales_returns.refund_mode`, `refund_account_id` (FK to accounts, restrict),
  `settlement_status` added;
- `legacy_transaction_identity_requests.request_fingerprint` added;
- `sales_return_lines` created (PK, FKs cascade/restrict, `returned_qty > 0` check,
  unique `(sales_return_id, original_invoice_item_id)`, business+item index, RLS enabled);
- 9-argument `post_sales_return(text,text,date,jsonb,text,text,text,uuid,text) → jsonb`
  created as SECURITY DEFINER, `SET search_path = public`, EXECUTE granted only to
  `service_role` (and owner `postgres`); anon/authenticated/public revoked;
- existing 5-arg and 6-arg `post_sales_return` overloads remain intact;
- the 9-arg body references `v_invoice.is_cancelled` (verified, not `status`);
- production data unchanged: 1 business, 6 invoices, 11 invoice_items, 0 sales_returns,
  0 sales_return_lines, 0 historical-return identity rows.

Runtime/UAT: NOT performed against production because only the real business
`biz-default` exists and no safe isolated test business is available. Browser workflow
verification for a real historical/partial sales return remains pending manual sign-off.
