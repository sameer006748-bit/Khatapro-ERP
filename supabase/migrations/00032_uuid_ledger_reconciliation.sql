-- Read-only reconciliation. MANUAL_APPROVED_BACKFILL is deliberately blocked
-- until a future approval supplies reviewed source IDs and accounting totals.
begin;

create or replace function public.ledger_optional_source_summary(
  p_business_id uuid,
  p_table_name text,
  p_date_column text,
  p_total_column text,
  p_source_type text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_table_name not in ('purchases', 'purchase_returns', 'expenses') then
    raise exception 'Unsupported reconciliation table';
  end if;
  if to_regclass(format('public.%I', p_table_name)) is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = p_table_name
         and column_name = 'business_id'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = p_table_name
         and column_name = 'id'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = p_table_name
         and column_name = p_date_column
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = p_table_name
         and column_name = p_total_column
     ) then
    return jsonb_build_object(
      'sourceType', p_source_type,
      'status', 'UNSUPPORTED_SCHEMA',
      'sourceCount', 0,
      'missingVoucherCount', 0,
      'proposedDebitPaisas', 0,
      'proposedCreditPaisas', 0
    );
  end if;
  execute format(
    $sql$
      select jsonb_build_object(
        'sourceType', %L,
        'status', 'READY_FOR_REVIEW',
        'sourceCount', count(*),
        'fromDate', min(%I)::text,
        'toDate', max(%I)::text,
        'missingVoucherCount', count(*) filter (
          where not exists (
            select 1 from public.ledger_vouchers v
            where v.business_id = $1
              and v.source_type = %L
              and v.source_id = source.id::text
          )
        ),
        'malformedCount', count(*) filter (
          where %I is null or %I < 0 or %I <> trunc(%I)
        ),
        'proposedDebitPaisas', coalesce(sum(%I), 0),
        'proposedCreditPaisas', coalesce(sum(%I), 0)
      )
      from public.%I source
      where source.business_id::text = $1::text
    $sql$,
    p_source_type, p_date_column, p_date_column, p_source_type,
    p_total_column, p_total_column, p_total_column, p_total_column,
    p_total_column, p_total_column, p_table_name
  ) into v_result using p_business_id;
  return v_result;
end $$;

create or replace function public.ledger_reconciliation(
  p_business_id uuid,
  p_mode text default 'DRY_RUN_ONLY'
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_sources jsonb;
  v_ledger jsonb;
begin
  if not exists (select 1 from public.businesses where id = p_business_id) then
    raise exception 'Reconciliation business does not exist';
  end if;
  if upper(trim(coalesce(p_mode, ''))) = 'MANUAL_APPROVED_BACKFILL' then
    raise exception 'MANUAL_APPROVED_BACKFILL requires a separate future approval and reviewed source manifest'
      using errcode = '42501';
  elsif upper(trim(coalesce(p_mode, ''))) <> 'DRY_RUN_ONLY' then
    raise exception 'Mode must be DRY_RUN_ONLY or MANUAL_APPROVED_BACKFILL';
  end if;

  select jsonb_build_object(
    'voucherCount', count(*),
    'debitPaisas', coalesce(sum(total_debit_paisas), 0),
    'creditPaisas', coalesce(sum(total_credit_paisas), 0),
    'unbalancedVoucherCount', count(*) filter (
      where total_debit_paisas <> total_credit_paisas
    ),
    'duplicateSourceCount', (
      select count(*) from (
        select source_type, source_id
        from public.ledger_vouchers
        where business_id = p_business_id and source_type is not null
        group by source_type, source_id
        having count(*) > 1
      ) duplicate
    ),
    'lineTotalMismatchCount', (
      select count(*) from (
        select v.id
        from public.ledger_vouchers v
        left join public.ledger_voucher_lines l
          on l.business_id = v.business_id and l.voucher_id = v.id
        where v.business_id = p_business_id
        group by v.id, v.total_debit_paisas, v.total_credit_paisas
        having coalesce(sum(l.debit_paisas), 0) <> v.total_debit_paisas
            or coalesce(sum(l.credit_paisas), 0) <> v.total_credit_paisas
      ) mismatch
    )
  ) into v_ledger
  from public.ledger_vouchers
  where business_id = p_business_id;

  select jsonb_build_array(
    (
      select jsonb_build_object(
        'sourceType', 'sale',
        'status', 'READY_FOR_REVIEW',
        'sourceCount', count(*),
        'fromDate', min(i.invoice_date)::text,
        'toDate', max(i.invoice_date)::text,
        'missingVoucherCount', count(*) filter (
          where not exists (
            select 1 from public.ledger_vouchers v
            where v.business_id = p_business_id
              and v.source_type = 'sale' and v.source_id = i.id::text
          )
        ),
        'malformedCount', count(*) filter (
          where i.total is null or i.total < 0 or i.paid < 0 or i.paid > i.total
        ),
        'proposedDebitPaisas',
          coalesce(sum(i.total), 0)
          + coalesce((
            select sum(coalesce(ii.unit_cost_paisas, 0) * ii.qty)
            from public.invoice_items ii
            where ii.business_id = p_business_id
          ), 0),
        'proposedCreditPaisas',
          coalesce(sum(i.total), 0)
          + coalesce((
            select sum(coalesce(ii.unit_cost_paisas, 0) * ii.qty)
            from public.invoice_items ii
            where ii.business_id = p_business_id
          ), 0)
      )
      from public.invoices i
      where i.business_id = p_business_id
    ),
    (
      select jsonb_build_object(
        'sourceType', 'sale_return',
        'status', 'READY_FOR_REVIEW',
        'sourceCount', count(*),
        'fromDate', min(r.return_date)::date::text,
        'toDate', max(r.return_date)::date::text,
        'missingVoucherCount', count(*) filter (
          where not exists (
            select 1 from public.ledger_vouchers v
            where v.business_id = p_business_id
              and v.source_type = 'sale_return' and v.source_id = r.id::text
          )
        ),
        'malformedCount', count(*) filter (where r.total is null or r.total < 0),
        'proposedDebitPaisas', coalesce(sum(r.total), 0),
        'proposedCreditPaisas', coalesce(sum(r.total), 0)
      )
      from public.sale_return_documents r
      where r.business_id = p_business_id and r.status = 'posted'
    ),
    (
      select jsonb_build_object(
        'sourceType', 'invoice_payment',
        'status', 'READY_FOR_REVIEW',
        'sourceCount', count(*),
        'fromDate', min(p.created_at)::date::text,
        'toDate', max(p.created_at)::date::text,
        'missingVoucherCount', count(*) filter (
          where not exists (
            select 1 from public.ledger_vouchers v
            where v.business_id = p_business_id
              and v.source_type = 'invoice_payment' and v.source_id = p.id::text
          )
        ),
        'malformedCount', count(*) filter (where p.amount is null or p.amount <= 0),
        'proposedDebitPaisas', coalesce(sum(p.amount), 0),
        'proposedCreditPaisas', coalesce(sum(p.amount), 0)
      )
      from public.payments p
      where p.business_id = p_business_id
        and p.direction = 'Received'
        and p.return_document_id is null
    ),
    (
      select jsonb_build_object(
        'sourceType', 'business_money_transaction',
        'status', 'READY_FOR_REVIEW',
        'sourceCount', count(*),
        'fromDate', min(t.transaction_date)::text,
        'toDate', max(t.transaction_date)::text,
        'missingVoucherCount', count(*) filter (where t.ledger_voucher_id is null),
        'malformedCount', count(*) filter (
          where t.amount_paisas is null or t.amount_paisas <= 0
        ),
        'proposedDebitPaisas', coalesce(sum(t.amount_paisas), 0),
        'proposedCreditPaisas', coalesce(sum(t.amount_paisas), 0)
      )
      from public.business_money_transactions t
      where t.business_id = p_business_id
    ),
    public.ledger_optional_source_summary(
      p_business_id, 'purchases', 'purchase_date', 'total', 'purchase'
    ),
    public.ledger_optional_source_summary(
      p_business_id, 'purchase_returns', 'return_date', 'total_amount', 'purchase_return'
    ),
    public.ledger_optional_source_summary(
      p_business_id, 'expenses', 'expense_date', 'total_amount', 'expense'
    )
  ) into v_sources;

  return jsonb_build_object(
    'mode', 'DRY_RUN_ONLY',
    'businessId', p_business_id,
    'generatedAt', now(),
    'ledger', v_ledger,
    'sources', v_sources,
    'containsCustomerPii', false,
    'mutationPerformed', false,
    'stopConditions', jsonb_build_array(
      'Any unbalanced or line-total mismatch',
      'Any duplicate canonical source reference',
      'Any malformed source row',
      'Any UNSUPPORTED_SCHEMA source',
      'Any source whose exact account mapping is not approved'
    )
  );
end $$;

revoke all on function public.ledger_optional_source_summary(
  uuid, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.ledger_reconciliation(uuid, text)
  from public, anon, authenticated;
grant execute on function public.ledger_reconciliation(uuid, text) to service_role;

commit;
notify pgrst, 'reload schema';
