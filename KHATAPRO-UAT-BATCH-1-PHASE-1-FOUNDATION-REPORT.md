# KhataPro ERP — Phase 1 Foundation Report (Repaired)

**Branch:** fix/backend-stock-recovery  
**Starting HEAD:** dbbbd5348b9d9dc1a8051928d4f3aa1f948e020d  
**Final HEAD:** dbbbd5348b9d9dc1a8051928d4f3aa1f948e020d (no new commits)  
**Date:** 21 July 2026  
**Audit sources:** KHATAPRO-UAT-BATCH-1-ARCHITECTURE-AUDIT.md, KHATAPRO-UAT-BATCH-1-PHASE-1-VERIFICATION-AUDIT.md  

=======================================================================
FILES CHANGED
=======================================================================

1. `prisma/schema.prisma` — +320/-247 lines (reformatting + new models/columns)
2. `supabase/migrations/00014_phase1_foundation.sql` — new file, 166 lines

=======================================================================
REPAIRED FOUNDATIONS
=======================================================================

### Requirement Status Table (post-repair)

| # | Requirement | Verdict | Notes |
|---|------------|---------|-------|
| 1 | Product commission rate | Partial | CHECK constraint `commission_rate >= 0` added; tests deferred |
| 2 | Sale-return foundation | Partial | `returnedQty` documented as cached aggregate; atomic RPC enforcement deferred to Phase 2 |
| 3 | CommissionEvent | Complete and safe | All traceability, idempotency, and Owner vs Salesman classification present |
| 4 | IdentitySequence | Complete and safe | Business-scoped unique PK; atomic increment deferred to RPC |
| 5 | AccountCategory parentId | Partial | Self-parent CHECK present; cycle prevention deferred |
| 6 | Rider foundation | Partial | `ordered_qty`, `delivered_qty`, `returned_qty` added; idempotency keys on `delivery_status_events` and `rider_cod_submissions` added |
| 7 | Rider Held COD system account | Complete and safe | Unsafe seed removed; `is_system` flag on `accounts` for lazy per-business creation in Phase 3 |
| 8 | RLS / permissions | Partial | SELECT policies for `commission_events` and `identity_sequences`; existing 00007 RLS covers delivery tables |
| 9 | Contra batch foundation | Not required | Deferred to Phase 7 per architecture audit |
| 10 | Migration safety | Partial | Transaction wrapper (`BEGIN/COMMIT`) added; idempotent statements throughout |

=======================================================================
REPAIRS APPLIED (from verification audit)
=======================================================================

### Repair 1 — Unsafe Rider Held COD seed REMOVED
- Removed all `INSERT` statements that assumed a literal `'system'` business_id.
- Added `is_system boolean not null default false` column to `accounts` table for protected system-account identification.
- Documented: lazy per-business Rider Held COD account creation deferred to Phase 3 (first Online delivery).

### Repair 2 — Commission rate CHECK constraint ADDED
- Supabase: `check (commission_rate is null or commission_rate >= 0)`
- Prisma: BigInt? (SQLite does not enforce checks; application/RPC must validate)

### Repair 3 — Return foundation safety DOCUMENTED
- Added comment in migration: `returned_qty` is a cached aggregate; must only be updated via atomic `SELECT ... FOR UPDATE` in Phase 2+ RPC.
- `originalInvoiceItemId` index preserved.

### Repair 4 — CommissionEvent: unchanged (already Complete and safe per verification audit)

### Repair 5 — IdentitySequence: unchanged (already Complete per audit)

### Repair 6 — AccountCategory: unchanged (self-parent CHECK was already present)

### Repair 7 — Rider foundation ENHANCED
- Added `ordered_qty`, `delivered_qty`, `returned_qty` columns to `delivery_orders`.
- Added `idempotency_key` to `delivery_status_events` with unique index.
- Added `idempotency_key` to `rider_cod_submissions` with unique index.
- Qty enforcement and atomic settlement deferred to Phases 3-4.

### Repair 8 — RLS: unchanged (SELECT policies present; existing 00007 RLS covers delivery tables)

### Repair 9 — Contra batch: NOT implemented (valid omission per audit)

### Repair 10 — Migration safety: transaction wrapper ADDED (`BEGIN`/`COMMIT`)

=======================================================================
MIGRATION SAFETY
=======================================================================

- Migration 00013: untouched
- Migration 00009: untouched
- Migration 00011: untouched
- Migration 00012: untouched
- Migration 00014: additive only, all idempotent statements (`if not exists`), wrapped in `begin/commit`
- No hardcoded `system` business_id
- No hardcoded production UUIDs
- `pgcrypto` extension required (already in 00007)
- Migration was NOT applied to any environment

=======================================================================
PRISMA / TYPESCRIPT / LINT / BUILD
=======================================================================

| Check | Result |
|-------|--------|
| `npx prisma format` | Passed |
| `npx prisma validate` | Passed — "The schema is valid" |
| `npx prisma generate` | Passed — Prisma Client v6.19.3 generated |
| `npx tsc --noEmit` | Exit 0, zero errors |
| `git diff --check` | Passed (LF warning only) |
| Build | Not run (not required for schema-only changes) |

=======================================================================
TESTS
=======================================================================

No dedicated `tests/phase1-foundation.test.ts` created. Phase 1 foundations remain untested.  
Minimum test coverage deferred to implementation task:

1. Product commission: negative rate reject, valid rate accept
2. Return foundation: valid link, invalid relation reject, duplicate idempotencyKey reject
3. Commission events: Owner reporting-only vs Salesman payable
4. Identity sequence: uniqueness, concurrency
5. Account category: self-parent reject
6. Rider: one active rider, duplicate delivery/settlement reject
7. Migration: additive only, no destructive changes

=======================================================================
DEFERRED WORK
=======================================================================

- Commission calculation/posting in sale/payment APIs (Phase 2)
- Return posting and stock reversal (Phase 2)
- Rider Held COD account lazy creation (Phase 3)
- Rider settlement posting (Phase 4)
- Home date-range API (Phase 5)
- Account category UI (Phase 6)
- Contra/Drawings batch (Phase 7)
- Professional printing (Phase 8)
- Atomic RPC for identity sequence increment
- Atomic RPC for returnedQty enforcement
- Commission earning/payable lifecycle
- Permission grants for new tables

=======================================================================
HIGHEST REMAINING RISK
=======================================================================

**`returnedQty` race condition.** Two concurrent returns on the same invoice line can both read and write the same aggregate value, losing one return. Must be protected by `SELECT ... FOR UPDATE` in a future atomic posting RPC before Phase 2 return logic is enabled.

**Commission rate enforcement.** SQLite does not enforce CHECK constraints. Application-level validation must be added before commission calculation is wired into live sale posting.

=======================================================================
CONFIRMATIONS
=======================================================================

- [Y] Migration 00014 NOT applied
- [Y] Migrations 00009, 00011, 00012, 00013 untouched
- [Y] No hardcoded `system` business_id
- [Y] No commit, push, or deploy
- [Y] No secrets exposed
- [Y] No live posting flow enabled
- [Y] Shared sale invoice sequence unchanged