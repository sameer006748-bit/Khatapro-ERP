-- ============================================================================
-- KhataPro ERP — Fix: post_sales_return() v_items type mismatch
-- Bug: v_items is typed as public.invoice_items%rowtype but also used in
--      a loop over public.payment_allocations. The payment_allocations table
--      has different columns (no qty column, has amount instead), causing
--      "invalid input syntax for type integer" error.
-- Fix: Use separate variables for invoice_items and payment_allocations loops.
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

  -- Restore stock
  for v_inv_item in select * from public.invoice_items where invoice_id = p_invoice_id
  loop
    if v_inv_item.product_id is not null then
      v_stock_sm_id := public.create_stock_movement(
        p_business_id, v_inv_item.product_id, 'adjustment_in', v_inv_item.qty,
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

NOTIFY pgrst, 'reload schema';
