-- ============================================================================
-- KhataPro ERP — Fix: COD over-allocation integrity
--
-- Bug: create_cod_submission() allowed creating submissions against already
--      fully-settled delivery orders. No allocation tracking existed.
--
-- Fix: Update create_cod_submission() to:
--   1. For each delivery order, calculate remaining allocatable COD:
--      remaining = cod_collected_amount
--                - sum(amount_allocated where submission status in ('submitted','confirmed'))
--   2. Lock the delivery order row (FOR UPDATE) to prevent concurrent submissions
--   3. Reject if requested allocation > remaining
--   4. Reject if remaining = 0 (fully allocated)
--   5. Roll back entire batch if any item is invalid
--
-- Also: Add reject_cod_submission() RPC to release allocations on rejection.
--       Clean up CS-0005 (invalid unconfirmed test submission).
--
-- This migration is rerunnable: uses CREATE OR REPLACE, DROP IF EXISTS, IF NOT EXISTS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- reject_cod_submission() — release allocations and mark submission rejected
-- ----------------------------------------------------------------------------
create or replace function public.reject_cod_submission(
  p_business_id text,
  p_submission_id text,
  p_rejected_by uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_sub record;
begin
  select * into v_sub from public.rider_cod_submissions
  where id = p_submission_id and business_id = p_business_id;
  if not found then raise exception 'COD submission not found'; end if;
  if v_sub.status != 'submitted' then
    raise exception 'Cannot reject submission with status: %', v_sub.status;
  end if;

  update public.rider_cod_submissions
  set status = 'rejected', notes = coalesce(p_reason, notes),
      confirmed_by = p_rejected_by, confirmed_at = now()
  where id = p_submission_id;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_rejected_by, 'REJECT_COD_SUBMISSION', 'rider_cod_submission', p_submission_id,
    jsonb_build_object('submission_no', v_sub.submission_no, 'reason', p_reason));

  return jsonb_build_object('submission_id', p_submission_id, 'status', 'rejected');
end;
$$;

-- ----------------------------------------------------------------------------
-- Updated create_cod_submission() — with allocation integrity
-- ----------------------------------------------------------------------------
create or replace function public.create_cod_submission(
  p_business_id text, p_rider_id text,
  p_items jsonb,
  p_settlement_mode text,
  p_requested_amount numeric(20,0),
  p_notes text default null,
  p_created_by uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_submission_id text;
  v_submission_no text;
  v_item jsonb;
  v_order record;
  v_total_fee_deduction numeric(20,0) := 0;
  v_already_allocated numeric(20,0);
  v_remaining numeric(20,0);
  v_requested_alloc numeric(20,0);
begin
  if p_settlement_mode not in ('full','net') then
    raise exception 'Invalid settlement mode';
  end if;
  if not exists (select 1 from public.riders where id = p_rider_id and business_id = p_business_id and is_active = true) then
    raise exception 'Invalid or inactive rider';
  end if;
  if jsonb_array_length(p_items) < 1 then
    raise exception 'At least one delivery order must be selected';
  end if;

  v_submission_no := public.next_cod_submission_no(p_business_id);

  -- Validate ALL items first (before creating anything)
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_requested_alloc := coalesce((v_item->>'amount_allocated')::numeric, 0);
    if v_requested_alloc <= 0 then
      raise exception 'Allocation amount must be greater than zero for order %', v_item->>'delivery_order_id';
    end if;

    -- Lock the delivery order row to prevent concurrent submissions
    select * into v_order from public.delivery_orders
    where id = v_item->>'delivery_order_id'
      and business_id = p_business_id
      and rider_id = p_rider_id
    for update;

    if not found then
      raise exception 'Invalid delivery order for this rider: %', v_item->>'delivery_order_id';
    end if;

    if v_order.status != 'delivered' then
      raise exception 'Order not delivered: %', v_item->>'delivery_order_id';
    end if;

    -- Calculate already-allocated amount from active submissions (submitted or confirmed)
    -- Uses JOIN between rider_cod_submission_items and rider_cod_submissions
    select coalesce(sum(sci.amount_allocated), 0) into v_already_allocated
    from public.rider_cod_submission_items sci
    join public.rider_cod_submissions scs on scs.id = sci.submission_id
    where sci.delivery_order_id = v_order.id
      and scs.status in ('submitted', 'confirmed');

    v_remaining := v_order.cod_collected_amount - v_already_allocated;

    if v_remaining <= 0 then
      raise exception 'Order % is fully allocated (COD: %, already allocated: %)',
        v_order.id, v_order.cod_collected_amount, v_already_allocated;
    end if;

    if v_requested_alloc > v_remaining then
      raise exception 'Allocation % exceeds remaining COD % for order % (total: %, already allocated: %)',
        v_requested_alloc, v_remaining, v_order.id, v_order.cod_collected_amount, v_already_allocated;
    end if;

    if p_settlement_mode = 'net' then
      v_total_fee_deduction := v_total_fee_deduction + coalesce((v_item->>'rider_fee_deducted')::numeric, 0);
    end if;
  end loop;

  -- All items validated — now create the submission
  insert into public.rider_cod_submissions
    (business_id, submission_no, rider_id, submitted_date, requested_amount,
     rider_fee_deduction, settlement_mode, status, notes, requested_by)
  values
    (p_business_id, v_submission_no, p_rider_id, (now() at time zone 'Asia/Karachi')::date,
     p_requested_amount, v_total_fee_deduction, p_settlement_mode, 'submitted', p_notes, p_created_by)
  returning id into v_submission_id;

  -- Insert items
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.rider_cod_submission_items
      (business_id, submission_id, delivery_order_id, amount_allocated, rider_fee_deducted)
    values
      (p_business_id, v_submission_id, v_item->>'delivery_order_id',
       (v_item->>'amount_allocated')::numeric,
       coalesce((v_item->>'rider_fee_deducted')::numeric, 0));
  end loop;

  insert into public.audit_logs (business_id, user_id, action, entity, entity_id, details)
  values (p_business_id, p_created_by, 'CREATE_COD_SUBMISSION', 'rider_cod_submission', v_submission_id,
    jsonb_build_object('submission_no', v_submission_no, 'rider_id', p_rider_id, 'amount', p_requested_amount, 'mode', p_settlement_mode));

  return jsonb_build_object('submission_id', v_submission_id, 'submission_no', v_submission_no);
end;
$$;

-- ----------------------------------------------------------------------------
-- Clean up CS-0005 (invalid unconfirmed test submission)
-- Safe to rerun: only updates if still 'submitted'
-- ----------------------------------------------------------------------------
update public.rider_cod_submissions
set status = 'rejected', notes = 'Cleaned up: invalid over-allocation test submission',
    confirmed_at = now()
where submission_no = 'CS-0005' and status = 'submitted';

-- ----------------------------------------------------------------------------
-- Supporting indexes (no subqueries in predicates)
-- These replace the invalid partial index from the previous attempt.
-- ----------------------------------------------------------------------------
drop index if exists public.cod_sub_items_order_active_idx;
create index if not exists cod_sub_items_order_submission_idx
  on public.rider_cod_submission_items(delivery_order_id, submission_id);

create index if not exists cod_submissions_id_status_idx
  on public.rider_cod_submissions(id, status);

create index if not exists cod_submissions_status_idx
  on public.rider_cod_submissions(business_id, status);

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Done. COD allocation integrity is now enforced:
--   ✓ Remaining COD calculated per order (total - already allocated in active submissions)
--   ✓ Uses JOIN between rider_cod_submission_items and rider_cod_submissions
--   ✓ Row-level locking prevents concurrent submissions for same order
--   ✓ Over-allocation rejected server-side
--   ✓ Fully allocated orders rejected
--   ✓ Entire batch rolls back if any item invalid
--   ✓ reject_cod_submission() releases allocations
--   ✓ CS-0005 cleaned up (marked rejected)
--   ✓ Normal indexes (no subquery predicates)
--   ✓ Rerunnable: CREATE OR REPLACE, DROP IF EXISTS, IF NOT EXISTS
-- ============================================================================
