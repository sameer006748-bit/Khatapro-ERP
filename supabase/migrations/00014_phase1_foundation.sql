-- Phase 1 Foundation: commission rate, return-line links, commission events,
-- identity sequences, account-category parent, rider delivery foundation.
-- Additive only. Does not modify migrations 00009-00013.

begin;

-- ============================================================
-- Product commission rate (paisas per piece)
-- ============================================================
alter table if exists public.products
  add column if not exists commission_rate bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'commission_rate_non_negative'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT commission_rate_non_negative
      CHECK (commission_rate IS NULL OR commission_rate >= 0);
  END IF;
END
$$;

-- ============================================================
-- Return-line linkage on invoice_items
-- ============================================================
-- returned_qty is a CACHED AGGREGATE. It must only be updated inside an
-- atomic RPC/transaction using SELECT ... FOR UPDATE in Phase 2+ return
-- posting. Do not trust it directly as the source-event ledger; use
-- sales_returns and linked return lines as the auditable source of truth.
alter table if exists public.invoice_items
  add column if not exists returned_qty int not null default 0,
  add column if not exists original_invoice_item_id text;

create index if not exists invoice_items_original_idx
  on public.invoice_items(original_invoice_item_id);

-- ============================================================
-- Sales return idempotency
-- ============================================================
alter table if exists public.sales_returns
  add column if not exists idempotency_key text;

create unique index if not exists sales_returns_idempotency_key_idx
  on public.sales_returns(idempotency_key)
  where idempotency_key is not null;

-- ============================================================
-- Commission events ledger
-- ============================================================
create table if not exists public.commission_events (
  id                     text primary key default gen_random_uuid()::text,
  business_id            text not null,
  salesman_id            text,
  invoice_id             text not null,
  invoice_item_id        text not null,
  original_invoice_item_id text,
  return_event_id        text,
  event_type             text not null,
  quantity               int not null,
  rate_paisas            bigint not null,
  gross_amount           bigint not null,
  eligible_amount        bigint not null,
  payable_amount         bigint not null,
  paid_amount            bigint not null default 0,
  status                 text not null,
  allocation_id          text,
  idempotency_key        text,
  is_owner_only          boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists commission_events_idempotency_key_idx
  on public.commission_events(idempotency_key)
  where idempotency_key is not null;

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
alter table if exists public.account_categories
  add column if not exists parent_id text;

create index if not exists account_categories_parent_idx
  on public.account_categories(parent_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'account_categories_no_self_parent'
      AND conrelid = 'public.account_categories'::regclass
  ) THEN
    ALTER TABLE public.account_categories
      ADD CONSTRAINT account_categories_no_self_parent
      CHECK (parent_id <> id);
  END IF;
END
$$;

-- ============================================================
-- Rider delivery foundation
-- ============================================================
alter table if exists public.delivery_orders
  add column if not exists is_settled boolean not null default false,
  add column if not exists ordered_qty int not null default 1,
  add column if not exists delivered_qty int not null default 0,
  add column if not exists returned_qty int not null default 0;

create index if not exists delivery_orders_settled_idx
  on public.delivery_orders(business_id, is_settled);

alter table if exists public.delivery_status_events
  add column if not exists idempotency_key text;

create unique index if not exists delivery_events_idempotency_key_idx
  on public.delivery_status_events(idempotency_key)
  where idempotency_key is not null;

alter table if exists public.rider_cod_submissions
  add column if not exists idempotency_key text;

create unique index if not exists cod_submissions_idempotency_key_idx
  on public.rider_cod_submissions(idempotency_key)
  where idempotency_key is not null;

-- ============================================================
-- System account marker: Rider Held COD foundation
-- ============================================================
-- No account row is inserted by this migration.
-- A system-controlled Rider Held COD account must be created lazily per
-- real business when the first Online delivery is marked delivered (Phase 3).
-- Use idempotent INSERT ... WHERE NOT EXISTS scoped to the authenticated
-- business. Identify via a stable system code and protect from normal
-- edit/delete paths.

alter table if exists public.accounts
  add column if not exists is_system boolean not null default false;

-- ============================================================
-- RLS (additive only; follow existing patterns where applicable)
-- ============================================================
alter table if exists public.commission_events enable row level security;
alter table if exists public.identity_sequences enable row level security;

drop policy if exists commission_events_select_own on public.commission_events;
create policy commission_events_select_own on public.commission_events
  for select using (
    business_id = current_setting('app.current_business_id', true)
  );

drop policy if exists identity_sequences_select_own on public.identity_sequences;
create policy identity_sequences_select_own on public.identity_sequences
  for select using (
    business_id = current_setting('app.current_business_id', true)
  );

-- delivery_status_events and rider_cod_submissions already have RLS from
-- migration 00007. New idempotency columns are additive and require no
-- new policies.

-- Service writes bypass RLS; application/API routes validate business + actor.

-- ============================================================
-- RLS grants: new Phase 1 tables — server/RPC-only access
-- ============================================================
-- Pattern from 00010_phase10_ai_settings.sql: deny anon/authenticated,
-- allow service_role only. commission_events and identity_sequences
-- are ledger/event tables — never directly writable by clients.

revoke all on public.commission_events from anon;
revoke all on public.commission_events from authenticated;
grant all on public.commission_events to service_role;

revoke all on public.identity_sequences from anon;
revoke all on public.identity_sequences from authenticated;
grant all on public.identity_sequences to service_role;

commit;
</parameter2name>
<task_progress>
- [x] Create read-only inspection SQL
- [x] Repair migration 00014 — replace ADD CONSTRAINT IF NOT EXISTS with DO $$ blocks
- [ ] Update tests to reject unsupported PostgreSQL syntax
- [ ] Run final checks
- [ ] Commit and push
- [ ] Present recovery instructions
</parameter2name>
</write_to_file>