-- Core financial reports read only the canonical UUID ledger.
begin;

do $$
begin
  if to_regclass('public.ledger_vouchers') is null
     or to_regclass('public.ledger_voucher_lines') is null
     or to_regclass('public.ledger_accounts') is null then
    raise exception 'Ledger reports require migrations 00025-00029';
  end if;
end $$;

create or replace function public.ledger_general_ledger(
  p_business_id uuid,
  p_account_id uuid,
  p_from_date date default null,
  p_to_date date default null
) returns table(
  line_id uuid,
  voucher_id uuid,
  readable_number text,
  voucher_type text,
  transaction_date date,
  narration text,
  reference text,
  source_type text,
  source_id text,
  debit_paisas numeric,
  credit_paisas numeric,
  running_balance_paisas numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with running as (
    select
      l.id as line_id,
      v.id as voucher_id,
      v.readable_number,
      v.voucher_type,
      v.transaction_date,
      coalesce(l.line_narration, v.narration) as narration,
      v.reference,
      v.source_type,
      v.source_id,
      l.debit_paisas,
      l.credit_paisas,
      sum(l.debit_paisas - l.credit_paisas) over (
        order by v.transaction_date, v.posted_at, l.line_number, l.id
        rows between unbounded preceding and current row
      ) as running_balance_paisas
    from public.ledger_voucher_lines l
    join public.ledger_vouchers v
      on v.business_id = l.business_id and v.id = l.voucher_id
    where l.business_id = p_business_id
      and l.account_id = p_account_id
      and (p_to_date is null or v.transaction_date <= p_to_date)
  )
  select *
  from running
  where p_from_date is null or transaction_date >= p_from_date
  order by transaction_date, readable_number, line_id
$$;

create or replace function public.ledger_trial_balance(
  p_business_id uuid,
  p_from_date date default null,
  p_to_date date default null
) returns table(
  account_id uuid,
  account_code text,
  account_name text,
  category_code text,
  category_name text,
  category_type text,
  subcategory_name text,
  opening_debit numeric,
  opening_credit numeric,
  period_debit numeric,
  period_credit numeric,
  closing_debit numeric,
  closing_credit numeric,
  total_debit numeric,
  total_credit numeric,
  balance numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with movement as (
    select
      a.id,
      a.account_code,
      a.account_name,
      c.stable_code,
      c.display_name,
      a.report_class,
      s.name as subcategory_name,
      coalesce(sum(l.debit_paisas - l.credit_paisas) filter (
        where p_from_date is not null and v.transaction_date < p_from_date
      ), 0) as opening_net,
      coalesce(sum(l.debit_paisas) filter (
        where (p_from_date is null or v.transaction_date >= p_from_date)
          and (p_to_date is null or v.transaction_date <= p_to_date)
      ), 0) as period_debit,
      coalesce(sum(l.credit_paisas) filter (
        where (p_from_date is null or v.transaction_date >= p_from_date)
          and (p_to_date is null or v.transaction_date <= p_to_date)
      ), 0) as period_credit
    from public.ledger_accounts a
    join public.ledger_account_categories c
      on c.business_id = a.business_id and c.id = a.category_id
    left join public.ledger_voucher_lines l
      on l.business_id = a.business_id and l.account_id = a.id
    left join public.ledger_vouchers v
      on v.business_id = l.business_id and v.id = l.voucher_id
      and (p_to_date is null or v.transaction_date <= p_to_date)
    left join public.account_subcategory_assignments assignment
      on assignment.business_id = a.business_id and assignment.account_id = a.id
    left join public.account_subcategories s on s.id = assignment.subcategory_id
    where a.business_id = p_business_id
    group by a.id, a.account_code, a.account_name, c.stable_code,
             c.display_name, a.report_class, s.name
  )
  select
    id, account_code, account_name, stable_code, display_name, report_class,
    subcategory_name,
    greatest(opening_net, 0),
    greatest(-opening_net, 0),
    period_debit,
    period_credit,
    greatest(opening_net + period_debit - period_credit, 0),
    greatest(-(opening_net + period_debit - period_credit), 0),
    period_debit,
    period_credit,
    opening_net + period_debit - period_credit
  from movement
  where opening_net <> 0 or period_debit <> 0 or period_credit <> 0
  order by account_code
$$;

create or replace function public.ledger_profit_loss(
  p_business_id uuid,
  p_from_date date,
  p_to_date date
) returns table(
  section text,
  account_id uuid,
  account_code text,
  account_name text,
  category_type text,
  subcategory_name text,
  amount numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    case c.statement_section
      when 'INCOME' then 'REVENUE'
      when 'COST_OF_GOODS_SOLD' then 'COST_OF_GOODS_SOLD'
      else 'EXPENSE'
    end,
    a.id,
    a.account_code,
    a.account_name,
    a.report_class,
    s.name,
    case
      when a.report_class = 'Income'
        then coalesce(sum(l.credit_paisas - l.debit_paisas), 0)
      else coalesce(sum(l.debit_paisas - l.credit_paisas), 0)
    end as amount
  from public.ledger_accounts a
  join public.ledger_account_categories c
    on c.business_id = a.business_id and c.id = a.category_id
  join public.ledger_voucher_lines l
    on l.business_id = a.business_id and l.account_id = a.id
  join public.ledger_vouchers v
    on v.business_id = l.business_id and v.id = l.voucher_id
   and v.transaction_date between p_from_date and p_to_date
  left join public.account_subcategory_assignments assignment
    on assignment.business_id = a.business_id and assignment.account_id = a.id
  left join public.account_subcategories s on s.id = assignment.subcategory_id
  where a.business_id = p_business_id
    and a.report_class in ('Income', 'Expense')
  group by c.statement_section, a.id, a.account_code, a.account_name,
           a.report_class, s.name
  having case
    when a.report_class = 'Income'
      then coalesce(sum(l.credit_paisas - l.debit_paisas), 0)
    else coalesce(sum(l.debit_paisas - l.credit_paisas), 0)
  end <> 0
  order by section, a.account_code
$$;

create or replace function public.ledger_balance_sheet(
  p_business_id uuid,
  p_as_of_date date
) returns table(
  section text,
  account_id uuid,
  account_code text,
  account_name text,
  category_type text,
  subcategory_name text,
  balance numeric,
  is_calculated boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with permanent as (
    select
      case a.report_class
        when 'Asset' then 'ASSET'
        when 'Liability' then 'LIABILITY'
        else 'EQUITY'
      end as section,
      a.id,
      a.account_code,
      a.account_name,
      a.report_class,
      s.name as subcategory_name,
      case
        when a.report_class = 'Asset'
          then coalesce(sum(
            case when v.id is not null then l.debit_paisas - l.credit_paisas else 0 end
          ), 0)
        else coalesce(sum(
          case when v.id is not null then l.credit_paisas - l.debit_paisas else 0 end
        ), 0)
      end as balance
    from public.ledger_accounts a
    left join public.ledger_voucher_lines l
      on l.business_id = a.business_id and l.account_id = a.id
    left join public.ledger_vouchers v
      on v.business_id = l.business_id and v.id = l.voucher_id
     and v.transaction_date <= p_as_of_date
    left join public.account_subcategory_assignments assignment
      on assignment.business_id = a.business_id and assignment.account_id = a.id
    left join public.account_subcategories s on s.id = assignment.subcategory_id
    where a.business_id = p_business_id
      and a.report_class in ('Asset', 'Liability', 'Equity')
      and a.account_code <> '3031'
    group by a.id, a.account_code, a.account_name, a.report_class, s.name
  ),
  earnings as (
    select coalesce(sum(case
      when a.report_class = 'Income' then l.credit_paisas - l.debit_paisas
      when a.report_class = 'Expense' then l.credit_paisas - l.debit_paisas
      else 0
    end), 0) as balance
    from public.ledger_voucher_lines l
    join public.ledger_vouchers v
      on v.business_id = l.business_id and v.id = l.voucher_id
    join public.ledger_accounts a
      on a.business_id = l.business_id and a.id = l.account_id
    where l.business_id = p_business_id
      and v.transaction_date <= p_as_of_date
      and a.report_class in ('Income', 'Expense')
  )
  select section, id, account_code, account_name, report_class,
         subcategory_name, balance, false
  from permanent
  where balance <> 0
  union all
  select 'EQUITY', a.id, a.account_code, a.account_name, a.report_class,
         null::text, e.balance, true
  from public.ledger_accounts a
  cross join earnings e
  where a.business_id = p_business_id and a.account_code = '3031'
  order by section, account_code
$$;

create or replace function public.ledger_account_balances(
  p_business_id uuid,
  p_as_of_date date default null
) returns table(
  account_id uuid,
  account_code text,
  account_name text,
  report_class text,
  account_class text,
  balance_paisas numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    a.id, a.account_code, a.account_name, a.report_class, a.account_class,
    case
      when a.report_class = 'Asset'
        then coalesce(sum(
          case when v.id is not null then l.debit_paisas - l.credit_paisas else 0 end
        ), 0)
      else coalesce(sum(
        case when v.id is not null then l.credit_paisas - l.debit_paisas else 0 end
      ), 0)
    end
  from public.ledger_accounts a
  left join public.ledger_voucher_lines l
    on l.business_id = a.business_id and l.account_id = a.id
  left join public.ledger_vouchers v
    on v.business_id = l.business_id and v.id = l.voucher_id
   and (p_as_of_date is null or v.transaction_date <= p_as_of_date)
  where a.business_id = p_business_id and a.is_active
  group by a.id, a.account_code, a.account_name, a.report_class, a.account_class
  order by a.account_code
$$;

create or replace function public.ledger_day_book(
  p_business_id uuid,
  p_from_date date default null,
  p_to_date date default null,
  p_voucher_type text default null
) returns table(
  voucher_id uuid,
  voucher_no text,
  voucher_type text,
  voucher_date date,
  memo text,
  total_debit numeric,
  total_credit numeric,
  is_cancelled boolean,
  posted_at timestamptz,
  posted_by uuid,
  reference_type text,
  reference_id text,
  source_label text,
  lines jsonb
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    v.id,
    v.readable_number,
    v.voucher_type,
    v.transaction_date,
    v.narration,
    v.total_debit_paisas,
    v.total_credit_paisas,
    false,
    v.posted_at,
    v.posted_by,
    v.source_type,
    v.source_id,
    coalesce(v.reference, v.source_type, 'Manual voucher'),
    jsonb_agg(jsonb_build_object(
      'line_id', l.id,
      'account_id', l.account_id,
      'account_code', a.account_code,
      'account_name', a.account_name,
      'debit', l.debit_paisas,
      'credit', l.credit_paisas,
      'memo', l.line_narration
    ) order by l.line_number)
  from public.ledger_vouchers v
  join public.ledger_voucher_lines l
    on l.business_id = v.business_id and l.voucher_id = v.id
  join public.ledger_accounts a
    on a.business_id = l.business_id and a.id = l.account_id
  where v.business_id = p_business_id
    and (p_from_date is null or v.transaction_date >= p_from_date)
    and (p_to_date is null or v.transaction_date <= p_to_date)
    and (p_voucher_type is null or v.voucher_type = p_voucher_type)
  group by v.id
  order by v.transaction_date desc, v.posted_at desc
$$;

revoke all on function public.ledger_general_ledger(uuid, uuid, date, date)
  from public, anon, authenticated;
revoke all on function public.ledger_trial_balance(uuid, date, date)
  from public, anon, authenticated;
revoke all on function public.ledger_profit_loss(uuid, date, date)
  from public, anon, authenticated;
revoke all on function public.ledger_balance_sheet(uuid, date)
  from public, anon, authenticated;
revoke all on function public.ledger_account_balances(uuid, date)
  from public, anon, authenticated;
revoke all on function public.ledger_day_book(uuid, date, date, text)
  from public, anon, authenticated;
grant execute on function public.ledger_general_ledger(uuid, uuid, date, date) to service_role;
grant execute on function public.ledger_trial_balance(uuid, date, date) to service_role;
grant execute on function public.ledger_profit_loss(uuid, date, date) to service_role;
grant execute on function public.ledger_balance_sheet(uuid, date) to service_role;
grant execute on function public.ledger_account_balances(uuid, date) to service_role;
grant execute on function public.ledger_day_book(uuid, date, date, text) to service_role;

commit;
notify pgrst, 'reload schema';
