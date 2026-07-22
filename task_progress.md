# Task Progress: Repair Migration 00014

## Analysis Complete
- [x] Read migration 00014_phase1_foundation.sql
- [x] Read inspection SQL
- [x] Read production schema discovery SQL
- [x] Read Prisma schema
- [x] Read tests
- [x] Read historical migrations (00001, 00003, 00004, 00007)
- [x] Confirmed HEAD: 87f8ec5

## Issues Found in Migration 00014

### 1. Base-table preconditions use wrong tables
- Uses `public.business` (singular) → should be `public.businesses` (plural)
- Uses `public.accounts` → doesn't exist in production
- Uses `public.account_categories` → doesn't exist in production
- Uses `public.delivery_orders` → doesn't exist in production
- Uses `public.delivery_status_events` → doesn't exist in production
- Uses `public.rider_cod_submissions` → doesn't exist in production
- Missing: `public.businesses`, `public.profiles`, `public.riders`, `public.delivery_events`, `public.rider_cash_ledger`

### 2. Type mismatch: text vs uuid
- Production `businesses.id` is `uuid`, not `text`
- All `business_id` FKs should be `uuid`
- `rider_id` FKs should be `uuid`
- `profile_id` references should be `uuid`

### 3. Unnecessary self-relation on invoice_items
- `original_invoice_item_id` on invoice_items is redundant (sale_return_lines already has this relation)

### 4. Prisma-only DDL in Supabase migration
- `account_categories.parent_id` - no production table
- `accounts.is_system` - no production table
- `delivery_orders` fields - no production table
- `delivery_status_events.idempotency_key` - no production table
- `rider_cod_submissions.idempotency_key` - no production table

### 5. CommissionEvent idempotency not business-scoped
- Unique index on `idempotency_key` alone should be `(business_id, idempotency_key)`

### 6. Rider foundation uses wrong tables
- Should use `delivery_events` and `rider_cash_ledger`, not `delivery_orders`/`delivery_status_events`/`rider_cod_submissions`

## Implementation Steps
- [ ] Rewrite migration 00014_phase1_foundation.sql
- [ ] Rewrite inspection SQL
- [ ] Update Prisma schema (minimal changes)
- [ ] Update tests
- [ ] Create reconciliation report
- [ ] Run npx prisma format && npx prisma validate
- [ ] Run tests
- [ ] Run npx tsc --noEmit
- [ ] Run git diff --check
- [ ] Commit and push