-- ============================================================================
-- KhataPro ERP — Fix: salesman_commissions.allocation_id nullable
-- Bug: post_sale() inserts commission row before payment_allocations are created,
--      so allocation_id is NULL but the column has NOT NULL constraint.
-- Fix: Make allocation_id nullable (commission is accrued at sale time,
--       allocation_id is linked later when payment is collected)
-- ============================================================================

alter table public.salesman_commissions
  alter column allocation_id drop not null;

NOTIFY pgrst, 'reload schema';
