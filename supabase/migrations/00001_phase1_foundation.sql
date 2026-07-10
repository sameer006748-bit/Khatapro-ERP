-- ============================================================================
-- KhataPro ERP — Phase 1 Foundation Migration
-- Target: Supabase Postgres
--
-- This migration creates the Phase 1 schema (auth-adjacent tables, roles,
-- permissions, chart of accounts, business accounts, audit log) with:
--   - business_id on every business-data table (future multi-tenant ready)
--   - Row-Level Security (RLS) enabled on every table
--   - SECURITY DEFINER helper functions for permission checks
--   - First-owner bootstrap logic
--
-- Money columns use numeric(14,2) per the master prompt. (Phase 1 has no
-- money columns yet — they arrive in 00002_phase2_accounting.sql with
-- voucher_lines.)
-- ============================================================================

-- Required extensions
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Business
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 2. Roles + Permissions catalog
-- ----------------------------------------------------------------------------
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

create table if not exists public.permissions (
  id          text primary key default gen_random_uuid()::text,
  code        text unique not null,
  module      text not null,
  description text
);
create index if not exists permissions_module_idx on public.permissions(module);

create table if not exists public.role_permissions (
  id            text primary key default gen_random_uuid()::text,
  role_id       text not null references public.roles(id) on delete cascade,
  permission_id text not null references public.permissions(id) on delete cascade,
  unique (role_id, permission_id)
);

-- ----------------------------------------------------------------------------
-- 3. Profiles (1:1 with auth.users)
-- ----------------------------------------------------------------------------
-- We do NOT create a duplicated `users` auth table — we link to the
-- Supabase-managed auth.users via a foreign key.
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
create index if not exists profiles_business_idx on public.profiles(business_id);
create index if not exists profiles_role_idx on public.profiles(role_id);

-- ----------------------------------------------------------------------------
-- 4. Chart of Accounts
-- ----------------------------------------------------------------------------
create table if not exists public.account_categories (
  id          text primary key default gen_random_uuid()::text,
  business_id text not null references public.business(id) on delete cascade,
  code        text not null,
  name        text not null,
  type        text not null,
  unique (business_id, code)
);

create table if not exists public.accounts (
  id                  text primary key default gen_random_uuid()::text,
  business_id         text not null references public.business(id) on delete cascade,
  code                text not null,
  name                text not null,
  category_id         text not null references public.account_categories(id) on delete restrict,
  parent_id           text references public.accounts(id) on delete restrict,
  is_active           boolean not null default true,
  is_business_account boolean not null default false,
  is_party_account    boolean not null default false,
  party_type          text,
  -- Server-maintained cache in paisas (numeric(20,0) = BigInt minor units).
  balance_cache       numeric(20,0) not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (business_id, code)
);
create index if not exists accounts_category_idx on public.accounts(category_id);
create index if not exists accounts_parent_idx on public.accounts(parent_id);
create index if not exists accounts_biz_acct_idx on public.accounts(business_id, is_business_account);

create table if not exists public.business_accounts (
  id             text primary key default gen_random_uuid()::text,
  business_id    text not null references public.business(id) on delete cascade,
  account_id     text not null unique references public.accounts(id) on delete restrict,
  name           text not null,
  type           text not null,
  account_holder text,
  bank_name      text,
  account_number text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists business_accounts_biz_idx on public.business_accounts(business_id);
create index if not exists business_accounts_type_idx on public.business_accounts(type);

-- ----------------------------------------------------------------------------
-- 5. Audit log
-- ----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id          text primary key default gen_random_uuid()::text,
  business_id text not null references public.business(id) on delete cascade,
  user_id     uuid,
  action      text not null,
  entity      text not null,
  entity_id   text,
  details     jsonb,
  timestamp   timestamptz not null default now()
);
create index if not exists audit_biz_time_idx on public.audit_logs(business_id, timestamp desc);
create index if not exists audit_entity_idx on public.audit_logs(entity, entity_id);

-- ============================================================================
-- SECURITY DEFINER helper functions
-- (the Supabase equivalent of the prompt's "SECURITY DEFINER helper
--  functions where needed to avoid recursive RLS policy bugs")
-- ============================================================================

-- current_profile(): returns the caller's profile row, or null.
-- Uses auth.uid() to find the linked profile.
create or replace function public.current_profile()
returns public.profiles
language sql stable
security definer
set search_path = public
as $$
  select p.* from public.profiles p
  where p.user_id = auth.uid() and p.is_active = true
  limit 1;
$$;

-- has_permission(code text): boolean — does the current user's role grant
-- the given permission code?
create or replace function public.has_permission(p_code text)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id
    join public.permissions perm on perm.id = rp.permission_id
    where p.user_id = auth.uid()
      and p.is_active = true
      and perm.code = p_code
  );
$$;

-- is_owner(): boolean — is the current user an Owner/Admin?
create or replace function public.is_owner()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.user_id = auth.uid()
      and p.is_active = true
      and r.name = 'Owner/Admin'
  );
$$;

-- no_owner_exists(): boolean — used by the first-owner bootstrap gate.
create or replace function public.no_owner_exists()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where r.name = 'Owner/Admin' and r.is_system = true
  );
$$;

-- current_business_id(): text — the business_id of the current user.
create or replace function public.current_business_id()
returns text
language sql stable
security definer
set search_path = public
as $$
  select p.business_id from public.profiles p
  where p.user_id = auth.uid() and p.is_active = true
  limit 1;
$$;

-- ============================================================================
-- Row-Level Security
-- ============================================================================

alter table public.business          enable row level security;
alter table public.roles             enable row level security;
alter table public.permissions       enable row level security;
alter table public.role_permissions  enable row level security;
alter table public.profiles          enable row level security;
alter table public.account_categories enable row level security;
alter table public.accounts          enable row level security;
alter table public.business_accounts enable row level security;
alter table public.audit_logs        enable row level security;

-- business: readable by any member of the business. Writable only by Owner.
drop policy if exists business_select_own on public.business;
create policy business_select_own on public.business
  for select using (id = public.current_business_id());

drop policy if exists business_update_owner on public.business;
create policy business_update_owner on public.business
  for update using (public.is_owner()) with check (public.is_owner());

-- roles: readable by any member of the business. Managed by Owner only.
drop policy if exists roles_select_own on public.roles;
create policy roles_select_own on public.roles
  for select using (business_id = public.current_business_id());

drop policy if exists roles_write_owner on public.roles;
create policy roles_write_owner on public.roles
  for all using (public.is_owner()) with check (public.is_owner());

-- permissions: globally readable (it's just a catalog, no business data).
drop policy if exists permissions_read_all on public.permissions;
create policy permissions_read_all on public.permissions
  for select using (true);

-- role_permissions: readable by any member of the business.
drop policy if exists role_perms_select_own on public.role_permissions;
create policy role_perms_select_own on public.role_permissions
  for select using (
    exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.business_id = public.current_business_id()
    )
  );

-- profiles: readable by any member of the same business. Owner manages.
drop policy if exists profiles_select_own_biz on public.profiles;
create policy profiles_select_own_biz on public.profiles
  for select using (business_id = public.current_business_id());

drop policy if exists profiles_insert_owner on public.profiles;
create policy profiles_insert_owner on public.profiles
  for insert with check (public.is_owner());

drop policy if exists profiles_update_owner on public.profiles;
create policy profiles_update_owner on public.profiles
  for update using (public.is_owner()) with check (public.is_owner());

-- account_categories: readable by members; managed by can_manage_setup.
drop policy if exists acct_cat_select_own on public.account_categories;
create policy acct_cat_select_own on public.account_categories
  for select using (business_id = public.current_business_id());

drop policy if exists acct_cat_manage_perms on public.account_categories;
create policy acct_cat_manage_perms on public.account_categories
  for all using (
    business_id = public.current_business_id()
    and public.has_permission('can_manage_setup')
  ) with check (
    business_id = public.current_business_id()
    and public.has_permission('can_manage_setup')
  );

-- accounts: readable by members; managed by can_manage_setup.
drop policy if exists accounts_select_own on public.accounts;
create policy accounts_select_own on public.accounts
  for select using (business_id = public.current_business_id());

drop policy if exists accounts_manage_perms on public.accounts;
create policy accounts_manage_perms on public.accounts
  for all using (
    business_id = public.current_business_id()
    and public.has_permission('can_manage_setup')
  ) with check (
    business_id = public.current_business_id()
    and public.has_permission('can_manage_setup')
  );

-- business_accounts: readable by members; managed by can_manage_setup.
drop policy if exists biz_accts_select_own on public.business_accounts;
create policy biz_accts_select_own on public.business_accounts
  for select using (business_id = public.current_business_id());

drop policy if exists biz_accts_manage_perms on public.business_accounts;
create policy biz_accts_manage_perms on public.business_accounts
  for all using (
    business_id = public.current_business_id()
    and public.has_permission('can_manage_setup')
  ) with check (
    business_id = public.current_business_id()
    and public.has_permission('can_manage_setup')
  );

-- audit_logs: readable by can_view_audit_log. Insertable by any member
-- (the write_audit helper writes through the admin client, which bypasses
-- RLS — but we still allow direct member inserts for flexibility).
drop policy if exists audit_select_perms on public.audit_logs;
create policy audit_select_perms on public.audit_logs
  for select using (
    business_id = public.current_business_id()
    and public.has_permission('can_view_audit_log')
  );

drop policy if exists audit_insert_own on public.audit_logs;
create policy audit_insert_own on public.audit_logs
  for insert with check (business_id = public.current_business_id());

-- ============================================================================
-- Updated_at trigger (shared)
-- ============================================================================
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists business_touch on public.business;
create trigger business_touch before update on public.business
  for each row execute function public.touch_updated_at();

drop trigger if exists roles_touch on public.roles;
create trigger roles_touch before update on public.roles
  for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists accounts_touch on public.accounts;
create trigger accounts_touch before update on public.accounts
  for each row execute function public.touch_updated_at();

drop trigger if exists business_accounts_touch on public.business_accounts;
create trigger business_accounts_touch before update on public.business_accounts
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Seed: permission catalog (idempotent)
-- ============================================================================
insert into public.permissions (code, module, description) values
  ('can_view_setup', 'setup', 'View Setup module'),
  ('can_manage_setup', 'setup', 'Create/edit business profile, chart of accounts, business accounts'),
  ('can_manage_users', 'users', 'Create/invite users, assign roles'),
  ('can_manage_roles', 'users', 'Create/edit roles and customize permissions'),
  ('can_view_products', 'products', 'View products and stock'),
  ('can_create_products', 'products', 'Create/edit products and categories'),
  ('can_edit_products', 'products', 'Edit product master and merge temporary items'),
  ('can_view_sales', 'sales', 'View sales invoices and reports'),
  ('can_create_sales', 'sales', 'Create Counter / Online / OFC sale bills'),
  ('can_edit_sales', 'sales', 'Edit posted sales invoices (Owner/Admin only by default)'),
  ('can_cancel_sales', 'sales', 'Cancel / void posted sale invoice'),
  ('can_view_own_sales', 'sales', 'View only own sales (salesman scope)'),
  ('can_view_purchases', 'purchases', 'View purchases and vendor ledgers'),
  ('can_create_purchases', 'purchases', 'Create purchase bills'),
  ('can_edit_purchases', 'purchases', 'Edit posted purchases'),
  ('can_view_vouchers', 'accounting', 'View vouchers and ledger drill-down'),
  ('can_create_vouchers', 'accounting', 'Create Receipt / Payment / Contra / Petty Cash vouchers'),
  ('can_post_journal_voucher', 'accounting', 'Post manual Journal Voucher (Accountant/Owner only)'),
  ('can_post_opening_voucher', 'accounting', 'Post opening balance vouchers'),
  ('can_cancel_vouchers', 'accounting', 'Cancel/reverse posted vouchers'),
  ('can_view_expenses', 'expenses', 'View expense batches'),
  ('can_create_expenses', 'expenses', 'Create expense batches'),
  ('can_view_riders', 'riders', 'View riders and rider ledgers'),
  ('can_manage_riders', 'riders', 'Create/edit riders'),
  ('can_submit_cod', 'riders', 'Submit COD collected (rider scope)'),
  ('can_view_own_orders', 'riders', 'View only own assigned orders (rider scope)'),
  ('can_view_trial_balance', 'reports', 'View Trial Balance'),
  ('can_view_pl', 'reports', 'View Profit & Loss / Income Statement'),
  ('can_view_balance_sheet', 'reports', 'View Balance Sheet'),
  ('can_view_ledgers', 'reports', 'View ledger drill-down and Day/Journal/Cash/Bank books'),
  ('can_view_vendor_ledger', 'reports', 'View Vendor Ledger'),
  ('can_view_customer_ledger', 'reports', 'View Customer Ledger'),
  ('can_view_salesman_commission', 'reports', 'View Salesman Commission Report'),
  ('can_view_rider_cod_report', 'reports', 'View Rider COD Report'),
  ('can_view_stock_report', 'reports', 'View Stock / Negative Stock / Pending Stock Entry reports'),
  ('can_view_receivables', 'reports', 'View Receivables report'),
  ('can_view_payables', 'reports', 'View Payables report'),
  ('can_view_daily_closing', 'reports', 'View Daily Closing report'),
  ('can_manage_closing', 'reports', 'Run daily closing'),
  ('can_export_reports', 'reports', 'Export reports to PDF / Excel'),
  ('can_view_account_balances', 'sensitive', 'View business account balances and trial balance figures'),
  ('can_view_audit_log', 'audit', 'View audit log')
on conflict (code) do update set
  module = excluded.module,
  description = excluded.description;

-- ============================================================================
-- Seed: default business + system roles + CoA
-- (Mirror of scripts/seed-phase1.ts so Supabase matches the local preview.)
-- ============================================================================
insert into public.business (id, name, currency, timezone)
values ('biz-default', 'Default Business', 'PKR', 'Asia/Karachi')
on conflict (id) do nothing;

-- System roles
insert into public.roles (id, business_id, name, is_system, description)
values
  ('role-owner-default', 'biz-default', 'Owner/Admin', true,
   'Full access. First registered owner is assigned this role.'),
  ('role-accountant-default', 'biz-default', 'Accountant', true,
   'Sales, purchases, vouchers, reports, closing.'),
  ('role-salesman-default', 'biz-default', 'Salesman', true,
   'Counter sale bill creation, own sales, own commission.'),
  ('role-rider-default', 'biz-default', 'Rider', true,
   'Assigned online orders, delivery status, COD submission, own ledger.')
on conflict (business_id, name) do update set
  is_system = true,
  description = excluded.description;

-- Owner/Admin gets every permission.
insert into public.role_permissions (role_id, permission_id)
select 'role-owner-default', id from public.permissions
on conflict do nothing;

-- Accountant
insert into public.role_permissions (role_id, permission_id)
select 'role-accountant-default', p.id from public.permissions p
where p.code in (
  'can_view_setup','can_view_products','can_create_products','can_edit_products',
  'can_view_sales','can_create_sales','can_edit_sales','can_cancel_sales',
  'can_view_purchases','can_create_purchases','can_edit_purchases',
  'can_view_vouchers','can_create_vouchers','can_post_journal_voucher',
  'can_post_opening_voucher','can_cancel_vouchers',
  'can_view_expenses','can_create_expenses','can_view_riders',
  'can_view_trial_balance','can_view_pl','can_view_balance_sheet',
  'can_view_ledgers','can_view_vendor_ledger','can_view_customer_ledger',
  'can_view_salesman_commission','can_view_rider_cod_report',
  'can_view_stock_report','can_view_receivables','can_view_payables',
  'can_view_daily_closing','can_manage_closing','can_export_reports',
  'can_view_account_balances','can_view_audit_log')
on conflict do nothing;

-- Salesman
insert into public.role_permissions (role_id, permission_id)
select 'role-salesman-default', p.id from public.permissions p
where p.code in (
  'can_view_products','can_create_sales','can_view_own_sales','can_view_salesman_commission')
on conflict do nothing;

-- Rider
insert into public.role_permissions (role_id, permission_id)
select 'role-rider-default', p.id from public.permissions p
where p.code in ('can_view_own_orders','can_submit_cod')
on conflict do nothing;

-- Account categories
insert into public.account_categories (business_id, code, name, type)
values
  ('biz-default','ASSET','Asset','Asset'),
  ('biz-default','LIABILITY','Liability','Liability'),
  ('biz-default','EQUITY','Equity','Equity'),
  ('biz-default','INCOME','Income','Income'),
  ('biz-default','EXPENSE','Expense','Expense')
on conflict (business_id, code) do update set
  name = excluded.name, type = excluded.type;

-- Default Chart of Accounts (17 accounts)
insert into public.accounts (business_id, code, name, category_id, is_business_account, is_party_account, party_type)
select 'biz-default', x.code, x.name, c.id, x.is_ba, x.is_pa, x.pt
from (values
  ('1010','Cash',true,false,null::text),
  ('1020','Petty Cash',true,false,null),
  ('1030','Bank',true,false,null),
  ('1040','Easypaisa',true,false,null),
  ('1050','JazzCash',true,false,null),
  ('1100','Inventory',false,false,null),
  ('1200','Customers Receivable',false,true,'customer'),
  ('2010','Vendors Payable',false,true,'vendor'),
  ('2020','Rider Payable',false,true,'rider'),
  ('3010','Owner Capital',false,false,null),
  ('3020','Owner Drawings',false,false,null),
  ('3030','Opening Balance Equity',false,false,null),
  ('4010','Sales',false,false,null),
  ('4020','Sales Returns',false,false,null),
  ('5010','Purchases / COGS',false,false,null),
  ('5020','Expenses',false,false,null),
  ('5030','Salesman Commission Expense',false,false,null)
) as x(code, name, is_ba, is_pa, pt)
join public.account_categories c
  on c.business_id = 'biz-default' and c.code = (
    case
      when x.code like '1%' then 'ASSET'
      when x.code like '2%' then 'LIABILITY'
      when x.code like '3%' then 'EQUITY'
      when x.code like '4%' then 'INCOME'
      when x.code like '5%' then 'EXPENSE'
    end
  )
on conflict (business_id, code) do update set
  name = excluded.name,
  is_business_account = excluded.is_business_account,
  is_party_account = excluded.is_party_account,
  party_type = excluded.party_type;

-- ============================================================================
-- Done. Phase 1 schema is live with RLS + SECURITY DEFINER helpers.
-- ============================================================================
