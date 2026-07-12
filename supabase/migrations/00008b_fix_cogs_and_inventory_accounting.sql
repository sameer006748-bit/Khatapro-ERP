-- ============================================================================
-- KhataPro ERP — Fix: Convert from periodic to perpetual inventory model
--
-- BUG: post_purchase() debited 5010 (Purchases/COGS) instead of 1100 (Inventory).
--      post_sale() never posted COGS (Dr COGS, Cr Inventory).
--      This made P&L show ALL purchases as COGS, not just sold items.
--
-- FIX: Convert to perpetual inventory:
--   1. post_purchase() → Dr Inventory (1100), not 5010
--   2. post_sale() → Add COGS lines: Dr 5010 (COGS), Cr 1100 (Inventory) using WAC × qty
--   3. post_sales_return() → Reverse COGS: Dr 1100, Cr 5010
--   4. post_purchase_return() → Credit Inventory (1100), not 5010
--   5. Add unit_cost_paisas to invoice_items for sale-time cost capture
--
-- HISTORICAL DATA POLICY:
--   - Existing posted vouchers are NOT rewritten
--   - Historical P&L before this migration will show inflated COGS
--   - A report warning should be shown for periods before migration
--   - New transactions from this point forward use correct perpetual model
--
-- Account mapping after migration:
--   1100 Inventory  → Asset, holds stock value (Dr on purchase, Cr on sale, Dr on return)
--   5010 COGS       → Expense, holds cost of goods sold (Dr on sale, Cr on return)
-- ============================================================================

-- Add sale-time cost to invoice_items
alter table public.invoice_items
  add column if not exists unit_cost_paisas numeric(20,0) default 0;

-- ============================================================================
-- Updated post_purchase() — Debit Inventory (1100) instead of 5010
-- ============================================================================
create or replace function public.post_purchase(
  p_business_id     text,
  p_vendor_id       text,
  p_purchase_date   date,
  p_supplier_bill_no text default null,
  p_items           jsonb default '[]'::jsonb,
  p_payments        jsonb default '[]'::jsonb,
  p_discount_paisas numeric(20,0) default 0,
  p_additional_charges_paisas numeric(20,0) default 0,
  p_notes           text default null,
  p_created_by      uuid default null
)
returns text
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
  v_inventory_acct text;
  v_payable_acct   text;
  v_vendor         record;
  v_stock_sm_id    text;
  v_pp_id          text;
  v_status         text;
begin
  if jsonb_array_length(p_items) < 1 then
    raise exception 'Purchase must have at least 1 item';
  end if;

  select * into v_vendor from public.vendors
  where id = p_vendor_id and business_id = p_business_id and is_active = true;
  if not found then
    raise exception 'Invalid or inactive vendor: %', p_vendor_id;
  end if;

  v_purchase_no := public.next_purchase_no(p_business_id);

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    v_unit_cost := coalesce((v_item->>'unit_cost_paisas')::numeric, 0);
    v_line_total := v_qty * v_unit_cost;
    v_subtotal := v_subtotal + v_line_total;
  end loop;

  v_total := v_subtotal - p_discount_paisas + p_additional_charges_paisas;

  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if coalesce((v_payment->>'payment_type')::text, 'purchase_payment') <> 'credit' then
      v_paid := v_paid + coalesce((v_payment->>'amount_paisas')::numeric, 0);
    end if;
  end loop;

  v_outstanding := v_total - v_paid;

  if v_outstanding <= 0 then
    v_status := 'paid';
  elsif v_paid > 0 then
    v_status := 'partially_paid';
  else
    v_status := 'posted';
  end if;

  -- *** FIX: Use Inventory (1100) instead of Purchases/COGS (5010) ***
  select id into v_inventory_acct from public.accounts
  where business_id = p_business_id and code = '1100' and is_active = true;
  if not found then
    raise exception 'Inventory account (1100) not found';
  end if;

  select id into v_payable_acct from public.accounts
  where business_id = p_business_id and code = '2010' and is_active = true;
  if not found then
    raise exception 'Vendors Payable account (2010) not found';
  end if;

  -- Dr Inventory (not COGS)
  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', v_inventory_acct,
    'debit', v_total::text,
    'credit', '0',
    'memo', 'Purchase ' || v_purchase_no
  );

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

  if v_outstanding > 0 then
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_payable_acct,
      'debit', '0',
      'credit', v_outstanding::text,
      'memo', 'Payable for ' || v_purchase_no
    );
  end if;

  v_voucher_id := public.post_voucher(
    p_business_id, 'PU', p_purchase_date,
    'Purchase ' || v_purchase_no, v_voucher_lines,
    null, null, p_created_by
  );

  insert into public.purchases (
    business_id, purchase_no, vendor_id, supplier_bill_no, purchase_date,
    subtotal, discount, additional_charges, total, paid_amount, outstanding_amount,
    status, notes, voucher_id, created_by
  ) values (
    p_business_id, v_purchase_no, p_vendor_id, p_supplier_bill_no, p_purchase_date,
    v_subtotal, p_discount_paisas, p_additional_charges_paisas, v_total, v_paid, v_outstanding,
    v_status, p_notes, v_voucher_id, p_created_by
  ) returning id into v_purchase_id;

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
        'Purchase ' || v_purchase_no, p_purchase_date, p_created_by,
        v_unit_cost
      );
    end if;

    insert into public.purchase_items (
      business_id, purchase_id, product_id, product_name, quantity, unit_cost, line_total, stock_movement_id
    ) values (
      p_business_id, v_purchase_id, v_product_id,
      v_item->>'product_name', v_qty, v_unit_cost, v_line_total, v_stock_sm_id
    );
  end loop;

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

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'POST_PURCHASE', 'purchase', v_purchase_id,
    jsonb_build_object('purchase_no', v_purchase_no, 'total', v_total, 'paid', v_paid, 'outstanding', v_outstanding, 'voucher_id', v_voucher_id));

  return v_purchase_id;
end;
$$;

-- ============================================================================
-- Updated post_sale() — Add COGS lines (Dr COGS, Cr Inventory) using WAC
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

  -- *** NEW: Resolve COGS (5010) and Inventory (1100) accounts ***
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

  -- *** NEW: COGS lines for each non-temporary product item ***
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

  -- Commission
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
    jsonb_build_object('invoice_no', v_invoice_no, 'type', p_invoice_type, 'total', v_total, 'cogs', v_total_cogs));

  return v_invoice_id;
end;
$$;

-- ============================================================================
-- Updated post_sales_return() — Reverse COGS (Dr Inventory, Cr COGS)
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
  v_items       public.invoice_items%rowtype;
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

  -- *** NEW: Resolve COGS and Inventory accounts ***
  select id into v_cogs_account from public.accounts
  where business_id = p_business_id and code = '5010' and is_active = true;
  if not found then raise exception 'COGS account (5010) not found'; end if;

  select id into v_inventory_acct from public.accounts
  where business_id = p_business_id and code = '1100' and is_active = true;
  if not found then raise exception 'Inventory account (1100) not found'; end if;

  -- Reverse Sales: Dr Sales, Cr payment accounts
  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', v_sales_account,
    'debit', v_invoice.total::text,
    'credit', '0',
    'memo', 'Sales return reversal: ' || v_invoice.invoice_no
  );

  -- Reverse payment allocations
  for v_items in select * from public.payment_allocations where invoice_id = p_invoice_id and is_change = false
  loop
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_items.account_id,
      'debit', '0',
      'credit', v_items.amount::text,
      'memo', 'Return refund: ' || v_invoice.invoice_no
    );
  end loop;

  -- *** NEW: Reverse COGS for each non-temporary item ***
  for v_items in select * from public.invoice_items where invoice_id = p_invoice_id
  loop
    if v_items.product_id is not null and not v_items.is_temporary then
      -- Use the original sale-time cost captured in unit_cost_paisas
      v_item_cogs := v_items.qty * coalesce(v_items.unit_cost_paisas, 0);
      if v_item_cogs > 0 then
        -- Dr Inventory (restore stock value)
        v_voucher_lines := v_voucher_lines || jsonb_build_object(
          'account_id', v_inventory_acct,
          'debit', v_item_cogs::text,
          'credit', '0',
          'memo', 'Return stock restore: ' || v_items.product_name
        );
        -- Cr COGS (reverse the cost)
        v_voucher_lines := v_voucher_lines || jsonb_build_object(
          'account_id', v_cogs_account,
          'debit', '0',
          'credit', v_item_cogs::text,
          'memo', 'Return COGS reversal: ' || v_items.product_name
        );
      end if;
    end if;
  end loop;

  v_voucher_id := public.post_voucher(
    p_business_id, 'SR', p_return_date,
    'Return: ' || v_invoice.invoice_no, v_voucher_lines,
    p_invoice_id, 'sales_return', p_created_by
  );

  -- Restore stock
  for v_items in select * from public.invoice_items where invoice_id = p_invoice_id
  loop
    if v_items.product_id is not null then
      v_stock_sm_id := public.create_stock_movement(
        p_business_id, v_items.product_id, 'adjustment_in', v_items.qty,
        'Return: ' || v_invoice.invoice_no, p_return_date, p_created_by
      );
    end if;
  end loop;

  insert into public.sales_returns (business_id, invoice_id, return_date, total_amount, reason, voucher_id, created_by)
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
-- Updated post_purchase_return() — Credit Inventory (1100) instead of COGS
-- ============================================================================
create or replace function public.post_purchase_return(
  p_business_id        text,
  p_purchase_id        text,
  p_return_items       jsonb,
  p_settlement_type    text default 'reduce_payable',
  p_settlement_account_id text default null,
  p_return_date        date default null,
  p_notes              text default null,
  p_created_by         uuid default null
)
returns text
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
  v_inventory_acct text;
  v_payable_acct   text;
  v_purchase     record;
  v_stock_sm_id  text;
  v_date         date;
begin
  select * into v_purchase from public.purchases
  where id = p_purchase_id and business_id = p_business_id;
  if not found then raise exception 'Purchase not found: %', p_purchase_id; end if;

  v_return_no := public.next_purchase_return_no(p_business_id);

  for v_item in select * from jsonb_array_elements(p_return_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    v_unit_cost := coalesce((v_item->>'unit_cost_paisas')::numeric, 0);
    v_line_total := v_qty * v_unit_cost;
    v_total := v_total + v_line_total;
  end loop;

  -- *** FIX: Use Inventory (1100) instead of COGS (5010) ***
  select id into v_inventory_acct from public.accounts
  where business_id = p_business_id and code = '1100' and is_active = true;
  if not found then raise exception 'Inventory account (1100) not found'; end if;

  select id into v_payable_acct from public.accounts
  where business_id = p_business_id and code = '2010' and is_active = true;
  if not found then raise exception 'Vendors Payable account (2010) not found'; end if;

  v_date := coalesce(p_return_date, (now() at time zone 'Asia/Karachi')::date);

  -- Credit Inventory (not COGS)
  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', v_inventory_acct, 'debit', '0', 'credit', v_total::text,
    'memo', 'Purchase return ' || v_return_no
  );

  if p_settlement_type = 'reduce_payable' then
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_payable_acct, 'debit', v_total::text, 'credit', '0',
      'memo', 'Return reduces payable ' || v_return_no
    );
  elsif p_settlement_type = 'vendor_refund' then
    if p_settlement_account_id is null then
      raise exception 'Settlement account required for vendor_refund';
    end if;
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', p_settlement_account_id, 'debit', v_total::text, 'credit', '0',
      'memo', 'Vendor refund ' || v_return_no
    );
  else
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_payable_acct, 'debit', v_total::text, 'credit', '0',
      'memo', 'Vendor credit ' || v_return_no
    );
  end if;

  v_voucher_id := public.post_voucher(
    p_business_id, 'PR', v_date, 'Purchase return ' || v_return_no,
    v_voucher_lines, p_purchase_id, 'purchase_return', p_created_by
  );

  insert into public.purchase_returns (
    business_id, purchase_id, vendor_id, return_no, return_date, total_amount,
    settlement_type, settlement_account_id, voucher_id, notes, created_by
  ) values (
    p_business_id, p_purchase_id, v_purchase.vendor_id, v_return_no, v_date, v_total,
    p_settlement_type, p_settlement_account_id, v_voucher_id, p_notes, p_created_by
  ) returning id into v_return_id;

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

    update public.purchase_items
    set returned_quantity = returned_quantity + v_qty
    where id = v_item->>'purchase_item_id';
  end loop;

  if v_total >= v_purchase.total then
    update public.purchases set status = 'returned', updated_at = now() where id = p_purchase_id;
  else
    update public.purchases set status = 'partially_returned', updated_at = now() where id = p_purchase_id;
  end if;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'PURCHASE_RETURN', 'purchase_return', v_return_id,
    jsonb_build_object('return_no', v_return_no, 'purchase_id', p_purchase_id, 'total', v_total, 'voucher_id', v_voucher_id));

  return v_return_id;
end;
$$;

-- ============================================================================
-- Updated report_profit_loss() — 5010 is now true COGS (only sold items)
-- No change needed — the RPC already reads from voucher_lines.
-- After migration, 5010 will only contain COGS from sales, not all purchases.
-- ============================================================================

-- Add comment to document the change
comment on table public.invoice_items is 'Now includes unit_cost_paisas for sale-time WAC capture (Phase 8b migration)';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Done. Perpetual inventory model is now active:
--   ✓ post_purchase() debits Inventory (1100), not COGS (5010)
--   ✓ post_sale() posts COGS: Dr 5010, Cr 1100 using WAC × qty
--   ✓ post_sales_return() reverses COGS: Dr 1100, Cr 5010 using original cost
--   ✓ post_purchase_return() credits Inventory (1100), not COGS (5010)
--   ✓ invoice_items.unit_cost_paisas captures sale-time WAC
--   ✓ Historical vouchers NOT rewritten (periodic model data preserved)
--   ✓ P&L will show correct COGS for new transactions
--   ✓ Historical P&L before migration will show inflated COGS (warning needed)
-- ============================================================================
