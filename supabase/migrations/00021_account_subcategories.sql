-- Real one-level, business-scoped account subcategories.
-- Classification metadata only: no balance or historical posting is updated.
begin;

do $$
begin
  if to_regclass('public.businesses') is null
     or to_regclass('public.profiles') is null then
    raise exception 'Account subcategories require businesses and profiles';
  end if;
end $$;

create table if not exists public.account_subcategories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  parent_code text not null check (parent_code in (
    'sales', 'expenses', 'accounts-receivable', 'accounts-payable',
    'capital', 'current-assets', 'purchases', 'salesman'
  )),
  name text not null,
  normalized_name text not null,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_subcategories_name_key
    unique (business_id, parent_code, normalized_name),
  constraint account_subcategories_name_not_blank
    check (length(trim(name)) > 0),
  constraint account_subcategories_archive_state
    check ((is_active and archived_at is null) or (not is_active and archived_at is not null))
);

create table if not exists public.account_subcategory_assignments (
  business_id uuid not null references public.businesses(id) on delete restrict,
  account_ref text not null,
  parent_code text not null check (parent_code in (
    'sales', 'expenses', 'accounts-receivable', 'accounts-payable',
    'capital', 'current-assets', 'purchases', 'salesman'
  )),
  subcategory_id uuid references public.account_subcategories(id) on delete restrict,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  constraint account_subcategory_assignments_pkey
    primary key (business_id, account_ref),
  constraint account_subcategory_assignments_account_not_blank
    check (length(trim(account_ref)) > 0)
);

create table if not exists public.account_classification_audit (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check (action in ('create', 'rename', 'archive', 'assign', 'move', 'uncategorize')),
  subcategory_id uuid references public.account_subcategories(id) on delete restrict,
  account_ref text,
  before_value jsonb,
  after_value jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists account_classification_audit_business_date_idx
  on public.account_classification_audit(business_id, occurred_at desc);

alter table public.account_subcategories enable row level security;
alter table public.account_subcategory_assignments enable row level security;
alter table public.account_classification_audit enable row level security;
revoke all on public.account_subcategories from public, anon, authenticated;
revoke all on public.account_subcategory_assignments from public, anon, authenticated;
revoke all on public.account_classification_audit from public, anon, authenticated;
grant all on public.account_subcategories to service_role;
grant all on public.account_subcategory_assignments to service_role;
grant all on public.account_classification_audit to service_role;

-- Seed only editable one-level children. Parents remain the approved stable
-- reporting classes and cannot be renamed into an invalid class.
insert into public.account_subcategories
  (business_id, parent_code, name, normalized_name)
select b.id, seed.parent_code, seed.name, lower(trim(seed.name))
from public.businesses b
cross join (values
  ('sales', 'Counter Sale'), ('sales', 'Online Sale'), ('sales', 'OFC Sale'), ('sales', 'Other Sale'),
  ('expenses', 'Rent'), ('expenses', 'Salary'), ('expenses', 'Utilities'), ('expenses', 'Delivery'), ('expenses', 'Marketing'), ('expenses', 'Miscellaneous'),
  ('accounts-receivable', 'Customer Collections'),
  ('accounts-payable', 'Vendor Payments'),
  ('purchases', 'Stock Purchases'), ('purchases', 'Purchase Returns'),
  ('capital', 'Owner Capital'), ('capital', 'Drawings'),
  ('current-assets', 'Cash'), ('current-assets', 'Bank'), ('current-assets', 'Wallet'), ('current-assets', 'Petty Cash'),
  ('salesman', 'Commissions'), ('salesman', 'Payouts')
) seed(parent_code, name)
on conflict (business_id, parent_code, normalized_name) do nothing;

create or replace function public.account_parent_report_class(p_parent_code text)
returns text
language sql immutable
set search_path = public
as $$
  select case p_parent_code
    when 'sales' then 'Income'
    when 'expenses' then 'Expense'
    when 'purchases' then 'Expense'
    when 'salesman' then 'Expense'
    when 'accounts-receivable' then 'Asset'
    when 'current-assets' then 'Asset'
    when 'accounts-payable' then 'Liability'
    when 'capital' then 'Equity'
    else null
  end
$$;

create or replace function public.phase21_assert_actor(
  p_business_id uuid, p_actor_id uuid, p_manage boolean
) returns public.profiles
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_profile public.profiles%rowtype;
begin
  select pr.* into v_profile from public.profiles pr
  where pr.id = p_actor_id and pr.business_id = p_business_id
    and pr.status = 'Active';
  if not found then
    raise exception 'Active business profile is required' using errcode = '42501';
  end if;
  if p_manage and v_profile.role not in ('Owner', 'Admin')
     and not (coalesce(v_profile.perms, '{}'::text[]) &&
       array['can_manage_account_categories', 'can_manage_chart_of_accounts']) then
    raise exception 'Profile cannot manage account subcategories' using errcode = '42501';
  end if;
  if not p_manage and v_profile.role not in ('Owner', 'Admin', 'Accountant')
     and not (coalesce(v_profile.perms, '{}'::text[]) &&
       array['can_view_account_balances', 'can_view_reports']) then
    raise exception 'Profile cannot view account subcategories' using errcode = '42501';
  end if;
  return v_profile;
end $$;

create or replace function public.list_account_subcategories(
  p_business_id uuid, p_actor_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.phase21_assert_actor(p_business_id, p_actor_id, false);
  return jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'parentCode', s.parent_code, 'name', s.name,
        'reportClass', public.account_parent_report_class(s.parent_code),
        'isActive', s.is_active, 'archivedAt', s.archived_at
      ) order by s.parent_code, s.is_active desc, s.name)
      from public.account_subcategories s where s.business_id = p_business_id
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'accountRef', a.account_ref, 'parentCode', a.parent_code,
        'subcategoryId', a.subcategory_id
      ) order by a.account_ref)
      from public.account_subcategory_assignments a
      where a.business_id = p_business_id
    ), '[]'::jsonb)
  );
end $$;

create or replace function public.manage_account_subcategory(
  p_business_id uuid,
  p_actor_id uuid,
  p_action text,
  p_parent_code text default null,
  p_subcategory_id uuid default null,
  p_name text default null,
  p_account_ref text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_sub public.account_subcategories%rowtype;
  v_before jsonb;
  v_old_assignment public.account_subcategory_assignments%rowtype;
  v_action text := lower(trim(coalesce(p_action, '')));
begin
  v_profile := public.phase21_assert_actor(p_business_id, p_actor_id, true);
  if p_parent_code is not null and p_parent_code not in (
    'sales', 'expenses', 'accounts-receivable', 'accounts-payable',
    'capital', 'current-assets', 'purchases', 'salesman'
  ) then raise exception 'Unsupported parent category'; end if;

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
    select * into v_sub from public.account_subcategories
    where id = p_subcategory_id and business_id = p_business_id for update;
    if not found then raise exception 'Subcategory not found'; end if;
    if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'Category name is required'; end if;
    v_before := to_jsonb(v_sub);
    update public.account_subcategories
    set name = trim(p_name), normalized_name = lower(trim(p_name)),
        updated_by = v_profile.id, updated_at = now()
    where id = v_sub.id returning * into v_sub;
  elsif v_action = 'archive' then
    select * into v_sub from public.account_subcategories
    where id = p_subcategory_id and business_id = p_business_id for update;
    if not found then raise exception 'Subcategory not found'; end if;
    v_before := to_jsonb(v_sub);
    update public.account_subcategories
    set is_active = false, archived_at = now(),
        updated_by = v_profile.id, updated_at = now()
    where id = v_sub.id returning * into v_sub;
  elsif v_action in ('assign', 'move', 'uncategorize') then
    if nullif(trim(coalesce(p_account_ref, '')), '') is null
       or p_parent_code is null then
      raise exception 'Account and parent are required';
    end if;
    select * into v_old_assignment from public.account_subcategory_assignments
    where business_id = p_business_id and account_ref = p_account_ref for update;
    if p_subcategory_id is not null then
      select * into v_sub from public.account_subcategories
      where id = p_subcategory_id and business_id = p_business_id
        and parent_code = p_parent_code and is_active;
      if not found then raise exception 'Active one-level subcategory is required'; end if;
    end if;
    insert into public.account_subcategory_assignments (
      business_id, account_ref, parent_code, subcategory_id, assigned_by
    ) values (
      p_business_id, trim(p_account_ref), p_parent_code, p_subcategory_id, v_profile.id
    )
    on conflict (business_id, account_ref) do update
      set parent_code = excluded.parent_code,
          subcategory_id = excluded.subcategory_id,
          assigned_by = excluded.assigned_by,
          assigned_at = now();
    v_action := case when p_subcategory_id is null then 'uncategorize'
                     when v_old_assignment.account_ref is null then 'assign'
                     else 'move' end;
  else
    raise exception 'Unsupported subcategory action';
  end if;

  insert into public.account_classification_audit (
    business_id, actor_id, action, subcategory_id, account_ref,
    before_value, after_value
  ) values (
    p_business_id, v_profile.id, v_action,
    coalesce(v_sub.id, p_subcategory_id), p_account_ref,
    coalesce(v_before, to_jsonb(v_old_assignment)), 
    case when v_action in ('assign', 'move', 'uncategorize')
      then jsonb_build_object('parentCode', p_parent_code, 'subcategoryId', p_subcategory_id)
      else to_jsonb(v_sub) end
  );
  return jsonb_build_object('ok', true, 'action', v_action, 'subcategoryId', coalesce(v_sub.id, p_subcategory_id));
end $$;

revoke all on function public.phase21_assert_actor(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.list_account_subcategories(uuid, uuid) from public, anon, authenticated;
revoke all on function public.manage_account_subcategory(uuid, uuid, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.list_account_subcategories(uuid, uuid) to service_role;
grant execute on function public.manage_account_subcategory(uuid, uuid, text, text, uuid, text, text) to service_role;

commit;
