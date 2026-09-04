-- Expected: one row per business, 6 categories, 21 accounts, zero voucher rows.
select b.id as business_id,
       count(distinct c.id) filter (where c.is_system) = 6 as categories_ok,
       count(distinct a.id) filter (where a.is_system) = 21 as accounts_ok,
       count(distinct a.id) filter (
         where a.is_system and (not a.is_active or a.archived_at is not null)
       ) = 0 as required_accounts_active
from public.businesses b
left join public.ledger_account_categories c on c.business_id = b.id
left join public.ledger_accounts a on a.business_id = b.id
group by b.id
order by b.id;

select 'repeat seed stable' as check_name,
       (r->>'systemCategoryCount')::int = 6
       and (r->>'systemAccountCount')::int = 21 as ok
from public.businesses b
cross join lateral public.seed_ledger_system_chart(b.id) r
union all
select 'no financial rows seeded', not exists (select 1 from public.ledger_vouchers)
union all
select 'business isolation', count(*) = count(distinct (business_id, account_code))
from public.ledger_accounts
union all
select 'report class integrity',
       not exists (
         select 1
         from public.ledger_accounts a
         join public.ledger_account_categories c
           on c.business_id = a.business_id and c.id = a.category_id
         where a.report_class <> c.report_class
       );
