-- ============================================================================
-- KhataPro ERP — Migration 00003: Seed Data
-- ============================================================================
-- Seeds:
--   * Default business (biz-default)
--   * 5 account categories (Asset, Liability, Equity, Income, Expense)
--   * 17 default Chart of Accounts (Pakistani garments SMB)
--   * 42-row permission catalog
--   * 4 system roles (Owner/Admin, Accountant, Salesman, Rider)
--   * Default role-permission mappings
--
-- Idempotent: uses ON CONFLICT so re-running is safe.
-- ============================================================================

-- Default business
insert into public.business (id, name, currency, timezone)
values ('biz-default', 'Default Business', 'PKR', 'Asia/Karachi')
on conflict (id) do nothing;

-- Account categories
insert into public.account_categories (business_id, code, name, type) values
  ('biz-default', 'ASSET',     'Asset',     'Asset'),
  ('biz-default', 'LIABILITY', 'Liability', 'Liability'),
  ('biz-default', 'EQUITY',    'Equity',    'Equity'),
  ('biz-default', 'INCOME',    'Income',    'Income'),
  ('biz-default', 'EXPENSE',   'Expense',   'Expense')
on conflict (business_id, code) do nothing;

-- Default Chart of Accounts
insert into public.accounts (business_id, code, name, category_id, is_business_account, is_party_account, party_type) values
  ('biz-default', '1010', 'Cash',                  (select id from public.account_categories where business_id='biz-default' and code='ASSET'), true,  false, null),
  ('biz-default', '1020', 'Petty Cash',            (select id from public.account_categories where business_id='biz-default' and code='ASSET'), true,  false, null),
  ('biz-default', '1030', 'Bank',                  (select id from public.account_categories where business_id='biz-default' and code='ASSET'), true,  false, null),
  ('biz-default', '1040', 'Easypaisa',             (select id from public.account_categories where business_id='biz-default' and code='ASSET'), true,  false, null),
  ('biz-default', '1050', 'JazzCash',              (select id from public.account_categories where business_id='biz-default' and code='ASSET'), true,  false, null),
  ('biz-default', '1100', 'Inventory',             (select id from public.account_categories where business_id='biz-default' and code='ASSET'), false, false, null),
  ('biz-default', '1200', 'Customers Receivable',  (select id from public.account_categories where business_id='biz-default' and code='ASSET'), false, true,  'customer'),
  ('biz-default', '2010', 'Vendors Payable',       (select id from public.account_categories where business_id='biz-default' and code='LIABILITY'), false, true, 'vendor'),
  ('biz-default', '2020', 'Rider Payable',         (select id from public.account_categories where business_id='biz-default' and code='LIABILITY'), false, true, 'rider'),
  ('biz-default', '3010', 'Owner Capital',         (select id from public.account_categories where business_id='biz-default' and code='EQUITY'), false, false, null),
  ('biz-default', '3020', 'Owner Drawings',        (select id from public.account_categories where business_id='biz-default' and code='EQUITY'), false, false, null),
  ('biz-default', '3030', 'Opening Balance Equity',(select id from public.account_categories where business_id='biz-default' and code='EQUITY'), false, false, null),
  ('biz-default', '4010', 'Sales',                 (select id from public.account_categories where business_id='biz-default' and code='INCOME'), false, false, null),
  ('biz-default', '4020', 'Sales Returns',         (select id from public.account_categories where business_id='biz-default' and code='INCOME'), false, false, null),
  ('biz-default', '5010', 'Purchases / COGS',      (select id from public.account_categories where business_id='biz-default' and code='EXPENSE'), false, false, null),
  ('biz-default', '5020', 'Expenses',              (select id from public.account_categories where business_id='biz-default' and code='EXPENSE'), false, false, null),
  ('biz-default', '5030', 'Salesman Commission Expense', (select id from public.account_categories where business_id='biz-default' and code='EXPENSE'), false, false, null)
on conflict (business_id, code) do nothing;

-- Permission catalog
insert into public.permissions (code, module, description) values
  -- Setup
  ('can_view_setup', 'setup', 'View Setup module'),
  ('can_manage_setup', 'setup', 'Create/edit business profile, chart of accounts, business accounts'),
  -- Users & roles
  ('can_manage_users', 'users', 'Create/invite users, assign roles'),
  ('can_manage_roles', 'users', 'Create/edit roles and customize permissions'),
  -- Products & stock
  ('can_view_products', 'products', 'View products and stock'),
  ('can_create_products', 'products', 'Create/edit products and categories'),
  ('can_edit_products', 'products', 'Edit product master and merge temporary items'),
  -- Sales
  ('can_view_sales', 'sales', 'View sales invoices and reports'),
  ('can_create_sales', 'sales', 'Create Counter / Online / OFC sale bills'),
  ('can_edit_sales', 'sales', 'Edit posted sales invoices (Owner/Admin only by default)'),
  ('can_cancel_sales', 'sales', 'Cancel / void posted sale invoice'),
  ('can_view_own_sales', 'sales', 'View only own sales (salesman scope)'),
  -- Purchases
  ('can_view_purchases', 'purchases', 'View purchases and vendor ledgers'),
  ('can_create_purchases', 'purchases', 'Create purchase bills'),
  ('can_edit_purchases', 'purchases', 'Edit posted purchases'),
  -- Accounting / vouchers
  ('can_view_vouchers', 'accounting', 'View vouchers and ledger drill-down'),
  ('can_create_vouchers', 'accounting', 'Create Receipt / Payment / Contra / Petty Cash vouchers'),
  ('can_post_journal_voucher', 'accounting', 'Post manual Journal Voucher (Accountant/Owner only)'),
  ('can_post_opening_voucher', 'accounting', 'Post opening balance vouchers'),
  ('can_cancel_vouchers', 'accounting', 'Cancel/reverse posted vouchers'),
  -- Expenses
  ('can_view_expenses', 'expenses', 'View expense batches'),
  ('can_create_expenses', 'expenses', 'Create expense batches'),
  -- Rider & COD
  ('can_view_riders', 'riders', 'View riders and rider ledgers'),
  ('can_manage_riders', 'riders', 'Create/edit riders'),
  ('can_submit_cod', 'riders', 'Submit COD collected (rider scope)'),
  ('can_view_own_orders', 'riders', 'View only own assigned orders (rider scope)'),
  -- Reports
  ('can_view_trial_balance', 'reports', 'View Trial Balance'),
  ('can_view_pl', 'reports', 'View Profit & Loss / Income Statement'),
  ('can_view_balance_sheet', 'reports', 'View Balance Sheet'),
  ('can_view_ledgers', 'reports', 'View ledger drill-down and Day/Journal/Cash/Bank books'),
  ('can_view_vendor_ledger', 'reports', 'View Vendor Ledger'),
  ('can_view_customer_ledger', 'reports', 'View Customer Ledger'),
  ('can_view_salesman_commission', 'reports', 'View Salesman Commission Report'),
  ('can_view_rider_cod_report', 'reports', 'View Rider COD Report'),
  ('can_view_stock_report', 'reports', 'View Stock / Negative Stock / Pending Stock Entry reports'),
  ('can_view_receivables', 'reports', 'View Receivables report'),
  ('can_view_payables', 'reports', 'View Payables report'),
  ('can_view_daily_closing', 'reports', 'View Daily Closing report'),
  ('can_manage_closing', 'reports', 'Run daily closing'),
  ('can_export_reports', 'reports', 'Export reports to PDF / Excel'),
  -- Sensitive balances
  ('can_view_account_balances', 'sensitive', 'View business account balances and trial balance figures'),
  -- Audit
  ('can_view_audit_log', 'audit', 'View audit log')
on conflict (code) do nothing;

-- System roles
insert into public.roles (business_id, name, is_system, description) values
  ('biz-default', 'Owner/Admin', true, 'Full access. First registered owner is assigned this role.'),
  ('biz-default', 'Accountant',  true, 'Sales, purchases, vouchers, reports, closing.'),
  ('biz-default', 'Salesman',    true, 'Counter sale bill creation, own sales, own commission.'),
  ('biz-default', 'Rider',       true, 'Assigned online orders, delivery status, COD submission, own ledger.')
on conflict (business_id, name) do nothing;

-- Role-permission mappings
-- Owner/Admin = ALL permissions
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.business_id = 'biz-default' and r.name = 'Owner/Admin'
on conflict do nothing;

-- Accountant
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.business_id = 'biz-default'
  and r.name = 'Accountant'
  and p.code in (
    'can_view_setup',
    'can_view_products','can_create_products','can_edit_products',
    'can_view_sales','can_create_sales','can_edit_sales','can_cancel_sales',
    'can_view_purchases','can_create_purchases','can_edit_purchases',
    'can_view_vouchers','can_create_vouchers','can_post_journal_voucher',
    'can_post_opening_voucher','can_cancel_vouchers',
    'can_view_expenses','can_create_expenses',
    'can_view_riders',
    'can_view_trial_balance','can_view_pl','can_view_balance_sheet',
    'can_view_ledgers','can_view_vendor_ledger','can_view_customer_ledger',
    'can_view_salesman_commission','can_view_rider_cod_report',
    'can_view_stock_report','can_view_receivables','can_view_payables',
    'can_view_daily_closing','can_manage_closing','can_export_reports',
    'can_view_account_balances','can_view_audit_log'
  )
on conflict do nothing;

-- Salesman
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.business_id = 'biz-default'
  and r.name = 'Salesman'
  and p.code in (
    'can_view_products','can_create_sales','can_view_own_sales',
    'can_view_salesman_commission'
  )
on conflict do nothing;

-- Rider
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.business_id = 'biz-default'
  and r.name = 'Rider'
  and p.code in ('can_view_own_orders','can_submit_cod')
on conflict do nothing;
