-- ============================================================================
-- KhataPro ERP — Phase 4.1 Fix: Partial Payment Voucher Balancing + Return Fix
--
-- Two fixes:
-- 1. post_sale(): When paid < total, debit outstanding to Customers
--    Receivable (1200) so the voucher balances.
-- 2. post_sales_return(): Use separate rowtype variables for invoice_items
--    and payment_allocations loops (was causing type mismatch error).
--
-- This is CREATE OR REPLACE — safe to run after 00004.
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
  v_change        numeric(20,0) := 0;
  v_item          jsonb;
  v_payment       jsonb;
  v_line_total    numeric(20,0);
  v_qty           integer;
  v_unit_price    numeric(20,0);
  v_product_id    text;
  v_voucher_id    text;
  v_voucher_lines jsonb := '[]'::jsonb;
  v_sales_account text;
  v_ar_account    text;
  v_outstanding   numeric(20,0);
  v_stock_sm_id   text;
  v_alloc_id      text;
  v_comm_pct      numeric(5,2);
  v_comm_amount   numeric(20,0);
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
    if coalesce((v_payment->>'is_change')::boolean, false) then
      v_change := v_change + coalesce((v_payment->>'amount')::numeric, 0);
    else
      v_paid := v_paid + coalesce((v_payment->>'amount')::numeric, 0);
    end if;
  end loop;

  select id into v_sales_account
  from public.accounts
  where business_id = p_business_id and code = '4010' and is_active = true;
  if not found then
    raise exception 'Sales account (4010) not found';
  end if;

  -- Find Customers Receivable (1200) for partial payments.
  select id into v_ar_account
  from public.accounts
  where business_id = p_business_id and code = '1200' and is_active = true;

  -- Credit Sales by total.
  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', v_sales_account,
    'debit', '0',
    'credit', v_total::text,
    'memo', 'Sale ' || v_invoice_no
  );

  -- Debit each payment account (non-change).
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

  -- Credit change accounts.
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

  -- Partial payment: debit outstanding to AR (1200).
  v_outstanding := v_total - v_paid + v_change;
  if v_outstanding > 0 and v_ar_account is not null then
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_ar_account,
      'debit', v_outstanding::text,
      'credit', '0',
      'memo', 'Outstanding ' || v_invoice_no
    );
  end if;

  v_voucher_id := public.post_voucher(
    p_business_id, 'SI', p_invoice_date, p_memo, v_voucher_lines, null, null, p_created_by
  );

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

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::integer;
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_total := v_qty * v_unit_price;
    v_product_id := v_item->>'product_id';

    v_stock_sm_id := null;
    if v_product_id is not null and v_product_id <> '' then
      v_stock_sm_id := public.create_stock_movement(
        p_business_id, v_product_id, 'adjustment_out', v_qty,
        'Sale ' || v_invoice_no, p_invoice_date, p_created_by
      );
    end if;

    insert into public.invoice_items (
      business_id, invoice_id, product_id, product_name, qty, unit_price,
      line_total, is_temporary, stock_movement_id
    ) values (
      p_business_id, v_invoice_id, v_product_id,
      v_item->>'product_name',
      v_qty, v_unit_price, v_line_total,
      coalesce((v_item->>'is_temporary')::boolean, false),
      v_stock_sm_id
    );
  end loop;

  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if not coalesce((v_payment->>'is_change')::boolean, false) then
      insert into public.payment_allocations (
        business_id, invoice_id, account_id, amount, is_change, voucher_id, created_by
      ) values (
        p_business_id, v_invoice_id,
        v_payment->>'account_id',
        coalesce((v_payment->>'amount')::numeric, 0),
        false, v_voucher_id, p_created_by
      ) returning id into v_alloc_id;

      if p_salesman_id is not null and coalesce((v_payment->>'amount')::numeric, 0) > 0 then
        select commission_pct into v_comm_pct
        from public.salesmen
        where id = p_salesman_id and business_id = p_business_id;
        if found then
          v_comm_amount := round(coalesce((v_payment->>'amount')::numeric, 0) * v_comm_pct / 100);
          insert into public.salesman_commissions (
            business_id, salesman_id, invoice_id, allocation_id,
            collected_amount, commission_pct, commission_amount
          ) values (
            p_business_id, p_salesman_id, v_invoice_id, v_alloc_id,
            coalesce((v_payment->>'amount')::numeric, 0),
            v_comm_pct, v_comm_amount
          ) on conflict (allocation_id, salesman_id) do nothing;
        end if;
      end if;
    end if;
  end loop;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'POST_SALE', 'invoice', v_invoice_id,
    jsonb_build_object(
      'invoice_no', v_invoice_no, 'invoice_type', p_invoice_type,
      'total', v_total, 'paid', v_paid, 'change', v_change,
      'outstanding', v_outstanding, 'voucher_id', v_voucher_id
    ));

  return v_invoice_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Fix post_sales_return(): use separate rowtype variables.
-- ----------------------------------------------------------------------------
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
  v_invoice       public.invoices%rowtype;
  v_item_row      public.invoice_items%rowtype;
  v_alloc_row     public.payment_allocations%rowtype;
  v_voucher_id    text;
  v_voucher_lines jsonb := '[]'::jsonb;
  v_sales_account text;
  v_return_id     text;
  v_stock_sm_id   text;
begin
  select * into v_invoice from public.invoices
  where id = p_invoice_id and business_id = p_business_id;

  if not found then
    raise exception 'Invoice not found: %', p_invoice_id;
  end if;

  if v_invoice.is_returned then
    raise exception 'Invoice already returned';
  end if;

  select id into v_sales_account
  from public.accounts
  where business_id = p_business_id and code = '4010';
  if not found then
    raise exception 'Sales account (4010) not found';
  end if;

  -- Debit Sales (reverse the original credit).
  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', v_sales_account,
    'debit', v_invoice.total::text,
    'credit', '0',
    'memo', 'Sales return reversal: ' || v_invoice.invoice_no
  );

  -- Credit each original payment account.
  for v_alloc_row in
    select * from public.payment_allocations
    where invoice_id = p_invoice_id and is_change = false
  loop
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_alloc_row.account_id,
      'debit', '0',
      'credit', v_alloc_row.amount::text,
      'memo', 'Return refund: ' || v_invoice.invoice_no
    );
  end loop;

  v_voucher_id := public.post_voucher(
    p_business_id, 'SR', p_return_date,
    'Return: ' || v_invoice.invoice_no,
    v_voucher_lines, p_invoice_id, 'sales_return', p_created_by
  );

  -- Restore stock.
  for v_item_row in select * from public.invoice_items where invoice_id = p_invoice_id
  loop
    if v_item_row.product_id is not null then
      v_stock_sm_id := public.create_stock_movement(
        p_business_id, v_item_row.product_id, 'adjustment_in',
        v_item_row.qty, 'Return: ' || v_invoice.invoice_no,
        p_return_date, p_created_by
      );
    end if;
  end loop;

  insert into public.sales_returns (
    business_id, original_invoice_id, return_voucher_id, return_date, total, reason, created_by
  ) values (
    p_business_id, p_invoice_id, v_voucher_id, p_return_date, v_invoice.total, p_reason, p_created_by
  ) returning id into v_return_id;

  update public.invoices
  set is_returned = true, return_voucher_id = v_voucher_id, updated_at = now()
  where id = p_invoice_id;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'POST_SALES_RETURN', 'invoice', p_invoice_id,
    jsonb_build_object('return_id', v_return_id, 'voucher_id', v_voucher_id, 'reason', p_reason));

  return v_return_id;
end;
$$;
