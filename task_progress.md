# Task Progress: Repair Composite Invoice Foreign Keys

## Verification
- [x] `invoices` has **composite PK** `(business_id, id)` — confirmed from migration 00004
- [x] `invoice_items` has single-column `id text primary key` — confirmed from migration 00004
- [x] `businesses` has single `id uuid primary key` — confirmed
- [x] `products` has single `id text primary key` — confirmed
- [x] `profiles` has single `id text primary key` — confirmed
- [x] `riders` has single `id text primary key` — confirmed

## Fixes Needed
- [ ] Fix `sale_return_documents`: composite FK `(business_id, original_invoice_id)` -> `invoices(business_id, id)`
- [ ] Fix `sale_return_lines`: `original_invoice_item_id` stays single-column (invoice_items has simple PK)
- [ ] Fix `commission_events`: `invoice_id` stays no-FK (no unique constraint enforcement yet)
- [ ] Fix `identity_sequences`: `business_id` FK stays single-column (businesses has simple PK)
- [ ] Fix Prisma model SaleReturn for composite FK
- [ ] Update inspection SQL
- [ ] Update tests
- [ ] Run all checks
- [ ] Commit and push