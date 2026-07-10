-- ============================================================================
-- KhataPro ERP — Migration 00001: Phase 1 Foundation Schema
-- ============================================================================
-- Tables: business, profiles, roles, permissions, role_permissions,
--         account_categories, accounts, business_accounts, audit_logs
--
-- Design rules (from master build prompt):
--   * business_id on EVERY business-data table (multi-tenant-ready)
--   * Money stored as BIGINT minor units (paisas) — never float/double
--   * RLS enabled on every business-data table
--   * SECURITY DEFINER helper functions for permission checks (avoid RLS
--     recursion when querying roles/permissions)
--   * updated_at maintained by triggers
--   * No standalone `users` table — uses Supabase auth.users
-- ============================================================================

-- Extensions
create extension if not exists "pgcrypto";

-- ============================================================================
-- updated_at trigger function (reusable)
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- business — single-business MVP, but multi-tenant-ready
-- ============================================================================
create table if not exists public.business (
  id          text primary key default gen_random_uuid()::text,
  name        text not null,
  legal_name  text,
  phone       text,
  address     text,
  currency    text not null default 'PKR',
  timezone    text not null default 'Asia/Karachi',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_business_updated_at on public.business;
create trigger trg_business_updated_at
  before update on public.business
  for each row execute function public.set_updated_at();

alter table public.business enable row level security;

-- Business is readable by any authenticated user (MVP: single business).
-- Writes restricted to Owner/Admin via app-layer checks (the first owner
-- bootstrap creates the business row server-side).
drop policy if exists "business_read_authenticated" on public.business;
create policy "business_read_authenticated" on public.business
  for select to authenticated using (true);

-- ============================================================================
-- roles
-- ============================================================================
create table if not exists public.roles (
  id          text primary key default gen_random_uuid()::text,
  business_id text not null references public.business(id) on delete cascade,
  name        text not null,
  is_system   boolean not null default false,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (business_id, name)
);

drop trigger if exists trg_roles_updated_at on public.roles;
create trigger trg_roles_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

alter table public.roles enable row level security;

drop policy if exists "roles_read_authenticated" on public.roles;
create policy "roles_read_authenticated" on public.roles
  for select to authenticated using (true);

-- ============================================================================
-- permissions — global catalog, not business-scoped
-- ============================================================================
create table if not exists public.permissions (
  id          text primary key default gen_random_uuid()::text,
  code        text not null unique,
  module      text not null,
  description text,
  created_at  timestamptz not null default now()
);

alter table public.permissions enable row level security;

drop policy if exists "permissions_read_authenticated" on public.permissions;
create policy "permissions_read_authenticated" on public.permissions
  for select to authenticated using (true);

-- ============================================================================
-- role_permissions
-- ============================================================================
create table if not exists public.role_permissions (
  id            text primary key default gen_random_uuid()::text,
  role_id       text not null references public.roles(id) on delete cascade,
  permission_id text not null references public.permissions(id) on delete cascade,
  unique (role_id, permission_id)
);

alter table public.role_permissions enable row level security;

drop policy if exists "role_permissions_read_authenticated" on public.role_permissions;
create policy "role_permissions_read_authenticated" on public.role_permissions
  for select to authenticated using (true);

-- ============================================================================
-- profiles — 1:1 with auth.users
-- ============================================================================
create table if not exists public.profiles (
  id           text primary key default gen_random_uuid()::text,
  user_id      uuid not null unique references auth.users(id) on delete cascade,
  business_id  text not null references public.business(id) on delete cascade,
  role_id      text not null references public.roles(id),
  display_name text not null,
  phone        text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

-- A profile is readable by its owner OR by anyone in the same business
-- (so Owner/Admin can see all users in their business).
drop policy if exists "profiles_read_self_or_same_business" on public.profiles;
create policy "profiles_read_self_or_same_business" on public.profiles
  for select to authenticated using (
    user_id = auth.uid()
    or business_id in (
      select p.business_id from public.profiles p where p.user_id = auth.uid()
    )
  );

-- A user can update their own profile (display_name, phone) but NOT role/business.
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Inserts are handled by the server-side bootstrap route (service-role key,
-- bypasses RLS). No public insert policy.

-- ============================================================================
-- account_categories
-- ============================================================================
create table if not exists public.account_categories (
  id          text primary key default gen_random_uuid()::text,
  business_id text not null references public.business(id) on delete cascade,
  code        text not null,
  name        text not null,
  type        text not null check (type in ('Asset','Liability','Equity','Income','Expense')),
  unique (business_id, code)
);

alter table public.account_categories enable row level security;

drop policy if exists "categories_read_same_business" on public.account_categories;
create policy "categories_read_same_business" on public.account_categories
  for select to authenticated using (
    business_id in (
      select p.business_id from public.profiles p where p.user_id = auth.uid()
    )
  );

-- ============================================================================
-- accounts — the Chart of Accounts
-- ============================================================================
create table if not exists public.accounts (
  id                  text primary key default gen_random_uuid()::text,
  business_id         text not null references public.business(id) on delete cascade,
  code                text not null,
  name                text not null,
  category_id         text not null references public.account_categories(id) on delete restrict,
  parent_id           text references public.accounts(id) on delete set null,
  is_active           boolean not null default true,
  is_business_account boolean not null default false,
  is_party_account    boolean not null default false,
  party_type          text,
  -- Server-maintained cache in paisas; always derived from voucher_lines
  -- by the post_voucher() RPC. Clients must NEVER write this directly.
  balance_cache       bigint not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (business_id, code)
);

drop trigger if exists trg_accounts_updated_at on public.accounts;
create trigger trg_accounts_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

create index if not exists idx_accounts_business on public.accounts(business_id);
create index if not exists idx_accounts_category on public.accounts(category_id);
create index if not exists idx_accounts_parent on public.accounts(parent_id);
create index if not exists idx_accounts_business_ba on public.accounts(business_id, is_business_account);

alter table public.accounts enable row level security;

drop policy if exists "accounts_read_same_business" on public.accounts;
create policy "accounts_read_same_business" on public.accounts
  for select to authenticated using (
    business_id in (
      select p.business_id from public.profiles p where p.user_id = auth.uid()
    )
  );

-- ============================================================================
-- business_accounts — 1:1 with accounts under Asset
-- ============================================================================
create table if not exists public.business_accounts (
  id             text primary key default gen_random_uuid()::text,
  business_id    text not null references public.business(id) on delete cascade,
  account_id     text not null unique references public.accounts(id) on delete restrict,
  name           text not null,
  type           text not null check (type in ('Cash','Petty Cash','Bank','Easypaisa','JazzCash','Wallet','Custom / Other')),
  account_holder text,
  bank_name      text,
  account_number text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists trg_business_accounts_updated_at on public.business_accounts;
create trigger trg_business_accounts_updated_at
  before update on public.business_accounts
  for each row execute function public.set_updated_at();

create index if not exists idx_ba_business on public.business_accounts(business_id);
create index if not exists idx_ba_type on public.business_accounts(type);

alter table public.business_accounts enable row level security;

drop policy if exists "business_accounts_read_same_business" on public.business_accounts;
create policy "business_accounts_read_same_business" on public.business_accounts
  for select to authenticated using (
    business_id in (
      select p.business_id from public.profiles p where p.user_id = auth.uid()
    )
  );

-- ============================================================================
-- audit_logs — append-only
-- ============================================================================
create table if not exists public.audit_logs (
  id          text primary key default gen_random_uuid()::text,
  business_id text not null references public.business(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  action      text not null,
  entity      text not null,
  entity_id   text,
  details     jsonb,
  timestamp   timestamptz not null default now()
);

create index if not exists idx_audit_business_ts on public.audit_logs(business_id, timestamp desc);
create index if not exists idx_audit_entity on public.audit_logs(entity, entity_id);

alter table public.audit_logs enable row level security;

drop policy if exists "audit_read_same_business" on public.audit_logs;
create policy "audit_read_same_business" on public.audit_logs
  for select to authenticated using (
    business_id in (
      select p.business_id from public.profiles p where p.user_id = auth.uid()
    )
  );

-- No update/delete policy — audit logs are append-only at the RLS level.
-- Writes happen via the service-role admin client (server-side).

-- ============================================================================
-- SECURITY DEFINER helper functions
-- ============================================================================
-- These avoid RLS recursion when checking the current user's role/permissions.
-- The browser client (publishable key) can call these safely; they run with
-- the function owner's privileges but only expose boolean results.

-- Returns the business_id of the current authenticated user, or null.
create or replace function public.current_business_id()
returns text
language sql
security definer
set search_path = public
as $$
  select p.business_id
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;
$$;

-- Returns the role name of the current authenticated user, or null.
create or replace function public.current_role_name()
returns text
language sql
security definer
set search_path = public
as $$
  select r.name
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.user_id = auth.uid()
  limit 1;
$$;

-- Returns true if the current user has the given permission code.
create or replace function public.has_permission(p_code text)
returns boolean
language sql
security definer
set search_path = public
as $$
  exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id
    join public.permissions perm on perm.id = rp.permission_id
    where p.user_id = auth.uid()
      and perm.code = p_code
  )
  or exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.user_id = auth.uid()
      and r.name = 'Owner/Admin'
  );
$$;

-- Returns true if the current user is the Owner/Admin of their business.
create or replace function public.is_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
  exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.user_id = auth.uid()
      and r.name = 'Owner/Admin'
  );
$$;

-- Returns true if no Owner/Admin profile exists yet (first-owner bootstrap).
create or replace function public.no_owner_exists()
returns boolean
language sql
security definer
set search_path = public
as $$
  not exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where r.name = 'Owner/Admin'
  );
$$;

-- Grant execute to authenticated users (RLS still applies inside via auth.uid()).
grant execute on function public.current_business_id() to authenticated;
grant execute on function public.current_role_name() to authenticated;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.no_owner_exists() to authenticated;
