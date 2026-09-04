-- Atomic canonical-ledger wrappers for production-verified UUID workflows.
-- The existing operational RPC and the ledger voucher execute in the same
-- PostgreSQL transaction. No historical rows are backfilled.
begin;

do $$
declare
  v_missing_signatures text;
  v_wrong_returns text;
begin
  if to_regclass('public.invoices') is null
     or to_regclass('public.invoice_items') is null
     or to_regclass('public.sale_return_documents') is null
     or to_regclass('public.payments') is null
     or to_regclass('public.rider_cash_ledger') is null
     or to_regclass('public.products') is null
     or to_regclass('public.stock_movements') is null
     or to_regclass('public.commission_events') is null
     or to_regprocedure(
       'public.post_ledger_voucher(uuid,text,date,text,jsonb,text,text,text,uuid,text,text,uuid)'
     ) is null then
    raise exception 'Verified workflow integration requires production Phase 1-3 tables and migrations 00025-00030';
  end if;

  select string_agg(signature, ', ' order by signature)
    into v_missing_signatures
  from (values
    ('public.post_sale_phase2(uuid,text,date,jsonb,jsonb,uuid,text,text,text,text,text,text,uuid,text)', 'text'),
    ('public.post_sale_return(uuid,text,jsonb,text,text,text)', 'jsonb'),
    ('public.receive_invoice_payment(uuid,text,numeric,text,text)', 'jsonb'),
    ('public.record_delivery_outcome(uuid,text,jsonb,numeric,text,text,uuid)', 'jsonb'),
    ('public.settle_rider_cod(uuid,uuid,numeric,text,text,text)', 'jsonb'),
    ('public.create_stock_movement(text,text,text,integer,text,date,uuid,numeric)', 'text')
  ) expected(signature, return_type)
  where to_regprocedure(signature) is null;
  if v_missing_signatures is not null then
    raise exception 'Verified workflow RPC signatures are missing: %', v_missing_signatures;
  end if;

  select string_agg(
           signature || ' expected ' || return_type || ' but found '
             || pg_get_function_result(to_regprocedure(signature)),
           ', ' order by signature
         )
    into v_wrong_returns
  from (values
    ('public.post_sale_phase2(uuid,text,date,jsonb,jsonb,uuid,text,text,text,text,text,text,uuid,text)', 'text'),
    ('public.post_sale_return(uuid,text,jsonb,text,text,text)', 'jsonb'),
    ('public.receive_invoice_payment(uuid,text,numeric,text,text)', 'jsonb'),
    ('public.record_delivery_outcome(uuid,text,jsonb,numeric,text,text,uuid)', 'jsonb'),
    ('public.settle_rider_cod(uuid,uuid,numeric,text,text,text)', 'jsonb'),
    ('public.create_stock_movement(text,text,text,integer,text,date,uuid,numeric)', 'text')
  ) expected(signature, return_type)
  where pg_get_function_result(to_regprocedure(signature)) <> return_type;
  if v_wrong_returns is not null then
    raise exception 'Verified workflow RPC return types do not match: %', v_wrong_returns;
  end if;
end $$;

create or replace function public.post_sale_return_document_to_ledger(
  p_business_id uuid,
  p_return_id uuid,
  p_refund_mode text,
  p_idempotency_key text,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_return public.sale_return_documents%rowtype;
  v_cost numeric(20,0);
  v_lines jsonb;
  v_counterpart uuid;
  v_commission_delta numeric(20,0);
begin
  select * into v_return
  from public.sale_return_documents
  where id = p_return_id and business_id = p_business_id;
  if not found then raise exception 'Sale return document not found'; end if;

  select coalesce(sum(
    coalesce(ii.unit_cost_paisas, 0) * line.returned_qty
  ), 0) into v_cost
  from public.sale_return_lines line
  join public.invoice_items ii on ii.id = line.original_invoice_item_id
  where line.business_id = p_business_id and line.sale_return_id = p_return_id;

  v_counterpart := case upper(coalesce(p_refund_mode, 'CREDIT'))
    when 'CASH' then public.ledger_account_id_by_code(p_business_id, '1010')
    when 'BANK' then public.ledger_account_id_by_code(p_business_id, '1020')
    else public.ledger_account_id_by_code(p_business_id, '1200')
  end;
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', public.ledger_account_id_by_code(p_business_id, '4000'),
      'debit_paisas', v_return.total, 'credit_paisas', 0,
      'line_narration', 'Sales return ' || v_return.return_no
    ),
    jsonb_build_object(
      'account_id', v_counterpart,
      'debit_paisas', 0, 'credit_paisas', v_return.total,
      'line_narration', case
        when upper(coalesce(p_refund_mode, 'CREDIT')) in ('CASH', 'BANK')
          then 'Customer refund'
        else 'Customer credit'
      end
    )
  );
  if v_cost > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', public.ledger_account_id_by_code(p_business_id, '1100'),
        'debit_paisas', v_cost, 'credit_paisas', 0,
        'line_narration', 'Returned inventory at sale-time cost'
      ),
      jsonb_build_object(
        'account_id', public.ledger_account_id_by_code(p_business_id, '5000'),
        'debit_paisas', 0, 'credit_paisas', v_cost,
        'line_narration', 'COGS reversal'
      )
    );
  end if;

  select coalesce(-sum(payable_amount), 0) into v_commission_delta
  from public.commission_events
  where business_id = p_business_id
    and return_event_id = p_return_id::text
    and event_type = 'return_adjustment'
    and payable_amount < 0;
  if v_commission_delta > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', public.ledger_account_id_by_code(p_business_id, '2030'),
        'debit_paisas', v_commission_delta, 'credit_paisas', 0,
        'line_narration', 'Commission payable reversal'
      ),
      jsonb_build_object(
        'account_id', public.ledger_account_id_by_code(p_business_id, '6010'),
        'debit_paisas', 0, 'credit_paisas', v_commission_delta,
        'line_narration', 'Commission expense reversal'
      )
    );
  end if;

  return public.post_ledger_voucher(
    p_business_id, 'SR', v_return.return_date::date,
    'Sale return ' || v_return.return_no, v_lines,
    'sale_return', p_return_id::text, p_idempotency_key, p_actor_id,
    v_return.return_no, v_return.return_no, null
  );
end $$;

create or replace function public.post_sale_phase2_ledger(
  p_business_id uuid,
  p_invoice_type text,
  p_invoice_date date,
  p_items jsonb,
  p_payments jsonb,
  p_salesman_id uuid,
  p_customer_id text,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_customer_city text,
  p_memo text,
  p_created_by uuid,
  p_idempotency_key text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice_id text;
  v_invoice public.invoices%rowtype;
  v_payment jsonb;
  v_payment_account uuid;
  v_amount numeric(20,0);
  v_paid numeric(20,0) := 0;
  v_change numeric(20,0) := 0;
  v_outstanding numeric(20,0);
  v_cost numeric(20,0);
  v_commission numeric(20,0);
  v_lines jsonb := '[]'::jsonb;
begin
  v_invoice_id := public.post_sale_phase2(
    p_business_id, p_invoice_type, p_invoice_date, p_items, p_payments,
    p_salesman_id, p_customer_id, p_customer_name, p_customer_phone,
    p_customer_address, p_customer_city, p_memo, p_created_by,
    p_idempotency_key
  );
  select * into v_invoice
  from public.invoices
  where business_id = p_business_id and id = v_invoice_id;
  if not found then raise exception 'Posted sale cannot be reloaded'; end if;

  for v_payment in select value from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb))
  loop
    v_amount := coalesce((v_payment->>'amount')::numeric, 0);
    if v_amount <= 0 or v_amount <> trunc(v_amount) then
      raise exception 'Sale payments must be positive whole-paisa values';
    end if;
    select id into v_payment_account
    from public.ledger_accounts
    where business_id = p_business_id
      and id = (v_payment->>'account_id')::uuid
      and report_class = 'Asset'
      and is_active and is_postable;
    if v_payment_account is null then
      raise exception 'Sale payment account must be an active same-business ledger asset';
    end if;
    if coalesce((v_payment->>'is_change')::boolean, false) then
      v_change := v_change + v_amount;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', v_payment_account,
        'debit_paisas', 0, 'credit_paisas', v_amount,
        'line_narration', 'Change returned'
      ));
    else
      v_paid := v_paid + v_amount;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', v_payment_account,
        'debit_paisas', v_amount, 'credit_paisas', 0,
        'line_narration', 'Sale collection'
      ));
    end if;
  end loop;
  if v_paid - v_change <> coalesce(v_invoice.paid, 0) then
    raise exception 'Operational sale payment total does not match the invoice';
  end if;
  v_outstanding := v_invoice.total - v_paid + v_change;
  if v_outstanding < 0 then raise exception 'Sale overpayment is not balanced'; end if;
  if v_outstanding > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', public.ledger_account_id_by_code(p_business_id, '1200'),
      'debit_paisas', v_outstanding, 'credit_paisas', 0,
      'party_type', case when v_invoice.customer_id is null then null else 'customer' end,
      'party_id', v_invoice.customer_id,
      'line_narration', 'Customer receivable'
    ));
  end if;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'account_id', public.ledger_account_id_by_code(p_business_id, '4000'),
    'debit_paisas', 0, 'credit_paisas', v_invoice.total,
    'line_narration', 'Sales income'
  ));

  select coalesce(sum(coalesce(unit_cost_paisas, 0) * qty), 0)
    into v_cost
  from public.invoice_items
  where business_id = p_business_id and invoice_id = v_invoice_id;
  if v_cost > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', public.ledger_account_id_by_code(p_business_id, '5000'),
        'debit_paisas', v_cost, 'credit_paisas', 0,
        'line_narration', 'Cost of goods sold'
      ),
      jsonb_build_object(
        'account_id', public.ledger_account_id_by_code(p_business_id, '1100'),
        'debit_paisas', 0, 'credit_paisas', v_cost,
        'line_narration', 'Inventory issued'
      )
    );
  end if;

  select coalesce(sum(payable_amount), 0) into v_commission
  from public.commission_events
  where business_id = p_business_id and invoice_id = v_invoice_id
    and event_type = 'collection' and allocation_id = 'initial-sale';
  if v_commission > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', public.ledger_account_id_by_code(p_business_id, '6010'),
        'debit_paisas', v_commission, 'credit_paisas', 0,
        'line_narration', 'Collection-earned commission'
      ),
      jsonb_build_object(
        'account_id', public.ledger_account_id_by_code(p_business_id, '2030'),
        'debit_paisas', 0, 'credit_paisas', v_commission,
        'line_narration', 'Commission payable'
      )
    );
  end if;

  perform public.post_ledger_voucher(
    p_business_id, 'SI', v_invoice.invoice_date,
    coalesce(nullif(trim(p_memo), ''), 'Sale ' || v_invoice.invoice_no),
    v_lines, 'sale', v_invoice_id, 'sale:' || p_idempotency_key,
    p_created_by, v_invoice.invoice_no, v_invoice.invoice_no, null
  );
  return v_invoice_id;
end $$;

create or replace function public.post_sale_return_ledger(
  p_business_id uuid,
  p_original_invoice_id text,
  p_items jsonb,
  p_refund_mode text,
  p_reason text,
  p_idempotency_key text,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  v_result := public.post_sale_return(
    p_business_id, p_original_invoice_id, p_items, p_refund_mode,
    p_reason, p_idempotency_key
  );
  perform public.post_sale_return_document_to_ledger(
    p_business_id, (v_result->>'return_id')::uuid, p_refund_mode,
    'sale-return:' || p_idempotency_key, p_actor_id
  );
  return v_result;
end $$;

create or replace function public.receive_invoice_payment_ledger(
  p_business_id uuid,
  p_invoice_id text,
  p_amount numeric,
  p_mode text,
  p_idempotency_key text,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_payment_id text;
  v_commission numeric(20,0);
  v_lines jsonb;
  v_account_code text;
begin
  v_result := public.receive_invoice_payment(
    p_business_id, p_invoice_id, p_amount, p_mode, p_idempotency_key
  );
  v_payment_id := v_result->>'payment_id';
  v_account_code := case upper(coalesce(p_mode, 'CASH'))
    when 'BANK' then '1020'
    when 'WALLET' then '1030'
    else '1010'
  end;
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', public.ledger_account_id_by_code(p_business_id, v_account_code),
      'debit_paisas', p_amount, 'credit_paisas', 0,
      'line_narration', 'Invoice collection'
    ),
    jsonb_build_object(
      'account_id', public.ledger_account_id_by_code(p_business_id, '1200'),
      'debit_paisas', 0, 'credit_paisas', p_amount,
      'line_narration', 'Receivable settled'
    )
  );
  select coalesce(sum(payable_amount), 0) into v_commission
  from public.commission_events
  where business_id = p_business_id
    and allocation_id = v_payment_id
    and event_type = 'collection';
  if v_commission > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', public.ledger_account_id_by_code(p_business_id, '6010'),
        'debit_paisas', v_commission, 'credit_paisas', 0,
        'line_narration', 'Collection-earned commission'
      ),
      jsonb_build_object(
        'account_id', public.ledger_account_id_by_code(p_business_id, '2030'),
        'debit_paisas', 0, 'credit_paisas', v_commission,
        'line_narration', 'Commission payable'
      )
    );
  end if;
  perform public.post_ledger_voucher(
    p_business_id, 'RC', (now() at time zone 'Asia/Karachi')::date,
    'Invoice collection', v_lines, 'invoice_payment', v_payment_id,
    'invoice-payment:' || p_idempotency_key, p_actor_id,
    p_invoice_id, null, null
  );
  return v_result;
end $$;

create or replace function public.record_delivery_outcome_ledger(
  p_business_id uuid,
  p_invoice_id text,
  p_items jsonb,
  p_cash_collected numeric,
  p_reason text,
  p_idempotency_key text,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_result jsonb; v_lines jsonb;
begin
  v_result := public.record_delivery_outcome(
    p_business_id, p_invoice_id, p_items, p_cash_collected,
    p_reason, p_idempotency_key, p_actor_id
  );
  if v_result->>'sale_return_id' is not null then
    perform public.post_sale_return_document_to_ledger(
      p_business_id, (v_result->>'sale_return_id')::uuid, 'CREDIT',
      'delivery-return:' || p_idempotency_key, p_actor_id
    );
  end if;
  if p_cash_collected > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id', public.ledger_account_id_by_code(p_business_id, '1300'),
        'debit_paisas', p_cash_collected, 'credit_paisas', 0,
        'party_type', 'rider', 'party_id', v_result->>'batch_id',
        'line_narration', 'COD held by rider'
      ),
      jsonb_build_object(
        'account_id', public.ledger_account_id_by_code(p_business_id, '1200'),
        'debit_paisas', 0, 'credit_paisas', p_cash_collected,
        'line_narration', 'Delivered customer receivable collected'
      )
    );
    perform public.post_ledger_voucher(
      p_business_id, 'COD', (now() at time zone 'Asia/Karachi')::date,
      'Approved COD collection; no business cash receipt', v_lines,
      'delivery_outcome', v_result->>'batch_id',
      'delivery-outcome:' || p_idempotency_key, p_actor_id,
      v_result->>'outcome_no', null, null
    );
  end if;
  return v_result;
end $$;

create or replace function public.settle_rider_cod_ledger(
  p_business_id uuid,
  p_rider_id uuid,
  p_amount numeric,
  p_mode text,
  p_note text,
  p_idempotency_key text,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_lines jsonb;
  v_account_code text;
  v_commission numeric(20,0);
begin
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and business_id = p_business_id and status = 'Active'
  ) then
    raise exception 'Active settlement actor is required' using errcode = '42501';
  end if;
  v_result := public.settle_rider_cod(
    p_business_id, p_rider_id, p_amount, p_mode, p_note, p_idempotency_key
  );
  v_account_code := case upper(coalesce(p_mode, 'CASH'))
    when 'BANK' then '1020'
    when 'WALLET' then '1030'
    else '1010'
  end;
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', public.ledger_account_id_by_code(p_business_id, v_account_code),
      'debit_paisas', p_amount, 'credit_paisas', 0,
      'line_narration', 'Actual COD settlement received'
    ),
    jsonb_build_object(
      'account_id', public.ledger_account_id_by_code(p_business_id, '1300'),
      'debit_paisas', 0, 'credit_paisas', p_amount,
      'party_type', 'rider', 'party_id', p_rider_id,
      'line_narration', 'Rider-held COD cleared'
    )
  );
  select coalesce(sum(e.payable_amount), 0)
    into v_commission
  from public.commission_events e
  join public.payments p
    on p.business_id = e.business_id and p.id::text = e.allocation_id
  where e.business_id = p_business_id
    and e.event_type = 'collection'
    and p.idempotency_key like
        'phase3:payment:' || (v_result->>'batch_id') || ':%';
  if v_commission > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', public.ledger_account_id_by_code(p_business_id, '6010'),
        'debit_paisas', v_commission, 'credit_paisas', 0,
        'line_narration', 'COD settlement-earned commission'
      ),
      jsonb_build_object(
        'account_id', public.ledger_account_id_by_code(p_business_id, '2030'),
        'debit_paisas', 0, 'credit_paisas', v_commission,
        'line_narration', 'Commission payable'
      )
    );
  end if;
  perform public.post_ledger_voucher(
    p_business_id, 'COD', (now() at time zone 'Asia/Karachi')::date,
    'Rider COD settlement ' || coalesce(v_result->>'reference', ''),
    v_lines, 'rider_cod_settlement', v_result->>'batch_id',
    'rider-settlement:' || p_idempotency_key, p_actor_id,
    v_result->>'reference', v_result->>'reference', null
  );
  return v_result;
end $$;

create or replace function public.post_opening_stock_ledger(
  p_business_id uuid,
  p_product_id text,
  p_quantity integer,
  p_unit_cost_paisas numeric,
  p_created_by uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product_name text;
  v_movement_id text;
  v_value numeric(20,0);
  v_voucher jsonb;
  v_existing public.ledger_vouchers%rowtype;
  v_lines jsonb;
begin
  if p_quantity is null or p_quantity <= 0
     or p_unit_cost_paisas is null or p_unit_cost_paisas <= 0
     or p_unit_cost_paisas <> trunc(p_unit_cost_paisas) then
    raise exception 'Opening stock requires positive quantity and whole-paisa cost';
  end if;
  select name into v_product_name
  from public.products
  where business_id = p_business_id and id = p_product_id
  for update;
  if not found then raise exception 'Product does not belong to this business'; end if;
  v_value := p_quantity * p_unit_cost_paisas;
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', public.ledger_account_id_by_code(p_business_id, '1100'),
      'debit_paisas', v_value, 'credit_paisas', 0,
      'line_narration', 'Opening inventory'
    ),
    jsonb_build_object(
      'account_id', public.ledger_account_id_by_code(p_business_id, '3030'),
      'debit_paisas', 0, 'credit_paisas', v_value,
      'line_narration', 'Opening balance equity'
    )
  );
  select * into v_existing
  from public.ledger_vouchers
  where business_id = p_business_id
    and idempotency_key = 'opening-stock:' || p_idempotency_key;
  if found then
    v_voucher := public.post_ledger_voucher(
      p_business_id, 'OP', v_existing.transaction_date,
      'Opening stock: ' || v_product_name, v_lines,
      'opening_stock', v_existing.source_id,
      'opening-stock:' || p_idempotency_key, p_created_by,
      p_product_id, v_existing.readable_number, null
    );
    return jsonb_build_object(
      'movement_id', v_existing.source_id,
      'voucher_id', v_voucher->>'voucher_id',
      'quantity', p_quantity,
      'unit_cost_paisas', p_unit_cost_paisas,
      'value_paisas', v_value,
      'idempotent', true
    );
  end if;
  if exists (
    select 1 from public.stock_movements
    where business_id = p_business_id
      and product_id = p_product_id and movement_type = 'opening'
  ) then
    raise exception 'Product already has opening stock posted';
  end if;
  v_movement_id := public.create_stock_movement(
    p_business_id::text, p_product_id, 'opening', p_quantity,
    'Opening stock', (now() at time zone 'Asia/Karachi')::date,
    p_created_by, p_unit_cost_paisas
  );
  v_voucher := public.post_ledger_voucher(
    p_business_id, 'OP', (now() at time zone 'Asia/Karachi')::date,
    'Opening stock: ' || v_product_name,
    v_lines,
    'opening_stock', v_movement_id, 'opening-stock:' || p_idempotency_key,
    p_created_by, p_product_id, null, null
  );
  return jsonb_build_object(
    'movement_id', v_movement_id,
    'voucher_id', v_voucher->>'voucher_id',
    'quantity', p_quantity,
    'unit_cost_paisas', p_unit_cost_paisas,
    'value_paisas', v_value
  );
end $$;

revoke all on function public.post_sale_return_document_to_ledger(
  uuid, uuid, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.post_sale_phase2_ledger(
  uuid, text, date, jsonb, jsonb, uuid, text, text, text, text, text, text, uuid, text
) from public, anon, authenticated;
revoke all on function public.post_sale_return_ledger(
  uuid, text, jsonb, text, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.receive_invoice_payment_ledger(
  uuid, text, numeric, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.record_delivery_outcome_ledger(
  uuid, text, jsonb, numeric, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.settle_rider_cod_ledger(
  uuid, uuid, numeric, text, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.post_opening_stock_ledger(
  uuid, text, integer, numeric, uuid, text
) from public, anon, authenticated;
grant execute on function public.post_sale_phase2_ledger(
  uuid, text, date, jsonb, jsonb, uuid, text, text, text, text, text, text, uuid, text
) to service_role;
grant execute on function public.post_sale_return_ledger(
  uuid, text, jsonb, text, text, text, uuid
) to service_role;
grant execute on function public.receive_invoice_payment_ledger(
  uuid, text, numeric, text, text, uuid
) to service_role;
grant execute on function public.record_delivery_outcome_ledger(
  uuid, text, jsonb, numeric, text, text, uuid
) to service_role;
grant execute on function public.settle_rider_cod_ledger(
  uuid, uuid, numeric, text, text, text, uuid
) to service_role;
grant execute on function public.post_opening_stock_ledger(
  uuid, text, integer, numeric, uuid, text
) to service_role;

commit;
notify pgrst, 'reload schema';
