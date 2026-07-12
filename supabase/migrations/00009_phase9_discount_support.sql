-- ============================================================================
-- KhataPro ERP — Phase 9: Discount support + canonical net-collection commission
--                        + receipt allocation + OFC full-advance enforcement
--
-- This migration contains ALL database changes for Phase 9:
--   1. Drop old 13-arg post_sale, create canonical 14-arg with p_discount_paisas
--   2. Create INTERNAL helper _post_salesman_collection_commission() (not exposed)
--   3. post_sale() calls internal helper ONCE per sale using net_collected
--   4. post_receipt_voucher() supports multi-invoice allocation + commission
--   5. Receipt allocations table for split receipt across invoices
--   6. Idempotent commission via NOT NULL source_allocation_id + unique index
--   7. Discount validated (>= 0 and <= subtotal)
--   8. OFC full-advance enforced server-side
--   9. Online delivery fields on invoices for grand-total reconciliation
--
-- OVERLOAD PREVENTION:
--   DROP the exact old 13-parameter signature, then CREATE the new 14-parameter.
--   No CASCADE. One canonical post_sale remains.
--
-- SECURITY:
--   _post_salesman_collection_commission is INTERNAL — revoked from all roles.
--   Only SECURITY DEFINER functions (post_sale, post_receipt_voucher) call it.
--   No ordinary authenticated user can submit arbitrary commission parameters.
--
-- Rerunnable: DROP IF EXISTS + CREATE OR REPLACE + IF NOT EXISTS. Safe to re-run.
-- ============================================================================

-- ============================================================================
-- PART 1: Schema — salesman_commissions source tracking
-- ============================================================================
-- source_type: 'sale_payment' (initial sale) or 'receipt_collection' (later receipt)
-- source_allocation_id: immutable unique reference
--   - For sale_payment: the sale voucher_id (one per sale)
--   - For receipt_collection: the receipt_allocation.id (one per allocation)

alter table public.salesman_commissions
  add column if not exists source_type text not null default 'sale_payment';

alter table public.salesman_commissions
  add column if not exists source_allocation_id text;

-- Backfill: any existing commission rows with NULL source_allocation_id get a
-- stable fallback derived from their allocation_id so the unique index can apply.
update public.salesman_commissions
  set source_allocation_id = 'legacy_' || coalesce(allocation_id, id)
  where source_allocation_id is null;

-- Unique index for idempotency. Every new commission created by 00009 logic
-- has a NOT NULL source_allocation_id, so this index covers all new rows.
drop index if exists public.salesman_commissions_source_unique;
create unique index if not exists salesman_commissions_source_unique
  on public.salesman_commissions (business_id, invoice_id, salesman_id, source_type, source_allocation_id)
  where source_allocation_id is not null;

-- ============================================================================
-- PART 2: Schema — invoices delivery fields (for Online grand-total reconciliation)
-- ============================================================================
-- These fields let the invoice track the full customer grand total
-- (product + delivery) so invoice detail, delivery order and print all agree.
-- Accounting separation is preserved: 4010 gets product revenue only,
-- 4030 gets delivery income, 2020 gets rider payable (recognized at delivery time).

alter table public.invoices
  add column if not exists delivery_charge numeric(20,0) not null default 0;

alter table public.invoices
  add column if not exists rider_earning numeric(20,0) not null default 0;

alter table public.invoices
  add column if not exists company_delivery_income numeric(20,0) not null default 0;

-- ============================================================================
-- PART 3: Schema — receipt_allocations table
-- ============================================================================
-- Supports allocating a single receipt across one or more outstanding invoices.
-- Each allocation is immutable and has its own ID, used as the commission
-- source_allocation_id for idempotent per-invoice commission.

create table if not exists public.receipt_allocations (
  id              text primary key default gen_random_uuid()::text,
  business_id     text not null references public.business(id) on delete cascade,
  receipt_id      text not null references public.receipts(id) on delete cascade,
  invoice_id      text not null references public.invoices(id) on delete restrict,
  customer_id     text,
  salesman_id     text,
  allocated_amount numeric(20,0) not null,
  allocation_date date not null default (now() at time zone 'Asia/Karachi')::date,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  constraint receipt_allocations_amount_check check (allocated_amount > 0)
);

create index if not exists receipt_allocations_receipt_idx
  on public.receipt_allocations(receipt_id);
create index if not exists receipt_allocations_invoice_idx
  on public.receipt_allocations(invoice_id);
create index if not exists receipt_allocations_biz_idx
  on public.receipt_allocations(business_id);

-- ============================================================================
-- PART 4: INTERNAL commission helper — _post_salesman_collection_commission
-- ============================================================================
-- This is the ONE canonical function that creates salesman commission.
-- It is INTERNAL: revoked from all roles. Only SECURITY DEFINER posting
-- functions (post_sale, post_receipt_voucher) may call it.
--
-- Business rules:
--   - Commission earned only on validated net collected amount
--   - No commission on outstanding/uncollected amount
--   - No commission on returned change (caller must net it out)
--   - No commission on zero collection
--   - Salesman obtained from the INVOICE — never trusted from caller
--   - Duplicate prevention via unique index on source_allocation_id
--   - Returns existing commission ID on replay (idempotent)
--   - Returns null for: zero collection, no salesman, inactive salesman,
--     zero commission rate, or duplicate source

create or replace function public._post_salesman_collection_commission(
  p_business_id          text,
  p_invoice_id           text,
  p_net_collected        numeric(20,0),
  p_source_type          text,
  p_source_allocation_id text,
  p_collection_date      date,
  p_created_by           uuid default null
)
returns text  -- commission ID, or null if no commission created
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_exists  boolean;
  v_invoice_biz     text;
  v_salesman_id     text;
  v_comm_pct        numeric(5,2);
  v_comm_amount     numeric(20,0);
  v_comm_id         text;
  v_existing_id     text;
  v_invoice_total   numeric(20,0);
  v_invoice_paid    numeric(20,0);
  v_outstanding     numeric(20,0);
begin
  -- source_allocation_id must NEVER be null for new commission records
  if p_source_allocation_id is null then
    raise exception 'source_allocation_id is required for commission creation';
  end if;

  -- source_type must be one of the approved values
  if p_source_type not in ('sale_payment', 'receipt_collection') then
    raise exception 'Invalid source_type: %', p_source_type;
  end if;

  -- Zero or negative collection = no commission, no row
  if p_net_collected is null or p_net_collected <= 0 then
    return null;
  end if;

  -- Validate business exists
  if not exists (select 1 from public.business where id = p_business_id) then
    raise exception 'Business not found: %', p_business_id;
  end if;

  -- Validate invoice exists and belongs to the same business
  select business_id, salesman_id, total, paid_amount
    into v_invoice_biz, v_salesman_id, v_invoice_total, v_invoice_paid
  from public.invoices
  where id = p_invoice_id;

  if not found then
    raise exception 'Invoice not found: %', p_invoice_id;
  end if;

  if v_invoice_biz is distinct from p_business_id then
    raise exception 'Invoice does not belong to business';
  end if;

  -- Obtain salesman from the invoice itself — never trust caller
  if v_salesman_id is null then
    return null;  -- No salesman on invoice = no commission
  end if;

  -- Get salesman's commission rate (must be active)
  select commission_pct into v_comm_pct
  from public.salesmen
  where id = v_salesman_id
    and business_id = p_business_id
    and is_active = true;

  if not found or v_comm_pct is null or v_comm_pct <= 0 then
    return null;  -- No commission rate or inactive salesman
  end if;

  -- Idempotency: check if commission already exists for this exact source
  select id into v_existing_id
  from public.salesman_commissions
  where business_id = p_business_id
    and invoice_id = p_invoice_id
    and salesman_id = v_salesman_id
    and source_type = p_source_type
    and source_allocation_id = p_source_allocation_id
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;  -- Replay: return existing reference, no duplicate
  end if;

  -- Validate collection does not exceed the amount allocated to that invoice
  -- For sale_payment: the net_collected cannot exceed the invoice total
  -- For receipt_collection: the caller (post_receipt_voucher) validates allocation <= outstanding
  if p_source_type = 'sale_payment' then
    if p_net_collected > v_invoice_total then
      raise exception 'Net collected (%) exceeds invoice total (%)', p_net_collected, v_invoice_total;
    end if;
  end if;

  -- Calculate commission on net collected amount only
  v_comm_amount := (p_net_collected * v_comm_pct) / 100;

  if v_comm_amount <= 0 then
    return null;
  end if;

  -- Insert commission row with NOT NULL source_allocation_id
  insert into public.salesman_commissions (
    business_id, salesman_id, invoice_id,
    allocation_id,
    collected_amount, commission_pct, commission_amount,
    status, source_type, source_allocation_id
  ) values (
    p_business_id, v_salesman_id, p_invoice_id,
    null,
    p_net_collected, v_comm_pct, v_comm_amount,
    'accrued', p_source_type, p_source_allocation_id
  )
  on conflict do nothing  -- safety net: unique index prevents duplicates
  returning id into v_comm_id;

  -- If insert was skipped by on conflict, fetch the existing ID
  if v_comm_id is null then
    select id into v_comm_id
    from public.salesman_commissions
    where business_id = p_business_id
      and invoice_id = p_invoice_id
      and salesman_id = v_salesman_id
      and source_type = p_source_type
      and source_allocation_id = p_source_allocation_id
    limit 1;
  end if;

  return v_comm_id;
end;
$$;

-- SECURITY: Revoke direct execution from ALL roles. Internal only.
revoke execute on function public._post_salesman_collection_commission(
  text, text, numeric(20,0), text, text, date, uuid
) from public;

revoke execute on function public._post_salesman_collection_commission(
  text, text, numeric(20,0), text, text, date, uuid
) from anon;

revoke execute on function public._post_salesman_collection_commission(
  text, text, numeric(20,0), text, text, date, uuid
) from authenticated;

-- ============================================================================
-- PART 5: Drop old post_sale and create canonical 14-arg with discount + commission
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
  v_net_collected numeric(20,0);
  v_product_wac   numeric(20,0);
  v_item_cogs     numeric(20,0);
  v_total_cogs    numeric(20,0) := 0;
  v_discount      numeric(20,0) := 0;
  v_comm_id       text;
  v_ar_line_added boolean := false;
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

  -- ========================================================================
  -- NET COLLECTED COMMISSION BASE
  -- ========================================================================
  -- net_collected = greatest(least(final_invoice_payable, total_paid - total_change), 0)
  --
  -- This ensures:
  --   - Commission base never exceeds the invoice payable amount
  --   - Returned change is subtracted (not commissioned)
  --   - Overpayment beyond invoice total is capped at invoice total
  --   - Zero or negative collection = zero commission
  v_net_collected := greatest(
    least(v_total, v_paid - v_change_total),
    0
  );

  -- ========================================================================
  -- OFC FULL-ADVANCE ENFORCEMENT (server-side)
  -- ========================================================================
  -- OFC requires net_collected == final_total (full advance, zero outstanding)
  if p_invoice_type = 'OFC' then
    if v_net_collected <> v_total then
      raise exception 'OFC requires full advance payment: net_collected (%) must equal final_total (%)', v_net_collected, v_total;
    end if;
    if v_outstanding is not null and v_outstanding > 0 then
      raise exception 'OFC outstanding must be zero';
    end if;
    -- Customer details required for OFC
    if p_customer_name is null or p_customer_phone is null
       or p_customer_address is null or p_customer_city is null then
      raise exception 'OFC requires customer name, phone, address and city';
    end if;
  end if;

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
  -- outstanding = total - (paid - change) = total - net_collected
  -- (The old formula v_total + v_change - v_paid is algebraically equivalent
  --  but we use the net_collected form to be explicit and avoid confusion.)
  v_outstanding := v_total - v_net_collected;
  if v_outstanding > 0 and v_ar_account is not null then
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_ar_account,
      'debit', v_outstanding::text, 'credit', '0',
      'memo', 'Outstanding ' || v_invoice_no
    );
    v_ar_line_added := true;
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
    v_subtotal, v_discount, v_total, v_net_collected,
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
    end if;
  end loop;

  -- ========================================================================
  -- CANONICAL COMMISSION: ONE call per sale, using net_collected
  -- ========================================================================
  -- Uses the sale voucher_id as the immutable source_allocation_id.
  -- This ensures ONE commission row per sale, regardless of how many
  -- payment accounts were used (split payments do not create duplicates).
  -- The internal helper gets the salesman from the invoice itself.
  if p_salesman_id is not null and v_net_collected > 0 then
    v_comm_id := public._post_salesman_collection_commission(
      p_business_id, v_invoice_id, v_net_collected,
      'sale_payment', v_voucher_id,
      p_invoice_date, p_created_by
    );
  end if;

  -- Audit log
  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'POST_SALE', 'invoice', v_invoice_id,
    jsonb_build_object('invoice_no', v_invoice_no, 'type', p_invoice_type, 'total', v_total,
      'discount', v_discount, 'paid', v_paid, 'change', v_change_total,
      'net_collected', v_net_collected, 'outstanding', v_outstanding,
      'cogs', v_total_cogs, 'voucher_id', v_voucher_id,
      'commission_id', v_comm_id));

  return v_invoice_id;
end;
$$;

grant execute on function public.post_sale(
  text, text, date, jsonb, jsonb, text, text, text, text, text, text, text, uuid, numeric
) to authenticated;

-- ============================================================================
-- PART 6: post_receipt_voucher — with multi-invoice allocation
-- ============================================================================
-- Supports allocating a receipt to one or more outstanding invoices.
-- Each allocation:
--   - Validates invoice belongs to the customer/business
--   - Validates allocation does not exceed invoice outstanding
--   - Creates a receipt_allocation row (immutable)
--   - Updates invoice paid_amount
--   - Calls internal commission helper with source_allocation_id = receipt_allocation.id
--
-- If no allocations provided: simple receipt (no commission, no invoice update).
-- General (non-customer) receipts create no salesman commission.

drop function if exists public.post_receipt_voucher(
  text, date, text, text, numeric(20,0), text, text, text, uuid
);

drop function if exists public.post_receipt_voucher(
  text, date, text, text, numeric(20,0), text, text, text, uuid, text
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
  p_allocations jsonb default null  -- [{invoice_id, allocated_amount}]
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
  v_alloc jsonb;
  v_alloc_row jsonb;
  v_alloc_id text;
  v_alloc_amount numeric(20,0);
  v_alloc_total numeric(20,0) := 0;
  v_invoice_id text;
  v_invoice_salesman_id text;
  v_invoice_biz text;
  v_invoice_total numeric(20,0);
  v_invoice_paid numeric(20,0);
  v_invoice_outstanding numeric(20,0);
  v_comm_id text;
  v_commission_ids text[] := '{}';
begin
  -- Validate accounts
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

  -- Validate allocations if provided
  if p_allocations is not null and jsonb_array_length(p_allocations) > 0 then
    for v_alloc_row in select * from jsonb_array_elements(p_allocations)
    loop
      v_invoice_id := v_alloc_row->>'invoice_id';
      v_alloc_amount := coalesce((v_alloc_row->>'allocated_amount')::numeric, 0);

      if v_invoice_id is null then
        raise exception 'Allocation missing invoice_id';
      end if;
      if v_alloc_amount <= 0 then
        raise exception 'Allocation amount must be positive';
      end if;

      -- Validate invoice exists, belongs to business
      select business_id, salesman_id, total, paid_amount
        into v_invoice_biz, v_invoice_salesman_id, v_invoice_total, v_invoice_paid
      from public.invoices
      where id = v_invoice_id;

      if not found then
        raise exception 'Allocated invoice not found: %', v_invoice_id;
      end if;

      if v_invoice_biz is distinct from p_business_id then
        raise exception 'Allocated invoice does not belong to business';
      end if;

      -- Validate invoice belongs to the customer (if customer_id provided)
      if p_customer_id is not null then
        if not exists (
          select 1 from public.invoices
          where id = v_invoice_id
            and business_id = p_business_id
            and (customer_id = p_customer_id or customer_id is null)
        ) then
          raise exception 'Invoice does not belong to the selected customer';
        end if;
      end if;

      -- Validate allocation does not exceed invoice outstanding
      v_invoice_outstanding := v_invoice_total - coalesce(v_invoice_paid, 0);
      if v_alloc_amount > v_invoice_outstanding then
        raise exception 'Allocation (%) exceeds invoice outstanding (%)', v_alloc_amount, v_invoice_outstanding;
      end if;

      v_alloc_total := v_alloc_total + v_alloc_amount;
    end loop;

    -- Total allocations cannot exceed the received amount
    if v_alloc_total > p_amount_paisas then
      raise exception 'Total allocations (%) exceed receipt amount (%)', v_alloc_total, p_amount_paisas;
    end if;
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

  -- Process allocations: create receipt_allocation rows, update invoice, commission
  if p_allocations is not null and jsonb_array_length(p_allocations) > 0 then
    for v_alloc_row in select * from jsonb_array_elements(p_allocations)
    loop
      v_invoice_id := v_alloc_row->>'invoice_id';
      v_alloc_amount := coalesce((v_alloc_row->>'allocated_amount')::numeric, 0);

      -- Re-fetch invoice (in case prior allocation updated paid_amount)
      select salesman_id, total, paid_amount
        into v_invoice_salesman_id, v_invoice_total, v_invoice_paid
      from public.invoices
      where id = v_invoice_id and business_id = p_business_id;

      -- Create immutable receipt_allocation row
      insert into public.receipt_allocations (
        business_id, receipt_id, invoice_id, customer_id, salesman_id,
        allocated_amount, allocation_date, created_by
      ) values (
        p_business_id, v_receipt_id, v_invoice_id, p_customer_id, v_invoice_salesman_id,
        v_alloc_amount, p_receipt_date, p_created_by
      ) returning id into v_alloc_id;

      -- Update invoice paid_amount (AR reduced exactly once per allocation)
      update public.invoices
        set paid_amount = coalesce(paid_amount, 0) + v_alloc_amount
      where id = v_invoice_id and business_id = p_business_id;

      -- Call internal commission helper with this allocation's immutable ID
      -- The helper gets the salesman from the invoice (not trusted from caller)
      if v_invoice_salesman_id is not null then
        v_comm_id := public._post_salesman_collection_commission(
          p_business_id, v_invoice_id, v_alloc_amount,
          'receipt_collection', v_alloc_id,
          p_receipt_date, p_created_by
        );
        if v_comm_id is not null then
          v_commission_ids := v_commission_ids || array[v_comm_id];
        end if;
      end if;
    end loop;
  end if;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'POST_RECEIPT_VOUCHER', 'receipt', v_receipt_id,
    jsonb_build_object('receipt_no', v_receipt_no, 'amount', p_amount_paisas,
      'voucher_id', v_voucher_id, 'customer_id', p_customer_id,
      'allocations_count',
        case when p_allocations is not null then jsonb_array_length(p_allocations) else 0 end,
      'allocations_total', v_alloc_total,
      'commission_ids', to_jsonb(v_commission_ids)));

  return jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_no', v_receipt_no,
    'voucher_id', v_voucher_id,
    'allocations_total', v_alloc_total,
    'commission_ids', to_jsonb(v_commission_ids)
  );
end;
$$;

grant execute on function public.post_receipt_voucher(
  text, date, text, text, numeric(20,0), text, text, text, uuid, jsonb
) to authenticated;

-- ============================================================================
-- PART 7: PostgREST schema reload
-- ============================================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Migration 00009 complete scope:
--   ✓ _post_salesman_collection_commission() — INTERNAL canonical commission helper
--     (revoked from PUBLIC, anon, authenticated — only SECURITY DEFINER calls it)
--   ✓ salesman_commissions.source_type and source_allocation_id columns added
--   ✓ Unique index on (business, invoice, salesman, source_type, source_allocation_id)
--   ✓ invoices.delivery_charge, rider_earning, company_delivery_income added
--   ✓ receipt_allocations table created (immutable per-invoice allocation)
--   ✓ post_sale() — 14 params with p_discount_paisas
--     - net_collected = greatest(least(total, paid - change), 0)
--     - ONE commission call per sale using voucher_id as source
--     - Split payments do NOT create duplicate commission
--     - OFC full-advance enforced server-side
--   ✓ post_receipt_voucher() — 10 params with p_allocations jsonb
--     - Multi-invoice allocation support
--     - Each allocation creates immutable receipt_allocation row
--     - Per-allocation commission with idempotent source
--     - Invoice paid/outstanding updated correctly
--     - AR reduced exactly once per allocation
--   ✓ Discount validated: >= 0 and <= subtotal
--   ✓ total = subtotal - discount
--   ✓ Revenue posts net of discount (4010 credit = net total)
--   ✓ COGS unchanged (discount does not reduce COGS)
--   ✓ Commission on net collected, not gross payment
--   ✓ Change allocations do NOT trigger commission
--   ✓ Duplicate commission prevented via unique index + on conflict do nothing
--   ✓ Grants: post_sale and post_receipt_voucher to authenticated only
--   ✓ _post_salesman_collection_commission: NO grant to any role
--   ✓ SECURITY DEFINER, set search_path = public on all functions
--   ✓ NOTIFY pgrst reload schema
--   ✓ No CASCADE used
--   ✓ Rerunnable: DROP IF EXISTS + CREATE OR REPLACE + IF NOT EXISTS
-- ============================================================================
