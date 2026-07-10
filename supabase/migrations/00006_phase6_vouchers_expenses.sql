-- ============================================================================
-- KhataPro ERP — Phase 6: Vouchers, Expenses, Petty Cash, Contra, Day Book
--                      + Phase 5: Weighted Average Cost fields
--
-- This migration adds:
--   PART A (Phase 5 cost audit):
--     - products.weighted_average_cost  (numeric(20,0) paisas)
--     - products.latest_purchase_cost   (numeric(20,0) paisas)
--     - stock_movements.unit_cost_paisas (numeric(20,0), nullable)
--     - stock_movements.balance_cost_after (numeric(20,0), nullable)
--     - stock_movements.cogs_finalized  (boolean, default false)
--     - recalculate_product_cost() RPC — recomputes WAC from stock_movements
--     - Enhanced create_stock_movement() with optional cost param
--
--   PART B (Phase 6 operational tables):
--     - expenses + expense_lines (EXP-0001 sequence)
--     - receipts (RV-0001 sequence)
--     - payments (PV-0001 sequence)
--     - contra_entries (CV-0001 sequence)
--     - next_document_no() generic sequence helper
--     - post_payment_voucher() RPC
--     - post_receipt_voucher() RPC
--     - post_journal_voucher() RPC
--     - post_contra_entry() RPC
--     - post_expense_batch() RPC
--     - reverse_voucher_safe() RPC (with source-doc safety)
--     - day_book() RPC
--   PART N (permissions):
--     - can_view_day_book, can_create_payment_voucher, can_create_receipt_voucher,
--       can_create_journal_voucher, can_create_contra, can_manage_petty_cash,
--       can_create_expense_batch, can_reverse_voucher
--
-- All money in numeric(20,0) paisas.
-- All RPCs are SECURITY DEFINER with safe search_path.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- PART A — PHASE 5 WEIGHTED AVERAGE COST FIELDS
-- ============================================================================

-- Add cost columns to products.
alter table public.products
  add column if not exists weighted_average_cost numeric(20,0) not null default 0;
alter table public.products
  add column if not exists latest_purchase_cost numeric(20,0) not null default 0;

-- Add cost columns to stock_movements.
alter table public.stock_movements
  add column if not exists unit_cost_paisas numeric(20,0);
alter table public.stock_movements
  add column if not exists balance_cost_after numeric(20,0);
alter table public.stock_movements
  add column if not exists cogs_finalized boolean not null default false;

-- Index for cost recalculation queries.
create index if not exists stock_movements_product_date_idx
  on public.stock_movements(product_id, created_at);

-- ----------------------------------------------------------------------------
-- recalculate_product_cost() — recomputes weighted_average_cost for a product.
--
-- Weighted Average Cost rule:
--   For positive available inventory:
--     new_average_cost =
--       (previous_positive_qty × previous_average_cost
--        + received_qty × received_unit_cost) / new_positive_qty
--
--   Negative stock: allowed. COGS for negative-qty sales is "pending/estimated"
--   until a later purchase covers the negative quantity.
--
-- This function replays ALL stock movements for a product in chronological order
-- and recomputes the running weighted average cost. It is the source of truth.
-- ----------------------------------------------------------------------------
create or replace function public.recalculate_product_cost(
  p_product_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty           integer := 0;
  v_wac           numeric(20,0) := 0;
  v_mv            record;
  v_delta         integer;
  v_mv_cost       numeric(20,0);
  v_prev_qty      integer;
  v_prev_wac      numeric(20,0);
  v_new_qty       integer;
begin
  -- Replay movements in chronological order.
  for v_mv in
    select id, movement_type, quantity, unit_cost_paisas
    from public.stock_movements
    where product_id = p_product_id
    order by created_at asc, id asc
  loop
    v_prev_qty := v_qty;
    v_prev_wac := v_wac;

    -- Compute signed delta.
    if v_mv.movement_type in ('adjustment_out', 'correction') and v_mv.quantity > 0 then
      -- adjustment_out stores positive qty but represents outflow.
      -- (correction can go either way — handle below)
    end if;

    if v_mv.movement_type = 'adjustment_out' then
      v_delta := -v_mv.quantity;
    elsif v_mv.movement_type = 'correction' then
      -- correction: quantity stored as signed already? No — stored positive.
      -- We treat correction as adjustment_in (positive) for simplicity.
      v_delta := v_mv.quantity;
    else
      -- opening, adjustment_in, temporary_item
      v_delta := v_mv.quantity;
    end if;

    v_mv_cost := coalesce(v_mv.unit_cost_paisas, 0);
    v_new_qty := v_qty + v_delta;

    if v_delta > 0 and v_mv_cost > 0 then
      -- Inflow with cost: apply weighted average.
      if v_prev_qty > 0 then
        -- Normal: previous positive stock + inflow.
        v_wac := (v_prev_qty * v_prev_wac + v_delta * v_mv_cost) / v_new_qty;
      elsif v_prev_qty < 0 then
        -- Negative stock being covered: the inflow first covers the negative qty,
        -- then the remainder becomes positive stock at the new cost.
        if v_new_qty > 0 then
          -- Remaining positive qty gets the new cost.
          v_wac := v_mv_cost;
        else
          -- Still negative or zero — no positive stock, WAC stays 0 (pending).
          v_wac := 0;
        end if;
      else
        -- Previous qty was 0 — WAC = inflow cost.
        v_wac := v_mv_cost;
      end if;
    elsif v_delta > 0 and v_mv_cost = 0 then
      -- Inflow without cost (e.g. opening stock without cost) — keep WAC if positive, else 0.
      if v_new_qty > 0 and v_prev_qty > 0 then
        v_wac := (v_prev_qty * v_prev_wac) / v_new_qty;
      else
        v_wac := 0;
      end if;
    elsif v_delta < 0 then
      -- Outflow: WAC does not change (cost flows out at current average).
      -- If stock goes negative, WAC is retained for pending COGS but marked pending.
      -- v_wac stays the same.
      null;
    end if;

    v_qty := v_new_qty;

    -- Update the movement's balance_cost_after.
    update public.stock_movements
    set balance_cost_after = v_qty * v_wac,
        cogs_finalized = (v_qty >= 0)
    where id = v_mv.id;
  end loop;

  -- Update the product's cached fields.
  update public.products
  set current_stock = v_qty,
      weighted_average_cost = v_wac,
      updated_at = now()
  where id = p_product_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Enhanced create_stock_movement() — accepts optional unit_cost_paisas.
-- Backward-compatible: existing callers (without cost) still work.
-- When cost is provided for an inflow, recalculates WAC.
-- ----------------------------------------------------------------------------
create or replace function public.create_stock_movement(
  p_business_id   text,
  p_product_id    text,
  p_movement_type text,
  p_quantity      integer,
  p_reason        text default null,
  p_movement_date date default null,
  p_created_by    uuid default null,
  p_unit_cost_paisas numeric(20,0) default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement_id text;
  v_current     integer;
  v_delta       integer;
  v_balance_after integer;
  v_date        date;
  v_prev_qty    integer;
  v_prev_wac    numeric(20,0);
  v_new_qty     integer;
  v_new_wac     numeric(20,0);
  v_mv_cost     numeric(20,0);
  v_balance_cost numeric(20,0);
begin
  if p_movement_type not in ('opening', 'adjustment_in', 'adjustment_out', 'temporary_item', 'correction') then
    raise exception 'Invalid movement_type: %', p_movement_type;
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = p_product_id and p.business_id = p_business_id
  ) then
    raise exception 'Invalid or foreign product_id: %', p_product_id;
  end if;

  if p_quantity <= 0 then
    raise exception 'Quantity must be positive for type %', p_movement_type;
  end if;

  if p_movement_type = 'adjustment_out' then
    v_delta := -p_quantity;
  else
    v_delta := p_quantity;
  end if;

  -- Lock and get current stock + WAC.
  select current_stock, weighted_average_cost
  into v_current, v_prev_wac
  from public.products
  where id = p_product_id
  for update;

  v_balance_after := v_current + v_delta;
  v_date := coalesce(p_movement_date, (now() at time zone 'Asia/Karachi')::date);
  v_mv_cost := coalesce(p_unit_cost_paisas, 0);
  v_prev_qty := v_current;
  v_new_qty := v_balance_after;

  -- Compute new WAC.
  if v_delta > 0 and v_mv_cost > 0 then
    if v_prev_qty > 0 then
      v_new_wac := (v_prev_qty * v_prev_wac + v_delta * v_mv_cost) / v_new_qty;
    elsif v_prev_qty < 0 then
      if v_new_qty > 0 then
        v_new_wac := v_mv_cost;
      else
        v_new_wac := 0;
      end if;
    else
      v_new_wac := v_mv_cost;
    end if;
  elsif v_delta > 0 and v_mv_cost = 0 then
    if v_new_qty > 0 and v_prev_qty > 0 then
      v_new_wac := (v_prev_qty * v_prev_wac) / v_new_qty;
    else
      v_new_wac := 0;
    end if;
  else
    -- Outflow — WAC unchanged.
    v_new_wac := v_prev_wac;
  end if;

  v_balance_cost := v_new_qty * v_new_wac;

  -- Insert movement with cost data.
  insert into public.stock_movements
    (business_id, product_id, movement_type, quantity, balance_after, reason,
     movement_date, created_by, unit_cost_paisas, balance_cost_after,
     cogs_finalized)
  values
    (p_business_id, p_product_id, p_movement_type, p_quantity, v_balance_after,
     p_reason, v_date, p_created_by, p_unit_cost_paisas, v_balance_cost,
     (v_new_qty >= 0))
  returning id into v_movement_id;

  -- Update product cache.
  update public.products
  set current_stock = v_balance_after,
      weighted_average_cost = v_new_wac,
      latest_purchase_cost = case
        when p_movement_type in ('adjustment_in', 'opening') and p_unit_cost_paisas is not null
        then p_unit_cost_paisas
        else latest_purchase_cost
      end,
      updated_at = now()
  where id = p_product_id;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'CREATE_STOCK_MOVEMENT', 'stock_movement', v_movement_id,
    jsonb_build_object(
      'product_id', p_product_id,
      'movement_type', p_movement_type,
      'quantity', p_quantity,
      'unit_cost_paisas', p_unit_cost_paisas,
      'delta', v_delta,
      'balance_after', v_balance_after,
      'new_wac', v_new_wac,
      'reason', p_reason
    ));

  return v_movement_id;
end;
$$;

-- ============================================================================
-- PART B — PHASE 6 OPERATIONAL TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. expenses — expense batch header.
-- ----------------------------------------------------------------------------
create table if not exists public.expenses (
  id              text primary key default gen_random_uuid()::text,
  business_id     text not null references public.business(id) on delete cascade,
  expense_no      text not null,
  expense_date    date not null default (now() at time zone 'Asia/Karachi')::date,
  payment_account_id text not null references public.accounts(id) on delete restrict,
  total_amount    numeric(20,0) not null default 0,
  reference       text,
  notes           text,
  status          text not null default 'posted',
  voucher_id      text references public.vouchers(id) on delete set null,
  reversal_voucher_id text references public.vouchers(id) on delete set null,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (business_id, expense_no),
  constraint expenses_total_check check (total_amount >= 0)
);
create index if not exists expenses_biz_date_idx on public.expenses(business_id, expense_date desc);
create index if not exists expenses_voucher_idx on public.expenses(voucher_id);

-- ----------------------------------------------------------------------------
-- 2. expense_lines — individual expense lines in a batch.
-- ----------------------------------------------------------------------------
create table if not exists public.expense_lines (
  id              text primary key default gen_random_uuid()::text,
  business_id     text not null references public.business(id) on delete cascade,
  expense_id      text not null references public.expenses(id) on delete cascade,
  expense_account_id text not null references public.accounts(id) on delete restrict,
  description     text,
  amount          numeric(20,0) not null,
  line_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  constraint expense_lines_amount_check check (amount > 0)
);
create index if not exists expense_lines_expense_idx on public.expense_lines(expense_id);

-- ----------------------------------------------------------------------------
-- 3. receipts — receipt voucher header.
-- ----------------------------------------------------------------------------
create table if not exists public.receipts (
  id              text primary key default gen_random_uuid()::text,
  business_id     text not null references public.business(id) on delete cascade,
  receipt_no      text not null,
  receipt_date    date not null default (now() at time zone 'Asia/Karachi')::date,
  received_into_account_id text not null references public.accounts(id) on delete restrict,
  credit_account_id text not null references public.accounts(id) on delete restrict,
  customer_id     text,
  amount          numeric(20,0) not null,
  reference       text,
  notes           text,
  status          text not null default 'posted',
  voucher_id      text references public.vouchers(id) on delete set null,
  reversal_voucher_id text references public.vouchers(id) on delete set null,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (business_id, receipt_no),
  constraint receipts_amount_check check (amount > 0)
);
create index if not exists receipts_biz_date_idx on public.receipts(business_id, receipt_date desc);

-- ----------------------------------------------------------------------------
-- 4. payments — payment voucher header.
-- ----------------------------------------------------------------------------
create table if not exists public.payments (
  id              text primary key default gen_random_uuid()::text,
  business_id     text not null references public.business(id) on delete cascade,
  payment_no      text not null,
  payment_date    date not null default (now() at time zone 'Asia/Karachi')::date,
  paid_from_account_id text not null references public.accounts(id) on delete restrict,
  debit_account_id text not null references public.accounts(id) on delete restrict,
  vendor_id       text references public.vendors(id) on delete set null,
  amount          numeric(20,0) not null,
  reference       text,
  notes           text,
  status          text not null default 'posted',
  voucher_id      text references public.vouchers(id) on delete set null,
  reversal_voucher_id text references public.vouchers(id) on delete set null,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (business_id, payment_no),
  constraint payments_amount_check check (amount > 0)
);
create index if not exists payments_biz_date_idx on public.payments(business_id, payment_date desc);

-- ----------------------------------------------------------------------------
-- 5. contra_entries — transfers between asset accounts.
-- ----------------------------------------------------------------------------
create table if not exists public.contra_entries (
  id              text primary key default gen_random_uuid()::text,
  business_id     text not null references public.business(id) on delete cascade,
  contra_no       text not null,
  contra_date     date not null default (now() at time zone 'Asia/Karachi')::date,
  from_account_id text not null references public.accounts(id) on delete restrict,
  to_account_id   text not null references public.accounts(id) on delete restrict,
  amount          numeric(20,0) not null,
  reference       text,
  notes           text,
  status          text not null default 'posted',
  voucher_id      text references public.vouchers(id) on delete set null,
  reversal_voucher_id text references public.vouchers(id) on delete set null,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (business_id, contra_no),
  constraint contra_amount_check check (amount > 0),
  constraint contra_different_accounts check (from_account_id <> to_account_id)
);
create index if not exists contra_biz_date_idx on public.contra_entries(business_id, contra_date desc);

-- ============================================================================
-- DOCUMENT NUMBER SEQUENCES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- next_document_no() — generic concurrency-safe document number generator.
--   p_prefix: 'PV', 'RV', 'JV', 'CV', 'EXP'
--   p_table:  'payments', 'receipts', 'vouchers', 'contra_entries', 'expenses'
--   p_column: 'payment_no', 'receipt_no', 'voucher_no', 'contra_no', 'expense_no'
-- Returns: '{PREFIX}-0001', '{PREFIX}-0002', etc.
-- ----------------------------------------------------------------------------
create or replace function public.next_document_no(
  p_business_id text,
  p_prefix text,
  p_table text,
  p_column text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next int;
  v_max text;
  v_query text;
begin
  -- Advisory lock scoped to (business, document type).
  perform pg_advisory_xact_lock(987654330, hashtext(p_business_id || p_prefix));

  -- Dynamically find the max existing number for this prefix.
  -- Safe because p_table/p_column are validated against a whitelist.
  if p_table not in ('payments', 'receipts', 'vouchers', 'contra_entries', 'expenses') then
    raise exception 'Invalid table for document sequence: %', p_table;
  end if;
  if p_column not in ('payment_no', 'receipt_no', 'voucher_no', 'contra_no', 'expense_no') then
    raise exception 'Invalid column for document sequence: %', p_column;
  end if;

  v_query := format(
    'select coalesce(max(cast(replace(%I, %L, '''') as integer)), 0) + 1 from public.%I where business_id = %L and %I like %L',
    p_column, p_prefix || '-', p_table, p_business_id, p_column, p_prefix || '-%'
  );
  execute v_query into v_next;

  return p_prefix || '-' || lpad(v_next::text, 4, '0');
end;
$$;

-- ============================================================================
-- POSTING RPCs
-- ============================================================================

-- ----------------------------------------------------------------------------
-- post_payment_voucher() — money paid from a business account.
--   Debit: selected destination/liability/expense/asset account
--   Credit: business (paid-from) account
-- ----------------------------------------------------------------------------
create or replace function public.post_payment_voucher(
  p_business_id text,
  p_payment_date date,
  p_paid_from_account_id text,
  p_debit_account_id text,
  p_amount_paisas numeric(20,0),
  p_vendor_id text default null,
  p_reference text default null,
  p_notes text default null,
  p_created_by uuid default null
)
returns jsonb  -- { payment_id, payment_no, voucher_id }
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id text;
  v_payment_no text;
  v_voucher_id text;
  v_lines jsonb;
begin
  -- Validate accounts belong to business and are active.
  if not exists (select 1 from public.accounts where id = p_paid_from_account_id and business_id = p_business_id and is_active = true) then
    raise exception 'Invalid or inactive paid-from account';
  end if;
  if not exists (select 1 from public.accounts where id = p_debit_account_id and business_id = p_business_id and is_active = true) then
    raise exception 'Invalid or inactive debit account';
  end if;
  if p_amount_paisas <= 0 then
    raise exception 'Amount must be positive';
  end if;
  if p_paid_from_account_id = p_debit_account_id then
    raise exception 'Paid-from and debit accounts must differ (use Contra for same-account transfer)';
  end if;

  v_payment_no := public.next_document_no(p_business_id, 'PV', 'payments', 'payment_no');

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', p_debit_account_id, 'debit', p_amount_paisas::text, 'credit', '0', 'memo', 'Payment ' || v_payment_no),
    jsonb_build_object('account_id', p_paid_from_account_id, 'debit', '0', 'credit', p_amount_paisas::text, 'memo', 'Paid from ' || v_payment_no)
  );

  v_voucher_id := public.post_voucher(p_business_id, 'PM', p_payment_date,
    'Payment Voucher ' || v_payment_no, v_lines, null, 'payment_voucher', p_created_by);

  insert into public.payments (business_id, payment_no, payment_date, paid_from_account_id,
    debit_account_id, vendor_id, amount, reference, notes, status, voucher_id, created_by)
  values (p_business_id, v_payment_no, p_payment_date, p_paid_from_account_id,
    p_debit_account_id, p_vendor_id, p_amount_paisas, p_reference, p_notes, 'posted', v_voucher_id, p_created_by)
  returning id into v_payment_id;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'POST_PAYMENT_VOUCHER', 'payment', v_payment_id,
    jsonb_build_object('payment_no', v_payment_no, 'amount', p_amount_paisas, 'voucher_id', v_voucher_id));

  return jsonb_build_object('payment_id', v_payment_id, 'payment_no', v_payment_no, 'voucher_id', v_voucher_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- post_receipt_voucher() — money received into a business account.
--   Debit: receiving business account
--   Credit: selected income/liability/receivable/other account
-- ----------------------------------------------------------------------------
create or replace function public.post_receipt_voucher(
  p_business_id text,
  p_receipt_date date,
  p_received_into_account_id text,
  p_credit_account_id text,
  p_amount_paisas numeric(20,0),
  p_customer_id text default null,
  p_reference text default null,
  p_notes text default null,
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt_id text;
  v_receipt_no text;
  v_voucher_id text;
  v_lines jsonb;
begin
  if not exists (select 1 from public.accounts where id = p_received_into_account_id and business_id = p_business_id and is_active = true) then
    raise exception 'Invalid or inactive received-into account';
  end if;
  if not exists (select 1 from public.accounts where id = p_credit_account_id and business_id = p_business_id and is_active = true) then
    raise exception 'Invalid or inactive credit account';
  end if;
  if p_amount_paisas <= 0 then
    raise exception 'Amount must be positive';
  end if;
  if p_received_into_account_id = p_credit_account_id then
    raise exception 'Received-into and credit accounts must differ';
  end if;

  v_receipt_no := public.next_document_no(p_business_id, 'RV', 'receipts', 'receipt_no');

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', p_received_into_account_id, 'debit', p_amount_paisas::text, 'credit', '0', 'memo', 'Receipt ' || v_receipt_no),
    jsonb_build_object('account_id', p_credit_account_id, 'debit', '0', 'credit', p_amount_paisas::text, 'memo', 'Credited ' || v_receipt_no)
  );

  v_voucher_id := public.post_voucher(p_business_id, 'RC', p_receipt_date,
    'Receipt Voucher ' || v_receipt_no, v_lines, null, 'receipt_voucher', p_created_by);

  insert into public.receipts (business_id, receipt_no, receipt_date, received_into_account_id,
    credit_account_id, customer_id, amount, reference, notes, status, voucher_id, created_by)
  values (p_business_id, v_receipt_no, p_receipt_date, p_received_into_account_id,
    p_credit_account_id, p_customer_id, p_amount_paisas, p_reference, p_notes, 'posted', v_voucher_id, p_created_by)
  returning id into v_receipt_id;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'POST_RECEIPT_VOUCHER', 'receipt', v_receipt_id,
    jsonb_build_object('receipt_no', v_receipt_no, 'amount', p_amount_paisas, 'voucher_id', v_voucher_id));

  return jsonb_build_object('receipt_id', v_receipt_id, 'receipt_no', v_receipt_no, 'voucher_id', v_voucher_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- post_journal_voucher() — manual double-entry journal voucher.
--   p_lines: [{account_id, debit, credit, memo}, ...]
-- ----------------------------------------------------------------------------
create or replace function public.post_journal_voucher(
  p_business_id text,
  p_jv_date date,
  p_memo text,
  p_lines jsonb,
  p_reference text default null,
  p_created_by uuid default null
)
returns jsonb  -- { voucher_id, voucher_no }
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voucher_id text;
  v_voucher_no text;
  v_line jsonb;
  v_total_debit numeric(20,0) := 0;
  v_total_credit numeric(20,0) := 0;
  v_count integer := 0;
  v_lines_out jsonb := '[]'::jsonb;
begin
  if jsonb_array_length(p_lines) < 2 then
    raise exception 'Journal voucher must have at least 2 lines';
  end if;

  -- Validate each line.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_count := v_count + 1;
    if coalesce((v_line->>'debit')::numeric, 0) < 0 or coalesce((v_line->>'credit')::numeric, 0) < 0 then
      raise exception 'Negative debit/credit not allowed on line %', v_count;
    end if;
    if coalesce((v_line->>'debit')::numeric, 0) = 0 and coalesce((v_line->>'credit')::numeric, 0) = 0 then
      raise exception 'Zero-value line not allowed on line %', v_count;
    end if;
    if coalesce((v_line->>'debit')::numeric, 0) > 0 and coalesce((v_line->>'credit')::numeric, 0) > 0 then
      raise exception 'Line % cannot have both debit and credit', v_count;
    end if;
    -- Validate account.
    if not exists (select 1 from public.accounts where id = v_line->>'account_id' and business_id = p_business_id and is_active = true) then
      raise exception 'Invalid or inactive account on line %: %', v_count, v_line->>'account_id';
    end if;
    v_total_debit := v_total_debit + coalesce((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + coalesce((v_line->>'credit')::numeric, 0);
    v_lines_out := v_lines_out || jsonb_build_object(
      'account_id', v_line->>'account_id',
      'debit', coalesce((v_line->>'debit')::numeric, 0)::text,
      'credit', coalesce((v_line->>'credit')::numeric, 0)::text,
      'memo', v_line->>'memo'
    );
  end loop;

  if v_total_debit <> v_total_credit then
    raise exception 'Unbalanced: total debit % <> total credit %', v_total_debit, v_total_credit;
  end if;
  if v_total_debit = 0 then
    raise exception 'Zero-value voucher not allowed';
  end if;

  v_voucher_no := public.next_document_no(p_business_id, 'JV', 'vouchers', 'voucher_no');

  v_voucher_id := public.post_voucher(p_business_id, 'JV', p_jv_date,
    coalesce(p_memo, 'Journal Voucher ' || v_voucher_no), v_lines_out,
    null, 'journal_voucher', p_created_by);

  -- Update the voucher_no (post_voucher doesn't set it).
  update public.vouchers set voucher_no = v_voucher_no where id = v_voucher_id;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'POST_JOURNAL_VOUCHER', 'voucher', v_voucher_id,
    jsonb_build_object('voucher_no', v_voucher_no, 'total', v_total_debit, 'reference', p_reference));

  return jsonb_build_object('voucher_id', v_voucher_id, 'voucher_no', v_voucher_no);
end;
$$;

-- ----------------------------------------------------------------------------
-- post_contra_entry() — transfer between two asset/business accounts.
--   Debit: to_account
--   Credit: from_account
-- ----------------------------------------------------------------------------
create or replace function public.post_contra_entry(
  p_business_id text,
  p_contra_date date,
  p_from_account_id text,
  p_to_account_id text,
  p_amount_paisas numeric(20,0),
  p_reference text default null,
  p_notes text default null,
  p_created_by uuid default null
)
returns jsonb  -- { contra_id, contra_no, voucher_id }
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contra_id text;
  v_contra_no text;
  v_voucher_id text;
  v_lines jsonb;
begin
  if p_from_account_id = p_to_account_id then
    raise exception 'From and To accounts must differ';
  end if;
  if not exists (select 1 from public.accounts where id = p_from_account_id and business_id = p_business_id and is_active = true) then
    raise exception 'Invalid or inactive from-account';
  end if;
  if not exists (select 1 from public.accounts where id = p_to_account_id and business_id = p_business_id and is_active = true) then
    raise exception 'Invalid or inactive to-account';
  end if;
  if p_amount_paisas <= 0 then
    raise exception 'Amount must be positive';
  end if;

  v_contra_no := public.next_document_no(p_business_id, 'CV', 'contra_entries', 'contra_no');

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', p_to_account_id, 'debit', p_amount_paisas::text, 'credit', '0', 'memo', 'Contra in ' || v_contra_no),
    jsonb_build_object('account_id', p_from_account_id, 'debit', '0', 'credit', p_amount_paisas::text, 'memo', 'Contra out ' || v_contra_no)
  );

  v_voucher_id := public.post_voucher(p_business_id, 'CT', p_contra_date,
    'Contra Entry ' || v_contra_no, v_lines, null, 'contra_entry', p_created_by);

  insert into public.contra_entries (business_id, contra_no, contra_date, from_account_id,
    to_account_id, amount, reference, notes, status, voucher_id, created_by)
  values (p_business_id, v_contra_no, p_contra_date, p_from_account_id,
    p_to_account_id, p_amount_paisas, p_reference, p_notes, 'posted', v_voucher_id, p_created_by)
  returning id into v_contra_id;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'POST_CONTRA_ENTRY', 'contra_entry', v_contra_id,
    jsonb_build_object('contra_no', v_contra_no, 'amount', p_amount_paisas, 'voucher_id', v_voucher_id));

  return jsonb_build_object('contra_id', v_contra_id, 'contra_no', v_contra_no, 'voucher_id', v_voucher_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- post_expense_batch() — multiple expense lines paid from one account.
--   p_lines: [{expense_account_id, description, amount_paisas}, ...]
--   One credit to payment account = sum of all lines.
-- ----------------------------------------------------------------------------
create or replace function public.post_expense_batch(
  p_business_id text,
  p_expense_date date,
  p_payment_account_id text,
  p_lines jsonb,
  p_reference text default null,
  p_notes text default null,
  p_created_by uuid default null
)
returns jsonb  -- { expense_id, expense_no, voucher_id }
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense_id text;
  v_expense_no text;
  v_voucher_id text;
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_total numeric(20,0) := 0;
  v_count integer := 0;
  v_order integer := 0;
begin
  if jsonb_array_length(p_lines) < 1 then
    raise exception 'Expense batch must have at least 1 line';
  end if;
  if not exists (select 1 from public.accounts where id = p_payment_account_id and business_id = p_business_id and is_active = true) then
    raise exception 'Invalid or inactive payment account';
  end if;

  -- Validate + build debit lines.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_count := v_count + 1;
    if coalesce((v_line->>'amount_paisas')::numeric, 0) <= 0 then
      raise exception 'Expense line % amount must be positive', v_count;
    end if;
    if not exists (select 1 from public.accounts where id = v_line->>'expense_account_id' and business_id = p_business_id and is_active = true) then
      raise exception 'Invalid or inactive expense account on line %', v_count;
    end if;
    v_total := v_total + (v_line->>'amount_paisas')::numeric;
    v_lines := v_lines || jsonb_build_object(
      'account_id', v_line->>'expense_account_id',
      'debit', (v_line->>'amount_paisas')::text,
      'credit', '0',
      'memo', coalesce(v_line->>'description', 'Expense')
    );
  end loop;

  -- Single credit to payment account.
  v_lines := v_lines || jsonb_build_object(
    'account_id', p_payment_account_id,
    'debit', '0',
    'credit', v_total::text,
    'memo', 'Expenses paid'
  );

  v_expense_no := public.next_document_no(p_business_id, 'EXP', 'expenses', 'expense_no');

  v_voucher_id := public.post_voucher(p_business_id, 'EX', p_expense_date,
    'Expense Batch ' || v_expense_no, v_lines, null, 'expense_batch', p_created_by);

  insert into public.expenses (business_id, expense_no, expense_date, payment_account_id,
    total_amount, reference, notes, status, voucher_id, created_by)
  values (p_business_id, v_expense_no, p_expense_date, p_payment_account_id,
    v_total, p_reference, p_notes, 'posted', v_voucher_id, p_created_by)
  returning id into v_expense_id;

  -- Insert expense lines.
  v_order := 0;
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_order := v_order + 1;
    insert into public.expense_lines (business_id, expense_id, expense_account_id, description, amount, line_order)
    values (p_business_id, v_expense_id, v_line->>'expense_account_id',
      v_line->>'description', (v_line->>'amount_paisas')::numeric, v_order);
  end loop;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'POST_EXPENSE_BATCH', 'expense', v_expense_id,
    jsonb_build_object('expense_no', v_expense_no, 'total', v_total, 'line_count', v_count, 'voucher_id', v_voucher_id));

  return jsonb_build_object('expense_id', v_expense_id, 'expense_no', v_expense_no, 'voucher_id', v_voucher_id);
end;
$$;

-- ============================================================================
-- reverse_voucher_safe() — controlled reversal with source-document safety.
--
-- For source-controlled documents (sales, purchases, purchase_returns),
-- the generic reverse is BLOCKED — user must use the source module.
-- For JV, RC, PM, CT, EX, OP — generic reverse is allowed.
-- ============================================================================
create or replace function public.reverse_voucher_safe(
  p_voucher_id text,
  p_business_id text,
  p_cancelled_by uuid,
  p_reason text default null
)
returns jsonb  -- { reversal_voucher_id, blocked: bool, block_reason: text }
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voucher record;
  v_reversal_id text;
  v_lines jsonb;
  v_blocked boolean := false;
  v_block_reason text := '';
begin
  select * into v_voucher from public.vouchers
  where id = p_voucher_id and business_id = p_business_id;

  if not found then
    raise exception 'Voucher not found';
  end if;

  if v_voucher.is_cancelled then
    raise exception 'Voucher already cancelled';
  end if;

  -- Source-document safety: block reversal of sales/purchase vouchers.
  if v_voucher.voucher_type in ('SI', 'SR') then
    v_blocked := true;
    v_block_reason := 'Sales invoices and sales returns must be reversed through the Sales module, not the generic voucher reversal.';
  elsif v_voucher.voucher_type = 'PU' then
    -- Check if this is a purchase (reference_type = null or 'purchase')
    if v_voucher.reference_type is null or v_voucher.reference_type = 'purchase' then
      v_blocked := true;
      v_block_reason := 'Purchase vouchers must be reversed through the Purchases module (purchase return).';
    end if;
  elsif v_voucher.voucher_type = 'PR' then
    v_blocked := true;
    v_block_reason := 'Purchase return vouchers cannot be generically reversed.';
  end if;

  if v_blocked then
    return jsonb_build_object('blocked', true, 'block_reason', v_block_reason);
  end if;

  -- Build reversing lines (swap debit/credit).
  select coalesce(jsonb_agg(jsonb_build_object(
    'account_id', account_id,
    'debit', credit,
    'credit', debit,
    'memo', 'REVERSAL: ' || coalesce(memo, '')
  )), '[]'::jsonb)
  into v_lines
  from public.voucher_lines
  where voucher_id = p_voucher_id;

  v_reversal_id := public.post_voucher(
    p_business_id, v_voucher.voucher_type, v_voucher.voucher_date,
    'REVERSE: ' || coalesce(v_voucher.memo, ''), v_lines,
    p_voucher_id, 'voucher_cancel', p_cancelled_by
  );

  -- Mark original as cancelled.
  update public.vouchers
  set is_cancelled = true,
      cancelled_at = now(),
      cancelled_by = p_cancelled_by,
      cancel_voucher_id = v_reversal_id
  where id = p_voucher_id;

  -- Update operational table status if applicable.
  if v_voucher.reference_type = 'expense_batch' then
    update public.expenses set status = 'reversed', reversal_voucher_id = v_reversal_id
    where voucher_id = p_voucher_id;
  elsif v_voucher.reference_type = 'payment_voucher' then
    update public.payments set status = 'reversed', reversal_voucher_id = v_reversal_id
    where voucher_id = p_voucher_id;
  elsif v_voucher.reference_type = 'receipt_voucher' then
    update public.receipts set status = 'reversed', reversal_voucher_id = v_reversal_id
    where voucher_id = p_voucher_id;
  elsif v_voucher.reference_type = 'contra_entry' then
    update public.contra_entries set status = 'reversed', reversal_voucher_id = v_reversal_id
    where voucher_id = p_voucher_id;
  end if;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_cancelled_by, 'REVERSE_VOUCHER', 'voucher', p_voucher_id,
    jsonb_build_object('reversal_voucher_id', v_reversal_id, 'reason', p_reason));

  return jsonb_build_object('blocked', false, 'reversal_voucher_id', v_reversal_id);
end;
$$;

-- ============================================================================
-- day_book() — all posted vouchers with expandable lines.
-- ============================================================================
create or replace function public.day_book(
  p_business_id text,
  p_from_date date default null,
  p_to_date date default null,
  p_voucher_type text default null
)
returns table (
  voucher_id text,
  voucher_no text,
  voucher_type text,
  voucher_date date,
  memo text,
  total_debit numeric,
  total_credit numeric,
  is_cancelled boolean,
  posted_at timestamptz,
  posted_by uuid,
  reference_type text,
  reference_id text,
  source_label text,
  lines jsonb
)
language plpgsql stable
security definer
set search_path = public
as $$
begin
  return query
  select
    v.id,
    v.voucher_no,
    v.voucher_type,
    v.voucher_date,
    v.memo,
    v.total_debit,
    v.total_credit,
    v.is_cancelled,
    v.posted_at,
    v.posted_by,
    v.reference_type,
    v.reference_id,
    case v.voucher_type
      when 'JV' then 'Journal Voucher'
      when 'OP' then 'Opening Balance'
      when 'RC' then 'Receipt Voucher'
      when 'PM' then 'Payment Voucher'
      when 'CT' then 'Contra Entry'
      when 'PC' then 'Petty Cash'
      when 'SI' then 'Sale Invoice'
      when 'SR' then 'Sales Return'
      when 'PU' then 'Purchase'
      when 'PR' then 'Purchase Return'
      when 'EX' then 'Expense Batch'
      when 'RP' then 'Replacement'
      else v.voucher_type
    end,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'line_id', vl.id,
        'account_id', vl.account_id,
        'account_code', a.code,
        'account_name', a.name,
        'debit', vl.debit,
        'credit', vl.credit,
        'memo', vl.memo
      ) order by vl.line_order)
      from public.voucher_lines vl
      join public.accounts a on a.id = vl.account_id
      where vl.voucher_id = v.id
    ), '[]'::jsonb)
  from public.vouchers v
  where v.business_id = p_business_id
    and (p_from_date is null or v.voucher_date >= p_from_date)
    and (p_to_date is null or v.voucher_date <= p_to_date)
    and (p_voucher_type is null or p_voucher_type = 'all' or v.voucher_type = p_voucher_type)
  order by v.voucher_date desc, v.posted_at desc
  limit 500;
end;
$$;

-- ============================================================================
-- ROW-LEVEL SECURITY
-- ============================================================================

alter table public.expenses        enable row level security;
alter table public.expense_lines   enable row level security;
alter table public.receipts        enable row level security;
alter table public.payments        enable row level security;
alter table public.contra_entries  enable row level security;

-- expenses: readable by members with can_view_day_book or can_view_vouchers.
drop policy if exists expenses_select_own on public.expenses;
create policy expenses_select_own on public.expenses
  for select using (
    business_id = public.current_business_id()
    and (public.has_permission('can_view_day_book') or public.has_permission('can_view_vouchers'))
  );

drop policy if exists expense_lines_select_own on public.expense_lines;
create policy expense_lines_select_own on public.expense_lines
  for select using (
    business_id = public.current_business_id()
    and (public.has_permission('can_view_day_book') or public.has_permission('can_view_vouchers'))
  );

-- receipts
drop policy if exists receipts_select_own on public.receipts;
create policy receipts_select_own on public.receipts
  for select using (
    business_id = public.current_business_id()
    and (public.has_permission('can_view_day_book') or public.has_permission('can_view_vouchers'))
  );

-- payments
drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments
  for select using (
    business_id = public.current_business_id()
    and (public.has_permission('can_view_day_book') or public.has_permission('can_view_vouchers'))
  );

-- contra_entries
drop policy if exists contra_entries_select_own on public.contra_entries;
create policy contra_entries_select_own on public.contra_entries
  for select using (
    business_id = public.current_business_id()
    and (public.has_permission('can_view_day_book') or public.has_permission('can_view_vouchers'))
  );

-- ============================================================================
-- PERMISSIONS
-- ============================================================================

insert into public.permissions (code, module, description) values
  ('can_view_day_book', 'accounting', 'View Day Book (all posted vouchers)'),
  ('can_create_payment_voucher', 'accounting', 'Create Payment Voucher'),
  ('can_create_receipt_voucher', 'accounting', 'Create Receipt Voucher'),
  ('can_create_journal_voucher', 'accounting', 'Create Journal Voucher'),
  ('can_create_contra', 'accounting', 'Create Contra Entry'),
  ('can_manage_petty_cash', 'accounting', 'Manage Petty Cash (top-up + expense)'),
  ('can_create_expense_batch', 'accounting', 'Create Expense Batch'),
  ('can_reverse_voucher', 'accounting', 'Reverse / cancel posted vouchers')
on conflict (code) do update set
  module = excluded.module,
  description = excluded.description;

-- Grant all Phase 6 permissions to Owner/Admin and Accountant.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.business_id = 'biz-default' and r.name in ('Owner/Admin', 'Accountant')
  and p.code in ('can_view_day_book', 'can_create_payment_voucher', 'can_create_receipt_voucher',
                 'can_create_journal_voucher', 'can_create_contra', 'can_manage_petty_cash',
                 'can_create_expense_batch', 'can_reverse_voucher')
on conflict do nothing;

-- ============================================================================
-- Updated_at triggers
-- ============================================================================
drop trigger if exists expenses_touch on public.expenses;
create trigger expenses_touch before update on public.expenses
  for each row execute function public.touch_updated_at();

drop trigger if exists receipts_touch on public.receipts;
create trigger receipts_touch before update on public.receipts
  for each row execute function public.touch_updated_at();

drop trigger if exists payments_touch on public.payments;
create trigger payments_touch before update on public.payments
  for each row execute function public.touch_updated_at();

drop trigger if exists contra_entries_touch on public.contra_entries;
create trigger contra_entries_touch before update on public.contra_entries
  for each row execute function public.touch_updated_at();

-- Refresh PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Done. Phase 6 + Phase 5 cost audit is live with:
--   ✓ Weighted average cost fields on products + stock_movements
--   ✓ recalculate_product_cost() RPC
--   ✓ Enhanced create_stock_movement() with cost param
--   ✓ expenses + expense_lines tables
--   ✓ receipts table
--   ✓ payments table
--   ✓ contra_entries table
--   ✓ next_document_no() generic sequence helper
--   ✓ post_payment_voucher() RPC
--   ✓ post_receipt_voucher() RPC
--   ✓ post_journal_voucher() RPC
--   ✓ post_contra_entry() RPC
--   ✓ post_expense_batch() RPC
--   ✓ reverse_voucher_safe() RPC (with source-doc safety)
--   ✓ day_book() RPC
--   ✓ RLS on all new tables
--   ✓ 8 new permissions granted to Owner/Admin + Accountant
--   ✓ Audit logs for all actions
-- ============================================================================
