-- ============================================================================
-- KhataPro ERP — Fix: Pass unit cost to create_stock_movement in purchase RPCs
--
-- Bug: post_purchase() and post_purchase_replacement() call create_stock_movement()
--      without p_unit_cost_paisas, so weighted-average cost is not updated for
--      real purchase stock-in movements.
--
-- Fix: Update both RPCs to pass the purchase unit cost (in paisas) to
--      create_stock_movement() for all stock-IN movements.
--      Stock-OUT movements (returns, defective outflow) don't need cost —
--      WAC is unchanged on outflow.
--
-- unit_cost in purchase_items is ALREADY in paisas (numeric(20,0)).
-- No conversion needed — pass directly as p_unit_cost_paisas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- post_purchase() — updated to pass v_unit_cost as p_unit_cost_paisas
-- ----------------------------------------------------------------------------
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
  v_purchases_acct text;
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

  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', v_purchases_acct,
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

  -- Insert items + create stock-in movements WITH unit cost.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    v_unit_cost := coalesce((v_item->>'unit_cost_paisas')::numeric, 0);
    v_line_total := v_qty * v_unit_cost;
    v_product_id := v_item->>'product_id';

    v_stock_sm_id := null;
    if v_product_id is not null and v_product_id <> '' then
      -- *** FIX: Pass v_unit_cost as p_unit_cost_paisas ***
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

-- ----------------------------------------------------------------------------
-- post_purchase_replacement() — updated to pass incoming unit cost as p_unit_cost_paisas
-- ----------------------------------------------------------------------------
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
  v_purchases_acct   text;
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

  select id into v_purchases_acct from public.accounts
  where business_id = p_business_id and code = '5010' and is_active = true;
  if not found then raise exception 'Purchases account (5010) not found'; end if;

  select id into v_payable_acct from public.accounts
  where business_id = p_business_id and code = '2010' and is_active = true;
  if not found then raise exception 'Vendors Payable account (2010) not found'; end if;

  v_date := coalesce(p_replacement_date, (now() at time zone 'Asia/Karachi')::date);

  if v_value_diff > 0 then
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_purchases_acct, 'debit', v_value_diff::text, 'credit', '0',
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
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_payable_acct, 'debit', (-v_value_diff)::text, 'credit', '0',
      'memo', 'Vendor credit for ' || v_replacement_no
    );
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_purchases_acct, 'debit', '0', 'credit', (-v_value_diff)::text,
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

    -- *** FIX: Stock-in for replacement item WITH incoming unit cost ***
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

-- Refresh PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Done. post_purchase() and post_purchase_replacement() now pass unit cost
-- to create_stock_movement() for all stock-IN movements.
--   ✓ Purchase stock-in updates weighted_average_cost
--   ✓ Replacement stock-in updates weighted_average_cost
--   ✓ Purchase return stock-out does NOT change WAC (outflow — correct)
--   ✓ Replacement stock-out does NOT change WAC (outflow — correct)
--   ✓ unit_cost is already in paisas — no conversion needed
--   ✓ Sale price is never touched
-- ============================================================================
