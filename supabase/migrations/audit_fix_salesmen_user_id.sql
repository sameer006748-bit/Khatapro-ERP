-- ============================================================================
-- KhataPro ERP — Audit Fix: Add user_id to salesmen for ownership filtering
--
-- Problem: Salesman role has can_view_own_sales but the API returns ALL
-- business invoices because there's no link between the authenticated user
-- and their salesman record.
--
-- Fix: Add user_id column to salesmen, backfill the preview salesman,
-- and use it to filter invoice queries.
-- ============================================================================

-- 1. Add user_id column to salesmen (nullable — not all salesmen may have
--    an auth account, e.g. if created before user mapping was implemented).
alter table public.salesmen add column if not exists user_id uuid;

-- 2. Create index for user_id lookup.
create index if not exists salesmen_user_id_idx on public.salesmen(user_id) where user_id is not null;

-- 3. Backfill: link the preview salesman "Ali (Salesman)" to the
--    salesman@test.local Supabase auth user.
--    salesman@test.local Supabase UUID: 0ff3b086-5fd1-4a85-bd23-b8fa723c207c
--    Ali (Salesman) record: business_id='biz-default', name='Ali (Salesman)'
update public.salesmen
set user_id = '0ff3b086-5fd1-4a85-bd23-b8fa723c207c'
where business_id = 'biz-default'
  and name = 'Ali (Salesman)'
  and user_id is null;

-- 4. Add RLS policy so users can look up their own salesman record.
drop policy if exists salesmen_select_own_user on public.salesmen;
create policy salesmen_select_own_user on public.salesmen
  for select using (
    business_id = public.current_business_id()
    and (user_id = auth.uid() or public.has_permission('can_manage_setup'))
  );
