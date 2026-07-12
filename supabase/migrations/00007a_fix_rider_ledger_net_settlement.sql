-- ============================================================================
-- KhataPro ERP — Fix: rider_ledger() net settlement COD submitted calculation
--
-- Bug: For net COD submissions, cod_submitted showed only confirmed_cash_amount
--      (800000) instead of confirmed_cash_amount + rider_fee_deduction (830000).
--      This caused running COD balance to show 30000 instead of 0.
--
-- Fix: Update the COD Submission row in rider_ledger() to use
--      confirmed_cash_amount + rider_fee_deduction as cod_submitted.
-- ============================================================================

create or replace function public.rider_ledger(
  p_business_id text, p_rider_id text,
  p_from_date date default null, p_to_date date default null
)
returns table (
  event_date date, event_type text, reference text, order_id text,
  cod_assigned numeric, cod_delivered numeric, cod_submitted numeric,
  cod_pending numeric, delivery_earning numeric, earning_settled numeric,
  running_cod_balance numeric, running_earning_balance numeric,
  voucher_id text
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_rider_cod_acct text;
  v_rider_payable_acct text;
begin
  select id into v_rider_cod_acct from public.accounts
  where business_id = p_business_id and code = '1310';
  select id into v_rider_payable_acct from public.accounts
  where business_id = p_business_id and code = '2020';

  return query
  with ledger as (
    -- Delivery events (COD delivered)
    select
      doo.delivered_at::date as event_date,
      'Delivered'::text as event_type,
      doo.id as reference,
      doo.invoice_id as order_id,
      0::numeric as cod_assigned,
      doo.total_cod_amount as cod_delivered,
      0::numeric as cod_submitted,
      0::numeric as cod_pending,
      doo.rider_earning_amount as delivery_earning,
      0::numeric as earning_settled,
      doo.delivery_voucher_id as voucher_id,
      doo.delivered_at as sort_key
    from public.delivery_orders doo
    where doo.business_id = p_business_id and doo.rider_id = p_rider_id
      and doo.status = 'delivered'
      and (p_from_date is null or doo.delivered_at::date >= p_from_date)
      and (p_to_date is null or doo.delivered_at::date <= p_to_date)

    union all

    -- COD submission confirmations
    -- FIX: cod_submitted = confirmed_cash_amount + rider_fee_deduction (not just cash)
    select
      rcs.confirmed_at::date as event_date,
      'COD Submission'::text as event_type,
      rcs.submission_no as reference,
      null::text as order_id,
      0::numeric as cod_assigned,
      0::numeric as cod_delivered,
      (rcs.confirmed_cash_amount + rcs.rider_fee_deduction) as cod_submitted,
      0::numeric as cod_pending,
      0::numeric as delivery_earning,
      rcs.rider_fee_deduction as earning_settled,
      rcs.voucher_id,
      rcs.confirmed_at as sort_key
    from public.rider_cod_submissions rcs
    where rcs.business_id = p_business_id and rcs.rider_id = p_rider_id
      and rcs.status = 'confirmed'
      and (p_from_date is null or rcs.confirmed_at::date >= p_from_date)
      and (p_to_date is null or rcs.confirmed_at::date <= p_to_date)

    union all

    -- Returned orders (no COD, no earning)
    select
      doo.returned_at::date as event_date,
      'Returned'::text as event_type,
      doo.id as reference,
      doo.invoice_id as order_id,
      0::numeric as cod_assigned,
      0::numeric as cod_delivered,
      0::numeric as cod_submitted,
      0::numeric as cod_pending,
      0::numeric as delivery_earning,
      0::numeric as earning_settled,
      doo.return_voucher_id as voucher_id,
      doo.returned_at as sort_key
    from public.delivery_orders doo
    where doo.business_id = p_business_id and doo.rider_id = p_rider_id
      and doo.status = 'returned'
      and (p_from_date is null or doo.returned_at::date >= p_from_date)
      and (p_to_date is null or doo.returned_at::date <= p_to_date)
  )
  select
    l.event_date, l.event_type, l.reference, l.order_id,
    l.cod_assigned, l.cod_delivered, l.cod_submitted,
    0::numeric as cod_pending,
    l.delivery_earning, l.earning_settled,
    coalesce(sum(l.cod_delivered - l.cod_submitted) over (order by l.sort_key), 0) as running_cod_balance,
    coalesce(sum(l.delivery_earning - l.earning_settled) over (order by l.sort_key), 0) as running_earning_balance,
    l.voucher_id
  from ledger l
  order by l.sort_key;
end;
$$;

NOTIFY pgrst, 'reload schema';
