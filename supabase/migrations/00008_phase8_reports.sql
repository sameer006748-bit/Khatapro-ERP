-- ============================================================================
-- KhataPro ERP — Phase 8: Financial, Sales, Purchase, Inventory Reports
--
-- This migration adds:
--   - report_profit_loss() RPC
--   - report_balance_sheet() RPC
--   - report_sales_summary() RPC
--   - report_inventory_valuation() RPC
--   - report_cash_flow() RPC
--   - report_expense_summary() RPC
--   - report_customer_outstanding() RPC
--   - report_vendor_outstanding() RPC
--   - 5 new permissions
--
-- All financial reports derive from posted voucher_lines.
-- All money in numeric(20,0) paisas.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- RPCs
-- ============================================================================

-- ----------------------------------------------------------------------------
-- report_profit_loss() — Profit & Loss for a date range
-- Returns: revenue, cogs, gross_profit, expenses, net_profit broken down by account
-- ----------------------------------------------------------------------------
create or replace function public.report_profit_loss(
  p_business_id text,
  p_from_date date,
  p_to_date date
)
returns table (
  section text,
  account_code text,
  account_name text,
  category_type text,
  amount numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
  select
    case
      when a.category_id in (select id from public.account_categories where business_id = p_business_id and code = 'INCOME') then 'REVENUE'
      when a.category_id in (select id from public.account_categories where business_id = p_business_id and code = 'EXPENSE') then 'EXPENSE'
      else 'OTHER'
    end as section,
    a.code,
    a.name,
    c.type,
    -- For income accounts: credit - debit (positive = revenue)
    -- For expense accounts: debit - credit (positive = expense)
    case
      when c.type = 'Income' then coalesce(sum(vl.credit - vl.debit), 0)
      when c.type = 'Expense' then coalesce(sum(vl.debit - vl.credit), 0)
      else 0
    end as amount
  from public.accounts a
  join public.account_categories c on c.id = a.category_id
  left join public.voucher_lines vl on vl.account_id = a.id
  left join public.vouchers v on v.id = vl.voucher_id
  where a.business_id = p_business_id
    and a.is_active = true
    and v.business_id = p_business_id
    and v.is_cancelled = false
    and v.voucher_date >= p_from_date
    and v.voucher_date <= p_to_date
  group by a.code, a.name, c.type, a.category_id
  having coalesce(sum(case when c.type = 'Income' then vl.credit - vl.debit else vl.debit - vl.credit end), 0) <> 0
  order by section, a.code;
end;
$$;

-- ----------------------------------------------------------------------------
-- report_balance_sheet() — Balance Sheet as of a date
-- Returns: assets, liabilities, equity with balances
-- ----------------------------------------------------------------------------
create or replace function public.report_balance_sheet(
  p_business_id text,
  p_as_of_date date
)
returns table (
  section text,
  account_code text,
  account_name text,
  category_type text,
  balance numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
  select
    case
      when c.type = 'Asset' then 'ASSET'
      when c.type = 'Liability' then 'LIABILITY'
      when c.type = 'Equity' then 'EQUITY'
      else 'OTHER'
    end as section,
    a.code,
    a.name,
    c.type,
    -- Balance = debit - credit (for assets) or credit - debit (for liabilities/equity)
    case
      when c.type = 'Asset' then coalesce(sum(vl.debit - vl.credit), 0)
      when c.type in ('Liability', 'Equity') then coalesce(sum(vl.credit - vl.debit), 0)
      else 0
    end as balance
  from public.accounts a
  join public.account_categories c on c.id = a.category_id
  left join public.voucher_lines vl on vl.account_id = a.id
  left join public.vouchers v on v.id = vl.voucher_id
  where a.business_id = p_business_id
    and a.is_active = true
    and (v.business_id = p_business_id or v.business_id is null)
    and (v.is_cancelled = false or v.is_cancelled is null)
    and (v.voucher_date <= p_as_of_date or v.voucher_date is null)
  group by a.code, a.name, c.type
  having coalesce(sum(vl.debit - vl.credit), 0) <> 0 or coalesce(sum(vl.credit - vl.debit), 0) <> 0
  order by section, a.code;
end;
$$;

-- ----------------------------------------------------------------------------
-- report_sales_summary() — Sales summary by type for a date range
-- ----------------------------------------------------------------------------
create or replace function public.report_sales_summary(
  p_business_id text,
  p_from_date date,
  p_to_date date
)
returns table (
  invoice_type text,
  invoice_count bigint,
  total_subtotal numeric,
  total_paid numeric,
  total_outstanding numeric,
  returned_count bigint
)
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
  select
    i.invoice_type,
    count(*)::bigint as invoice_count,
    coalesce(sum(i.subtotal), 0) as total_subtotal,
    coalesce(sum(i.paid_amount), 0) as total_paid,
    coalesce(sum(i.outstanding_amount), 0) as total_outstanding,
    count(*) filter (where i.is_returned = true)::bigint as returned_count
  from public.invoices i
  where i.business_id = p_business_id
    and i.is_cancelled = false
    and i.invoice_date >= p_from_date
    and i.invoice_date <= p_to_date
  group by i.invoice_type
  order by i.invoice_type;
end;
$$;

-- ----------------------------------------------------------------------------
-- report_inventory_valuation() — Inventory valuation from products
-- ----------------------------------------------------------------------------
create or replace function public.report_inventory_valuation(
  p_business_id text
)
returns table (
  product_id text,
  product_name text,
  category_name text,
  current_stock integer,
  weighted_average_cost numeric,
  stock_value numeric,
  sale_price numeric(14,2),
  low_stock_threshold integer
)
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
  select
    p.id,
    p.name,
    pc.name,
    p.current_stock,
    p.weighted_average_cost,
    case when p.current_stock > 0 then p.current_stock * p.weighted_average_cost else 0 end as stock_value,
    p.sale_price,
    coalesce(p.low_stock_threshold, 5) as low_stock_threshold
  from public.products p
  left join public.product_categories pc on pc.id = p.category_id
  where p.business_id = p_business_id
    and p.is_active = true
  order by p.name;
end;
$$;

-- ----------------------------------------------------------------------------
-- report_cash_flow() — Cash/Bank/Wallet movement for a date range
-- ----------------------------------------------------------------------------
create or replace function public.report_cash_flow(
  p_business_id text,
  p_from_date date,
  p_to_date date
)
returns table (
  account_id text,
  account_code text,
  account_name text,
  opening_balance numeric,
  total_debit numeric,
  total_credit numeric,
  closing_balance numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
  with account_mov as (
    select
      a.id as account_id,
      a.code as account_code,
      a.name as account_name,
      coalesce(sum(vl.debit - vl.credit) filter (where v.voucher_date < p_from_date), 0) as opening,
      coalesce(sum(vl.debit) filter (where v.voucher_date >= p_from_date and v.voucher_date <= p_to_date), 0) as period_debit,
      coalesce(sum(vl.credit) filter (where v.voucher_date >= p_from_date and v.voucher_date <= p_to_date), 0) as period_credit
    from public.accounts a
    left join public.voucher_lines vl on vl.account_id = a.id
    left join public.vouchers v on v.id = vl.voucher_id and v.business_id = p_business_id and v.is_cancelled = false
    where a.business_id = p_business_id
      and a.is_active = true
      and a.is_business_account = true
      and a.category_id in (select id from public.account_categories where business_id = p_business_id and code = 'ASSET')
    group by a.id, a.code, a.name
  )
  select
    am.account_id, am.account_code, am.account_name,
    am.opening, am.period_debit, am.period_credit,
    am.opening + am.period_debit - am.period_credit as closing
  from account_mov am
  order by am.account_code;
end;
$$;

-- ----------------------------------------------------------------------------
-- report_expense_summary() — Expense breakdown for a date range
-- ----------------------------------------------------------------------------
create or replace function public.report_expense_summary(
  p_business_id text,
  p_from_date date,
  p_to_date date
)
returns table (
  account_code text,
  account_name text,
  total_amount numeric,
  entry_count bigint
)
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
  select
    a.code,
    a.name,
    coalesce(sum(vl.debit - vl.credit), 0) as total_amount,
    count(*)::bigint as entry_count
  from public.accounts a
  join public.account_categories c on c.id = a.category_id
  join public.voucher_lines vl on vl.account_id = a.id
  join public.vouchers v on v.id = vl.voucher_id
  where a.business_id = p_business_id
    and a.is_active = true
    and c.type = 'Expense'
    and v.business_id = p_business_id
    and v.is_cancelled = false
    and v.voucher_date >= p_from_date
    and v.voucher_date <= p_to_date
  group by a.code, a.name
  having coalesce(sum(vl.debit - vl.credit), 0) <> 0
  order by total_amount desc;
end;
$$;

-- ----------------------------------------------------------------------------
-- report_customer_outstanding() — Customer receivables outstanding
-- ----------------------------------------------------------------------------
create or replace function public.report_customer_outstanding(
  p_business_id text
)
returns table (
  customer_name text,
  customer_phone text,
  total_billed numeric,
  total_paid numeric,
  total_returned numeric,
  outstanding numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
  select
    i.customer_name,
    i.customer_phone,
    coalesce(sum(i.subtotal), 0) as total_billed,
    coalesce(sum(i.paid_amount), 0) as total_paid,
    0::numeric as total_returned,
    coalesce(sum(i.outstanding_amount), 0) as outstanding
  from public.invoices i
  where i.business_id = p_business_id
    and i.is_cancelled = false
    and i.customer_name is not null
  group by i.customer_name, i.customer_phone
  having coalesce(sum(i.outstanding_amount), 0) > 0
  order by outstanding desc;
end;
$$;

-- ----------------------------------------------------------------------------
-- report_vendor_outstanding() — Vendor payables outstanding
-- ----------------------------------------------------------------------------
create or replace function public.report_vendor_outstanding(
  p_business_id text
)
returns table (
  vendor_id text,
  vendor_name text,
  total_purchased numeric,
  total_paid numeric,
  total_returned numeric,
  outstanding numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
  select
    v.id as vendor_id,
    v.name as vendor_name,
    coalesce(sum(p.total), 0) as total_purchased,
    coalesce(sum(p.paid_amount), 0) as total_paid,
    0::numeric as total_returned,
    coalesce(sum(p.outstanding_amount), 0) as outstanding
  from public.vendors v
  left join public.purchases p on p.vendor_id = v.id and p.business_id = p_business_id
  where v.business_id = p_business_id
    and v.is_active = true
  group by v.id, v.name
  having coalesce(sum(p.outstanding_amount), 0) > 0
  order by outstanding desc;
end;
$$;

-- ============================================================================
-- PERMISSIONS
-- ============================================================================

insert into public.permissions (code, module, description) values
  ('can_view_sales_reports', 'reports', 'View sales reports'),
  ('can_view_purchase_reports', 'reports', 'View purchase reports'),
  ('can_view_inventory_reports', 'reports', 'View inventory reports'),
  ('can_view_delivery_reports', 'reports', 'View delivery and rider reports'),
  ('can_view_audit_reports', 'reports', 'View audit and exception reports')
on conflict (code) do update set module = excluded.module, description = excluded.description;

-- Grant to Owner/Admin
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.business_id = 'biz-default' and r.name = 'Owner/Admin'
  and p.code in ('can_view_sales_reports','can_view_purchase_reports','can_view_inventory_reports',
                 'can_view_delivery_reports','can_view_audit_reports')
on conflict do nothing;

-- Grant to Accountant
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.business_id = 'biz-default' and r.name = 'Accountant'
  and p.code in ('can_view_sales_reports','can_view_purchase_reports','can_view_inventory_reports',
                 'can_view_delivery_reports','can_view_audit_reports')
on conflict do nothing;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Done. Phase 8 report RPCs are live with:
--   ✓ report_profit_loss() — P&L from voucher_lines
--   ✓ report_balance_sheet() — Balance Sheet as of date
--   ✓ report_sales_summary() — Sales by type
--   ✓ report_inventory_valuation() — Stock value from WAC
--   ✓ report_cash_flow() — Cash/Bank/Wallet movement
--   ✓ report_expense_summary() — Expense breakdown
--   ✓ report_customer_outstanding() — Customer receivables
--   ✓ report_vendor_outstanding() — Vendor payables
--   ✓ 5 new permissions granted to Owner/Admin + Accountant
-- ============================================================================
