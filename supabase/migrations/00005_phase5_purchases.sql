-- ============================================================================
-- KhataPro ERP — Phase 5 Purchases, Vendors, Payables and Purchase Returns
-- Target: Supabase Postgres
--
-- This migration adds the complete purchases module:
--   - vendors (party accounts linked to accounts table)
--   - purchases (header with purchase_no sequence)
--   - purchase_items (line items)
--   - purchase_payments (payments, advances, advance applications)
--   - purchase_returns (returns with PRN- sequence)
--   - purchase_return_items (return line items)
--
-- Accounting rules:
--   * Every purchase posts a balanced voucher via post_voucher()
--   * Stock-in movements created for each item
--   * Vendor payments post balanced vouchers
--   * Vendor advances post balanced vouchers
--   * Purchase returns post reversing vouchers + stock-out
--   * No hard delete for posted records
--   * All money in numeric(20,0) paisas
--
-- Money columns use numeric(20,0) = BigInt paisas (consistent with vouchers).
-- ============================================================================

-- Required extensions
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. vendors — party accounts linked to the accounts table.
--    Every vendor MUST have a linked ledger account under Liability (Vendors Payable 2010)
--    or a sub-account. The vendor's balance is derived from voucher_lines.
-- ----------------------------------------------------------------------------
create table if not exists public.vendors (
  id             text primary key default gen_random_uuid()::text,
  business_id    text not null references public.business(id) on delete cascade,
  account_id     text not null unique references public.accounts(id) on delete restrict,
  name           text not null,
  phone          text,
  email          text,
  address        text,
  city           text,
  is_active      boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists vendors_biz_idx on public.vendors(business_id);

-- ----------------------------------------------------------------------------
-- 2. purchases — header with server-side PUR-0001 sequence.
-- ----------------------------------------------------------------------------
create table if not exists public.purchases (
  id              text primary key default gen_random_uuid()::text,
  business_id     text not null references public.business(id) on delete cascade,
  purchase_no     text not null,
  vendor_id       text not null references public.vendors(id) on delete restrict,
  supplier_bill_no text,
  purchase_date   date not null default (now() at time zone 'Asia/Karachi')::date,
  -- Totals in paisas
  subtotal        numeric(20,0) not null default 0,
  discount        numeric(20,0) not null default 0,
  additional_charges numeric(20,0) not null default 0,
  total           numeric(20,0) not null default 0,
  paid_amount     numeric(20,0) not null default 0,
  outstanding_amount numeric(20,0) not null default 0,
  -- Status: draft | posted | partially_paid | paid | returned | partially_returned | cancelled
  status          text not null default 'posted',
  notes           text,
  voucher_id      text references public.vouchers(id) on delete set null,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (business_id, purchase_no)
);
create index if not exists purchases_biz_date_idx on public.purchases(business_id, purchase_date desc);
create index if not exists purchases_vendor_idx on public.purchases(vendor_id);
create index if not exists purchases_status_idx on public.purchases(business_id, status);

-- ----------------------------------------------------------------------------
-- 3. purchase_items
-- ----------------------------------------------------------------------------
create table if not exists public.purchase_items (
  id              text primary key default gen_random_uuid()::text,
  business_id     text not null references public.business(id) on delete cascade,
  purchase_id     text not null references public.purchases(id) on delete cascade,
  product_id      text references public.products(id) on delete set null,
  product_name    text not null,
  quantity        integer not null,
  unit_cost       numeric(20,0) not null,  -- paisas
  line_total      numeric(20,0) not null,  -- paisas
  returned_quantity integer not null default 0,
  stock_movement_id text references public.stock_movements(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists purchase_items_purchase_idx on public.purchase_items(purchase_id);
create index if not exists purchase_items_product_idx on public.purchase_items(product_id);

-- ----------------------------------------------------------------------------
-- 4. purchase_payments — payments, advances, advance applications
-- ----------------------------------------------------------------------------
create table if not exists public.purchase_payments (
  id              text primary key default gen_random_uuid()::text,
  business_id     text not null references public.business(id) on delete cascade,
  purchase_id     text references public.purchases(id) on delete set null,
  vendor_id       text not null references public.vendors(id) on delete restrict,
  account_id      text not null references public.accounts(id) on delete restrict,
  amount          numeric(20,0) not null,  -- paisas
  payment_date    date not null default (now() at time zone 'Asia/Karachi')::date,
  -- payment_type: purchase_payment | later_payment | vendor_advance | advance_application | vendor_refund
  payment_type    text not null default 'purchase_payment',
  voucher_id      text references public.vouchers(id) on delete set null,
  notes           text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create index if not exists purchase_payments_purchase_idx on public.purchase_payments(purchase_id);
create index if not exists purchase_payments_vendor_idx on public.purchase_payments(vendor_id);
create index if not exists purchase_payments_account_idx on public.purchase_payments(account_id);

-- ----------------------------------------------------------------------------
-- 5. purchase_returns — returns with PRN-0001 sequence
-- ----------------------------------------------------------------------------
create table if not exists public.purchase_returns (
  id              text primary key default gen_random_uuid()::text,
  business_id     text not null references public.business(id) on delete cascade,
  purchase_id     text not null references public.purchases(id) on delete restrict,
  vendor_id       text not null references public.vendors(id) on delete restrict,
  return_no       text not null,
  return_date     date not null default (now() at time zone 'Asia/Karachi')::date,
  total_amount    numeric(20,0) not null,  -- paisas
  -- settlement_type: reduce_payable | vendor_refund | vendor_credit
  settlement_type text not null default 'reduce_payable',
  settlement_account_id text references public.accounts(id) on delete set null,
  voucher_id      text references public.vouchers(id) on delete set null,
  notes           text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (business_id, return_no)
);
create index if not exists purchase_returns_purchase_idx on public.purchase_returns(purchase_id);
create index if not exists purchase_returns_vendor_idx on public.purchase_returns(vendor_id);

-- ----------------------------------------------------------------------------
-- 6. purchase_return_items
-- ----------------------------------------------------------------------------
create table if not exists public.purchase_return_items (
  id              text primary key default gen_random_uuid()::text,
  business_id     text not null references public.business(id) on delete cascade,
  purchase_return_id text not null references public.purchase_returns(id) on delete cascade,
  purchase_item_id   text not null references public.purchase_items(id) on delete restrict,
  product_id      text references public.products(id) on delete set null,
  product_name    text not null,
  quantity        integer not null,
  unit_cost       numeric(20,0) not null,  -- paisas
  line_total      numeric(20,0) not null,  -- paisas
  stock_movement_id text references public.stock_movements(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists purchase_return_items_return_idx on public.purchase_return_items(purchase_return_id);

-- ============================================================================
-- RPC FUNCTIONS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 7. next_purchase_no() — concurrency-safe purchase number sequence.
--    Returns 'PUR-0001', 'PUR-0002', etc.
-- ----------------------------------------------------------------------------
create or replace function public.next_purchase_no(p_business_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next int;
begin
  perform pg_advisory_xact_lock(987654322, hashtext(p_business_id));
  select coalesce(max(cast(replace(purchase_no, 'PUR-', '') as integer)), 0) + 1
    into v_next
    from public.purchases
    where business_id = p_business_id;
  return 'PUR-' || lpad(v_next::text, 4, '0');
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. next_purchase_return_no() — concurrency-safe return number sequence.
--    Returns 'PRN-0001', 'PRN-0002', etc.
-- ----------------------------------------------------------------------------
create or replace function public.next_purchase_return_no(p_business_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next int;
begin
  perform pg_advisory_xact_lock(987654323, hashtext(p_business_id));
  select coalesce(max(cast(replace(return_no, 'PRN-', '') as integer)), 0) + 1
    into v_next
    from public.purchase_returns
    where business_id = p_business_id;
  return 'PRN-' || lpad(v_next::text, 4, '0');
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. post_purchase() — atomic purchase posting RPC.
--    Creates: purchase + items + stock-in + voucher + payments + audit.
--    SECURITY DEFINER so it can insert into all tables.
--
--    p_items: [{product_id, product_name, quantity, unit_cost_paisas}, ...]
--    p_payments: [{account_id, amount_paisas, payment_type}, ...]
--         payment_type: 'purchase_payment' | 'vendor_advance' | 'credit' (no cash)
--    p_discount_paisas, p_additional_charges_paisas: numeric
-- ----------------------------------------------------------------------------
create or replace function public.post_purchase(
  p_business_id     text,
  p_vendor_id       text,
  p_purchase_date   date,
  p_supplier_bill_no text default null,
  p_items           jsonb,
  p_payments        jsonb,
  p_discount_paisas numeric(20,0) default 0,
  p_additional_charges_paisas numeric(20,0) default 0,
  p_notes           text default null,
  p_created_by      uuid default null
)
returns text  -- the new purchase id
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_id    text;
  v_purchase_no    text;
  v_subtotal       numeric(20,0) := 0;
  v_total          numeric(20,0) := 0;
  v_paid           numeric(20,0) := 0;
  v_outstanding    numeric(20,0) := 0;
  v_item           jsonb;
  v_payment        jsonb;
  v_line_total     numeric(20,0);
  v_qty            integer;
  v_unit_cost      numeric(20,0);
  v_product_id     text;
  v_voucher_id     text;
  v_voucher_lines  jsonb := '[]'::jsonb;
  v_purchases_acct text;
  v_payable_acct   text;
  v_vendor         record;
  v_stock_sm_id    text;
  v_pp_id          text;
  v_status         text;
begin
  -- Validate at least 1 item.
  if jsonb_array_length(p_items) < 1 then
    raise exception 'Purchase must have at least 1 item';
  end if;

  -- Validate vendor belongs to business.
  select * into v_vendor from public.vendors
  where id = p_vendor_id and business_id = p_business_id and is_active = true;
  if not found then
    raise exception 'Invalid or inactive vendor: %', p_vendor_id;
  end if;

  -- Generate purchase number.
  v_purchase_no := public.next_purchase_no(p_business_id);

  -- Compute subtotal from items.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    v_unit_cost := coalesce((v_item->>'unit_cost_paisas')::numeric, 0);
    v_line_total := v_qty * v_unit_cost;
    v_subtotal := v_subtotal + v_line_total;
  end loop;

  -- Total = subtotal - discount + additional_charges
  v_total := v_subtotal - p_discount_paisas + p_additional_charges_paisas;

  -- Compute paid from payments (exclude 'credit' type).
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if coalesce((v_payment->>'payment_type')::text, 'purchase_payment') <> 'credit' then
      v_paid := v_paid + coalesce((v_payment->>'amount_paisas')::numeric, 0);
    end if;
  end loop;

  v_outstanding := v_total - v_paid;

  -- Determine status.
  if v_outstanding <= 0 then
    v_status := 'paid';
  elsif v_paid > 0 then
    v_status := 'partially_paid';
  else
    v_status := 'posted';
  end if;

  -- Resolve accounts by code.
  -- Purchases/COGS = 5010, Vendors Payable = 2010
  select id into v_purchases_acct from public.accounts
  where business_id = p_business_id and code = '5010' and is_active = true;
  if not found then
    raise exception 'Purchases/COGS account (5010) not found';
  end if;

  select id into v_payable_acct from public.accounts
  where business_id = p_business_id and code = '2010' and is_active = true;
  if not found then
    raise exception 'Vendors Payable account (2010) not found';
  end if;

  -- Build voucher lines.
  -- Debit Purchases/COGS by total.
  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', v_purchases_acct,
    'debit', v_total::text,
    'credit', '0',
    'memo', 'Purchase ' || v_purchase_no
  );

  -- Credit each payment account (non-credit payments).
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if coalesce((v_payment->>'payment_type')::text, 'purchase_payment') <> 'credit' then
      v_voucher_lines := v_voucher_lines || jsonb_build_object(
        'account_id', v_payment->>'account_id',
        'debit', '0',
        'credit', coalesce((v_payment->>'amount_paisas')::numeric, 0)::text,
        'memo', 'Payment for ' || v_purchase_no
      );
    end if;
  end loop;

  -- Credit Vendor Payable for outstanding.
  if v_outstanding > 0 then
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_payable_acct,
      'debit', '0',
      'credit', v_outstanding::text,
      'memo', 'Payable for ' || v_purchase_no
    );
  end if;

  -- Post the voucher.
  v_voucher_id := public.post_voucher(
    p_business_id, 'PU', p_purchase_date,
    'Purchase ' || v_purchase_no, v_voucher_lines,
    null, null, p_created_by
  );

  -- Insert purchase header.
  insert into public.purchases (
    business_id, purchase_no, vendor_id, supplier_bill_no, purchase_date,
    subtotal, discount, additional_charges, total, paid_amount, outstanding_amount,
    status, notes, voucher_id, created_by
  ) values (
    p_business_id, v_purchase_no, p_vendor_id, p_supplier_bill_no, p_purchase_date,
    v_subtotal, p_discount_paisas, p_additional_charges_paisas, v_total, v_paid, v_outstanding,
    v_status, p_notes, v_voucher_id, p_created_by
  ) returning id into v_purchase_id;

  -- Insert items + create stock-in movements.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    v_unit_cost := coalesce((v_item->>'unit_cost_paisas')::numeric, 0);
    v_line_total := v_qty * v_unit_cost;
    v_product_id := v_item->>'product_id';

    v_stock_sm_id := null;
    if v_product_id is not null and v_product_id <> '' then
      v_stock_sm_id := public.create_stock_movement(
        p_business_id, v_product_id, 'adjustment_in', v_qty,
        'Purchase ' || v_purchase_no, p_purchase_date, p_created_by
      );
    end if;

    insert into public.purchase_items (
      business_id, purchase_id, product_id, product_name, quantity, unit_cost, line_total, stock_movement_id
    ) values (
      p_business_id, v_purchase_id, v_product_id,
      v_item->>'product_name', v_qty, v_unit_cost, v_line_total, v_stock_sm_id
    );
  end loop;

  -- Insert payment records.
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if coalesce((v_payment->>'payment_type')::text, 'purchase_payment') <> 'credit' then
      insert into public.purchase_payments (
        business_id, purchase_id, vendor_id, account_id, amount, payment_date, payment_type, voucher_id, notes, created_by
      ) values (
        p_business_id, v_purchase_id, p_vendor_id,
        v_payment->>'account_id',
        coalesce((v_payment->>'amount_paisas')::numeric, 0),
        p_purchase_date,
        coalesce((v_payment->>'payment_type')::text, 'purchase_payment'),
        v_voucher_id,
        v_payment->>'notes',
        p_created_by
      ) returning id into v_pp_id;
    end if;
  end loop;

  -- Audit.
  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'POST_PURCHASE', 'purchase', v_purchase_id,
    jsonb_build_object('purchase_no', v_purchase_no, 'total', v_total, 'paid', v_paid, 'outstanding', v_outstanding, 'voucher_id', v_voucher_id));

  return v_purchase_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. post_vendor_payment() — pay vendor later (separate from purchase).
--     Posts: Supplier Payable debit, Cash/Bank credit.
-- ----------------------------------------------------------------------------
create or replace function public.post_vendor_payment(
  p_business_id   text,
  p_vendor_id     text,
  p_account_id    text,
  p_amount_paisas numeric(20,0),
  p_payment_date  date default null,
  p_purchase_id   text default null,
  p_notes         text default null,
  p_created_by    uuid default null
)
returns text  -- the purchase_payment id
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp_id        text;
  v_voucher_id   text;
  v_voucher_lines jsonb := '[]'::jsonb;
  v_payable_acct text;
  v_date         date;
begin
  -- Validate vendor.
  if not exists (select 1 from public.vendors where id = p_vendor_id and business_id = p_business_id and is_active = true) then
    raise exception 'Invalid vendor: %', p_vendor_id;
  end if;

  -- Validate account is active and belongs to business.
  if not exists (select 1 from public.accounts where id = p_account_id and business_id = p_business_id and is_active = true) then
    raise exception 'Invalid or inactive account: %', p_account_id;
  end if;

  -- Resolve Vendors Payable account (2010).
  select id into v_payable_acct from public.accounts
  where business_id = p_business_id and code = '2010' and is_active = true;
  if not found then
    raise exception 'Vendors Payable account (2010) not found';
  end if;

  v_date := coalesce(p_payment_date, (now() at time zone 'Asia/Karachi')::date);

  -- Voucher: Debit Payable, Credit Cash/Bank.
  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', v_payable_acct, 'debit', p_amount_paisas::text, 'credit', '0',
    'memo', 'Vendor payment'
  );
  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', p_account_id, 'debit', '0', 'credit', p_amount_paisas::text,
    'memo', 'Paid to vendor'
  );

  v_voucher_id := public.post_voucher(
    p_business_id, 'PM', v_date, 'Vendor payment', v_voucher_lines,
    p_purchase_id, 'vendor_payment', p_created_by
  );

  -- Insert payment record.
  insert into public.purchase_payments (
    business_id, purchase_id, vendor_id, account_id, amount, payment_date, payment_type, voucher_id, notes, created_by
  ) values (
    p_business_id, p_purchase_id, p_vendor_id, p_account_id, p_amount_paisas, v_date,
    'later_payment', v_voucher_id, p_notes, p_created_by
  ) returning id into v_pp_id;

  -- Update purchase outstanding if linked.
  if p_purchase_id is not null then
    update public.purchases
    set paid_amount = paid_amount + p_amount_paisas,
        outstanding_amount = outstanding_amount - p_amount_paisas,
        status = case when outstanding_amount - p_amount_paisas <= 0 then 'paid' else 'partially_paid' end,
        updated_at = now()
    where id = p_purchase_id;
  end if;

  -- Audit.
  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'VENDOR_PAYMENT', 'purchase_payment', v_pp_id,
    jsonb_build_object('vendor_id', p_vendor_id, 'amount', p_amount_paisas, 'voucher_id', v_voucher_id));

  return v_pp_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 11. post_vendor_advance() — record vendor advance.
--     Posts: Vendor Advance debit, Cash/Bank credit.
--     Uses a dynamic account for vendor advance. We create a sub-account
--     under Liability if it doesn't exist, or use an existing one.
--     For simplicity, we use the Vendor Payable account (2010) as the
--     advance account — advance is a debit balance on the payable account.
-- ----------------------------------------------------------------------------
create or replace function public.post_vendor_advance(
  p_business_id   text,
  p_vendor_id     text,
  p_account_id    text,
  p_amount_paisas numeric(20,0),
  p_advance_date  date default null,
  p_notes         text default null,
  p_created_by    uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp_id        text;
  v_voucher_id   text;
  v_voucher_lines jsonb := '[]'::jsonb;
  v_payable_acct text;
  v_date         date;
begin
  if not exists (select 1 from public.vendors where id = p_vendor_id and business_id = p_business_id and is_active = true) then
    raise exception 'Invalid vendor: %', p_vendor_id;
  end if;
  if not exists (select 1 from public.accounts where id = p_account_id and business_id = p_business_id and is_active = true) then
    raise exception 'Invalid account: %', p_account_id;
  end if;

  select id into v_payable_acct from public.accounts
  where business_id = p_business_id and code = '2010' and is_active = true;
  if not found then raise exception 'Vendors Payable account (2010) not found'; end if;

  v_date := coalesce(p_advance_date, (now() at time zone 'Asia/Karachi')::date);

  -- Debit Vendor Payable (advance = debit balance), Credit Cash/Bank.
  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', v_payable_acct, 'debit', p_amount_paisas::text, 'credit', '0',
    'memo', 'Vendor advance'
  );
  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', p_account_id, 'debit', '0', 'credit', p_amount_paisas::text,
    'memo', 'Advance paid to vendor'
  );

  v_voucher_id := public.post_voucher(
    p_business_id, 'PM', v_date, 'Vendor advance', v_voucher_lines,
    null, 'vendor_advance', p_created_by
  );

  insert into public.purchase_payments (
    business_id, purchase_id, vendor_id, account_id, amount, payment_date, payment_type, voucher_id, notes, created_by
  ) values (
    p_business_id, null, p_vendor_id, p_account_id, p_amount_paisas, v_date,
    'vendor_advance', v_voucher_id, p_notes, p_created_by
  ) returning id into v_pp_id;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'VENDOR_ADVANCE', 'purchase_payment', v_pp_id,
    jsonb_build_object('vendor_id', p_vendor_id, 'amount', p_amount_paisas));

  return v_pp_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 12. post_purchase_return() — atomic purchase return.
--     Creates: return header + items + stock-out + reversing voucher.
--     settlement_type: reduce_payable | vendor_refund | vendor_credit
-- ----------------------------------------------------------------------------
create or replace function public.post_purchase_return(
  p_business_id        text,
  p_purchase_id        text,
  p_return_items       jsonb,  -- [{purchase_item_id, product_id, product_name, quantity, unit_cost_paisas}, ...]
  p_settlement_type    text default 'reduce_payable',
  p_settlement_account_id text default null,
  p_return_date        date default null,
  p_notes              text default null,
  p_created_by         uuid default null
)
returns text  -- the purchase_return id
language plpgsql
security definer
set search_path = public
as $$
declare
  v_return_id    text;
  v_return_no    text;
  v_total        numeric(20,0) := 0;
  v_item         jsonb;
  v_line_total   numeric(20,0);
  v_qty          integer;
  v_unit_cost    numeric(20,0);
  v_product_id   text;
  v_voucher_id   text;
  v_voucher_lines jsonb := '[]'::jsonb;
  v_purchases_acct text;
  v_payable_acct   text;
  v_purchase     record;
  v_stock_sm_id  text;
  v_date         date;
begin
  -- Load original purchase.
  select * into v_purchase from public.purchases
  where id = p_purchase_id and business_id = p_business_id;
  if not found then raise exception 'Purchase not found: %', p_purchase_id; end if;

  -- Generate return number.
  v_return_no := public.next_purchase_return_no(p_business_id);

  -- Compute total from return items.
  for v_item in select * from jsonb_array_elements(p_return_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    v_unit_cost := coalesce((v_item->>'unit_cost_paisas')::numeric, 0);
    v_line_total := v_qty * v_unit_cost;
    v_total := v_total + v_line_total;
  end loop;

  -- Resolve accounts.
  select id into v_purchases_acct from public.accounts
  where business_id = p_business_id and code = '5010' and is_active = true;
  if not found then raise exception 'Purchases account (5010) not found'; end if;

  select id into v_payable_acct from public.accounts
  where business_id = p_business_id and code = '2010' and is_active = true;
  if not found then raise exception 'Vendors Payable account (2010) not found'; end if;

  v_date := coalesce(p_return_date, (now() at time zone 'Asia/Karachi')::date);

  -- Build voucher lines based on settlement type.
  -- Credit Purchases/COGS (reverse the original debit).
  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', v_purchases_acct, 'debit', '0', 'credit', v_total::text,
    'memo', 'Purchase return ' || v_return_no
  );

  if p_settlement_type = 'reduce_payable' then
    -- Debit Vendor Payable (reduce what we owe).
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_payable_acct, 'debit', v_total::text, 'credit', '0',
      'memo', 'Return reduces payable ' || v_return_no
    );
  elsif p_settlement_type = 'vendor_refund' then
    -- Debit Cash/Bank (vendor refunds us).
    if p_settlement_account_id is null then
      raise exception 'Settlement account required for vendor_refund';
    end if;
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', p_settlement_account_id, 'debit', v_total::text, 'credit', '0',
      'memo', 'Vendor refund ' || v_return_no
    );
  else
    -- vendor_credit: Debit Vendor Payable (same as reduce_payable accounting-wise).
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_payable_acct, 'debit', v_total::text, 'credit', '0',
      'memo', 'Vendor credit ' || v_return_no
    );
  end if;

  -- Post reversing voucher.
  v_voucher_id := public.post_voucher(
    p_business_id, 'PR', v_date, 'Purchase return ' || v_return_no,
    v_voucher_lines, p_purchase_id, 'purchase_return', p_created_by
  );

  -- Insert return header.
  insert into public.purchase_returns (
    business_id, purchase_id, vendor_id, return_no, return_date, total_amount,
    settlement_type, settlement_account_id, voucher_id, notes, created_by
  ) values (
    p_business_id, p_purchase_id, v_purchase.vendor_id, v_return_no, v_date, v_total,
    p_settlement_type, p_settlement_account_id, v_voucher_id, p_notes, p_created_by
  ) returning id into v_return_id;

  -- Insert return items + create stock-out movements.
  for v_item in select * from jsonb_array_elements(p_return_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    v_unit_cost := coalesce((v_item->>'unit_cost_paisas')::numeric, 0);
    v_line_total := v_qty * v_unit_cost;
    v_product_id := v_item->>'product_id';

    v_stock_sm_id := null;
    if v_product_id is not null and v_product_id <> '' then
      v_stock_sm_id := public.create_stock_movement(
        p_business_id, v_product_id, 'adjustment_out', v_qty,
        'Purchase return ' || v_return_no, v_date, p_created_by
      );
    end if;

    insert into public.purchase_return_items (
      business_id, purchase_return_id, purchase_item_id, product_id, product_name,
      quantity, unit_cost, line_total, stock_movement_id
    ) values (
      p_business_id, v_return_id, v_item->>'purchase_item_id', v_product_id,
      v_item->>'product_name', v_qty, v_unit_cost, v_line_total, v_stock_sm_id
    );

    -- Update returned_quantity on original purchase_item.
    update public.purchase_items
    set returned_quantity = returned_quantity + v_qty
    where id = v_item->>'purchase_item_id';
  end loop;

  -- Update purchase status.
  if v_total >= v_purchase.total then
    update public.purchases set status = 'returned', updated_at = now() where id = p_purchase_id;
  else
    update public.purchases set status = 'partially_returned', updated_at = now() where id = p_purchase_id;
  end if;

  -- Audit.
  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'PURCHASE_RETURN', 'purchase_return', v_return_id,
    jsonb_build_object('return_no', v_return_no, 'purchase_id', p_purchase_id, 'total', v_total, 'voucher_id', v_voucher_id));

  return v_return_id;
end;
$$;

-- ============================================================================
-- Row-Level Security
-- ============================================================================

alter table public.vendors               enable row level security;
alter table public.purchases              enable row level security;
alter table public.purchase_items         enable row level security;
alter table public.purchase_payments      enable row level security;
alter table public.purchase_returns       enable row level security;
alter table public.purchase_return_items  enable row level security;

-- vendors: readable by members; managed by can_manage_setup or can_create_purchases.
drop policy if exists vendors_select_own on public.vendors;
create policy vendors_select_own on public.vendors
  for select using (business_id = public.current_business_id());

drop policy if exists vendors_manage_perms on public.vendors;
create policy vendors_manage_perms on public.vendors
  for all using (
    business_id = public.current_business_id()
    and (public.has_permission('can_manage_setup') or public.has_permission('can_create_purchases'))
  ) with check (
    business_id = public.current_business_id()
    and (public.has_permission('can_manage_setup') or public.has_permission('can_create_purchases'))
  );

-- purchases: readable by members with can_view_purchases.
drop policy if exists purchases_select_own on public.purchases;
create policy purchases_select_own on public.purchases
  for select using (
    business_id = public.current_business_id()
    and public.has_permission('can_view_purchases')
  );

-- No direct INSERT on purchases — must use post_purchase() RPC.

-- purchase_items: readable by members with can_view_purchases.
drop policy if exists purchase_items_select_own on public.purchase_items;
create policy purchase_items_select_own on public.purchase_items
  for select using (
    business_id = public.current_business_id()
    and public.has_permission('can_view_purchases')
  );

-- purchase_payments: readable by members with can_view_purchases.
drop policy if exists purchase_payments_select_own on public.purchase_payments;
create policy purchase_payments_select_own on public.purchase_payments
  for select using (
    business_id = public.current_business_id()
    and public.has_permission('can_view_purchases')
  );

-- purchase_returns: readable by members with can_view_purchases.
drop policy if exists purchase_returns_select_own on public.purchase_returns;
create policy purchase_returns_select_own on public.purchase_returns
  for select using (
    business_id = public.current_business_id()
    and public.has_permission('can_view_purchases')
  );

-- purchase_return_items: readable by members with can_view_purchases.
drop policy if exists purchase_return_items_select_own on public.purchase_return_items;
create policy purchase_return_items_select_own on public.purchase_return_items
  for select using (
    business_id = public.current_business_id()
    and public.has_permission('can_view_purchases')
  );

-- ============================================================================
-- Updated_at triggers
-- ============================================================================
drop trigger if exists vendors_touch on public.vendors;
create trigger vendors_touch before update on public.vendors
  for each row execute function public.touch_updated_at();

drop trigger if exists purchases_touch on public.purchases;
create trigger purchases_touch before update on public.purchases
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Add new permissions to the catalog
-- ============================================================================
insert into public.permissions (code, module, description) values
  ('can_pay_vendors', 'purchases', 'Pay vendors and record advances'),
  ('can_manage_vendors', 'purchases', 'Create/edit vendors'),
  ('can_return_purchases', 'purchases', 'Post purchase returns'),
  ('can_view_vendor_ledger', 'purchases', 'View vendor ledger')
on conflict (code) do update set
  module = excluded.module,
  description = excluded.description;

-- Grant new permissions to Owner/Admin and Accountant.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.business_id = 'biz-default' and r.name in ('Owner/Admin', 'Accountant')
  and p.code in ('can_pay_vendors', 'can_manage_vendors', 'can_return_purchases', 'can_view_vendor_ledger')
on conflict do nothing;

-- Refresh PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Done. Phase 5 purchases module is live with:
--   ✓ Vendors table with linked ledger accounts
--   ✓ Purchases with PUR-0001 sequence (concurrency-safe)
--   ✓ Purchase items with stock-in movements
--   ✓ Purchase payments (cash, credit, partial, advance)
--   ✓ Purchase returns with PRN-0001 sequence
--   ✓ post_purchase() RPC — atomic purchase posting
--   ✓ post_vendor_payment() RPC — later vendor payments
--   ✓ post_vendor_advance() RPC — vendor advances
--   ✓ post_purchase_return() RPC — atomic returns with stock-out
--   ✓ RLS on all tables
--   ✓ Audit logs for all actions
--   ✓ New permissions: can_pay_vendors, can_manage_vendors, can_return_purchases, can_view_vendor_ledger
-- ============================================================================
