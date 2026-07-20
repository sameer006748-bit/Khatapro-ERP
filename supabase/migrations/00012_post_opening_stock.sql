-- ============================================================================
-- KhataPro ERP — Opening Stock Posting (additive)
--
-- Purpose: one atomic RPC that posts a new product's opening stock:
--   1. one 'opening' stock movement (quantity + WAC via create_stock_movement)
--   2. one balanced voucher: Debit Inventory (1100) / Credit Opening Balance
--      Equity (3030) for quantity × unit cost (paisas), via post_voucher
--   3. one summary audit entry
--
-- Replaces the application's dependency on atomic_create_product (from the
-- unavailable migration 00011). The application now inserts the product with
-- current_stock = 0 and then calls this RPC; if this RPC fails, the product
-- remains at zero quantity with no movement and no voucher.
--
-- Additive only: no table/column changes, no data migration, no dependency on
-- the request's authentication context.
-- Executable by service_role only (matches 00008k containment posture).
-- ============================================================================

create or replace function public.post_opening_stock(
  p_business_id      text,
  p_product_id       text,
  p_quantity         integer,
  p_unit_cost_paisas numeric(20,0),
  p_created_by       uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_biz     text;
  v_movement_id     text;
  v_voucher_id      text;
  v_inventory_acct  text;
  v_obe_acct        text;
  v_value_paisas    numeric(20,0);
  v_product_name    text;
begin
  -- Validate business exists.
  if not exists (select 1 from public.business b where b.id = p_business_id) then
    raise exception 'Invalid business_id';
  end if;

  -- Validate product ownership and serialize concurrent opening attempts on
  -- this product (row lock held for the rest of the transaction).
  select p.business_id, p.name into v_product_biz, v_product_name
  from public.products p
  where p.id = p_product_id
  for update;
  if v_product_biz is null or v_product_biz <> p_business_id then
    raise exception 'Invalid or foreign product_id: %', p_product_id;
  end if;

  -- Exactly one opening per product: a retry or second attempt fails safely.
  if exists (
    select 1 from public.stock_movements sm
    where sm.product_id = p_product_id and sm.movement_type = 'opening'
  ) then
    raise exception 'Product already has opening stock posted';
  end if;

  -- Validate quantity and cost. Zero-quantity products must never reach this
  -- function; a costless opening would create quantity without valuation.
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Opening quantity must be a positive integer';
  end if;
  if p_unit_cost_paisas is null or p_unit_cost_paisas <= 0 then
    raise exception 'Opening unit cost must be positive';
  end if;

  v_value_paisas := p_quantity * p_unit_cost_paisas;

  -- Resolve the two ledger accounts.
  select a.id into v_inventory_acct
  from public.accounts a
  where a.business_id = p_business_id and a.code = '1100' and a.is_active = true;
  if v_inventory_acct is null then
    raise exception 'Inventory account (1100) not found';
  end if;

  select a.id into v_obe_acct
  from public.accounts a
  where a.business_id = p_business_id and a.code = '3030' and a.is_active = true;
  if v_obe_acct is null then
    raise exception 'Opening Balance Equity account (3030) not found';
  end if;

  -- 1. Stock movement: updates current_stock and sets WAC = opening cost
  --    (previous quantity is 0, so create_stock_movement's weighted-average
  --    formula yields exactly p_unit_cost_paisas).
  v_movement_id := public.create_stock_movement(
    p_business_id,
    p_product_id,
    'opening',
    p_quantity,
    'Opening stock',
    null,
    p_created_by,
    p_unit_cost_paisas
  );

  -- 2. Balanced voucher: Debit Inventory / Credit Opening Balance Equity.
  v_voucher_id := public.post_voucher(
    p_business_id,
    'OP',
    (now() at time zone 'Asia/Karachi')::date,
    'Opening stock: ' || v_product_name,
    jsonb_build_array(
      jsonb_build_object('account_id', v_inventory_acct, 'debit', v_value_paisas, 'credit', 0, 'memo', 'Opening stock ' || p_quantity || ' pcs'),
      jsonb_build_object('account_id', v_obe_acct, 'debit', 0, 'credit', v_value_paisas, 'memo', 'Opening stock ' || p_quantity || ' pcs')
    ),
    v_movement_id,
    'opening_stock',
    p_created_by
  );

  -- Link the movement to its voucher for auditability.
  update public.stock_movements
  set voucher_id = v_voucher_id
  where id = v_movement_id;

  -- 3. Summary audit entry.
  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'POST_OPENING_STOCK', 'product', p_product_id,
    jsonb_build_object(
      'movement_id', v_movement_id,
      'voucher_id', v_voucher_id,
      'quantity', p_quantity,
      'unit_cost_paisas', p_unit_cost_paisas,
      'value_paisas', v_value_paisas
    ));

  -- Any exception above rolls back the movement, the voucher, the stock and
  -- WAC updates, and the audit rows together (single transaction).
  return jsonb_build_object(
    'movement_id', v_movement_id,
    'voucher_id', v_voucher_id,
    'quantity', p_quantity,
    'unit_cost_paisas', p_unit_cost_paisas,
    'value_paisas', v_value_paisas
  );
end;
$$;

-- Containment posture (matches 00008k): server-side execution only.
revoke execute on function public.post_opening_stock(text, text, integer, numeric, uuid)
  from public, anon, authenticated;
grant execute on function public.post_opening_stock(text, text, integer, numeric, uuid)
  to service_role;

-- Refresh PostgREST schema cache.
notify pgrst, 'reload schema';
