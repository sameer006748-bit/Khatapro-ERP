-- Supersede 00021's text account_ref placeholder with a canonical UUID
-- ledger-account FK while preserving its categories and audit history.
begin;

do $$
begin
  if to_regclass('public.account_subcategories') is null
     or to_regclass('public.account_subcategory_assignments') is null
     or to_regclass('public.ledger_accounts') is null then
    raise exception 'Ledger subcategories require migrations 00021 and 00025-00027';
  end if;
end $$;

alter table public.account_subcategory_assignments
  add column if not exists account_id uuid;
alter table public.account_classification_audit
  add column if not exists account_id uuid;

-- Preserve any development assignment that can be proven to reference the
-- canonical account by UUID or stable account code. Unresolved rows remain
-- readable but are explicitly surfaced by the inspection stop condition.
update public.account_subcategory_assignments assignment
set account_id = account.id
from public.ledger_accounts account
where account.business_id = assignment.business_id
  and assignment.account_id is null
  and (
    assignment.account_ref = account.id::text
    or assignment.account_ref = account.account_code
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.account_subcategory_assignments')
      and conname = 'account_subcategory_assignments_ledger_account_fkey'
  ) then
    alter table public.account_subcategory_assignments
      add constraint account_subcategory_assignments_ledger_account_fkey
      foreign key (business_id, account_id)
      references public.ledger_accounts(business_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.account_classification_audit')
      and conname = 'account_classification_audit_ledger_account_fkey'
  ) then
    alter table public.account_classification_audit
      add constraint account_classification_audit_ledger_account_fkey
      foreign key (business_id, account_id)
      references public.ledger_accounts(business_id, id) on delete restrict;
  end if;
end $$;

create unique index if not exists account_subcategory_assignments_ledger_key
  on public.account_subcategory_assignments(business_id, account_id)
  where account_id is not null;

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
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'parentCode', s.parent_code,
        'name', s.name,
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

drop function if exists public.manage_account_subcategory(
  uuid, uuid, text, text, uuid, text, text
);

create function public.manage_account_subcategory(
  p_business_id uuid,
  p_actor_id uuid,
  p_action text,
  p_parent_code text default null,
  p_subcategory_id uuid default null,
  p_name text default null,
  p_account_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_sub public.account_subcategories%rowtype;
  v_account public.ledger_accounts%rowtype;
  v_before jsonb;
  v_old_assignment public.account_subcategory_assignments%rowtype;
  v_action text := lower(trim(coalesce(p_action, '')));
  v_expected_class text;
begin
  v_profile := public.phase21_assert_actor(p_business_id, p_actor_id, true);
  v_expected_class := public.account_parent_report_class(p_parent_code);
  if p_parent_code is not null and v_expected_class is null then
    raise exception 'Unsupported parent category';
  end if;

  if v_action = 'create' then
    if nullif(trim(coalesce(p_name, '')), '') is null or p_parent_code is null then
      raise exception 'Parent and category name are required';
    end if;
    insert into public.account_subcategories (
      business_id, parent_code, name, normalized_name, created_by, updated_by
    ) values (
      p_business_id, p_parent_code, trim(p_name), lower(trim(p_name)),
      v_profile.id, v_profile.id
    ) returning * into v_sub;
  elsif v_action = 'rename' then
    select * into v_sub
    from public.account_subcategories
    where id = p_subcategory_id and business_id = p_business_id
    for update;
    if not found then raise exception 'Subcategory not found'; end if;
    if nullif(trim(coalesce(p_name, '')), '') is null then
      raise exception 'Category name is required';
    end if;
    v_before := to_jsonb(v_sub);
    update public.account_subcategories
    set name = trim(p_name),
        normalized_name = lower(trim(p_name)),
        updated_by = v_profile.id,
        updated_at = now()
    where id = v_sub.id
    returning * into v_sub;
  elsif v_action = 'archive' then
    select * into v_sub
    from public.account_subcategories
    where id = p_subcategory_id and business_id = p_business_id
    for update;
    if not found then raise exception 'Subcategory not found'; end if;
    v_before := to_jsonb(v_sub);
    update public.account_subcategories
    set is_active = false,
        archived_at = now(),
        updated_by = v_profile.id,
        updated_at = now()
    where id = v_sub.id
    returning * into v_sub;
  elsif v_action in ('assign', 'move', 'uncategorize') then
    if p_account_id is null or p_parent_code is null then
      raise exception 'Canonical ledger account and parent are required';
    end if;
    select * into v_account
    from public.ledger_accounts
    where id = p_account_id and business_id = p_business_id and is_active
    for update;
    if not found then
      raise exception 'Active same-business ledger account is required';
    end if;
    if v_account.report_class <> v_expected_class then
      raise exception 'Account cannot move between Balance Sheet and Profit and Loss report classes';
    end if;
    if p_subcategory_id is not null then
      select * into v_sub
      from public.account_subcategories
      where id = p_subcategory_id
        and business_id = p_business_id
        and parent_code = p_parent_code
        and is_active;
      if not found then
        raise exception 'Active one-level subcategory is required';
      end if;
    end if;
    select * into v_old_assignment
    from public.account_subcategory_assignments
    where business_id = p_business_id and account_id = p_account_id
    for update;
    insert into public.account_subcategory_assignments (
      business_id, account_ref, account_id, parent_code,
      subcategory_id, assigned_by
    ) values (
      p_business_id, p_account_id::text, p_account_id, p_parent_code,
      p_subcategory_id, v_profile.id
    )
    on conflict (business_id, account_id) where account_id is not null do update
      set account_ref = excluded.account_ref,
          parent_code = excluded.parent_code,
          subcategory_id = excluded.subcategory_id,
          assigned_by = excluded.assigned_by,
          assigned_at = now();
    v_action := case
      when p_subcategory_id is null then 'uncategorize'
      when v_old_assignment.account_id is null then 'assign'
      else 'move'
    end;
  else
    raise exception 'Unsupported subcategory action';
  end if;

  insert into public.account_classification_audit (
    business_id, actor_id, action, subcategory_id, account_ref, account_id,
    before_value, after_value
  ) values (
    p_business_id, v_profile.id, v_action,
    coalesce(v_sub.id, p_subcategory_id),
    case when p_account_id is null then null else p_account_id::text end,
    p_account_id,
    coalesce(v_before, to_jsonb(v_old_assignment)),
    case
      when v_action in ('assign', 'move', 'uncategorize') then
        jsonb_build_object(
          'parentCode', p_parent_code,
          'subcategoryId', p_subcategory_id,
          'reportClass', v_account.report_class
        )
      else to_jsonb(v_sub)
    end
  );
  return jsonb_build_object(
    'ok', true, 'action', v_action,
    'subcategoryId', coalesce(v_sub.id, p_subcategory_id),
    'accountId', p_account_id
  );
end $$;

revoke all on function public.list_account_subcategories(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.manage_account_subcategory(
  uuid, uuid, text, text, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.list_account_subcategories(uuid, uuid) to service_role;
grant execute on function public.manage_account_subcategory(
  uuid, uuid, text, text, uuid, text, uuid
) to service_role;

commit;
notify pgrst, 'reload schema';
