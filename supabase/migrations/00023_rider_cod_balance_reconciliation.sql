-- Fix get_rider_cod_balances' oldest_outstanding_delivery_date heuristic.
-- Root cause: settle_rider_cod can allocate against the same collection
-- entry across multiple settlement batches (partial settlement), each
-- inserting its own rider_cash_ledger row with related_entry_id = c.id.
-- The prior heuristic checked whether any SINGLE settlement row had
-- amount >= c.amount, so a collection fully settled via two or more
-- partial installments was still counted as outstanding. This replaces
-- the single-row check with a per-entry settlement sum.
begin;

do $$
begin
  if to_regclass('public.rider_cash_ledger') is null
     or to_regclass('public.riders') is null then
    raise exception 'Rider COD balance reconciliation requires riders and rider_cash_ledger';
  end if;
end $$;

create or replace function public.get_rider_cod_balances(
  p_business_id uuid, p_rider_id uuid default null
) returns table(
  rider_id uuid, rider_name text, collected_cod numeric, settled_cod numeric,
  outstanding_cod numeric, invoice_count bigint, oldest_outstanding_delivery_date timestamptz,
  latest_settlement_date timestamptz
)
language plpgsql security definer
set search_path = public
as $$
declare v_profile public.profiles%rowtype; v_self_rider uuid;
begin
  v_profile := public.phase3_assert_active_profile(p_business_id);
  if v_profile.role = 'Rider' then
    select r.id into v_self_rider from public.riders r where r.business_id = p_business_id and r.profile_id = v_profile.id;
    if v_self_rider is null then raise exception 'No rider profile linked to this account' using errcode = '42501'; end if;
    if p_rider_id is not null and p_rider_id <> v_self_rider then raise exception 'Rider can only view own COD balance' using errcode = '42501'; end if;
    p_rider_id := v_self_rider;
  elsif v_profile.role not in ('Owner', 'Admin', 'Accountant')
    and not (coalesce(v_profile.perms, '{}'::text[]) && array['can_view_rider_cod', 'can_settle_rider_cod']) then
    raise exception 'Profile is not permitted to view rider COD' using errcode = '42501';
  end if;
  return query
  select r.id, r.name,
    coalesce(sum(case when c.event_type = 'collection' then c.amount else 0 end), 0),
    coalesce(sum(case when c.event_type = 'settlement' then c.amount else 0 end), 0),
    coalesce(sum(case when c.event_type = 'collection' then c.amount else -c.amount end), 0),
    count(distinct c.invoice_id) filter (where c.event_type = 'collection'),
    min(c.delivered_at) filter (
      where c.event_type = 'collection'
        and c.amount > coalesce((
          select sum(s.amount) from public.rider_cash_ledger s
          where s.related_entry_id = c.id and s.event_type = 'settlement'
        ), 0)
    ),
    max(b.settled_at)
  from public.riders r
  left join public.rider_cash_ledger c on c.business_id = r.business_id and c.rider_id = r.id
  left join public.rider_cod_settlement_batches b on b.business_id = r.business_id and b.rider_id = r.id
  where r.business_id = p_business_id and (p_rider_id is null or r.id = p_rider_id)
  group by r.id, r.name;
end $$;

commit;
