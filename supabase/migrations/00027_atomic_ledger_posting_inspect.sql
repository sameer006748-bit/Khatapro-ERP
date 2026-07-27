-- Expected: every row has ok = true.
select 'posting function security definer' as check_name,
       exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'post_ledger_voucher'
           and p.prosecdef
       ) as ok
union all
select 'service role execute',
       has_function_privilege(
         'service_role',
         'public.post_ledger_voucher(uuid,text,date,text,jsonb,text,text,text,uuid,text,text,uuid)',
         'EXECUTE'
       )
union all
select 'authenticated denied',
       not has_function_privilege(
         'authenticated',
         'public.post_ledger_voucher(uuid,text,date,text,jsonb,text,text,text,uuid,text,text,uuid)',
         'EXECUTE'
       )
union all
select 'anon denied',
       not has_function_privilege(
         'anon',
         'public.post_ledger_voucher(uuid,text,date,text,jsonb,text,text,text,uuid,text,text,uuid)',
         'EXECUTE'
       )
union all
select 'idempotency unique',
       exists (
         select 1 from pg_constraint
         where conrelid = to_regclass('public.ledger_vouchers')
           and conname = 'ledger_vouchers_idempotency_key'
       )
union all
select 'source exact once',
       exists (
         select 1 from pg_constraint
         where conrelid = to_regclass('public.ledger_vouchers')
           and conname = 'ledger_vouchers_source_key'
       )
union all
select 'all stored vouchers balanced',
       not exists (
         select 1 from public.ledger_vouchers
         where total_debit_paisas <> total_credit_paisas
       )
union all
select 'all line sums match voucher totals',
       not exists (
         select 1
         from public.ledger_vouchers v
         left join public.ledger_voucher_lines l
           on l.business_id = v.business_id and l.voucher_id = v.id
         group by v.id, v.total_debit_paisas, v.total_credit_paisas
         having coalesce(sum(l.debit_paisas), 0) <> v.total_debit_paisas
             or coalesce(sum(l.credit_paisas), 0) <> v.total_credit_paisas
       );

-- Manual transaction tests are intentionally not executed by this file:
-- 1. post a valid two-line voucher;
-- 2. repeat the same key/payload and expect idempotent=true/same voucher_id;
-- 3. change the payload with the same key and expect SQLSTATE 23505;
-- 4. attempt an unbalanced, one-line, foreign, inactive, or non-postable account;
-- 5. run two sessions and confirm distinct readable numbers;
-- 6. roll back a post and confirm voucher/lines/sequence allocation all disappear.
