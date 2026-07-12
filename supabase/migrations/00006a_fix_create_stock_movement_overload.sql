-- ============================================================================
-- KhataPro ERP — Fix: Drop overloaded create_stock_movement function
--
-- Bug: Migration 00006 used CREATE OR REPLACE to add p_unit_cost_paisas param,
-- but PostgreSQL treats this as a NEW overloaded function (different signature).
-- Both 7-param and 8-param versions exist, causing PostgREST PGRST203 errors.
--
-- Fix: DROP both versions, then CREATE the single correct 8-param version.
-- ============================================================================

-- Drop ALL overloads of create_stock_movement
drop function if exists public.create_stock_movement(text, text, text, integer, text, date, uuid);
drop function if exists public.create_stock_movement(text, text, text, integer, text, date, uuid, numeric);

-- Recreate the single correct 8-param version with optional cost
create or replace function public.create_stock_movement(
  p_business_id   text,
  p_product_id    text,
  p_movement_type text,
  p_quantity      integer,
  p_reason        text default null,
  p_movement_date date default null,
  p_created_by    uuid default null,
  p_unit_cost_paisas numeric(20,0) default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement_id text;
  v_current     integer;
  v_delta       integer;
  v_balance_after integer;
  v_date        date;
  v_prev_qty    integer;
  v_prev_wac    numeric(20,0);
  v_new_qty     integer;
  v_new_wac     numeric(20,0);
  v_mv_cost     numeric(20,0);
  v_balance_cost numeric(20,0);
begin
  if p_movement_type not in ('opening', 'adjustment_in', 'adjustment_out', 'temporary_item', 'correction') then
    raise exception 'Invalid movement_type: %', p_movement_type;
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = p_product_id and p.business_id = p_business_id
  ) then
    raise exception 'Invalid or foreign product_id: %', p_product_id;
  end if;

  if p_quantity <= 0 then
    raise exception 'Quantity must be positive for type %', p_movement_type;
  end if;

  if p_movement_type = 'adjustment_out' then
    v_delta := -p_quantity;
  else
    v_delta := p_quantity;
  end if;

  -- Lock and get current stock + WAC.
  select current_stock, weighted_average_cost
  into v_current, v_prev_wac
  from public.products
  where id = p_product_id
  for update;

  v_balance_after := v_current + v_delta;
  v_date := coalesce(p_movement_date, (now() at time zone 'Asia/Karachi')::date);
  v_mv_cost := coalesce(p_unit_cost_paisas, 0);
  v_prev_qty := v_current;
  v_new_qty := v_balance_after;

  -- Compute new WAC.
  if v_delta > 0 and v_mv_cost > 0 then
    if v_prev_qty > 0 then
      v_new_wac := (v_prev_qty * v_prev_wac + v_delta * v_mv_cost) / v_new_qty;
    elsif v_prev_qty < 0 then
      if v_new_qty > 0 then
        v_new_wac := v_mv_cost;
      else
        v_new_wac := 0;
      end if;
    else
      v_new_wac := v_mv_cost;
    end if;
  elsif v_delta > 0 and v_mv_cost = 0 then
    if v_new_qty > 0 and v_prev_qty > 0 then
      v_new_wac := (v_prev_qty * v_prev_wac) / v_new_qty;
    else
      v_new_wac := 0;
    end if;
  else
    -- Outflow — WAC unchanged.
    v_new_wac := v_prev_wac;
  end if;

  v_balance_cost := v_new_qty * v_new_wac;

  -- Insert movement with cost data.
  insert into public.stock_movements
    (business_id, product_id, movement_type, quantity, balance_after, reason,
     movement_date, created_by, unit_cost_paisas, balance_cost_after,
     cogs_finalized)
  values
    (p_business_id, p_product_id, p_movement_type, p_quantity, v_balance_after,
     p_reason, v_date, p_created_by, p_unit_cost_paisas, v_balance_cost,
     (v_new_qty >= 0))
  returning id into v_movement_id;

  -- Update product cache.
  update public.products
  set current_stock = v_balance_after,
      weighted_average_cost = v_new_wac,
      latest_purchase_cost = case
        when p_movement_type in ('adjustment_in', 'opening') and p_unit_cost_paisas is not null
        then p_unit_cost_paisas
        else latest_purchase_cost
      end,
      updated_at = now()
  where id = p_product_id;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'CREATE_STOCK_MOVEMENT', 'stock_movement', v_movement_id,
    jsonb_build_object(
      'product_id', p_product_id,
      'movement_type', p_movement_type,
      'quantity', p_quantity,
      'unit_cost_paisas', p_unit_cost_paisas,
      'delta', v_delta,
      'balance_after', v_balance_after,
      'new_wac', v_new_wac,
      'reason', p_reason
    ));

  return v_movement_id;
end;
$$;

-- Refresh PostgREST schema cache.
NOTIFY pgrst, 'reload schema';
