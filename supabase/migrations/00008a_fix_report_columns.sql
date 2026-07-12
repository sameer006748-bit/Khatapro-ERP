-- ============================================================================
-- KhataPro ERP — Fix: report_sales_summary + report_customer_outstanding
-- Bug: used non-existent column i.outstanding_amount (should be total - paid_amount)
-- ============================================================================

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
    coalesce(sum(i.total - i.paid_amount), 0) as total_outstanding,
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
    coalesce(sum(i.total - i.paid_amount), 0) as outstanding
  from public.invoices i
  where i.business_id = p_business_id
    and i.is_cancelled = false
    and i.customer_name is not null
  group by i.customer_name, i.customer_phone
  having coalesce(sum(i.total - i.paid_amount), 0) > 0
  order by outstanding desc;
end;
$$;

NOTIFY pgrst, 'reload schema';
