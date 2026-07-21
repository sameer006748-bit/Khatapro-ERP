-- Phase 1 Foundation: commission rate, linked-return documents, commission
-- events, identity sequences, account-category parent, and rider delivery.
-- Additive only. Does not modify migrations 00009-00013.

begin;

-- This migration extends established production tables. Do not silently skip a
-- missing base table: the error must identify schema drift before any DDL runs.
do $$
declare
  v_missing text;
begin
  select string_agg(required_table, ', ' order by required_table)
    into v_missing
  from (
    values
      ('public.accounts', to_regclass('public.accounts')),
      ('public.account_categories', to_regclass('public.account_categories')),
      ('public.business', to_regclass('public.business')),
      ('public.delivery_orders', to_regclass('public.delivery_orders')),
      ('public.delivery_status_events', to_regclass('public.delivery_status_events')),
      ('public.invoices', to_regclass('public.invoices')),
      ('public.invoice_items', to_regclass('public.invoice_items')),
      ('public.products', to_regclass('public.products')),
      ('public.rider_cod_submissions', to_regclass('public.rider_cod_submissions'))
  ) as required(required_table, relation_name)
  where relation_name is null;

  if v_missing is not null then
    raise exception
      'Phase 1 foundation migration requires existing base table(s): %. Aborting without changes.',
      v_missing;
  end if;
end
$$;

-- ============================================================
-- Product commission rate (paisas per piece)
-- ============================================================
alter table public.products
  add column if not exists commission_rate bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'commission_rate_non_negative'
      and conrelid = to_regclass('public.products')
  ) then
    alter table public.products
      add constraint commission_rate_non_negative
      check (commission_rate is null or commission_rate >= 0);
  end if;
end
$$;

-- ============================================================
-- Linked return-document foundation
-- ============================================================
-- Production does not contain the historical return-header table.
-- Create new document/line tables instead of altering that stale assumption.
-- Original invoices and invoice items remain immutable. returned_qty is only a
-- CACHED AGGREGATE, updated by a future atomic RPC using SELECT ... FOR UPDATE;
-- sale_return_lines is the auditable source of return quantities.
alter table public.invoice_items
  add column if not exists returned_qty int not null default 0,
  add column if not exists original_invoice_item_id text;

create index if not exists invoice_items_original_idx
  on public.invoice_items(original_invoice_item_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoice_items_original_invoice_item_fk'
      and conrelid = to_regclass('public.invoice_items')
  ) then
    alter table public.invoice_items
      add constraint invoice_items_original_invoice_item_fk
      foreign key (original_invoice_item_id) references public.invoice_items(id)
      on delete restrict;
  end if;
end
$$;

create table if not exists public.sale_return_documents (
  id              text primary key default gen_random_uuid()::text,
  business_id     text not null references public.business(id) on delete restrict,
  original_invoice_id text not null references public.invoices(id) on delete restrict,
  return_voucher_id text,
  return_date     timestamptz not null default now(),
  total           bigint not null default 0,
  return_no       text not null default gen_random_uuid()::text,
  idempotency_key text not null default gen_random_uuid()::text,
  status          text not null default 'draft',
  reason          text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint sale_return_documents_status_check
    check (status in ('draft', 'posted', 'cancelled')),
  constraint sale_return_documents_business_return_no_key
    unique (business_id, return_no),
  constraint sale_return_documents_business_idempotency_key_key
    unique (business_id, idempotency_key)
);

create index if not exists sale_return_documents_original_invoice_idx
  on public.sale_return_documents(original_invoice_id);

create table if not exists public.sale_return_lines (
  id                       text primary key default gen_random_uuid()::text,
  business_id              text not null references public.business(id) on delete restrict,
  sale_return_id           text not null references public.sale_return_documents(id) on delete restrict,
  original_invoice_item_id text not null references public.invoice_items(id) on delete restrict,
  returned_qty             int not null,
  reason                   text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint sale_return_lines_returned_qty_positive check (returned_qty > 0),
  constraint sale_return_lines_document_invoice_item_key
    unique (sale_return_id, original_invoice_item_id)
);

create index if not exists sale_return_lines_business_idx
  on public.sale_return_lines(business_id);
create index if not exists sale_return_lines_original_invoice_item_idx
  on public.sale_return_lines(original_invoice_item_id);

-- ============================================================
-- Commission events ledger
-- ============================================================
create table if not exists public.commission_events (
  id                       text primary key default gen_random_uuid()::text,
  business_id              text not null,
  salesman_id              text,
  invoice_id               text not null,
  invoice_item_id          text not null,
  original_invoice_item_id text,
  return_event_id          text,
  event_type               text not null,
  quantity                 int not null,
  rate_paisas              bigint not null,
  gross_amount             bigint not null,
  eligible_amount          bigint not null,
  payable_amount           bigint not null,
  paid_amount              bigint not null default 0,
  status                   text not null,
  allocation_id            text,
  idempotency_key          text,
  is_owner_only            boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create unique index if not exists commission_events_idempotency_key_idx
  on public.commission_events(idempotency_key) where idempotency_key is not null;
create index if not exists commission_events_biz_invoice_idx
  on public.commission_events(business_id, invoice_id);
create index if not exists commission_events_salesman_idx
  on public.commission_events(salesman_id);
create index if not exists commission_events_invoice_item_idx
  on public.commission_events(invoice_item_id);

-- ============================================================
-- Identity sequences
-- ============================================================
create table if not exists public.identity_sequences (
  business_id text not null,
  prefix      text not null,
  last_seq    int not null default 0,
  primary key (business_id, prefix)
);

-- ============================================================
-- Account category parent
-- ============================================================
alter table public.account_categories
  add column if not exists parent_id text;

create index if not exists account_categories_parent_idx
  on public.account_categories(parent_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'account_categories_no_self_parent'
      and conrelid = to_regclass('public.account_categories')
  ) then
    alter table public.account_categories
      add constraint account_categories_no_self_parent check (parent_id <> id);
  end if;
end
$$;

-- ============================================================
-- Rider delivery foundation
-- ============================================================
alter table public.delivery_orders
  add column if not exists is_settled boolean not null default false,
  add column if not exists ordered_qty int not null default 1,
  add column if not exists delivered_qty int not null default 0,
  add column if not exists returned_qty int not null default 0;

create index if not exists delivery_orders_settled_idx
  on public.delivery_orders(business_id, is_settled);

alter table public.delivery_status_events
  add column if not exists idempotency_key text;
create unique index if not exists delivery_events_idempotency_key_idx
  on public.delivery_status_events(idempotency_key) where idempotency_key is not null;

alter table public.rider_cod_submissions
  add column if not exists idempotency_key text;
create unique index if not exists cod_submissions_idempotency_key_idx
  on public.rider_cod_submissions(idempotency_key) where idempotency_key is not null;

-- ============================================================
-- System account marker: Rider Held COD foundation
-- ============================================================
-- No account row is inserted by this migration. A system-controlled Rider Held
-- COD account is created lazily for the real business by a later workflow.
alter table public.accounts
  add column if not exists is_system boolean not null default false;

-- ============================================================
-- RLS and grants for new server/RPC-only tables
-- ============================================================
alter table public.commission_events enable row level security;
alter table public.identity_sequences enable row level security;
alter table public.sale_return_documents enable row level security;
alter table public.sale_return_lines enable row level security;

drop policy if exists commission_events_select_own on public.commission_events;
create policy commission_events_select_own on public.commission_events
  for select using (business_id = current_setting('app.current_business_id', true));

drop policy if exists identity_sequences_select_own on public.identity_sequences;
create policy identity_sequences_select_own on public.identity_sequences
  for select using (business_id = current_setting('app.current_business_id', true));

drop policy if exists sale_return_documents_select_own on public.sale_return_documents;
create policy sale_return_documents_select_own on public.sale_return_documents
  for select using (business_id = current_setting('app.current_business_id', true));

drop policy if exists sale_return_lines_select_own on public.sale_return_lines;
create policy sale_return_lines_select_own on public.sale_return_lines
  for select using (business_id = current_setting('app.current_business_id', true));

-- delivery_status_events and rider_cod_submissions already have RLS from
-- migration 00007. New idempotency columns are additive and require no policy.
revoke all on public.commission_events from anon;
revoke all on public.commission_events from authenticated;
grant all on public.commission_events to service_role;
revoke all on public.identity_sequences from anon;
revoke all on public.identity_sequences from authenticated;
grant all on public.identity_sequences to service_role;
revoke all on public.sale_return_documents from anon;
revoke all on public.sale_return_documents from authenticated;
grant all on public.sale_return_documents to service_role;
revoke all on public.sale_return_lines from anon;
revoke all on public.sale_return_lines from authenticated;
grant all on public.sale_return_lines to service_role;

commit;
