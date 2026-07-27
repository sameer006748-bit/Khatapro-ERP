-- Expected: every boolean is true. Existing unvouchered rows must be zero in
-- production (production discovery found business_money_transactions empty).
select 'money accounts linked' as check_name,
       not exists (
         select 1 from public.business_money_accounts
         where ledger_account_id is null
       ) as ok
union all
select 'no unvouchered operational history',
       not exists (
         select 1 from public.business_money_transactions
         where ledger_voucher_id is null
       )
union all
select 'operational and voucher references agree',
       not exists (
         select 1
         from public.business_money_transactions t
         join public.ledger_vouchers v
           on v.business_id = t.business_id and v.id = t.ledger_voucher_id
         where v.readable_number <> t.reference
            or v.source_type <> 'business_money_transaction'
            or v.source_id <> t.id::text
       )
union all
select 'owner money never hits profit and loss',
       not exists (
         select 1
         from public.business_money_transactions t
         join public.ledger_voucher_lines l
           on l.business_id = t.business_id and l.voucher_id = t.ledger_voucher_id
         join public.ledger_accounts a
           on a.business_id = l.business_id and a.id = l.account_id
         where a.report_class in ('Income', 'Expense')
       )
union all
select 'mutation functions service only',
       not has_function_privilege(
         'authenticated',
         'public.post_contra_transfer(uuid,uuid,uuid,numeric,date,text,text,uuid)',
         'EXECUTE'
       )
       and has_function_privilege(
         'service_role',
         'public.post_contra_transfer(uuid,uuid,uuid,numeric,date,text,text,uuid)',
         'EXECUTE'
       );

-- Controlled tests: seed capital, transfer part of it, draw part of it, then
-- retry each key. Confirm the same IDs return, balances derive from ledger
-- lines, Equity changes only for capital/drawings, and a forced exception
-- leaves neither the operational row nor voucher/lines.
