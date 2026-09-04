-- Legacy TEXT-ID account classification foundation.
--
-- IMPORTANT: this migration is prepared for review only. Creating this file
-- does not apply it to any database.
--
-- Hierarchy:
--   depth 0 = immutable system accounting root
--   depth 1 = client-managed category
--   depth 2 = optional client-managed subcategory
--
-- Existing accounts remain valid when linked directly to a depth-0 root.
-- New manual accounts must be linked to an active depth-1 or depth-2 row.

begin;

-- -------------------------------------------------------------------------
-- Fail-closed legacy schema and data preflight. No mutation precedes this.
-- -------------------------------------------------------------------------

do $$
declare
  v_problem text;
begin
  if to_regclass('public.business') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.roles') is null
     or to_regclass('public.permissions') is null
     or to_regclass('public.role_permissions') is null
     or to_regclass('public.account_categories') is null
     or to_regclass('public.accounts') is null
     or to_regclass('public.business_accounts') is null
     or to_regclass('public.audit_logs') is null then
    raise exception '00042 requires the legacy TEXT-ID accounting and RBAC tables';
  end if;

  select string_agg(format('%I.%I must be text', x.table_name, x.column_name), ', ')
  into v_problem
  from (values
    ('business', 'id'),
    ('profiles', 'id'),
    ('profiles', 'business_id'),
    ('account_categories', 'id'),
    ('account_categories', 'business_id'),
    ('accounts', 'id'),
    ('accounts', 'business_id'),
    ('accounts', 'category_id')
  ) x(table_name, column_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = x.table_name
      and c.column_name = x.column_name
      and c.udt_name = 'text'
  );
  if v_problem is not null then
    raise exception 'Legacy identifier precondition failed: %', v_problem;
  end if;

  -- On a first apply, account_categories must still contain only the five
  -- verified roots for every business that has accounting setup. A rerun of
  -- the completed migration is allowed to contain depth-1/2 rows.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'account_categories'
      and column_name = 'depth'
  ) then
    select string_agg(problem.business_id, ', ' order by problem.business_id)
    into v_problem
    from (
      select scoped.business_id
      from (
        select business_id from public.account_categories
        union
        select business_id from public.accounts
      ) scoped
      where (
        select count(*) from public.account_categories c
        where c.business_id = scoped.business_id
      ) <> 5
      or exists (
        select 1
        from public.account_categories c
        where c.business_id = scoped.business_id
          and (c.code, c.type) not in (
            ('ASSET', 'Asset'),
            ('LIABILITY', 'Liability'),
            ('EQUITY', 'Equity'),
            ('INCOME', 'Income'),
            ('EXPENSE', 'Expense')
          )
      )
      or exists (
        select 1
        from (values
          ('ASSET', 'Asset'),
          ('LIABILITY', 'Liability'),
          ('EQUITY', 'Equity'),
          ('INCOME', 'Income'),
          ('EXPENSE', 'Expense')
        ) expected(code, type)
        where not exists (
          select 1
          from public.account_categories c
          where c.business_id = scoped.business_id
            and c.code = expected.code
            and c.type = expected.type
        )
      )
    ) problem;
    if v_problem is not null then
      raise exception 'Unexpected legacy account category state for business(es): %', v_problem;
    end if;
  end if;

  select string_agg(a.business_id || ':' || a.id, ', ' order by a.business_id, a.id)
  into v_problem
  from public.accounts a
  left join public.account_categories c on c.id = a.category_id
  where c.id is null or c.business_id <> a.business_id;
  if v_problem is not null then
    raise exception 'Cross-business or missing account category references: %', v_problem;
  end if;

  -- Stable code verification intentionally includes the expected display name
  -- only as an abort condition. The update below matches by business + code.
  select string_agg(problem.business_id, ', ' order by problem.business_id)
  into v_problem
  from (
    select distinct a.business_id
    from public.accounts a
    where not exists (
      select 1
      from public.accounts system_account
      join public.account_categories root
        on root.id = system_account.category_id
       and root.business_id = system_account.business_id
      where system_account.business_id = a.business_id
        and system_account.code = '5010'
        and system_account.name = 'Purchases / COGS'
        and root.code = 'EXPENSE'
        and root.type = 'Expense'
    )
    or not exists (
      select 1
      from public.accounts system_account
      join public.account_categories root
        on root.id = system_account.category_id
       and root.business_id = system_account.business_id
      where system_account.business_id = a.business_id
        and system_account.code = '5030'
        and system_account.name = 'Salesman Commission Expense'
        and root.code = 'EXPENSE'
        and root.type = 'Expense'
    )
  ) problem;
  if v_problem is not null then
    raise exception 'Stable system account identity mismatch for business(es): %', v_problem;
  end if;
end $$;

-- -------------------------------------------------------------------------
-- Additive hierarchy and lifecycle columns.
-- -------------------------------------------------------------------------

alter table public.account_categories
  add column if not exists parent_id text,
  add column if not exists root_id text,
  add column if not exists depth smallint,
  add column if not exists is_active boolean not null default true,
  add column if not exists is_system boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- The first-apply preflight proved that every existing row is one of the five
-- roots, so this backfill cannot reinterpret an unknown custom row.
update public.account_categories
set parent_id = null,
    root_id = id,
    depth = 0,
    is_active = true,
    is_system = true,
    updated_at = coalesce(updated_at, now())
where depth is null;

alter table public.account_categories
  alter column root_id set not null,
  alter column depth set not null;

alter table public.accounts
  add column if not exists is_system boolean not null default false;

update public.accounts
set is_system = true
where code in ('5010', '5030');

-- 5020 is intentionally not system-managed. It remains the legacy direct-root
-- manual expense account until the client creates and classifies new accounts.

-- -------------------------------------------------------------------------
-- Business-scoped keys, hierarchy checks, and lookup indexes.
-- -------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.account_categories'::regclass
      and conname = 'account_categories_business_id_id_key'
  ) then
    alter table public.account_categories
      add constraint account_categories_business_id_id_key
      unique (business_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.account_categories'::regclass
      and conname = 'account_categories_business_parent_fkey'
  ) then
    alter table public.account_categories
      add constraint account_categories_business_parent_fkey
      foreign key (business_id, parent_id)
      references public.account_categories(business_id, id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.account_categories'::regclass
      and conname = 'account_categories_business_root_fkey'
  ) then
    alter table public.account_categories
      add constraint account_categories_business_root_fkey
      foreign key (business_id, root_id)
      references public.account_categories(business_id, id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.account_categories'::regclass
      and conname = 'account_categories_depth_check'
  ) then
    alter table public.account_categories
      add constraint account_categories_depth_check
      check (depth between 0 and 2);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.account_categories'::regclass
      and conname = 'account_categories_hierarchy_shape'
  ) then
    alter table public.account_categories
      add constraint account_categories_hierarchy_shape
      check (
        (depth = 0 and parent_id is null and root_id = id and is_system)
        or
        (depth in (1, 2) and parent_id is not null and root_id <> id and not is_system)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.accounts'::regclass
      and conname = 'accounts_business_id_id_key'
  ) then
    alter table public.accounts
      add constraint accounts_business_id_id_key unique (business_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.accounts'::regclass
      and conname = 'accounts_business_category_fkey'
  ) then
    alter table public.accounts
      add constraint accounts_business_category_fkey
      foreign key (business_id, category_id)
      references public.account_categories(business_id, id)
      on delete restrict;
  end if;
end $$;

create unique index if not exists account_categories_sibling_name_key
  on public.account_categories (business_id, parent_id, lower(btrim(name)))
  where depth in (1, 2);

create index if not exists account_categories_hierarchy_idx
  on public.account_categories (business_id, root_id, parent_id, depth, is_active);

create index if not exists accounts_classification_idx
  on public.accounts (business_id, category_id, is_active, is_system);

-- -------------------------------------------------------------------------
-- Database-enforced hierarchy, lifecycle, and system-account invariants.
-- These apply even to the compatible legacy authenticated write policies.
-- -------------------------------------------------------------------------

create or replace function public.enforce_legacy_account_category_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent public.account_categories%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.depth = 0 or old.is_system then
      raise exception 'Fixed accounting roots cannot be deleted' using errcode = '55000';
    end if;
    if exists (
      select 1 from public.account_categories c
      where c.business_id = old.business_id and c.parent_id = old.id
    ) then
      raise exception 'Category with child subcategories cannot be deleted' using errcode = '23503';
    end if;
    if exists (
      select 1 from public.accounts a
      where a.business_id = old.business_id and a.category_id = old.id
    ) then
      raise exception 'Category linked to ledger accounts cannot be deleted' using errcode = '23503';
    end if;
    return old;
  end if;

  if nullif(btrim(new.name), '') is null or length(btrim(new.name)) > 80 then
    raise exception 'Account category name must contain 1 to 80 characters';
  end if;
  new.name := btrim(new.name);

  if new.depth = 0 then
    if tg_op = 'INSERT' then
      raise exception 'New accounting roots cannot be created' using errcode = '55000';
    end if;
    if new.business_id is distinct from old.business_id
       or new.id is distinct from old.id
       or new.code is distinct from old.code
       or new.name is distinct from old.name
       or new.type is distinct from old.type
       or new.parent_id is distinct from old.parent_id
       or new.root_id is distinct from old.root_id
       or new.depth is distinct from old.depth
       or new.is_active is distinct from old.is_active
       or new.is_system is distinct from old.is_system then
      raise exception 'Fixed accounting roots are immutable' using errcode = '55000';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if new.depth not in (1, 2) or new.parent_id is null or new.is_system then
    raise exception 'Custom classification hierarchy is invalid' using errcode = '23514';
  end if;

  select c.* into v_parent
  from public.account_categories c
  where c.business_id = new.business_id and c.id = new.parent_id;
  if not found then
    raise exception 'Same-business parent category is required' using errcode = '23503';
  end if;
  if v_parent.depth <> new.depth - 1
     or new.root_id <> v_parent.root_id
     or new.type <> v_parent.type then
    raise exception 'Parent, root, depth and accounting type must agree' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' and not v_parent.is_active then
    raise exception 'New classifications require an active parent' using errcode = '55000';
  end if;

  if tg_op = 'UPDATE' then
    if new.business_id is distinct from old.business_id
       or new.id is distinct from old.id
       or new.code is distinct from old.code
       or new.type is distinct from old.type
       or new.parent_id is distinct from old.parent_id
       or new.root_id is distinct from old.root_id
       or new.depth is distinct from old.depth
       or new.is_system is distinct from old.is_system then
      raise exception 'Classification identity and accounting root are immutable' using errcode = '55000';
    end if;

    if old.is_active and not new.is_active then
      if exists (
        select 1 from public.account_categories c
        where c.business_id = old.business_id
          and c.parent_id = old.id
          and c.is_active
      ) then
        raise exception 'Deactivate active child subcategories first' using errcode = '55000';
      end if;
      if exists (
        select 1
        from public.accounts a
        join public.account_categories selected
          on selected.business_id = a.business_id and selected.id = a.category_id
        where a.business_id = old.business_id
          and a.is_active
          and (selected.id = old.id or selected.parent_id = old.id)
      ) then
        raise exception 'Deactivate or reclassify active ledger accounts first' using errcode = '55000';
      end if;
    elsif not old.is_active and new.is_active and not v_parent.is_active then
      raise exception 'Reactivate the parent category first' using errcode = '55000';
    end if;
  end if;

  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists account_categories_hierarchy_guard on public.account_categories;
create trigger account_categories_hierarchy_guard
before insert or update or delete on public.account_categories
for each row execute function public.enforce_legacy_account_category_hierarchy();

create or replace function public.enforce_legacy_account_classification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_category public.account_categories%rowtype;
  v_new_category public.account_categories%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'System-managed ledger accounts cannot be deleted' using errcode = '55000';
    end if;
    return old;
  end if;

  select c.* into v_new_category
  from public.account_categories c
  where c.business_id = new.business_id and c.id = new.category_id;
  if not found then
    raise exception 'Same-business account classification is required' using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.is_system then
    if new.business_id is distinct from old.business_id
       or new.id is distinct from old.id
       or new.code is distinct from old.code
       or new.name is distinct from old.name
       or new.category_id is distinct from old.category_id
       or new.parent_id is distinct from old.parent_id
       or new.is_active is distinct from true
       or new.is_system is distinct from true
       or new.is_business_account is distinct from old.is_business_account
       or new.is_party_account is distinct from old.is_party_account
       or new.party_type is distinct from old.party_type then
      raise exception 'System-managed ledger accounts cannot be renamed, reclassified, deactivated or deleted'
        using errcode = '55000';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.category_id is distinct from old.category_id then
    select c.* into v_old_category
    from public.account_categories c
    where c.business_id = old.business_id and c.id = old.category_id;
    if not found or v_old_category.root_id <> v_new_category.root_id
       or v_old_category.type <> v_new_category.type then
      raise exception 'Ledger accounts cannot move across fixed accounting roots'
        using errcode = '55000';
    end if;
  end if;

  if new.is_active and not v_new_category.is_active then
    raise exception 'Active ledger accounts require an active classification'
      using errcode = '55000';
  end if;

  return new;
end
$$;

drop trigger if exists accounts_classification_guard on public.accounts;
create trigger accounts_classification_guard
before insert or update or delete on public.accounts
for each row execute function public.enforce_legacy_account_classification();

-- -------------------------------------------------------------------------
-- Server-attributed permission and safe identity helpers.
-- -------------------------------------------------------------------------

create or replace function public.assert_legacy_account_classification_actor(
  p_business_id text,
  p_actor_profile_id text,
  p_manage boolean
) returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
begin
  select p.user_id into v_user_id
  from public.profiles p
  join public.roles r
    on r.id = p.role_id and r.business_id = p.business_id
  where p.id = p_actor_profile_id
    and p.business_id = p_business_id
    and p.is_active
    and (
      r.name in ('Owner', 'Admin', 'Owner/Admin')
      or exists (
        select 1
        from public.role_permissions rp
        join public.permissions permission on permission.id = rp.permission_id
        where rp.role_id = p.role_id
          and permission.code = any (
            case when p_manage then
              array['can_manage_setup', 'can_manage_account_categories', 'can_manage_chart_of_accounts']::text[]
            else
              array[
                'can_manage_setup', 'can_manage_account_categories', 'can_manage_chart_of_accounts',
                'can_view_account_balances', 'can_view_reports', 'can_view_trial_balance',
                'can_view_balance_sheet', 'can_view_pl'
              ]::text[]
            end
          )
      )
    );
  if v_user_id is null then
    raise exception 'Account classification access denied' using errcode = '42501';
  end if;
  return v_user_id;
end
$$;

create or replace function public.legacy_account_category_identity(
  p_category public.account_categories
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p_category.id,
    'code', p_category.code,
    'name', p_category.name,
    'type', p_category.type,
    'rootId', p_category.root_id,
    'parentId', p_category.parent_id,
    'depth', p_category.depth,
    'isActive', p_category.is_active
  )
$$;

create or replace function public.legacy_account_identity(
  p_account public.accounts
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p_account.id,
    'code', p_account.code,
    'name', p_account.name,
    'categoryId', p_account.category_id,
    'isActive', p_account.is_active,
    'isSystem', p_account.is_system
  )
$$;

-- -------------------------------------------------------------------------
-- Read contract. Inactive classifications are deliberately included so
-- historical account and report rows remain resolvable.
-- -------------------------------------------------------------------------

create or replace function public.list_account_classification(
  p_business_id text,
  p_actor_profile_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_legacy_account_classification_actor(
    p_business_id, p_actor_profile_id, false
  );

  return jsonb_build_object(
    'roots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'code', c.code, 'name', c.name, 'type', c.type,
        'displayType', case when c.type = 'Income' then 'Revenue' else c.type end,
        'isActive', c.is_active
      ) order by c.code)
      from public.account_categories c
      where c.business_id = p_business_id and c.depth = 0
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(public.legacy_account_category_identity(c) order by c.name)
      from public.account_categories c
      where c.business_id = p_business_id and c.depth = 1
    ), '[]'::jsonb),
    'subcategories', coalesce((
      select jsonb_agg(public.legacy_account_category_identity(c) order by c.name)
      from public.account_categories c
      where c.business_id = p_business_id and c.depth = 2
    ), '[]'::jsonb),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'code', a.code,
        'name', a.name,
        'rootId', selected.root_id,
        'rootType', selected.type,
        'categoryId', case
          when selected.depth = 1 then selected.id
          when selected.depth = 2 then selected.parent_id
          else null
        end,
        'subcategoryId', case when selected.depth = 2 then selected.id else null end,
        'classificationDepth', selected.depth,
        'isActive', a.is_active,
        'isSystem', a.is_system,
        'isBusinessAccount', a.is_business_account,
        'isPartyAccount', a.is_party_account
      ) order by a.code)
      from public.accounts a
      join public.account_categories selected
        on selected.business_id = a.business_id and selected.id = a.category_id
      where a.business_id = p_business_id
    ), '[]'::jsonb)
  );
end
$$;

-- -------------------------------------------------------------------------
-- Category management: depth 1 only.
-- -------------------------------------------------------------------------

create or replace function public.manage_account_category(
  p_business_id text,
  p_actor_profile_id text,
  p_action text,
  p_category_id text default null,
  p_root_id text default null,
  p_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_root public.account_categories%rowtype;
  v_category public.account_categories%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_id text;
begin
  v_actor_user_id := public.assert_legacy_account_classification_actor(
    p_business_id, p_actor_profile_id, true
  );

  if v_action = 'create' then
    if nullif(btrim(coalesce(p_name, '')), '') is null or length(btrim(p_name)) > 80 then
      raise exception 'Category name must contain 1 to 80 characters';
    end if;
    select c.* into v_root
    from public.account_categories c
    where c.id = p_root_id and c.business_id = p_business_id
      and c.depth = 0 and c.is_system and c.is_active
    for share;
    if not found then raise exception 'Active fixed root is required'; end if;

    v_id := gen_random_uuid()::text;
    insert into public.account_categories (
      id, business_id, code, name, type, parent_id, root_id,
      depth, is_active, is_system
    ) values (
      v_id, p_business_id,
      'CAT-' || upper(substr(replace(v_id, '-', ''), 1, 12)),
      btrim(p_name), v_root.type, v_root.id, v_root.id,
      1, true, false
    ) returning * into v_category;
    v_after := public.legacy_account_category_identity(v_category);
  else
    select c.* into v_category
    from public.account_categories c
    where c.id = p_category_id and c.business_id = p_business_id and c.depth = 1
    for update;
    if not found then raise exception 'Category not found'; end if;
    v_before := public.legacy_account_category_identity(v_category);

    if v_action = 'rename' then
      if nullif(btrim(coalesce(p_name, '')), '') is null or length(btrim(p_name)) > 80 then
        raise exception 'Category name must contain 1 to 80 characters';
      end if;
      update public.account_categories
      set name = btrim(p_name)
      where id = v_category.id and business_id = p_business_id
      returning * into v_category;
      v_after := public.legacy_account_category_identity(v_category);
    elsif v_action = 'deactivate' then
      update public.account_categories
      set is_active = false
      where id = v_category.id and business_id = p_business_id
      returning * into v_category;
      v_after := public.legacy_account_category_identity(v_category);
    elsif v_action = 'reactivate' then
      update public.account_categories
      set is_active = true
      where id = v_category.id and business_id = p_business_id
      returning * into v_category;
      v_after := public.legacy_account_category_identity(v_category);
    elsif v_action = 'delete' then
      delete from public.account_categories
      where id = v_category.id and business_id = p_business_id;
    else
      raise exception 'Unsupported category action';
    end if;
  end if;

  insert into public.audit_logs (
    business_id, user_id, action, entity, entity_id, details
  ) values (
    p_business_id,
    v_actor_user_id,
    'ACCOUNT_CATEGORY_' || upper(v_action),
    'account_category',
    coalesce(v_category.id, v_id),
    jsonb_build_object('before', v_before, 'after', v_after)
  );

  return jsonb_build_object(
    'ok', true, 'action', v_action,
    'category', coalesce(v_after, v_before)
  );
end
$$;

-- -------------------------------------------------------------------------
-- Subcategory management: depth 2 only.
-- -------------------------------------------------------------------------

create or replace function public.manage_account_subcategory(
  p_business_id text,
  p_actor_profile_id text,
  p_action text,
  p_subcategory_id text default null,
  p_category_id text default null,
  p_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_parent public.account_categories%rowtype;
  v_subcategory public.account_categories%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_id text;
begin
  v_actor_user_id := public.assert_legacy_account_classification_actor(
    p_business_id, p_actor_profile_id, true
  );

  if v_action = 'create' then
    if nullif(btrim(coalesce(p_name, '')), '') is null or length(btrim(p_name)) > 80 then
      raise exception 'Subcategory name must contain 1 to 80 characters';
    end if;
    select c.* into v_parent
    from public.account_categories c
    where c.id = p_category_id and c.business_id = p_business_id
      and c.depth = 1 and c.is_active
    for share;
    if not found then raise exception 'Active parent category is required'; end if;

    v_id := gen_random_uuid()::text;
    insert into public.account_categories (
      id, business_id, code, name, type, parent_id, root_id,
      depth, is_active, is_system
    ) values (
      v_id, p_business_id,
      'SUB-' || upper(substr(replace(v_id, '-', ''), 1, 12)),
      btrim(p_name), v_parent.type, v_parent.id, v_parent.root_id,
      2, true, false
    ) returning * into v_subcategory;
    v_after := public.legacy_account_category_identity(v_subcategory);
  else
    select c.* into v_subcategory
    from public.account_categories c
    where c.id = p_subcategory_id and c.business_id = p_business_id and c.depth = 2
    for update;
    if not found then raise exception 'Subcategory not found'; end if;
    v_before := public.legacy_account_category_identity(v_subcategory);

    if v_action = 'rename' then
      if nullif(btrim(coalesce(p_name, '')), '') is null or length(btrim(p_name)) > 80 then
        raise exception 'Subcategory name must contain 1 to 80 characters';
      end if;
      update public.account_categories
      set name = btrim(p_name)
      where id = v_subcategory.id and business_id = p_business_id
      returning * into v_subcategory;
      v_after := public.legacy_account_category_identity(v_subcategory);
    elsif v_action = 'deactivate' then
      update public.account_categories
      set is_active = false
      where id = v_subcategory.id and business_id = p_business_id
      returning * into v_subcategory;
      v_after := public.legacy_account_category_identity(v_subcategory);
    elsif v_action = 'reactivate' then
      update public.account_categories
      set is_active = true
      where id = v_subcategory.id and business_id = p_business_id
      returning * into v_subcategory;
      v_after := public.legacy_account_category_identity(v_subcategory);
    elsif v_action = 'delete' then
      delete from public.account_categories
      where id = v_subcategory.id and business_id = p_business_id;
    else
      raise exception 'Unsupported subcategory action';
    end if;
  end if;

  insert into public.audit_logs (
    business_id, user_id, action, entity, entity_id, details
  ) values (
    p_business_id,
    v_actor_user_id,
    'ACCOUNT_SUBCATEGORY_' || upper(v_action),
    'account_subcategory',
    coalesce(v_subcategory.id, v_id),
    jsonb_build_object('before', v_before, 'after', v_after)
  );

  return jsonb_build_object(
    'ok', true, 'action', v_action,
    'subcategory', coalesce(v_after, v_before)
  );
end
$$;

-- -------------------------------------------------------------------------
-- Manual ledger lifecycle and same-root classification management.
-- Business/party/system accounts remain under their dedicated workflows.
-- Account codes are immutable after creation.
-- -------------------------------------------------------------------------

create or replace function public.manage_manual_ledger_account(
  p_business_id text,
  p_actor_profile_id text,
  p_action text,
  p_account_id text default null,
  p_account_code text default null,
  p_name text default null,
  p_category_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_account public.accounts%rowtype;
  v_target public.account_categories%rowtype;
  v_current public.account_categories%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_code text;
begin
  v_actor_user_id := public.assert_legacy_account_classification_actor(
    p_business_id, p_actor_profile_id, true
  );

  if v_action = 'create' then
    v_code := upper(btrim(coalesce(p_account_code, '')));
    if v_code !~ '^[0-9A-Z][0-9A-Z._-]{1,31}$' then
      raise exception 'Account code must contain 2 to 32 letters, numbers, dots, underscores or hyphens';
    end if;
    if nullif(btrim(coalesce(p_name, '')), '') is null or length(btrim(p_name)) > 80 then
      raise exception 'Account name must contain 1 to 80 characters';
    end if;
    select c.* into v_target
    from public.account_categories c
    where c.id = p_category_id and c.business_id = p_business_id
      and c.depth in (1, 2) and c.is_active and not c.is_system
    for share;
    if not found then raise exception 'Active category or subcategory is required'; end if;

    insert into public.accounts (
      business_id, code, name, category_id, is_active, is_system,
      is_business_account, is_party_account, party_type, balance_cache
    ) values (
      p_business_id, v_code, btrim(p_name), v_target.id, true, false,
      false, false, null, 0
    ) returning * into v_account;
    v_after := public.legacy_account_identity(v_account);
  else
    select a.* into v_account
    from public.accounts a
    where a.id = p_account_id and a.business_id = p_business_id
    for update;
    if not found then raise exception 'Ledger account not found'; end if;
    if v_account.is_system or v_account.is_business_account or v_account.is_party_account then
      raise exception 'This account is managed by a dedicated system workflow' using errcode = '55000';
    end if;
    v_before := public.legacy_account_identity(v_account);

    if v_action = 'rename' then
      if nullif(btrim(coalesce(p_name, '')), '') is null or length(btrim(p_name)) > 80 then
        raise exception 'Account name must contain 1 to 80 characters';
      end if;
      update public.accounts
      set name = btrim(p_name), updated_at = now()
      where id = v_account.id and business_id = p_business_id
      returning * into v_account;
    elsif v_action = 'activate' then
      select c.* into v_target
      from public.account_categories c
      where c.id = v_account.category_id and c.business_id = p_business_id
        and c.is_active;
      if not found then raise exception 'Reactivate the account classification first'; end if;
      update public.accounts
      set is_active = true, updated_at = now()
      where id = v_account.id and business_id = p_business_id
      returning * into v_account;
    elsif v_action = 'deactivate' then
      update public.accounts
      set is_active = false, updated_at = now()
      where id = v_account.id and business_id = p_business_id
      returning * into v_account;
    elsif v_action = 'classify' then
      select c.* into v_target
      from public.account_categories c
      where c.id = p_category_id and c.business_id = p_business_id
        and c.depth in (1, 2) and c.is_active and not c.is_system
      for share;
      if not found then raise exception 'Active category or subcategory is required'; end if;
      select c.* into v_current
      from public.account_categories c
      where c.id = v_account.category_id and c.business_id = p_business_id;
      if not found or v_current.root_id <> v_target.root_id or v_current.type <> v_target.type then
        raise exception 'Ledger accounts cannot move across fixed accounting roots'
          using errcode = '55000';
      end if;
      update public.accounts
      set category_id = v_target.id, updated_at = now()
      where id = v_account.id and business_id = p_business_id
      returning * into v_account;
    else
      raise exception 'Unsupported manual ledger account action';
    end if;
    v_after := public.legacy_account_identity(v_account);
  end if;

  insert into public.audit_logs (
    business_id, user_id, action, entity, entity_id, details
  ) values (
    p_business_id,
    v_actor_user_id,
    'MANUAL_LEDGER_ACCOUNT_' || upper(v_action),
    'manual_ledger_account',
    v_account.id,
    jsonb_build_object('before', v_before, 'after', v_after)
  );

  return jsonb_build_object(
    'ok', true, 'action', v_action, 'account', v_after
  );
end
$$;

-- -------------------------------------------------------------------------
-- RLS / grants.
--
-- Scoped preflight found all production-compatible account/category writes in
-- this repository use server-side admin clients or service-role-only RPCs.
-- Business Accounts uses the 00041 RPCs and therefore remains compatible.
-- Remove only direct client mutation rights; same-business SELECT policies
-- and all service-role workflows remain unchanged.
-- -------------------------------------------------------------------------

drop policy if exists acct_cat_manage_perms on public.account_categories;
drop policy if exists accounts_manage_perms on public.accounts;
revoke insert, update, delete on public.account_categories from anon, authenticated;
revoke insert, update, delete on public.accounts from anon, authenticated;

revoke all on function public.enforce_legacy_account_category_hierarchy()
  from public, anon, authenticated;
revoke all on function public.enforce_legacy_account_classification()
  from public, anon, authenticated;
revoke all on function public.assert_legacy_account_classification_actor(text, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.legacy_account_category_identity(public.account_categories)
  from public, anon, authenticated, service_role;
revoke all on function public.legacy_account_identity(public.accounts)
  from public, anon, authenticated, service_role;

revoke all on function public.list_account_classification(text, text)
  from public, anon, authenticated;
revoke all on function public.manage_account_category(text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.manage_account_subcategory(text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.manage_manual_ledger_account(text, text, text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.list_account_classification(text, text)
  to service_role;
grant execute on function public.manage_account_category(text, text, text, text, text, text)
  to service_role;
grant execute on function public.manage_account_subcategory(text, text, text, text, text, text)
  to service_role;
grant execute on function public.manage_manual_ledger_account(text, text, text, text, text, text, text)
  to service_role;

notify pgrst, 'reload schema';
commit;
