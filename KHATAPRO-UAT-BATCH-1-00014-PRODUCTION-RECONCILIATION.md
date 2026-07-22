# KhataPro ERP — UAT Batch 1: Migration 00014 Production Reconciliation

## Confirmed Production Mappings

| Production Table | Type Convention | Used in 00014? |
|---|---|---|
| `public.businesses` | uuid PK | Yes — base precondition |
| `public.products` | uuid PK, numeric(20,0) money | Yes — commission_rate added |
| `public.invoices` | uuid PK, numeric(20,0) money | Yes — FK reference |
| `public.invoice_items` | uuid PK, int qty | Yes — returned_qty added |
| `public.profiles` | uuid PK, uuid business_id | Yes — base precondition |
| `public.riders` | uuid PK, uuid business_id | Yes — base precondition |
| `public.delivery_events` | uuid PK, uuid business_id | Yes — idempotency_key added |
| `public.rider_cash_ledger` | uuid PK, uuid business_id | Yes — idempotency_key + settlement_batch_id |

## Prisma/Local vs Supabase Split

| Model/Table | Prisma (SQLite/local) | Supabase Production |
|---|---|---|
| AccountCategory | Full model with parentId | No production table — exists only in Prisma/old migrations |
| Account | Full model with isSystem | No production table — exists only in Prisma/old migrations |
| CommissionEvent | business+idempotencyKey unique | Business-scoped unique index |
| IdentitySequence | @@unique([businessId, prefix]) | Composite PK matching |
| SalesReturn/SaleReturnLine | @@map to sale_return_documents/lines | Same names, uuid types |

## Removed Invalid Assumptions

1. **`public.business` (singular)** — replaced with `public.businesses`
2. **`public.accounts`** — removed entirely (no production table)
3. **`public.account_categories`** — removed entirely (no production table)
4. **`public.delivery_orders`** — removed (no production table; uses delivery_events instead)
5. **`public.delivery_status_events`** — removed (no production table)
6. **`public.rider_cod_submissions`** — removed (no production table)
7. **`redacted` `original_invoice_item_id` on `invoice_items`** — removed redundant self-relation
8. **`is_system` on `accounts`** — removed (no accounts table)
9. **`parent_id` on `account_categories`** — removed (no account_categories table)
10. **`delivery_orders` qty/is_settled fields** — removed
11. **CommissionEvent global idempotency index** — replaced with business-scoped unique index
12. **SELECT policies on new tables** — removed; server-only containment (RPCs only)
13. **Rider Held COD account** — removed (no accounts table in production)

## Exact Migration Objects Retained

- `public.products.commission_rate` (numeric(20,0))
- `public.invoice_items.returned_qty` (int, cached aggregate)
- `public.sale_return_documents` (uuid PK, business_id uuid, idempotency_key)
- `public.sale_return_lines` (uuid PK, business_id uuid, original_invoice_item_id uuid FK)
- `public.commission_events` (uuid PK, business_id uuid, business-scoped idempotency)
- `public.identity_sequences` (business_id uuid, composite PK)
- `public.delivery_events.idempotency_key` + unique index
- `public.rider_cash_ledger.idempotency_key` + settlement_batch_id

## Exact Objects Deferred (Phase 2+)

- AccountCategory.parent_id — deferred to accounting phase when real chart of accounts is designed
- Account.is_system — deferred
- Rider Held COD account — deferred to accounting/voucher integration (Phase 3)
- delivery_orders — not created (no production need)
- CompensationEvent accounting integration — deferred

## Type Corrections

- All PKs: `uuid` (was `text`)
- All `business_id` FKs: `uuid not null references public.businesses(id)` (was `text references public.business(id)`)
- Commission money fields: `numeric(20,0)` (was `bigint` for SQL, `BigInt` in Prisma)
- `return_no` and `idempotency_key` on sale_return_documents: `text not null` (was `text not null default gen_random_uuid()::text`)

## RLS Strategy

- All new tables: RLS enabled
- `anon` and `authenticated`: all privileges revoked
- `service_role`: all privileges granted
- No SELECT policies created — client access through RPCs only (server-only containment)

## Tests/Results

- **50 tests run, 50 passed, 0 failed**
- Verified: production base tables required, Prisma-only tables absent, UUID types, business-scoped idempotency, no stale Prisma-only DDL, server-only RLS containment

## Prisma/TypeScript Result

- `npx prisma format` — passed
- `npx prisma validate` — passed
- `npx tsc --noEmit` — passed (0 errors)

## Migration Readiness Verdict

**READY** — corrected migration is additive, transactional, and references only proven production tables.

## Confirmation: Migration NOT Applied

Migration `00014` has NOT been applied to the Supabase project. The corrected SQL is ready for review and inspection-run first.

## Next Action

Run the corrected inspection SQL on project `ebcebxwpddltiwrqybqc` to verify production schema alignment before approval.