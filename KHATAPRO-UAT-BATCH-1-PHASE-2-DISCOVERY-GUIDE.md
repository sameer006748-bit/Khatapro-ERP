# KhataPro ERP — Phase 2 Production Discovery Guide

## Run order

1. Run `supabase/migrations/00015_phase2_accounting_discovery.sql` in project `ebcebxwpddltiwrqybqc`.
2. Run `supabase/migrations/00015_phase2_rpc_discovery.sql` immediately afterwards.
3. Paste every result set back without application-table data.

## Expected result sets

The first file returns: relevant table/column metadata; primary and unique keys; foreign keys with ordered columns and actions; indexes; routine signatures/parameters/grants; RLS/policies/table grants; and role/permission/business-attribution metadata. The second file returns complete relevant public RPC definitions and their execute grants.

## Local paths to map after discovery

- `src/lib/sales/data-access.ts`: shared Counter, Online, and OFC `postSale()` path plus legacy full-invoice return.
- `src/app/api/sales/counter/route.ts`, `online/route.ts`, and `ofc/route.ts`: server-side seller attribution before shared posting.
- `src/app/api/sales/[id]/return/route.ts`: existing return permission boundary.
- `src/lib/vouchers/data-access.ts`: receipt, payment, journal, and voucher RPC callers.

## Known differences and remaining proof

Prisma/local models and old migrations cannot prove current production accounting tables, keys, function signatures, permissions, or RLS. Phase 1 did prove the linked-return and commission tables, but not the voucher/customer-credit path required for a line-level return. The output must therefore establish: accounting storage, exact key types, return/cancellation and payment RPC bodies, account/ledger posting conventions, and server-enforced Owner/Admin/Accountant/Salesman permissions.

No Phase 2 implementation, migration, production query, or production data change was performed.
