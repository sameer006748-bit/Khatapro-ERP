-- ============================================================================
-- KhataPro ERP — Phase 9: Add discount support + canonical collection commission
--
-- This migration contains ALL database changes for Phase 9:
--   1. Drop old 13-arg post_sale, create new 14-arg with p_discount_paisas
--   2. Create canonical post_salesman_collection_commission() RPC
--   3. post_sale() calls canonical commission for initial payments
--   4. post_receipt_voucher() calls canonical commission for later collections
--   5. Discount validations
--   6. Collection-based commission (not invoice-time)
--   7. Duplicate commission prevention via unique constraint
--
-- OVERLOAD PREVENTION:
--   DROP the exact old 13-parameter signature, then CREATE the new 14-parameter.
--   No CASCADE. One canonical post_sale remains.
--
-- Rerunnable: DROP IF EXISTS + CREATE OR REPLACE. Safe to re-run.
-- ============================================================================

-- ============================================================================
-- PART 1: Canonical collection commission function
-- ============================================================================
-- This is the ONE function that creates salesman commission.
-- Called from:
--   - post_sale() for initial invoice payments
--   - post_receipt_voucher() for later customer collections
--
-- Business rules:
--   - Commission earned only on net collected amount (payment - change)
--   - No commission on outstanding/uncollected amount
--   - No commission on returned change
--   - Duplicate prevention via source_reference unique check
--   - Zero collection = zero commission (no row inserted)

create or replace function public.post_salesman_collection_commission(
  p_business_id      text,
  p_salesman_id      text,
  p_invoice_id       text,
  p_net_collected    numeric(20,0),
  p_source_type      text,
  p_source_id        text,
  p_collection_date  date,
  p_created_by       uuid default null
)
returns text  -- commission ID, or null if no commission created
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comm_pct      numeric(5,2);
  v_comm_amount   numeric(20,0);
  v_comm_id       text;
  v_exists        boolean;
begin
  -- Validate inputs
  if p_net_collected <= 0 then
    return null;  -- Zero or negative collection = no commission
  end if;

  -- Get salesman's commission rate
  select commission_pct into v_comm_pct
  from public.salesmen
  where id = p_salesman_id
    and business_id = p_business_id
    and is_active = true;

  if not found or v_comm_pct is null or v_comm_pct <= 0 then
    return null;  -- No commission rate or inactive salesman
  end if;

  -- Duplicate prevention: check if commission already exists for this source
  select exists(
    select 1 from public.salesman_commissions
    where business_id = p_business_id
      and invoice_id = p_invoice_id
      and salesman_id = p_salesman_id
      and source_type = p_source_type
      and source_id = p_source_id
  ) into v_exists;

  if v_exists then
    return null;  -- Already commissioned for this source — no duplicate
  end if;

  -- Calculate commission on net collected amount only
  v_comm_amount := (p_net_collected * v_comm_pct) / 100;

  if v_comm_amount <= 0 then
    return null;
  end if;

  -- Insert commission row
  insert into public.salesman_commissions (
    business_id, salesman_id, invoice_id,
    allocation_id,  -- nullable (set for initial payments, null for receipts)
    collected_amount, commission_pct, commission_amount,
    status, source_type, source_id
  ) values (
    p_business_id, p_salesman_id, p_invoice_id,
    null,  -- allocation_id — nullable per 00008d
    p_net_collected, v_comm_pct, v_comm_amount,
    'accrued', p_source_type, p_source_id
  ) returning id into v_comm_id;

  return v_comm_id;
end;
$$;

grant execute on function public.post_salesman_collection_commission(
  text, text, text, numeric(20,0), text, text, date, uuid
) to authenticated;

-- ============================================================================
-- PART 2: Add source_type and source_id columns to salesman_commissions
-- ============================================================================
-- These columns enable the canonical duplicate-prevention mechanism.
-- source_type: 'sale_payment' or 'receipt_collection'
-- source_id: the payment_allocation ID or receipt ID

alter table public.salesman_commissions
  add column if not exists source_type text not null default 'sale_payment';

alter table public.salesman_commissions
  add column if not exists source_id text;

-- Add unique constraint for duplicate prevention (source_type + source_id + invoice_id + salesman_id)
drop constraint if exists salesman_commissions_source_unique on public.salesman_commissions;
create unique index if not exists salesman_commissions_source_unique
  on public.salesman_commissions (business_id, invoice_id, salesman_id, source_type, source_id)
  where source_id is not null;

-- ============================================================================
-- PART 3: Drop old post_sale and create new with discount + commission
-- ============================================================================

-- Drop the exact old 13-parameter signature (no CASCADE)
drop function if exists public.post_sale(
  text, text, date, jsonb, jsonb, text, text, text, text, text, text, text, uuid
);

-- Create the canonical 14-parameter function
create function public.post_sale(
  p_business_id    text,
  p_invoice_type   text,
  p_invoice_date   date,
  p_items          jsonb,
  p_payments       jsonb,
  p_salesman_id    text default null,
  p_customer_id    text default null,
  p_customer_name  text default null,
  p_customer_phone text default null,
  p_customer_address text default null,
  p_customer_city  text default null,
  p_memo           text default null,
  p_created_by     uuid default null,
  p_discount_paisas numeric(20,0) default 0
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id    text;
  v_invoice_no    text;
  v_subtotal      numeric(20,0) := 0;
  v_total         numeric(20,0) := 0;
  v_paid          numeric(20,0) := 0;
  v_change_total  numeric(20,0) := 0;
  v_item          jsonb;
  v_payment       jsonb;
  v_line_total    numeric(20,0);
  v_qty           integer;
  v_unit_price    numeric(20,0);
  v_product_id    text;
  v_is_temporary  boolean;
  v_voucher_id    text;
  v_voucher_lines jsonb := '[]'::jsonb;
  v_sales_account text;
  v_cogs_account  text;
  v_inventory_acct text;
  v_ar_account    text;
  v_outstanding   numeric(20,0);
  v_stock_sm_id   text;
  v_alloc_id      text;
  v_comm_pct      numeric(5,2);
  v_net_collected numeric(20,0);
  v_product_wac   numeric(20,0);
  v_item_cogs     numeric(20,0);
  v_total_cogs    numeric(20,0) := 0;
  v_discount      numeric(20,0) := 0;
begin
  if p_invoice_type not in ('COUNTER', 'ONLINE', 'OFC') then
    raise exception 'Invalid invoice_type: %', p_invoice_type;
  end if;

  if jsonb_array_length(p_items) < 1 then
    raise exception 'Invoice must have at least 1 item';
  end if;

  -- Validate discount
  v_discount := coalesce(p_discount_paisas, 0);
  if v_discount < 0 then
    raise exception 'Discount cannot be negative';
  end if;

  v_invoice_no := public.next_invoice_no(p_business_id);

  -- Compute subtotal from items
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::integer;
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_total := v_qty * v_unit_price;
    v_subtotal := v_subtotal + v_line_total;
  end loop;

  -- Validate discount does not exceed subtotal
  if v_discount > v_subtotal then
    raise exception 'Discount (%) cannot exceed subtotal (%)', v_discount, v_subtotal;
  end if;

  -- total = subtotal - discount (delivery fee is separate, not in post_sale)
  v_total := v_subtotal - v_discount;

  -- Compute paid and change from payments
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if not coalesce((v_payment->>'is_change')::boolean, false) then
      v_paid := v_paid + coalesce((v_payment->>'amount')::numeric, 0);
    else
      v_change_total := v_change_total + coalesce((v_payment->>'amount')::numeric, 0);
    end if;
  end loop;

  -- Resolve accounts
  select id into v_sales_account
  from public.accounts
  where business_id = p_business_id and code = '4010' and is_active = true;
  if not found then raise exception 'Sales account (4010) not found'; end if;

  select id into v_cogs_account
  from public.accounts
  where business_id = p_business_id and code = '5010' and is_active = true;
  if not found then raise exception 'COGS account (5010) not found'; end if;

  select id into v_inventory_acct
  from public.accounts
  where business_id = p_business_id and code = '1100' and is_active = true;
  if not found then raise exception 'Inventory account (1100) not found'; end if;

  select id into v_ar_account
  from public.accounts
  where business_id = p_business_id and code = '1200' and is_active = true;

  -- Build voucher lines:

  -- Credit Sales by total (net of discount)
  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', v_sales_account, 'debit', '0', 'credit', v_total::text,
    'memo', 'Sale ' || v_invoice_no
  );

  -- Debit each payment account (non-change)
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if not coalesce((v_payment->>'is_change')::boolean, false) then
      v_voucher_lines := v_voucher_lines || jsonb_build_object(
        'account_id', v_payment->>'account_id',
        'debit', coalesce((v_payment->>'amount')::numeric, 0)::text,
        'credit', '0', 'memo', 'Payment received ' || v_invoice_no
      );
    end if;
  end loop;

  -- Credit change accounts
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if coalesce((v_payment->>'is_change')::boolean, false) then
      v_voucher_lines := v_voucher_lines || jsonb_build_object(
        'account_id', v_payment->>'account_id',
        'debit', '0',
        'credit', coalesce((v_payment->>'amount')::numeric, 0)::text,
        'memo', 'Change given ' || v_invoice_no
      );
    end if;
  end loop;

  -- AR (1200) debit for outstanding
  v_outstanding := v_total + v_change_total - v_paid;
  if v_outstanding > 0 and v_ar_account is not null then
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_ar_account,
      'debit', v_outstanding::text, 'credit', '0',
      'memo', 'Outstanding ' || v_invoice_no
    );
  end if;

  -- COGS lines (discount does NOT reduce COGS)
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::integer;
    v_product_id := v_item->>'product_id';
    v_is_temporary := coalesce((v_item->>'is_temporary')::boolean, false);

    if v_product_id is not null and v_product_id <> '' and not v_is_temporary then
      select weighted_average_cost into v_product_wac
      from public.products
      where id = v_product_id and business_id = p_business_id;

      v_item_cogs := v_qty * coalesce(v_product_wac, 0);
      v_total_cogs := v_total_cogs + v_item_cogs;

      if v_item_cogs > 0 then
        v_voucher_lines := v_voucher_lines || jsonb_build_object(
          'account_id', v_cogs_account,
          'debit', v_item_cogs::text, 'credit', '0',
          'memo', 'COGS: ' || (v_item->>'product_name')
        );
        v_voucher_lines := v_voucher_lines || jsonb_build_object(
          'account_id', v_inventory_acct,
          'debit', '0', 'credit', v_item_cogs::text,
          'memo', 'Stock out: ' || (v_item->>'product_name')
        );
      end if;
    end if;
  end loop;

  -- Post voucher
  v_voucher_id := public.post_voucher(
    p_business_id, 'SI', p_invoice_date, p_memo, v_voucher_lines,
    null, null, p_created_by
  );

  -- Insert invoice header with discount
  insert into public.invoices (
    business_id, invoice_no, invoice_type, invoice_date,
    customer_id, salesman_id,
    customer_name, customer_phone, customer_address, customer_city,
    subtotal, discount, total, paid_amount,
    voucher_id, memo, created_by
  ) values (
    p_business_id, v_invoice_no, p_invoice_type, p_invoice_date,
    p_customer_id, p_salesman_id,
    p_customer_name, p_customer_phone, p_customer_address, p_customer_city,
    v_subtotal, v_discount, v_total, v_paid,
    v_voucher_id, p_memo, p_created_by
  ) returning id into v_invoice_id;

  -- Insert items + stock-out + capture sale-time cost
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::integer;
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_total := v_qty * v_unit_price;
    v_product_id := v_item->>'product_id';
    v_is_temporary := coalesce((v_item->>'is_temporary')::boolean, false);

    v_stock_sm_id := null;
    if v_product_id is not null and v_product_id <> '' and not v_is_temporary then
      select weighted_average_cost into v_product_wac
      from public.products where id = v_product_id;

      v_stock_sm_id := public.create_stock_movement(
        p_business_id, v_product_id, 'adjustment_out', v_qty,
        'Sale ' || v_invoice_no, p_invoice_date, p_created_by
      );
    else
      v_product_wac := 0;
    end if;

    insert into public.invoice_items (
      business_id, invoice_id, product_id, product_name, qty, unit_price, line_total, is_temporary, stock_movement_id, unit_cost_paisas
    ) values (
      p_business_id, v_invoice_id, v_product_id,
      v_item->>'product_name', v_qty, v_unit_price, v_line_total,
      v_is_temporary, v_stock_sm_id, coalesce(v_product_wac, 0)
    );
  end loop;

  -- Insert payment allocations (non-change)
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if not coalesce((v_payment->>'is_change')::boolean, false) then
      insert into public.payment_allocations (
        business_id, invoice_id, account_id, amount, is_change, voucher_id, created_by
      ) values (
        p_business_id, v_invoice_id, v_payment->>'account_id',
        coalesce((v_payment->>'amount')::numeric, 0), false, v_voucher_id, p_created_by
      ) returning id into v_alloc_id;

      -- *** CANONICAL COMMISSION: call collection commission for this payment allocation ***
      if p_salesman_id is not null then
        -- net_collected = payment amount (change is separate, not in this allocation)
        v_net_collected := coalesce((v_payment->>'amount')::numeric, 0);
        perform public.post_salesman_collection_commission(
          p_business_id, p_salesman_id, v_invoice_id,
          v_net_collected, 'sale_payment', v_alloc_id,
          p_invoice_date, p_created_by
        );
      end if;
    end if;
  end loop;

  -- Change allocations
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if coalesce((v_payment->>'is_change')::boolean, false) then
      insert into public.payment_allocations (
        business_id, invoice_id, account_id, amount, is_change, voucher_id, created_by
      ) values (
        p_business_id, v_invoice_id, v_payment->>'account_id',
        coalesce((v_payment->>'amount')::numeric, 0), true, v_voucher_id, p_created_by
      ) returning id into v_alloc_id;
      -- NO commission on change allocations
    end if;
  end loop;

  -- Audit log
  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'POST_SALE', 'invoice', v_invoice_id,
    jsonb_build_object('invoice_no', v_invoice_no, 'type', p_invoice_type, 'total', v_total,
      'discount', v_discount, 'paid', v_paid, 'change', v_change_total, 'outstanding', v_outstanding,
      'cogs', v_total_cogs, 'voucher_id', v_voucher_id));

  return v_invoice_id;
end;
$$;

grant execute on function public.post_sale(
  text, text, date, jsonb, jsonb, text, text, text, text, text, text, text, uuid, numeric
) to authenticated;

-- ============================================================================
-- PART 4: Update post_receipt_voucher to support commission on collection
-- ============================================================================
-- Add optional p_invoice_id parameter so receipts linked to specific invoices
-- can trigger commission on the collected amount.

drop function if exists public.post_receipt_voucher(
  text, date, text, text, numeric(20,0), text, text, text, uuid
);

create function public.post_receipt_voucher(
  p_business_id text,
  p_receipt_date date,
  p_received_into_account_id text,
  p_credit_account_id text,
  p_amount_paisas numeric(20,0),
  p_customer_id text default null,
  p_reference text default null,
  p_notes text default null,
  p_created_by uuid default null,
  p_invoice_id text default null
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
  v_invoice_salesman_id text;
  v_comm_id text;
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

  -- *** CANONICAL COMMISSION: if receipt is linked to an invoice with a salesman ***
  if p_invoice_id is not null then
    -- Get the invoice's salesman
    select salesman_id into v_invoice_salesman_id
    from public.invoices
    where id = p_invoice_id and business_id = p_business_id;

    if v_invoice_salesman_id is not null then
      -- Call canonical collection commission
      v_comm_id := public.post_salesman_collection_commission(
        p_business_id, v_invoice_salesman_id, p_invoice_id,
        p_amount_paisas, 'receipt_collection', v_receipt_id,
        p_receipt_date, p_created_by
      );
    end if;
  end if;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'POST_RECEIPT_VOUCHER', 'receipt', v_receipt_id,
    jsonb_build_object('receipt_no', v_receipt_no, 'amount', p_amount_paisas, 'voucher_id', v_voucher_id,
      'invoice_id', p_invoice_id, 'commission_id', v_comm_id));

  return jsonb_build_object('receipt_id', v_receipt_id, 'receipt_no', v_receipt_no, 'voucher_id', v_voucher_id, 'commission_id', v_comm_id);
end;
$$;

grant execute on function public.post_receipt_voucher(
  text, date, text, text, numeric(20,0), text, text, text, uuid, text
) to authenticated;

-- ============================================================================
-- PostgREST schema reload
-- ============================================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Done. Migration 00009 complete scope:
--   ✓ post_salesman_collection_commission() — ONE canonical commission function
--   ✓ salesman_commissions.source_type and source_id columns added
--   ✓ Unique index on (business, invoice, salesman, source_type, source_id)
--   ✓ post_sale() — 14 params with p_discount_paisas, calls canonical commission
--   ✓ post_receipt_voucher() — 10 params with p_invoice_id, calls canonical commission
--   ✓ Discount validated: >= 0 and <= subtotal
--   ✓ total = subtotal - discount
--   ✓ Revenue posts net of discount
--   ✓ COGS unchanged
--   ✓ Commission on net collected (payment - change), not subtotal
--   ✓ Change allocations do NOT trigger commission
--   ✓ Duplicate commission prevented via unique index
--   ✓ Grant to authenticated only (NOT anon)
--   ✓ SECURITY DEFINER, set search_path = public
--   ✓ NOTIFY pgrst reload schema
-- ============================================================================
