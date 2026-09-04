-- Sync invoices.rider_id from the authoritative delivery_orders assignment.
-- Root cause: assign_rider_to_order() (00007) only ever wrote
-- delivery_orders.rider_id. The Phase 3+ rider workflows (00017, 00019)
-- authorize against invoices.rider_id, which nothing ever populated, so a
-- correctly assigned rider was rejected by every mark_cod_out_for_delivery /
-- complete_cod_delivery / record_delivery_outcome / return_rider_delivery call.
-- delivery_orders.rider_id remains the single authoritative assignment;
-- invoices.rider_id becomes a synced projection kept consistent by this
-- function so both rider-delivery code paths observe the same assignment.
begin;

do $$
begin
  if to_regclass('public.delivery_orders') is null
     or to_regclass('public.invoices') is null then
    raise exception 'Rider assignment sync requires delivery_orders and invoices';
  end if;
end $$;

create or replace function public.assign_rider_to_order(
  p_business_id text, p_delivery_order_id text, p_rider_id text, p_created_by uuid default null
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_order record;
  v_rider record;
  v_old_rider_id text;
begin
  select * into v_order from public.delivery_orders
  where id = p_delivery_order_id and business_id = p_business_id;
  if not found then raise exception 'Delivery order not found'; end if;

  if v_order.status not in ('pending','assigned') then
    raise exception 'Cannot assign rider: order status is %', v_order.status;
  end if;

  select * into v_rider from public.riders
  where id = p_rider_id and business_id = p_business_id and is_active = true;
  if not found then raise exception 'Invalid or inactive rider'; end if;

  v_old_rider_id := v_order.rider_id;
  update public.delivery_orders
  set rider_id = p_rider_id, status = 'assigned', assigned_at = now(),
      updated_at = now(), updated_by = p_created_by
  where id = p_delivery_order_id;

  -- Keep the Phase 3+ rider-authorization column in lockstep with the
  -- authoritative delivery_orders assignment, including on reassignment.
  update public.invoices
  set rider_id = p_rider_id::uuid
  where business_id = p_business_id and id = v_order.invoice_id;

  insert into public.delivery_status_events
    (business_id, delivery_order_id, from_status, to_status, rider_id, note, created_by)
  values
    (p_business_id, p_delivery_order_id, v_order.status, 'assigned', p_rider_id,
     case when v_old_rider_id is not null then 'Reassigned from ' || v_old_rider_id else null end,
     p_created_by);

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'ASSIGN_RIDER', 'delivery_order', p_delivery_order_id,
    jsonb_build_object('rider_id', p_rider_id, 'old_rider_id', v_old_rider_id));

  return p_delivery_order_id;
end;
$$;

commit;
