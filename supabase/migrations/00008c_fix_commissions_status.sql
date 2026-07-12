-- ============================================================================
-- KhataPro ERP — Fix: salesman_commissions table missing 'status' column
-- Bug: post_sale() inserts 'status' column which doesn't exist in the table
-- ============================================================================

alter table public.salesman_commissions
  add column if not exists status text not null default 'accrued';

NOTIFY pgrst, 'reload schema';
