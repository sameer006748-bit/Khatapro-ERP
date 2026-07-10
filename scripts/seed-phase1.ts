/**
 * Phase 1 seed: default Business, AccountCategories, default Chart of
 * Accounts for a Pakistani garments SMB, the four system Roles, the
 * Permission catalog, and default RolePermission mappings.
 *
 * Run with: `bun run scripts/seed-phase1.ts`
 *
 * Idempotent: safe to re-run.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

// ─────────────────────────────────────────────────────────────
// Default Chart of Accounts — Pakistani garments SMB
// Money values are irrelevant here in Phase 1 (no opening balances yet);
// balanceCache defaults to 0 for every account.
// ─────────────────────────────────────────────────────────────
const COA: Array<{ code: string; name: string; category: string; isBusinessAccount?: boolean; isPartyAccount?: boolean; partyType?: string }> = [
  // Asset
  { code: '1010', name: 'Cash', category: 'ASSET', isBusinessAccount: true },
  { code: '1020', name: 'Petty Cash', category: 'ASSET', isBusinessAccount: true },
  { code: '1030', name: 'Bank', category: 'ASSET', isBusinessAccount: true },
  { code: '1040', name: 'Easypaisa', category: 'ASSET', isBusinessAccount: true },
  { code: '1050', name: 'JazzCash', category: 'ASSET', isBusinessAccount: true },
  { code: '1100', name: 'Inventory', category: 'ASSET' },
  { code: '1200', name: 'Customers Receivable', category: 'ASSET', isPartyAccount: true, partyType: 'customer' },
  // Liability
  { code: '2010', name: 'Vendors Payable', category: 'LIABILITY', isPartyAccount: true, partyType: 'vendor' },
  { code: '2020', name: 'Rider Payable', category: 'LIABILITY', isPartyAccount: true, partyType: 'rider' },
  // Equity
  { code: '3010', name: 'Owner Capital', category: 'EQUITY' },
  { code: '3020', name: 'Owner Drawings', category: 'EQUITY' },
  { code: '3030', name: 'Opening Balance Equity', category: 'EQUITY' },
  // Income
  { code: '4010', name: 'Sales', category: 'INCOME' },
  { code: '4020', name: 'Sales Returns', category: 'INCOME' },
  // Expense
  { code: '5010', name: 'Purchases / COGS', category: 'EXPENSE' },
  { code: '5020', name: 'Expenses', category: 'EXPENSE' },
  { code: '5030', name: 'Salesman Commission Expense', category: 'EXPENSE' },
]

const CATEGORIES: Array<{ code: string; name: string; type: string }> = [
  { code: 'ASSET', name: 'Asset', type: 'Asset' },
  { code: 'LIABILITY', name: 'Liability', type: 'Liability' },
  { code: 'EQUITY', name: 'Equity', type: 'Equity' },
  { code: 'INCOME', name: 'Income', type: 'Income' },
  { code: 'EXPENSE', name: 'Expense', type: 'Expense' },
]

// ─────────────────────────────────────────────────────────────
// Permission catalog.
// Codes follow the prompt examples (can_view_sales, can_create_sales,
// can_view_trial_balance, can_export_reports, can_view_account_balances, …).
// ─────────────────────────────────────────────────────────────
const PERMISSIONS: Array<{ code: string; module: string; description: string }> = [
  // Setup / configuration
  { code: 'can_view_setup', module: 'setup', description: 'View Setup module' },
  { code: 'can_manage_setup', module: 'setup', description: 'Create/edit business profile, chart of accounts, business accounts' },
  // Users & roles
  { code: 'can_manage_users', module: 'users', description: 'Create/invite users, assign roles' },
  { code: 'can_manage_roles', module: 'users', description: 'Create/edit roles and customize permissions' },
  // Products & stock
  { code: 'can_view_products', module: 'products', description: 'View products and stock' },
  { code: 'can_create_products', module: 'products', description: 'Create/edit products and categories' },
  { code: 'can_edit_products', module: 'products', description: 'Edit product master and merge temporary items' },
  // Sales
  { code: 'can_view_sales', module: 'sales', description: 'View sales invoices and reports' },
  { code: 'can_create_sales', module: 'sales', description: 'Create Counter / Online / OFC sale bills' },
  { code: 'can_edit_sales', module: 'sales', description: 'Edit posted sales invoices (Owner/Admin only by default)' },
  { code: 'can_cancel_sales', module: 'sales', description: 'Cancel / void posted sale invoice' },
  { code: 'can_view_own_sales', module: 'sales', description: 'View only own sales (salesman scope)' },
  // Purchases
  { code: 'can_view_purchases', module: 'purchases', description: 'View purchases and vendor ledgers' },
  { code: 'can_create_purchases', module: 'purchases', description: 'Create purchase bills' },
  { code: 'can_edit_purchases', module: 'purchases', description: 'Edit posted purchases' },
  // Accounting / vouchers
  { code: 'can_view_vouchers', module: 'accounting', description: 'View vouchers and ledger drill-down' },
  { code: 'can_create_vouchers', module: 'accounting', description: 'Create Receipt / Payment / Contra / Petty Cash vouchers' },
  { code: 'can_post_journal_voucher', module: 'accounting', description: 'Post manual Journal Voucher (Accountant/Owner only)' },
  { code: 'can_post_opening_voucher', module: 'accounting', description: 'Post opening balance vouchers' },
  { code: 'can_cancel_vouchers', module: 'accounting', description: 'Cancel/reverse posted vouchers' },
  // Expenses
  { code: 'can_view_expenses', module: 'expenses', description: 'View expense batches' },
  { code: 'can_create_expenses', module: 'expenses', description: 'Create expense batches' },
  // Rider & COD
  { code: 'can_view_riders', module: 'riders', description: 'View riders and rider ledgers' },
  { code: 'can_manage_riders', module: 'riders', description: 'Create/edit riders' },
  { code: 'can_submit_cod', module: 'riders', description: 'Submit COD collected (rider scope)' },
  { code: 'can_view_own_orders', module: 'riders', description: 'View only own assigned orders (rider scope)' },
  // Reports
  { code: 'can_view_trial_balance', module: 'reports', description: 'View Trial Balance' },
  { code: 'can_view_pl', module: 'reports', description: 'View Profit & Loss / Income Statement' },
  { code: 'can_view_balance_sheet', module: 'reports', description: 'View Balance Sheet' },
  { code: 'can_view_ledgers', module: 'reports', description: 'View ledger drill-down and Day/Journal/Cash/Bank books' },
  { code: 'can_view_vendor_ledger', module: 'reports', description: 'View Vendor Ledger' },
  { code: 'can_view_customer_ledger', module: 'reports', description: 'View Customer Ledger' },
  { code: 'can_view_salesman_commission', module: 'reports', description: 'View Salesman Commission Report' },
  { code: 'can_view_rider_cod_report', module: 'reports', description: 'View Rider COD Report' },
  { code: 'can_view_stock_report', module: 'reports', description: 'View Stock / Negative Stock / Pending Stock Entry reports' },
  { code: 'can_view_receivables', module: 'reports', description: 'View Receivables report' },
  { code: 'can_view_payables', module: 'reports', description: 'View Payables report' },
  { code: 'can_view_daily_closing', module: 'reports', description: 'View Daily Closing report' },
  { code: 'can_manage_closing', module: 'reports', description: 'Run daily closing' },
  { code: 'can_export_reports', module: 'reports', description: 'Export reports to PDF / Excel' },
  // Sensitive balances
  { code: 'can_view_account_balances', module: 'sensitive', description: 'View business account balances and trial balance figures' },
  // Audit
  { code: 'can_view_audit_log', module: 'audit', description: 'View audit log' },
]

// ─────────────────────────────────────────────────────────────
// Default RolePermission map.
// Owner/Admin = everything.
// Accountant  = day-to-day finance ops + reporting, but no user/role
//                management and no Journal Voucher posting override
//                (Accountant CAN post journal voucher per prompt).
// Salesman    = sale creation + own sales + own commission.
// Rider       = own orders + COD submit + own rider ledger.
// ─────────────────────────────────────────────────────────────
const ROLE_PERMS: Record<string, string[]> = {
  'Owner/Admin': ['*'],
  Accountant: [
    'can_view_setup',
    'can_view_products',
    'can_create_products',
    'can_edit_products',
    'can_view_sales', 'can_create_sales', 'can_edit_sales', 'can_cancel_sales',
    'can_view_purchases', 'can_create_purchases', 'can_edit_purchases',
    'can_view_vouchers', 'can_create_vouchers', 'can_post_journal_voucher',
    'can_post_opening_voucher', 'can_cancel_vouchers',
    'can_view_expenses', 'can_create_expenses',
    'can_view_riders',
    'can_view_trial_balance', 'can_view_pl', 'can_view_balance_sheet',
    'can_view_ledgers', 'can_view_vendor_ledger', 'can_view_customer_ledger',
    'can_view_salesman_commission', 'can_view_rider_cod_report',
    'can_view_stock_report', 'can_view_receivables', 'can_view_payables',
    'can_view_daily_closing', 'can_manage_closing', 'can_export_reports',
    'can_view_account_balances', 'can_view_audit_log',
  ],
  Salesman: [
    'can_view_products',
    'can_create_sales',
    'can_view_own_sales',
    'can_view_salesman_commission',
  ],
  Rider: [
    'can_view_own_orders',
    'can_submit_cod',
  ],
}

async function main() {
  // 1. Default Business (single-business MVP, but business_id is on every
  //    business-data table so the schema can become multi-tenant later.)
  const business = await db.business.upsert({
    where: { id: 'biz-default' },
    update: {},
    create: {
      id: 'biz-default',
      name: 'Default Business',
      currency: 'PKR',
      timezone: 'Asia/Karachi',
    },
  })

  // 2. Account categories
  for (const c of CATEGORIES) {
    await db.accountCategory.upsert({
      where: { businessId_code: { businessId: business.id, code: c.code } },
      update: { name: c.name, type: c.type },
      create: { ...c, businessId: business.id },
    })
  }

  // 3. Chart of Accounts
  for (const a of COA) {
    const cat = await db.accountCategory.findUnique({
      where: { businessId_code: { businessId: business.id, code: a.category } },
    })
    if (!cat) throw new Error(`Missing category ${a.category}`)
    await db.account.upsert({
      where: { businessId_code: { businessId: business.id, code: a.code } },
      update: {
        name: a.name,
        categoryId: cat.id,
        isBusinessAccount: a.isBusinessAccount ?? false,
        isPartyAccount: a.isPartyAccount ?? false,
        partyType: a.partyType ?? null,
      },
      create: {
        businessId: business.id,
        code: a.code,
        name: a.name,
        categoryId: cat.id,
        isBusinessAccount: a.isBusinessAccount ?? false,
        isPartyAccount: a.isPartyAccount ?? false,
        partyType: a.partyType ?? null,
      },
    })
  }

  // 4. Permission catalog (upsert by code)
  for (const p of PERMISSIONS) {
    await db.permission.upsert({
      where: { code: p.code },
      update: { module: p.module, description: p.description },
      create: p,
    })
  }

  // 5. System roles + role-permission mapping
  const allPerms = await db.permission.findMany()
  const allCodes = allPerms.map((p) => p.id)

  for (const [roleName, permCodes] of Object.entries(ROLE_PERMS)) {
    const role = await db.role.upsert({
      where: { businessId_name: { businessId: business.id, name: roleName } },
      update: { isSystem: true },
      create: {
        businessId: business.id,
        name: roleName,
        isSystem: true,
        description:
          roleName === 'Owner/Admin'
            ? 'Full access. First registered owner is assigned this role.'
            : roleName === 'Accountant'
            ? 'Sales, purchases, vouchers, reports, closing.'
            : roleName === 'Salesman'
            ? 'Counter sale bill creation, own sales, own commission.'
            : 'Assigned online orders, delivery status, COD submission, own ledger.',
      },
    })

    // Reset perms then re-apply
    await db.rolePermission.deleteMany({ where: { roleId: role.id } })
    const selected =
      permCodes[0] === '*'
        ? allCodes
        : allPerms.filter((p) => permCodes.includes(p.code)).map((p) => p.id)
    for (const permissionId of selected) {
      await db.rolePermission.create({ data: { roleId: role.id, permissionId } })
    }
  }

  console.log('✓ Phase 1 seed complete.')
  console.log('  Business:', business.id, business.name)
  console.log('  Categories:', CATEGORIES.length)
  console.log('  Accounts:', COA.length)
  console.log('  Permissions:', PERMISSIONS.length)
  console.log('  Roles:', Object.keys(ROLE_PERMS).length)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
