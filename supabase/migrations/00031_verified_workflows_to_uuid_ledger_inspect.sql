-- Static/catalog checks. Runtime fixture tests remain mandatory.
select p.proname,
       p.prosecdef as security_definer,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute,
       not has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_denied
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'post_sale_phase2_ledger', 'post_sale_return_ledger',
    'receive_invoice_payment_ledger', 'record_delivery_outcome_ledger',
    'settle_rider_cod_ledger', 'post_opening_stock_ledger'
  )
order by p.proname;

select 'no duplicate source vouchers' as check_name,
       not exists (
         select business_id, source_type, source_id
         from public.ledger_vouchers
         where source_type is not null
         group by business_id, source_type, source_id
         having count(*) > 1
       ) as ok
union all
select 'delivery collection never posts business cash',
       not exists (
         select 1
         from public.ledger_vouchers v
         join public.ledger_voucher_lines l
           on l.business_id = v.business_id and l.voucher_id = v.id
         join public.ledger_accounts a
           on a.business_id = l.business_id and a.id = l.account_id
         where v.source_type = 'delivery_outcome'
           and a.account_code in ('1010', '1020', '1030')
       )
union all
select 'contra capital drawings excluded from pnl classes',
       not exists (
         select 1
         from public.ledger_vouchers v
         join public.ledger_voucher_lines l
           on l.business_id = v.business_id and l.voucher_id = v.id
         join public.ledger_accounts a
           on a.business_id = l.business_id and a.id = l.account_id
         where v.source_type = 'business_money_transaction'
           and a.report_class in ('Income', 'Expense')
       );

-- Stop conditions retained for controlled dev migration testing:
-- * do not promote if the existing post_sale_phase2/create_stock_movement RPC
--   signature differs from the inspected production schema;
-- * do not connect purchases, purchase returns, generic expenses, or manual
--   stock adjustments until their production column/type discovery is recorded;
-- * do not invent a rider/commission settlement accounting policy.
