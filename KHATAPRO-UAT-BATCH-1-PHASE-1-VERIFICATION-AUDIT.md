# KhataPro ERP — Phase 1 Foundation Verification Audit

**Branch:** fix/backend-stock-recovery  
**HEAD:** dbbbd5348b9d9dc1a8051928d4f3aa1f948e020d  
**Audit date:** 21 July 2026  

=======================================================================
STEP 1 — REPOSITORY STATE
=======================================================================

- `git status --short`: `M prisma/schema.prisma`, `?? supabase/migrations/00014_phase1_foundation.sql`
- `git diff --stat`: 1 file, +109/-37 lines
- `git diff --check`: passed (no whitespace errors)
- Migrations 00009, 00011, 00012, 00013: **untouched** — confirmed by diff inspection

=======================================================================
STEP 2 — FULL IMPLEMENTATION AUDIT (10 AREAS)
=======================================================================

### 1. PRODUCT COMMISSION RATE

| Finding | Status |
|---------|--------|
| `commissionRate` (BigInt?) on `Product` — correct money type | PASS |
| NULL means no commission — safe default | PASS |
| Supabase migration: `commission_rate bigint` — consistent | PASS |
| No DB-level CHECK for non-negative rate | **MISSING** |
| Existing products preserved (NULLable, no backfill) | PASS |

Verdict: **Partial** — missing DB-level `CHECK (commission_rate >= 0)` on both Prisma (SQLite doesn't enforce) and Supabase. Application layer must validate.

---

### 2. SALE-RETURN FOUNDATION

| Finding | Status |
|---------|--------|
| `InvoiceItem.returnedQty` (Int, default 0) — additive aggregate field | PRESENT |
| `InvoiceItem.originalInvoiceItemId` — self-referencing FK for return-line linking | PASS |
| `SalesReturn.idempotencyKey` (@unique) — duplicate return prevention | PRESENT |
| Mutable `returnedQty` aggregate: concurrent returns could overwrite | **RISK** |
| No atomic cumulative-return enforcement yet (deferred to RPC) | By design |
| Original invoice lines remain immutable (no destructive edit) | PASS |
| Migration has `invoice_items_original_idx` index | PASS |

Verdict: **Partial** — foundation schema exists for linked returns. `returnedQty` is a mutable aggregate that must later be protected by an atomic RPC/transaction using `SELECT ... FOR UPDATE` or equivalent. Not unsafe for Phase 1 but requires RPC guard in Phase 2.

---

### 3. CommissionEvent

| Finding | Status |
|---------|--------|
| Business, sale, sale-line, seller relations all present | PASS |
| `isOwnerOnly` (Boolean) — structurally distinguishes reporting-only vs expense | PASS |
| `quantity` (Int) — net eligible quantity supported | PASS |
| `ratePaisas`, `grossAmount`, `eligibleAmount`, `payableAmount`, `paidAmount` — all BigInt | PASS |
| `idempotencyKey` (@unique) — global uniqueness (stricter than business-scoped) | PASS |
| `eventType` and `status` string enums — correct classification | PASS |
| Indexes: `(businessId, invoiceId)`, `(salesmanId)`, `(invoiceItemId)`, `(idempotencyKey)` | PASS |
| SQL `commission_events` table — all columns match Prisma | PASS |

Verdict: **Complete and safe**.

---

### 4. IdentitySequence

| Finding | Status |
|---------|--------|
| `(businessId, prefix)` composite unique PK | PASS |
| Business-scoped — correct isolation | PASS |
| `lastSeq` (Int, default 0) | PASS |
| Does NOT replace shared `INV-XXXX` invoice sequence | PASS |
| SQL `identity_sequences` table — identical to Prisma | PASS |
| No reset-period logic | Not required in Phase 1 |
| Concurrency-safe: unique PK prevents duplicate reads; atomic `SELECT FOR UPDATE` needed in application | By design |

Verdict: **Complete** — foundation is concurrency-safe at DB level. Application/RPC must use atomic increment (e.g., `UPDATE ... SET last_seq = last_seq + 1 WHERE ... RETURNING last_seq`).

---

### 5. AccountCategory.parentId

| Finding | Status |
|---------|--------|
| `parentId` (String?) — nullable, safe default | PASS |
| Self-referencing relation `AccountCategoryHierarchy` | PASS |
| `account_categories_no_self_parent` CHECK constraint in migration | PASS |
| `account_categories_parent_idx` index | PASS |
| Existing categories remain valid roots (nullable parent) | PASS |
| Cycle prevention: deferred to application/RPC | By design |

Verdict: **Partial** — self-parent prevented. Multi-level cycles (grandparent loops) need application/RPC validation in later phase.

---

### 6. RIDER FOUNDATION

| Finding | Status |
|---------|--------|
| `delivery_orders.is_settled` (Boolean) | PRESENT |
| Assignment history table (`delivery_status_events` already exists in 00007) | **EXISTS** |
| Delivery event identity — existing `delivery_status_events` table | **PARTIALLY EXISTS** |
| Delivery-line quantities — NO schema for partial qty per delivery event | **MISSING** |
| Settlement batch allocations — NO new table for allocation tracking | **MISSING** |
| Rider Held COD allocation tracking — NO table column for COD per delivery line | **MISSING** |
| Duplicate delivery idempotency — NO `idempotencyKey` on delivery_status_events | **MISSING** |
| Duplicate settlement idempotency — NO `idempotencyKey` on rider_cod_submissions | **MISSING** |
| One-active-rider protection — existing RPC `assign_rider_to_order` checks status | By design |

Verdict: **Missing** — the architecture audit recommended settlement allocation table enhancement, delivery-line qty tracking, and idempotency foundations. Only `is_settled` flag added. This gap is significant for Phases 3-4 but may be addressed when those phases implement settlement.

---

### 7. RIDER HELD COD SYSTEM ACCOUNT

| Finding | Status |
|---------|--------|
| SQL INSERT uses literal `'system'` as `business_id` | **UNSAFE** |
| No proof a `'system'` business row exists in current schema | **ASSUMPTION** |
| `where not exists` prevents duplicates — correct in principle | PASS |
| Category lookup: `where business_id = 'system' and type = 'Asset'` | **UNSAFE** |
| `is_active = false` — safe to prevent accidental use | PASS |
| Code `'1300-HELD'` — reasonable Current Asset convention | PASS |

Verdict: **Unsafe** — the hardcoded `'system'` business_id is not proven to exist. This seed will silently insert nothing if no system business row or no Asset category under that business. Must be changed to either:
- A per-real-business lazy creation via application/provisioning function, OR
- A business-agnostic approach (omit business_id and rely on a system convention)

---

### 8. RLS AND PERMISSIONS

| Finding | Status |
|---------|--------|
| `commission_events` RLS enabled with SELECT policy | PRESENT |
| `identity_sequences` RLS enabled with SELECT policy | PRESENT |
| Policy pattern: `current_setting('app.current_business_id', true)` | PRESENT |
| No INSERT/UPDATE/DELETE policies — service writes bypass RLS | By design |
| No permission grants for `can_view_commissions` etc. | **MISSING** |
| No cross-business access protection beyond `business_id` filter in policy | Adequate |
| Owner/Admin, Accountant, Salesman, Rider role isolation not implemented in this phase | Deferred |

Verdict: **Partial** — RLS SELECT policies exist for new tables. No INSERT/UPDATE/DELETE policies (service writes bypass RLS — acceptable if API routes validate actor). No new permission codes added in migration.

---

### 9. CONTRA BATCH FOUNDATION

| Finding | Status |
|---------|--------|
| Architecture audit recommended multi-row batch with type per row | Required |
| Phase 1 implementation: NOT present | **NOT IMPLEMENTED** |
| Is omission valid? | Debatable — contra batch is Phase 7, not Phase 1 |

Verdict: **Valid omission** — Contra batch foundation is planned for Phase 7 per architecture audit. However, the Prisma model for contra batches was not even declared. This is acceptable for Phase 1 only.

---

### 10. MIGRATION SAFETY

| Finding | Status |
|---------|--------|
| Additive only (`alter ... add column if not exists`, `create table if not exists`) | PASS |
| No destructive drop/reset | PASS |
| Safe on existing production records | PASS |
| Correct ordering after 00013 | PASS |
| Prisma and SQL names/types align | PASS |
| Not wrapped in a single transaction (individual statements) | Minor risk |
| `gen_random_uuid()` requires `pgcrypto` extension | Already in 00007 |
| No hardcoded production IDs (except `'system'` business assumption) | **RISK** |

Verdict: **Partial** — structurally safe but Rider Held COD seed contains unsafe assumption. Also no explicit `BEGIN/COMMIT` transaction wrapper (though individual statements are idempotent).

=======================================================================
STEP 3 — TYPESCRIPT BASELINE COMPARISON
=======================================================================

| Metric | Result |
|--------|--------|
| Baseline `tsc --noEmit` at HEAD | Exit 0, no errors |
| Post-change `tsc --noEmit` after `git apply` | Exit 0, no errors |
| New errors introduced by Phase 1 changes | **None** |
| Prisma generate | Successful both times |

TypeScript comparison: **PASS** — zero regression, zero new errors.

=======================================================================
STEP 4 — TEST COVERAGE AUDIT
=======================================================================

| Test | Exists? |
|------|---------|
| Negative commission rate | NO |
| Duplicate commission source event (idempotencyKey) | NO |
| Owner reporting-only classification | NO |
| Return-line duplicate event (idempotencyKey) | NO |
| One active rider assignment | NO |
| Duplicate delivery identity | NO |
| Duplicate settlement identity | NO |
| Identity sequence concurrency | NO |
| Account category self-parent | NO |
| Migration safety (additive, no destructive) | NO |

Test coverage: **0/10**. No dedicated `tests/phase1-foundation.test.ts` file exists. All Phase 1 foundations are utterly untested.

=======================================================================
STEP 5 — REQUIREMENT-BY-REQUIREMENT VERDICT TABLE
=======================================================================

| # | Requirement | Verdict | Issue |
|---|------------|---------|-------|
| 1 | Product commission rate | Partial | Missing DB CHECK for non-negative |
| 2 | Sale-return foundation | Partial | returnedQty mutable aggregate — needs RPC guard |
| 3 | CommissionEvent | Complete and safe | — |
| 4 | IdentitySequence | Complete and safe | — |
| 5 | AccountCategory parentId | Partial | Self-parent OK; cycle prevention deferred |
| 6 | Rider foundation | Missing | Only is_settled added; missing qty tracking, idempotency |
| 7 | Rider Held COD system account | Unsafe | Hardcoded 'system' business_id assumption |
| 8 | RLS / permissions | Partial | SELECT policies only; no new permission codes |
| 9 | Contra batch foundation | Not required | Valid omission for Phase 1 |
| 10 | Migration safety | Partial | Safe structure; unsafe seed assumption |
| — | Tests | Missing | 0/10 critical tests exist |

=======================================================================
PRODUCTION RISKS
=======================================================================

1. **Rider Held COD seed: SILENT FAILURE.** If no `'system'` business or its Asset category exists, the INSERT inserts nothing. This is a silent failure — not an error. The account is never created, and later settlement code will fail with cryptic FK errors.

2. **returnedQty race condition.** Two concurrent returns on the same invoice line can both read `returnedQty = 0`, compute `newReturnedQty = 0 + 1`, and both write `1`. Actual returned quantity should be `2` but database stores `1`. This MUST be protected by `SELECT ... FOR UPDATE` or an atomic RPC before Phase 2 return logic is enabled.

3. **No transaction wrapper on migration.** While individual statements are idempotent, an interrupted migration could leave partial state (e.g., commission_events table created but RLS not enabled). Should be wrapped in `BEGIN ... COMMIT`.

=======================================================================
REPAIR PLAN
=======================================================================

### Must fix before applying migration:

1. **Rider Held COD seed:** Remove hardcoded `'system'` business. Replace with one of:
   - Defer entirely: remove from 00014 and add a dedicated `00014_seed_rider_cod_account.sql` later
   - Use a business-agnostic approach: seed during first-delivery posting
   - **Recommended:** Remove seed from migration entirely. Rider Held COD account creation should happen lazily when the first Online delivery is marked delivered (Phase 3), with idempotent `insert ... where not exists` per real business_id.

2. **Add CHECK constraint for commission_rate:** `alter table products add constraint commission_rate_non_negative check (commission_rate is null or commission_rate >= 0)`

3. **Wrap migration in transaction:** Add `begin;` at top and `commit;` at bottom.

### Should fix before Phase 2:

4. **Add `returnedQty` concurrency note** as a comment in both Prisma and migration — warn future implementers this field requires `SELECT ... FOR UPDATE`.

5. **Add Phase 1 test file:** `tests/phase1-foundation.test.ts` covering at minimum commission rate validation, idempotency key uniqueness, identity sequence uniqueness, and account category self-parent.

=======================================================================
FINAL CONFIRMATIONS
=======================================================================

- [Y] Migration 00014 NOT applied to any environment
- [Y] Migrations 00009, 00011, 00012, 00013 untouched
- [Y] No commit, push, or deploy
- [Y] No files intentionally modified during audit (only temporary checkout + reapply)
- [Y] TypeScript baseline and post-change: both exit 0, zero new errors
- [Y] `git diff --check`: passed