-- Idempotent minimum system Chart of Accounts for every UUID business.
-- No opening balances or other financial amounts are inserted here.
begin;

do $$
begin
  if to_regclass('public.ledger_account_categories') is null
     or to_regclass('public.ledger_accounts') is null then
    raise exception 'System chart seeding requires migration 00025';
  end if;
end $$;

create or replace function public.seed_ledger_system_chart(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_category_count integer;
  v_account_count integer;
  v_integrity_count integer;
begin
  if not exists (select 1 from public.businesses b where b.id = p_business_id) then
    raise exception 'Ledger seed business does not exist';
  end if;

  insert into public.ledger_account_categories (
    business_id, stable_code, display_name, report_class, statement_section, is_system
  )
  select p_business_id, x.stable_code, x.display_name, x.report_class, x.statement_section, true
  from (values
    ('CURRENT_ASSETS', 'Current Assets', 'Asset', 'CURRENT_ASSET'),
    ('CURRENT_LIABILITIES', 'Current Liabilities', 'Liability', 'CURRENT_LIABILITY'),
    ('EQUITY', 'Equity', 'Equity', 'EQUITY'),
    ('INCOME', 'Income', 'Income', 'INCOME'),
    ('COGS', 'Cost of Goods Sold', 'Expense', 'COST_OF_GOODS_SOLD'),
    ('EXPENSES', 'Expenses', 'Expense', 'EXPENSE')
  ) x(stable_code, display_name, report_class, statement_section)
  on conflict (business_id, stable_code) do nothing;

  select count(*) into v_integrity_count
  from public.ledger_account_categories c
  join (values
    ('CURRENT_ASSETS', 'Asset', 'CURRENT_ASSET'),
    ('CURRENT_LIABILITIES', 'Liability', 'CURRENT_LIABILITY'),
    ('EQUITY', 'Equity', 'EQUITY'),
    ('INCOME', 'Income', 'INCOME'),
    ('COGS', 'Expense', 'COST_OF_GOODS_SOLD'),
    ('EXPENSES', 'Expense', 'EXPENSE')
  ) expected(stable_code, report_class, statement_section)
    on expected.stable_code = c.stable_code
   and expected.report_class = c.report_class
   and expected.statement_section = c.statement_section
  where c.business_id = p_business_id and c.is_system and c.is_active;
  if v_integrity_count <> 6 then
    raise exception 'Existing ledger categories conflict with the required report classes';
  end if;

  insert into public.ledger_accounts (
    business_id, category_id, account_code, account_name, report_class,
    account_class, is_system, is_postable, operational_money_key, party_type
  )
  select
    p_business_id, c.id, x.account_code, x.account_name, x.report_class,
    x.account_class, true, x.is_postable, x.operational_money_key, x.party_type
  from (values
    ('CURRENT_ASSETS', '1010', 'Cash', 'Asset', 'asset', true, 'cash', null),
    ('CURRENT_ASSETS', '1020', 'Bank', 'Asset', 'asset', true, 'bank', null),
    ('CURRENT_ASSETS', '1030', 'Wallet', 'Asset', 'asset', true, 'wallet', null),
    ('CURRENT_ASSETS', '1040', 'Petty Cash', 'Asset', 'asset', true, null, null),
    ('CURRENT_ASSETS', '1100', 'Inventory', 'Asset', 'asset', true, null, null),
    ('CURRENT_ASSETS', '1200', 'Accounts Receivable', 'Asset', 'asset', true, null, 'customer'),
    ('CURRENT_ASSETS', '1300', 'Rider Held COD', 'Asset', 'asset', true, null, 'rider'),
    ('CURRENT_LIABILITIES', '2010', 'Accounts Payable', 'Liability', 'liability', true, null, 'vendor'),
    ('CURRENT_LIABILITIES', '2020', 'Rider Settlement Payable', 'Liability', 'liability', true, null, 'rider'),
    ('CURRENT_LIABILITIES', '2030', 'Salesman Commission Payable', 'Liability', 'liability', true, null, 'salesman'),
    ('EQUITY', '3010', 'Owner Capital', 'Equity', 'equity', true, null, null),
    ('EQUITY', '3020', 'Owner Drawings', 'Equity', 'contra_equity', true, null, null),
    ('EQUITY', '3030', 'Opening Balance Equity', 'Equity', 'equity', true, null, null),
    ('EQUITY', '3031', 'Current Earnings', 'Equity', 'equity', false, null, null),
    ('INCOME', '4000', 'Sales', 'Income', 'income', true, null, null),
    ('INCOME', '4010', 'Other Income', 'Income', 'income', true, null, null),
    ('COGS', '5000', 'Cost of Goods Sold', 'Expense', 'cost_of_goods_sold', true, null, null),
    ('EXPENSES', '5090', 'Inventory Adjustment', 'Expense', 'expense', true, null, null),
    ('EXPENSES', '6000', 'General Expenses', 'Expense', 'expense', true, null, null),
    ('EXPENSES', '6010', 'Commission Expense', 'Expense', 'expense', true, null, null),
    ('EXPENSES', '6020', 'Delivery Expense', 'Expense', 'expense', true, null, null)
  ) x(
    category_code, account_code, account_name, report_class, account_class,
    is_postable, operational_money_key, party_type
  )
  join public.ledger_account_categories c
    on c.business_id = p_business_id and c.stable_code = x.category_code
  on conflict (business_id, account_code) do nothing;

  select count(*) into v_integrity_count
  from public.ledger_accounts a
  join (values
    ('1010', 'Asset', 'asset', true), ('1020', 'Asset', 'asset', true),
    ('1030', 'Asset', 'asset', true), ('1040', 'Asset', 'asset', true),
    ('1100', 'Asset', 'asset', true), ('1200', 'Asset', 'asset', true),
    ('1300', 'Asset', 'asset', true), ('2010', 'Liability', 'liability', true),
    ('2020', 'Liability', 'liability', true), ('2030', 'Liability', 'liability', true),
    ('3010', 'Equity', 'equity', true), ('3020', 'Equity', 'contra_equity', true),
    ('3030', 'Equity', 'equity', true), ('3031', 'Equity', 'equity', false),
    ('4000', 'Income', 'income', true), ('4010', 'Income', 'income', true),
    ('5000', 'Expense', 'cost_of_goods_sold', true),
    ('5090', 'Expense', 'expense', true), ('6000', 'Expense', 'expense', true),
    ('6010', 'Expense', 'expense', true), ('6020', 'Expense', 'expense', true)
  ) expected(account_code, report_class, account_class, is_postable)
    on expected.account_code = a.account_code
   and expected.report_class = a.report_class
   and expected.account_class = a.account_class
   and expected.is_postable = a.is_postable
  where a.business_id = p_business_id and a.is_system and a.is_active;
  if v_integrity_count <> 21 then
    raise exception 'Existing ledger accounts conflict with the required report classes';
  end if;

  select count(*) into v_category_count
  from public.ledger_account_categories where business_id = p_business_id and is_system;
  select count(*) into v_account_count
  from public.ledger_accounts where business_id = p_business_id and is_system;
  return jsonb_build_object(
    'businessId', p_business_id,
    'systemCategoryCount', v_category_count,
    'systemAccountCount', v_account_count
  );
end $$;

revoke all on function public.seed_ledger_system_chart(uuid)
  from public, anon, authenticated;
grant execute on function public.seed_ledger_system_chart(uuid) to service_role;

-- Current production businesses are seeded idempotently. No money rows result.
select public.seed_ledger_system_chart(b.id)
from public.businesses b
order by b.id;

commit;
notify pgrst, 'reload schema';
