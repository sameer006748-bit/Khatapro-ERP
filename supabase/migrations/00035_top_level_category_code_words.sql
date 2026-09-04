-- 00035 - expose readable code words for the fixed top-level category families.
--
-- The deployed classification architecture stores one-level children in
-- account_subcategories and uses parent_code for fixed families. This
-- follow-up adds no parallel category table and changes no relational ID.
--
-- ROLLBACK (manual, only if needed): drop function
-- public.account_parent_code_word(text); then restore the 00034
-- list_account_subcategories definition without parentCategories.

begin;

create or replace function public.account_parent_code_word(p_parent_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(trim(coalesce(p_parent_code, '')))
    when 'sales' then 'INCOME'
    when 'expenses' then 'EXP'
    when 'accounts-receivable' then 'AR'
    when 'accounts-payable' then 'LIAB'
    when 'purchases' then 'PUR'
    when 'capital' then 'EQUITY'
    when 'current-assets' then 'ASSET'
    when 'salesman' then 'COMM'
    else null
  end
$$;

create or replace function public.list_account_subcategories(
  p_business_id uuid, p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.phase21_assert_actor(p_business_id, p_actor_id, false);
  return jsonb_build_object(
    'parentCategories', jsonb_build_array(
      jsonb_build_object('id', 'sales', 'code', 'INCOME', 'label', 'Sales'),
      jsonb_build_object('id', 'expenses', 'code', 'EXP', 'label', 'Expenses'),
      jsonb_build_object('id', 'accounts-receivable', 'code', 'AR', 'label', 'Accounts Receivable'),
      jsonb_build_object('id', 'accounts-payable', 'code', 'LIAB', 'label', 'Accounts Payable'),
      jsonb_build_object('id', 'purchases', 'code', 'PUR', 'label', 'Purchases'),
      jsonb_build_object('id', 'capital', 'code', 'EQUITY', 'label', 'Capital'),
      jsonb_build_object('id', 'current-assets', 'code', 'ASSET', 'label', 'Current Assets'),
      jsonb_build_object('id', 'salesman', 'code', 'COMM', 'label', 'Salesman')
    ),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'parentCode', s.parent_code,
        'name', s.name,
        'code', s.code,
        'reportClass', public.account_parent_report_class(s.parent_code),
        'isActive', s.is_active,
        'archivedAt', s.archived_at
      ) order by s.parent_code, s.is_active desc, s.name)
      from public.account_subcategories s
      where s.business_id = p_business_id
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'accountId', a.account_id,
        'parentCode', a.parent_code,
        'subcategoryId', a.subcategory_id
      ) order by la.account_code)
      from public.account_subcategory_assignments a
      join public.ledger_accounts la
        on la.business_id = a.business_id and la.id = a.account_id
      where a.business_id = p_business_id
    ), '[]'::jsonb)
  );
end $$;

revoke all on function public.account_parent_code_word(text) from public, anon, authenticated;
grant execute on function public.account_parent_code_word(text) to service_role;
revoke all on function public.list_account_subcategories(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_account_subcategories(uuid, uuid) to service_role;

commit;
notify pgrst, 'reload schema';
