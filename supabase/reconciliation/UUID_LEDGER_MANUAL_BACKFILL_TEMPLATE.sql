-- MANUAL APPROVED BACKFILL TEMPLATE -- NON-EXECUTABLE BY DESIGN
--
-- A future approval must replace this guard with a reviewed, business-scoped
-- source manifest produced by ledger_reconciliation(..., 'DRY_RUN_ONLY').
-- Never remove the guard in a production SQL editor without:
--   1. recording the exact business UUID and source IDs;
--   2. proving every proposed voucher balances;
--   3. confirming no canonical source voucher already exists;
--   4. taking a restorable backup/snapshot;
--   5. running in one transaction and re-running the dry report before commit.
begin;

do $$
begin
  raise exception 'STOP: manual UUID-ledger backfill has not been approved';
end $$;

-- Reviewed future inserts must call public.post_ledger_voucher with stable
-- `backfill:<source type>:<source id>` idempotency keys. Never insert ledger
-- voucher/line rows directly and never rewrite operational source history.

rollback;
