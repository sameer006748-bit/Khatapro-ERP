-- Phase 1 Foundation: commission rate, linked-return documents, commission
-- events, identity sequences, and rider delivery idempotency.
-- Additive only. Does not modify migrations 00009-00013.
--
-- Uses only proven production tables. No Prisma-only tables (accounts,
-- account_categories, delivery_orders, delivery_status_events,
-- rider_cod_submissions) are referenced.
--
-- All foreign keys use uuid types matching the proven production schema.
-- Foreign keys referencing invoices use the composite key (business_id, id)
-- because production invoices has PRIMARY KEY (business_id, id).

begin;

-- ============================================================
-- 1. BASE-TABLE PRECONDITIONS
-- ============================================================
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
      ('public.businesses', to_regclass('public.businesses')),
      ('public.products', to_regclass('public.products')),
      ('public.invoices', to_regclass('public.invoices')),
      ('public.invoice_items', to_regclass('public.invoice_items')),
      ('public.profiles', to_regclass('public.profiles')),
      ('public.riders', to_regclass('public.riders')),
      ('public.delivery_events', to_regclass('public.delivery_events')),
      ('public.rider_cash_ledger', to_regclass('public.rider_cash_ledger'))
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
-- 2. PRODUCT COMMISSION RATE (paisas per piece)
-- ============================================================
-- Uses numeric(20,0) to match the production money convention (paisas).
-- NULL means no commission for this product.
alter table public.products
  add column if not exists commission_rate numeric(20,0);

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
-- 3. LINKED SALE RETURN FOUNDATION
-- ============================================================
-- Production has no existing return table. Create new document/line tables.
-- Original invoices and invoice items remain immutable. returned_qty is only a
-- CACHED AGGREGATE, updated by a future atomic RPC using SELECT ... FOR UPDATE;
-- sale_return_lines is the auditable source of return quantities.
--
-- NOTE: original_invoice_item_id is NOT added to invoice_items. The
-- sale_return_lines table already contains the original invoice item relation,
-- making a self-referencing FK on invoice_items redundant.
--
-- IMPORTANT: Production invoices has PRIMARY KEY (business_id, id), not a
-- single-column PK. Therefore, the FK from sale_return_documents to invoices
-- must use the composite key (business_id, original_invoice_id) referencing
-- invoices(business_id, id).

alter table public.invoice_items
  add column if not exists returned_qty int not null default 0;

create table if not exists public.sale_return_documents (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null,
  original_invoice_id uuid not null,
  return_voucher_id   text,
  return_date         timestamptz not null default now(),
  total               numeric(20,0) not null default 0,
  return_no           text not null,
  idempotency_key     text not null,
  status              text not null default 'draft',
  reason              text,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint sale_return_documents_status_check
    check (status in ('draft', 'posted', 'cancelled')),
  constraint sale_return_documents_business_return_no_key
    unique (business_id, return_no),
  constraint sale_return_documents_business_idempotency_key_key
    unique (business_id, idempotency_key),
  -- Composite FK matching invoices composite PK (business_id, id)
  constraint sale_return_documents_invoice_fkey
    foreign key (business_id, original_invoice_id)
    references public.invoices(business_id, id)
    on delete restrict
);

create index if not exists sale_return_documents_original_invoice_idx
  on public.sale_return_documents(original_invoice_id);

create table if not exists public.sale_return_lines (
  id                       uuid primary key default gen_random_uuid(),
  business_id              uuid not null references public.businesses(id) on delete restrict,
  sale_return_id           uuid not null references public.sale_return_documents(id) on delete restrict,
  original_invoice_item_id uuid not null references public.invoice_items(id) on delete restrict,
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
-- 4. COMMISSION EVENTS LEDGER
-- ============================================================
-- invoice_id and invoice_item_id are stored as uuid values but do NOT have
-- foreign key constraints in this migration. Production invoices has a
-- composite PK (business_id, id), and invoice_items may also have a composite
-- PK. Adding verified composite FKs requires confirming the exact PK of
-- invoice_items in production. Deferred to avoid unverified constraints.
create table if not exists public.commission_events (
  id                       uuid primary key default gen_random_uuid(),
  business_id              uuid not null,
  salesman_id              uuid,
  invoice_id               uuid not null,
  invoice_item_id          uuid not null,
  original_invoice_item_id uuid,
  return_event_id          text,
  event_type               text not null,
  quantity                 int not null,
  rate_paisas              numeric(20,0) not null,
  gross_amount             numeric(20,0) not null,
  eligible_amount          numeric(20,0) not null,
  payable_amount           numeric(20,0) not null,
  paid_amount              numeric(20,0) not null default 0,
  status                   text not null,
  allocation_id            text,
  idempotency_key          text,
  is_owner_only            boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- Business-scoped idempotency: unique per (business_id, idempotency_key)
create unique index if not exists commission_events_business_idempotency_key_idx
  on public.commission_events(business_id, idempotency_key) where idempotency_key is not null;
create index if not exists commission_events_biz_invoice_idx
  on public.commission_events(business_id, invoice_id);
create index if not exists commission_events_salesman_idx
  on public.commission_events(salesman_id);
create index if not exists commission_events_invoice_item_idx
  on public.commission_events(invoice_item_id);

-- ============================================================
-- 5. IDENTITY SEQUENCES
-- ============================================================
create table if not exists public.identity_sequences (
  business_id uuid not null references public.businesses(id) on delete restrict,
  prefix      text not null,
  last_seq    int not null default 0,
  primary key (business_id, prefix)
);

-- ============================================================
-- 6. RIDER FOUNDATION — IDEMPOTENCY ADDITIONS
-- ============================================================
-- Uses existing production tables: delivery_events and rider_cash_ledger.
-- No delivery_orders table exists in production.
-- No Rider Held COD account is created (no accounts table in production).

-- delivery_events: add idempotency key for duplicate prevention
alter table public.delivery_events
  add column if not exists idempotency_key text;
create unique index if not exists delivery_events_idempotency_key_idx
  on public.delivery_events(idempotency_key) where idempotency_key is not null;

-- rider_cash_ledger: add idempotency and settlement foundation
alter table public.rider_cash_ledger
  add column if not exists idempotency_key text;
create unique index if not exists rider_cash_ledger_idempotency_key_idx
  on public.rider_cash_ledger(idempotency_key) where idempotency_key is not null;

alter table public.rider_cash_ledger
  add column if not exists settlement_batch_id text;
create index if not exists rider_cash_ledger_settlement_batch_idx
  on public.rider_cash_ledger(settlement_batch_id);

-- ============================================================
-- 7. RLS AND GRANTS FOR NEW SERVER/RPC-ONLY TABLES
-- ============================================================
-- Strict server-only containment: RLS enabled, anon/authenticated revoked,
-- service_role granted. No SELECT policies are created — client access is
-- through RPCs only, consistent with the production security model.

alter table public.commission_events enable row level security;
alter table public.identity_sequences enable row level security;
alter table public.sale_return_documents enable row level security;
alter table public.sale_return_lines enable row level security;

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