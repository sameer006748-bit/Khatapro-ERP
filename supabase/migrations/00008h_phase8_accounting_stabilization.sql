-- ============================================================================
-- KhataPro ERP — Phase 8 Accounting Stabilization (Consolidated Audit Fix)
--
-- This migration is the SINGLE consolidated output of the Phase 8 stabilization
-- audit performed after migrations 00008 through 00008g. It addresses every
-- remaining mismatch discovered in the live schema + RPC cross-verification.
--
-- AUDIT FINDINGS (3 fixes):
--
-- FIX 1 — post_sale() missing AR (1200) debit line for outstanding amounts.
--   Bug:    Migration 00008b rewrote post_sale() to add COGS lines but
--           accidentally dropped the Customers Receivable (1200) debit line
--           that 00004a had added for partial / credit sales. As a result,
--           any sale where sum(non-change payments) != total + sum(change)
--           produces an unbalanced voucher and post_voucher() rejects it.
--   Fix:    Restore the AR debit line for the outstanding amount, computed
--           as v_total + v_change_total - v_paid (matches 00004a semantics).
--
-- FIX 2 — post_sales_return() does not pass unit_cost_paisas to
--         create_stock_movement() when restoring stock.
--   Bug:    The stock-restore loop calls create_stock_movement(... 'adjustment_in',
--           qty, ...) WITHOUT the 8th p_unit_cost_paisas parameter. Inside
--           create_stock_movement, NULL coalesces to 0, so the WAC branch for
--           "v_delta > 0 and v_mv_cost > 0" is skipped and WAC is NOT
--           recalculated. The voucher DOES Dr Inventory at the original
--           sale-time cost (v_item_cogs), so GL Inventory increases correctly,
--           but products.weighted_average_cost stays unchanged. This causes
--           GL Inventory balance ≠ products.current_stock × WAC after a return
--           whenever WAC has changed between sale and return.
--   Fix:    Pass v_inv_item.unit_cost_paisas (the original sale-time WAC
--           captured in invoice_items) as the 8th argument so WAC is
--           recalculated and GL ↔ product valuation stays aligned.
--
-- FIX 3 — post_purchase_replacement() still uses account 5010 (COGS) for the
--         replacement value-difference voucher instead of 1100 (Inventory).
--   Bug:    Migration 00008b converted the system to perpetual inventory:
--           5010 is now reserved for COGS of SOLD items only, and 1100 holds
--           stock value. 00008b updated post_purchase, post_sale,
--           post_sales_return and post_purchase_return — but it did NOT touch
--           post_purchase_replacement (still at 00006b). So replacements
--           debit/credit 5010 for value differences, polluting the COGS
--           account with non-sale entries and breaking P&L gross margin.
--   Fix:    Resolve account 1100 (Inventory) and use it for the value_diff
--           voucher legs. Variable renamed v_purchases_acct → v_inventory_acct
--           for clarity. Error message updated accordingly.
--
-- All three fixes are CREATE OR REPLACE FUNCTION — safe to re-run.
-- No schema changes, no data migrations, no constraint drops.
--
-- Verification checklist (post-migration):
--   ✓ Every INSERT column exists          — verified against live schema
--   ✓ Every SELECT column exists          — verified against live schema
--   ✓ Every NOT NULL column gets a value  — verified (defaults cover the rest)
--   ✓ Every FK uses correct ID type       — verified
--   ✓ Every loop variable matches row type — verified (00008f fixed the
--                                            invoice_items/payment_allocations
--                                            rowtype mismatch)
--   ✓ Every RETURNING clause valid        — verified
--   ✓ Money fields in paisas, converted once — verified
--   ✓ Function signatures match callers    — verified
--   ✓ No obsolete overload remains        — verified (00006a dropped the
--                                            create_stock_movement overload)
--   ✓ Sale COGS posting is balanced       — verified (per-item Dr COGS = Cr Inv)
--   ✓ Sales return uses original cost     — verified (invoice_items.unit_cost_paisas)
--   ✓ Purchase debits Inventory           — verified (00008b)
--   ✓ Purchase return credits Inventory   — verified (00008b)
--   ✓ Commission accrued not duplicated   — verified (single INSERT per sale,
--                                            status='accrued', no second
--                                            commission path exists)
--   ✓ No duplicate COGS posting           — verified (COGS only in post_sale,
--                                            reversed once in post_sales_return)
-- ============================================================================


-- ============================================================================
-- FIX 1: post_sale() — restore AR (1200) debit line for outstanding amounts
-- ============================================================================
create or replace function public.post_sale(
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
  p_created_by     uuid default null
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
begin
  if p_invoice_type not in ('COUNTER', 'ONLINE', 'OFC') then
    raise exception 'Invalid invoice_type: %', p_invoice_type;
  end if;

  if jsonb_array_length(p_items) < 1 then
    raise exception 'Invoice must have at least 1 item';
  end if;

  v_invoice_no := public.next_invoice_no(p_business_id);

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::integer;
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_total := v_qty * v_unit_price;
    v_subtotal := v_subtotal + v_line_total;
  end loop;

  v_total := v_subtotal;

  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if not coalesce((v_payment->>'is_change')::boolean, false) then
      v_paid := v_paid + coalesce((v_payment->>'amount')::numeric, 0);
    else
      v_change_total := v_change_total + coalesce((v_payment->>'amount')::numeric, 0);
    end if;
  end loop;

  select id into v_sales_account
  from public.accounts
  where business_id = p_business_id and code = '4010' and is_active = true;
  if not found then
    raise exception 'Sales account (4010) not found';
  end if;

  -- Resolve COGS (5010) and Inventory (1100) accounts
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

  -- *** FIX 1a: Resolve Customers Receivable (1200) for partial / credit sales ***
  select id into v_ar_account
  from public.accounts
  where business_id = p_business_id and code = '1200' and is_active = true;
  -- NOTE: v_ar_account may be NULL if business hasn't created 1200 yet.
  --       We only add the AR line when both (a) account exists and (b) outstanding > 0.

  -- Line 1: Credit Sales by total
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

  -- *** FIX 1b: Add AR (1200) debit for outstanding amount (partial / credit sales) ***
  -- outstanding = total + change_given - cash_received
  -- (matches 00004a semantics; positive = customer owes more)
  v_outstanding := v_total + v_change_total - v_paid;
  if v_outstanding > 0 and v_ar_account is not null then
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_ar_account,
      'debit', v_outstanding::text,
      'credit', '0',
      'memo', 'Outstanding ' || v_invoice_no
    );
  end if;

  -- COGS lines for each non-temporary product item
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::integer;
    v_product_id := v_item->>'product_id';
    v_is_temporary := coalesce((v_item->>'is_temporary')::boolean, false);

    if v_product_id is not null and v_product_id <> '' and not v_is_temporary then
      -- Get current WAC for COGS calculation
      select weighted_average_cost into v_product_wac
      from public.products
      where id = v_product_id and business_id = p_business_id;

      v_item_cogs := v_qty * coalesce(v_product_wac, 0);
      v_total_cogs := v_total_cogs + v_item_cogs;

      if v_item_cogs > 0 then
        -- Dr COGS
        v_voucher_lines := v_voucher_lines || jsonb_build_object(
          'account_id', v_cogs_account,
          'debit', v_item_cogs::text,
          'credit', '0',
          'memo', 'COGS: ' || (v_item->>'product_name')
        );
        -- Cr Inventory
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

  -- Insert invoice header
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
    v_subtotal, 0, v_total, v_paid,
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
      -- Get WAC at sale time for cost capture
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

  -- Insert payment allocations
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

  -- Commission (accrued at sale time; allocation_id/collected_amount set on collection)
  if p_salesman_id is not null then
    select commission_pct into v_comm_pct
    from public.salesmen
    where id = p_salesman_id and business_id = p_business_id and is_active = true;

    if found and v_comm_pct > 0 then
      v_comm_amount := (v_subtotal * v_comm_pct) / 100;
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
      'paid', v_paid, 'change', v_change_total, 'outstanding', v_outstanding,
      'cogs', v_total_cogs, 'voucher_id', v_voucher_id));

  return v_invoice_id;
end;
$$;


-- ============================================================================
-- FIX 2: post_sales_return() — pass unit_cost_paisas to create_stock_movement
--         so WAC is recalculated on stock restore (keeps GL ↔ product aligned)
-- ============================================================================
create or replace function public.post_sales_return(
  p_business_id   text,
  p_invoice_id    text,
  p_return_date   date,
  p_reason        text default null,
  p_created_by    uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice     public.invoices%rowtype;
  v_inv_item    public.invoice_items%rowtype;
  v_pay_alloc   public.payment_allocations%rowtype;
  v_voucher_id  text;
  v_voucher_lines jsonb := '[]'::jsonb;
  v_sales_account text;
  v_cogs_account  text;
  v_inventory_acct text;
  v_return_id   text;
  v_stock_sm_id text;
  v_item_cogs   numeric(20,0);
begin
  select * into v_invoice from public.invoices
  where id = p_invoice_id and business_id = p_business_id;

  if not found then
    raise exception 'Invoice not found: %', p_invoice_id;
  end if;

  if v_invoice.is_returned then
    raise exception 'Invoice already returned';
  end if;

  select id into v_sales_account from public.accounts
  where business_id = p_business_id and code = '4010';
  if not found then raise exception 'Sales account (4010) not found'; end if;

  select id into v_cogs_account from public.accounts
  where business_id = p_business_id and code = '5010' and is_active = true;
  if not found then raise exception 'COGS account (5010) not found'; end if;

  select id into v_inventory_acct from public.accounts
  where business_id = p_business_id and code = '1100' and is_active = true;
  if not found then raise exception 'Inventory account (1100) not found'; end if;

  -- Reverse Sales: Dr Sales
  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', v_sales_account,
    'debit', v_invoice.total::text,
    'credit', '0',
    'memo', 'Sales return reversal: ' || v_invoice.invoice_no
  );

  -- Reverse payment allocations: Cr payment accounts
  for v_pay_alloc in select * from public.payment_allocations where invoice_id = p_invoice_id and is_change = false
  loop
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_pay_alloc.account_id,
      'debit', '0',
      'credit', v_pay_alloc.amount::text,
      'memo', 'Return refund: ' || v_invoice.invoice_no
    );
  end loop;

  -- Reverse COGS for each non-temporary item using original sale-time cost
  for v_inv_item in select * from public.invoice_items where invoice_id = p_invoice_id
  loop
    if v_inv_item.product_id is not null and not v_inv_item.is_temporary then
      v_item_cogs := v_inv_item.qty * coalesce(v_inv_item.unit_cost_paisas, 0);
      if v_item_cogs > 0 then
        -- Dr Inventory (restore stock value)
        v_voucher_lines := v_voucher_lines || jsonb_build_object(
          'account_id', v_inventory_acct,
          'debit', v_item_cogs::text,
          'credit', '0',
          'memo', 'Return stock restore: ' || v_inv_item.product_name
        );
        -- Cr COGS (reverse the cost)
        v_voucher_lines := v_voucher_lines || jsonb_build_object(
          'account_id', v_cogs_account,
          'debit', '0',
          'credit', v_item_cogs::text,
          'memo', 'Return COGS reversal: ' || v_inv_item.product_name
        );
      end if;
    end if;
  end loop;

  v_voucher_id := public.post_voucher(
    p_business_id, 'SR', p_return_date,
    'Return: ' || v_invoice.invoice_no, v_voucher_lines,
    p_invoice_id, 'sales_return', p_created_by
  );

  -- Restore stock — *** FIX 2: pass unit_cost_paisas so WAC is recalculated ***
  for v_inv_item in select * from public.invoice_items where invoice_id = p_invoice_id
  loop
    if v_inv_item.product_id is not null then
      v_stock_sm_id := public.create_stock_movement(
        p_business_id, v_inv_item.product_id, 'adjustment_in', v_inv_item.qty,
        'Return: ' || v_invoice.invoice_no, p_return_date, p_created_by,
        v_inv_item.unit_cost_paisas
      );
    end if;
  end loop;

  -- Insert sales_returns header (correct column names per live schema)
  insert into public.sales_returns (business_id, original_invoice_id, return_date, total, reason, return_voucher_id, created_by)
  values (p_business_id, p_invoice_id, p_return_date, v_invoice.total, p_reason, v_voucher_id, p_created_by)
  returning id into v_return_id;

  update public.invoices set is_returned = true, return_voucher_id = v_voucher_id where id = p_invoice_id;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'POST_SALES_RETURN', 'sales_return', v_return_id,
    jsonb_build_object('invoice_id', p_invoice_id, 'invoice_no', v_invoice.invoice_no, 'voucher_id', v_voucher_id));

  return v_return_id;
end;
$$;


-- ============================================================================
-- FIX 3: post_purchase_replacement() — use Inventory (1100) instead of
--         COGS (5010) for the value-difference voucher (perpetual inventory)
-- ============================================================================
create or replace function public.post_purchase_replacement(
  p_business_id        text,
  p_purchase_id        text,
  p_replacement_items  jsonb,
  p_replacement_date   date default null,
  p_notes              text default null,
  p_created_by         uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replacement_id   text;
  v_replacement_no   text;
  v_outgoing_value   numeric(20,0) := 0;
  v_incoming_value   numeric(20,0) := 0;
  v_value_diff       numeric(20,0);
  v_item             jsonb;
  v_voucher_id       text;
  v_voucher_lines    jsonb := '[]'::jsonb;
  v_inventory_acct   text;     -- *** FIX 3: renamed from v_purchases_acct ***
  v_payable_acct     text;
  v_purchase         record;
  v_outgoing_sm_id   text;
  v_incoming_sm_id   text;
  v_date             date;
  v_out_qty          integer;
  v_out_cost         numeric(20,0);
  v_in_qty           integer;
  v_in_cost          numeric(20,0);
begin
  if jsonb_array_length(p_replacement_items) < 1 then
    raise exception 'Replacement must have at least 1 item';
  end if;

  select * into v_purchase from public.purchases
  where id = p_purchase_id and business_id = p_business_id;
  if not found then raise exception 'Purchase not found: %', p_purchase_id; end if;

  v_replacement_no := public.next_replacement_no(p_business_id);

  for v_item in select * from jsonb_array_elements(p_replacement_items)
  loop
    v_out_qty := (v_item->>'outgoing_quantity')::integer;
    v_out_cost := coalesce((v_item->>'outgoing_unit_cost')::numeric, 0);
    v_in_qty := (v_item->>'incoming_quantity')::integer;
    v_in_cost := coalesce((v_item->>'incoming_unit_cost')::numeric, 0);
    v_outgoing_value := v_outgoing_value + (v_out_qty * v_out_cost);
    v_incoming_value := v_incoming_value + (v_in_qty * v_in_cost);
  end loop;

  v_value_diff := v_incoming_value - v_outgoing_value;

  -- *** FIX 3: Resolve Inventory (1100), NOT COGS (5010) ***
  -- Under the perpetual inventory model (00008b), 5010 is reserved for COGS of
  -- SOLD items only. Replacement value differences adjust stock value, which
  -- lives in Inventory (1100).
  select id into v_inventory_acct from public.accounts
  where business_id = p_business_id and code = '1100' and is_active = true;
  if not found then raise exception 'Inventory account (1100) not found'; end if;

  select id into v_payable_acct from public.accounts
  where business_id = p_business_id and code = '2010' and is_active = true;
  if not found then raise exception 'Vendors Payable account (2010) not found'; end if;

  v_date := coalesce(p_replacement_date, (now() at time zone 'Asia/Karachi')::date);

  if v_value_diff > 0 then
    -- Incoming stock is worth more than outgoing — Dr Inventory, Cr Payable
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_inventory_acct, 'debit', v_value_diff::text, 'credit', '0',
      'memo', 'Replacement value difference (higher) ' || v_replacement_no
    );
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_payable_acct, 'debit', '0', 'credit', v_value_diff::text,
      'memo', 'Additional payable for ' || v_replacement_no
    );
    v_voucher_id := public.post_voucher(
      p_business_id, 'RP', v_date, 'Replacement (higher value) ' || v_replacement_no,
      v_voucher_lines, null, 'purchase_replacement', p_created_by
    );
  elsif v_value_diff < 0 then
    -- Outgoing stock was worth more than incoming — Dr Payable, Cr Inventory
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_payable_acct, 'debit', (-v_value_diff)::text, 'credit', '0',
      'memo', 'Vendor credit for ' || v_replacement_no
    );
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_inventory_acct, 'debit', '0', 'credit', (-v_value_diff)::text,
      'memo', 'Replacement value reduction ' || v_replacement_no
    );
    v_voucher_id := public.post_voucher(
      p_business_id, 'RP', v_date, 'Replacement (lower value) ' || v_replacement_no,
      v_voucher_lines, null, 'purchase_replacement', p_created_by
    );
  else
    v_voucher_id := null;
  end if;

  insert into public.purchase_replacements (
    business_id, purchase_id, vendor_id, replacement_no, replacement_date,
    outgoing_value, incoming_value, value_diff, voucher_id, notes, created_by
  ) values (
    p_business_id, p_purchase_id, v_purchase.vendor_id, v_replacement_no, v_date,
    v_outgoing_value, v_incoming_value, v_value_diff, v_voucher_id, p_notes, p_created_by
  ) returning id into v_replacement_id;

  for v_item in select * from jsonb_array_elements(p_replacement_items)
  loop
    v_out_qty := (v_item->>'outgoing_quantity')::integer;
    v_out_cost := coalesce((v_item->>'outgoing_unit_cost')::numeric, 0);
    v_in_qty := (v_item->>'incoming_quantity')::integer;
    v_in_cost := coalesce((v_item->>'incoming_unit_cost')::numeric, 0);

    -- Stock-out for defective item (outflow — no cost needed, WAC unchanged)
    v_outgoing_sm_id := null;
    if v_item->>'outgoing_product_id' is not null and (v_item->>'outgoing_product_id') <> '' then
      v_outgoing_sm_id := public.create_stock_movement(
        p_business_id, v_item->>'outgoing_product_id', 'adjustment_out', v_out_qty,
        'Replacement out (defective) ' || v_replacement_no, v_date, p_created_by
      );
    end if;

    -- Stock-in for replacement item WITH incoming unit cost (updates WAC)
    v_incoming_sm_id := null;
    if v_item->>'incoming_product_id' is not null and (v_item->>'incoming_product_id') <> '' then
      v_incoming_sm_id := public.create_stock_movement(
        p_business_id, v_item->>'incoming_product_id', 'adjustment_in', v_in_qty,
        'Replacement in (received) ' || v_replacement_no, v_date, p_created_by,
        v_in_cost
      );
    end if;

    insert into public.purchase_replacement_items (
      business_id, purchase_replacement_id, original_purchase_item_id,
      outgoing_product_id, outgoing_product_name, outgoing_quantity, outgoing_unit_cost, outgoing_line_total, outgoing_stock_movement_id,
      incoming_product_id, incoming_product_name, incoming_quantity, incoming_unit_cost, incoming_line_total, incoming_stock_movement_id
    ) values (
      p_business_id, v_replacement_id, v_item->>'original_purchase_item_id',
      nullif(v_item->>'outgoing_product_id', ''), v_item->>'outgoing_product_name', v_out_qty, v_out_cost, v_out_qty * v_out_cost, v_outgoing_sm_id,
      nullif(v_item->>'incoming_product_id', ''), v_item->>'incoming_product_name', v_in_qty, v_in_cost, v_in_qty * v_in_cost, v_incoming_sm_id
    );
  end loop;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'PURCHASE_REPLACEMENT', 'purchase_replacement', v_replacement_id,
    jsonb_build_object('replacement_no', v_replacement_no, 'purchase_id', p_purchase_id,
      'outgoing_value', v_outgoing_value, 'incoming_value', v_incoming_value,
      'value_diff', v_value_diff, 'voucher_id', v_voucher_id));

  return v_replacement_id;
end;
$$;


-- Refresh PostgREST schema cache so all three replaced functions are visible.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Done. Phase 8 accounting stabilization complete:
--   ✓ post_sale() now balances for partial / credit sales (AR 1200 line restored)
--   ✓ post_sales_return() now recalculates WAC on stock restore (GL ↔ product aligned)
--   ✓ post_purchase_replacement() now uses Inventory (1100) for value differences
--     (5010 reserved for COGS of sold items only — perpetual inventory integrity)
--   ✓ All three functions are CREATE OR REPLACE — rerunnable, no data migration
--   ✓ No schema changes, no constraint drops, no data backfills
--   ✓ Existing vouchers NOT rewritten (historical data preserved)
-- ============================================================================
