# KhataPro UAT Batch 1 — Phase 3 Rider COD Settlement

## Evidence

- Added `00017_phase3_rider_cod_settlement.sql` and its read-only inspection companion.
- COD delivery records immutable rider-held collection cash; it does not receipt the business, change `invoices.paid`, or earn commission.
- Settlement locks the rider and collection rows, allocates oldest outstanding cash first, supports partial allocation, creates `Received` invoice payments, updates customer credit, and invokes the Phase 2 collection-commission helper.
- Active profile, business scope, rider ownership, idempotency, SECURITY DEFINER, explicit grants, and PUBLIC/anon revocation are enforced in the RPC layer.
- Focused Phase 3 tests cover delivery, settlement, allocation, idempotency, permissions, identifiers, return safety, and migration immutability.

## Deferred and risk

Production smoke testing and migration application are deferred until Batch 1 is complete. The highest remaining risk is production-schema drift in legacy rider/delivery columns; the migration is additive and validates the required production tables before mutation.
