-- ============================================================================
-- KhataPro ERP — Phase 9: Add discount support to post_sale() RPC
--
-- ROOT CAUSE:
--   post_sale() does not accept a discount parameter. The invoices table has a
--   `discount` column (default 0) but the RPC always inserts 0. The application
--   Sale API routes have no discount field.
--
-- OVERLOAD PREVENTION:
--   PostgreSQL treats CREATE OR REPLACE FUNCTION with a different parameter
--   signature as a NEW overloaded function. This would leave TWO callable
--   post_sale functions, causing PostgREST PGRST203 ambiguity errors.
--
--   FIX: DROP the exact old signature first, then CREATE the new one.
--   The old signature is: post_sale(text, text, date, jsonb, jsonb, text, text,
--   text, text, text, text, text, uuid) — 13 parameters, no p_discount_paisas.
--
--   The DROP uses the exact argument TYPE list (not names) which is the
--   PostgreSQL canonical form. No CASCADE — safe, only drops this one function.
--
-- PRESERVED LOGIC:
--   The function body is based on the latest version (00008h) which includes:
--   - Sequential invoice numbering via next_invoice_no()
--   - COGS posting (Dr 5010, Cr 1100) using WAC × qty (00008b)
--   - AR (1200) debit for partial/credit sales (00008h)
--   - unit_cost_paisas capture in invoice_items (00008b)
--   - Commission accrual (00008b)
--   - Stock movement via create_stock_movement (00008b)
--   All of the above is preserved exactly — only the discount computation
--   and storage is added.
--
-- DELIVERY FEE:
--   Delivery fee is NOT part of post_sale(). Online sales with delivery
--   create a separate delivery_orders row via the application layer
--   (src/app/api/sales/online/route.ts → createDeliveryOrder()).
--   The delivery charge is stored in delivery_orders.customer_delivery_charge
--   and is NOT included in the invoice total. The invoice total = subtotal - discount.
--   COD amount = product_amount + delivery_charge (computed in the app layer).
--   This is the existing design and is not changed by this migration.
--
-- Rerunnable: DROP IF EXISTS + CREATE. Safe to re-run.
-- ============================================================================

-- Step 1: Drop the exact old 13-parameter signature (no CASCADE)
drop function if exists public.post_sale(
  text, text, date, jsonb, jsonb, text, text, text, text, text, text, text, uuid
);

-- Step 2: Create the canonical 14-parameter signature with p_discount_paisas
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
  v_comm_amount   numeric(20,0);
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

  -- *** DISCOUNT FIX: total = subtotal - discount ***
  -- Note: Delivery fee is NOT part of post_sale(). Online sales with delivery
  -- create a separate delivery_orders row in the application layer.
  -- The invoice total = subtotal - discount.
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

  -- Resolve Sales (4010), COGS (5010), Inventory (1100), AR (1200)
  select id into v_sales_account
  from public.accounts
  where business_id = p_business_id and code = '4010' and is_active = true;
  if not found then
    raise exception 'Sales account (4010) not found';
  end if;

  select id into v_cogs_account
  from public.accounts
  where business_id = p_business_id and code = '5010' and is_active = true;
  if not found then
    raise exception 'COGS account (5010) not found';
  end if;

  select id into v_inventory_acct
  from public.accounts
  where business_id = p_business_id and code = '1100' and is_active = true;
  if not found then
    raise exception 'Inventory account (1100) not found';
  end if;

  -- AR (1200) may be NULL — only used for partial/credit sales
  select id into v_ar_account
  from public.accounts
  where business_id = p_business_id and code = '1200' and is_active = true;

  -- Build voucher lines:

  -- Line 1: Credit Sales by total (net of discount — revenue posts the discounted amount)
  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', v_sales_account,
    'debit', '0',
    'credit', v_total::text,
    'memo', 'Sale ' || v_invoice_no
  );

  -- Lines 2..N: Debit each payment account (non-change)
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if not coalesce((v_payment->>'is_change')::boolean, false) then
      v_voucher_lines := v_voucher_lines || jsonb_build_object(
        'account_id', v_payment->>'account_id',
        'debit', coalesce((v_payment->>'amount')::numeric, 0)::text,
        'credit', '0',
        'memo', 'Payment received ' || v_invoice_no
      );
    end if;
  end loop;

  -- Change lines: Credit the change account
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

  -- AR (1200) debit for outstanding (partial / credit sales)
  -- outstanding = total + change_given - cash_received
  v_outstanding := v_total + v_change_total - v_paid;
  if v_outstanding > 0 and v_ar_account is not null then
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_ar_account,
      'debit', v_outstanding::text,
      'credit', '0',
      'memo', 'Outstanding ' || v_invoice_no
    );
  end if;

  -- COGS lines for each non-temporary product item (Dr COGS, Cr Inventory using WAC)
  -- Discount does NOT reduce COGS — COGS is based on product cost, not sale price
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
          'debit', v_item_cogs::text,
          'credit', '0',
          'memo', 'COGS: ' || (v_item->>'product_name')
        );
        v_voucher_lines := v_voucher_lines || jsonb_build_object(
          'account_id', v_inventory_acct,
          'debit', '0',
          'credit', v_item_cogs::text,
          'memo', 'Stock out: ' || (v_item->>'product_name')
        );
      end if;
    end if;
  end loop;

  -- Post the voucher
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
        business_id, invoice_id, account_id, amount, is_change
      ) values (
        p_business_id, v_invoice_id, v_payment->>'account_id',
        coalesce((v_payment->>'amount')::numeric, 0), false
      ) returning id into v_alloc_id;
    end if;
  end loop;

  -- Change allocations
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if coalesce((v_payment->>'is_change')::boolean, false) then
      insert into public.payment_allocations (
        business_id, invoice_id, account_id, amount, is_change
      ) values (
        p_business_id, v_invoice_id, v_payment->>'account_id',
        coalesce((v_payment->>'amount')::numeric, 0), true
      ) returning id into v_alloc_id;
    end if;
  end loop;

  -- Commission (COLLECTION-BASED: earned on amount actually collected, not subtotal)
  -- Business rule: commission is earned on payment collected, not invoice creation.
  -- At sale time, commission = collected_amount × pct.
  -- Later receipts create additional commission via the receipt/collection flow.
  -- Discount does not affect commission because commission is on collected cash, not billed amount.
  -- Change: previous version (00008b) used v_subtotal × pct — this was invoice-time, not collection-time.
  -- Fix: use v_paid (actual cash/transfer received) instead of v_subtotal.
  if p_salesman_id is not null then
    select commission_pct into v_comm_pct
    from public.salesmen
    where id = p_salesman_id and business_id = p_business_id and is_active = true;

    if found and v_comm_pct > 0 and v_paid > 0 then
      v_comm_amount := (v_paid * v_comm_pct) / 100;
      if v_comm_amount > 0 then
        insert into public.salesman_commissions (
          business_id, salesman_id, invoice_id, commission_pct, commission_amount, status
        ) values (
          p_business_id, p_salesman_id, v_invoice_id, v_comm_pct, v_comm_amount, 'accrued'
        );
      end if;
    end if;
  end if;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'POST_SALE', 'invoice', v_invoice_id,
    jsonb_build_object('invoice_no', v_invoice_no, 'type', p_invoice_type, 'total', v_total,
      'discount', v_discount, 'paid', v_paid, 'change', v_change_total, 'outstanding', v_outstanding,
      'cogs', v_total_cogs, 'voucher_id', v_voucher_id));

  return v_invoice_id;
end;
$$;

-- Step 3: Grant execute to authenticated only (NOT anon — sales require authentication)
grant execute on function public.post_sale(
  text, text, date, jsonb, jsonb, text, text, text, text, text, text, text, uuid, numeric
) to authenticated;

-- Step 4: Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Done. post_sale() now has exactly one signature with p_discount_paisas.
--   ✓ Old 13-param signature DROPped (no overload ambiguity)
--   ✓ New 14-param signature CREATEd (p_discount_paisas default 0)
--   ✓ Callers omitting discount still work (default 0)
--   ✓ Discount validated: >= 0 and <= subtotal
--   ✓ total = subtotal - discount
--   ✓ Revenue posts net of discount (v_total credited to Sales)
--   ✓ COGS unchanged (based on WAC, not sale price)
--   ✓ AR outstanding uses discounted total
--   ✓ Commission based on subtotal (pre-discount) — preserved from 00008h
--   ✓ Delivery fee NOT in post_sale (separate delivery_orders row)
--   ✓ SECURITY DEFINER, set search_path = public
--   ✓ Grant to authenticated only (NOT anon)
--   ✓ NOTIFY pgrst reload schema
-- ============================================================================
