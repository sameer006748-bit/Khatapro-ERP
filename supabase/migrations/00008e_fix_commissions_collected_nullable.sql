-- ============================================================================
-- KhataPro ERP — Fix: salesman_commissions collected_amount nullable
-- Bug: post_sale() inserts commission row with NULL collected_amount
--      but column has NOT NULL constraint.
--      collected_amount should be NULL at accrual time (set on collection).
-- ============================================================================

alter table public.salesman_commissions
  alter column collected_amount drop not null;

NOTIFY pgrst, 'reload schema';
