import 'server-only'
import type { SessionUser } from '@/lib/auth/permissions'
import type { AiFieldMetadata, AiMode, AiScreen } from '@/lib/ai/safety-core'
import type { ResolvedAiPeriod } from '@/lib/ai/ai-period'
import type { AllowedFinancialValue } from '@/lib/ai/financial-safety'
import { getAdminSupabase } from '@/lib/supabase/admin'
import {
  reportBalanceSheet,
  reportCashFlow,
  reportCustomerOutstanding,
  reportExpenseSummary,
  reportInventoryValuation,
  reportMySalesSummary,
  reportProfitLoss,
  reportSalesSummary,
  reportTrialBalance,
  reportVendorOutstanding,
} from '@/lib/reports/data-access'

type ContextArgs = {
  session: SessionUser
  screen: AiScreen
  mode: AiMode
  prompt: string
  field: AiFieldMetadata | null
  period: ResolvedAiPeriod
}

const SCREEN_GUIDES: Partial<Record<AiScreen, Record<string, string>>> = {
  home: { purpose: 'Business Summary shows sales, cash movement, outstanding balances, profit signals and stock risks.' },
  'counter-sale': { purpose: 'Counter Sale records an invoice and its collection.', accounting: 'Usually cash/bank or receivable is debited, sales is credited, COGS is debited and inventory is credited.' },
  'online-sale': { purpose: 'Online Sale records an invoice, collection/COD position and stock movement.', accounting: 'Sales and stock accounting depend on payment and delivery status.' },
  'ofc-sale': { purpose: 'OFC Sale records an invoice and its payment/outstanding effect.', accounting: 'Cash/bank or receivable rises; sales rises; sold stock and cost are recognized.' },
  'sales-list': { purpose: 'Sales lists posted invoices, amounts received, balances and returns.' },
  purchases: { purpose: 'Purchases increase stock or expense and create cash payment or supplier payable.', accounting: 'Inventory/expense is debited; cash/bank or supplier payable is credited.' },
  'expense-batch': { purpose: 'Expenses record business costs paid or owed.', accounting: 'Expense is debited; cash/bank or payable is credited.' },
  'receipt-voucher': { purpose: 'Receipt Voucher records money received.', accounting: 'Cash/bank is debited and the source/customer account is credited.' },
  'payment-voucher': { purpose: 'Payment Voucher records money paid.', accounting: 'The receiving expense/party account is debited and cash/bank is credited.' },
  'journal-voucher': { purpose: 'Journal Voucher records a balanced manual double entry.', accounting: 'Total debit must equal total credit; it does not inherently mean cash moved.' },
  'contra-entry': { purpose: 'Contra transfers money between business cash/bank accounts.', accounting: 'Destination asset is debited and source asset is credited; profit does not change.' },
  'petty-cash': { purpose: 'Petty Cash tracks small cash expenses and replenishment.' },
  'day-book': { purpose: 'Day Book is the chronological list of posted accounting vouchers.' },
  'ledger-drilldown': { purpose: 'Ledger shows all debits, credits and the running balance of one account.' },
  'trial-balance': { purpose: 'Trial Balance checks that total debits equal total credits across accounts.' },
  reports: { purpose: 'Financial Reports summarize Profit & Loss, Balance Sheet, cash flow, receivables, payables and inventory.' },
  inventory: { purpose: 'Inventory shows quantities, weighted average cost, valuation and stock warnings.' },
  accounts: { purpose: 'Accounts show cash, bank and party balances derived from posted vouchers.' },
  vendors: { purpose: 'Vendors show purchase and supplier payable positions.' },
  delivery: { purpose: 'Delivery shows assigned orders, statuses and COD collection duties.' },
  'my-reports': { purpose: 'My Reports shows only the signed-in salesman’s sales, collections, returns and commission.' },
  'voucher-detail': { purpose: 'Voucher Detail explains one balanced debit-and-credit posting.' },
  'invoice-detail': { purpose: 'Invoice Detail explains a sale, payment, outstanding and stock/cost effect.' },
  products: { purpose: 'Products define sale price, purchase price, opening stock, WAC and low-stock thresholds.' },
  'opening-balance': { purpose: 'Opening Balance establishes starting account balances without recording current-period income.' },
  coa: { purpose: 'Chart of Accounts classifies assets, liabilities, equity, income and expenses.' },
}

function sum(rows: any[], field: string): bigint {
  return rows.reduce((total, row) => {
    try { return total + BigInt(row?.[field] ?? 0) } catch { return total }
  }, 0n)
}

function wantsPartyNames(prompt: string): boolean {
  return /\b(kis customer|which customer|customer se|kis supplier|which supplier|kis vendor|which vendor|kisko|whom)\b/i.test(prompt)
}

async function buildSalesmanContext(session: SessionUser, screen: AiScreen, period: ResolvedAiPeriod) {
  const admin = getAdminSupabase()
  const linkedUserId = session.supabaseUserUuid ?? session.userId
  const { data: salesman, error } = await admin
    .from('salesmen')
    .select('id')
    .eq('business_id', session.businessId)
    .eq('user_id', linkedUserId)
    .maybeSingle()

  if (error || !salesman) return { scope: 'own_sales_only', linked: false, screen }
  const summary = await reportMySalesSummary(session.businessId, salesman.id, period.from, period.to)
  return { scope: 'own_sales_only', linked: true, period, summary }
}

async function buildRiderContext(session: SessionUser, period: ResolvedAiPeriod) {
  const admin = getAdminSupabase()
  const linkedUserId = session.supabaseUserUuid ?? session.userId
  const { data: rider, error } = await admin
    .from('riders')
    .select('id')
    .eq('business_id', session.businessId)
    .eq('user_id', linkedUserId)
    .maybeSingle()

  if (error || !rider) return { scope: 'assigned_deliveries_only', linked: false, period }
  const { data: rows, error: ordersError } = await admin
    .from('delivery_orders')
    .select('status,total_cod_amount,cod_collected_amount')
    .eq('business_id', session.businessId)
    .eq('rider_id', rider.id)
    .limit(250)

  if (ordersError) return { scope: 'assigned_deliveries_only', linked: true, dataAvailable: false, period }
  const orders = rows ?? []
  const statusCounts: Record<string, number> = {}
  for (const row of orders) statusCounts[row.status ?? 'unknown'] = (statusCounts[row.status ?? 'unknown'] ?? 0) + 1
  return {
    scope: 'assigned_deliveries_only',
    linked: true,
    assignedCount: orders.length,
    statusCounts,
    codAssigned: sum(orders, 'total_cod_amount').toString(),
    codCollected: sum(orders, 'cod_collected_amount').toString(),
    period,
  }
}

type LoaderName = 'sales' | 'expenses' | 'cash' | 'profitLoss' | 'balanceSheet' | 'trialBalance' | 'inventory' | 'receivables' | 'payables'

function selectedLoaders(screen: AiScreen, prompt: string): Set<LoaderName> {
  const names = new Set<LoaderName>()
  const text = `${screen} ${prompt}`.toLowerCase()
  if (screen === 'home') ['sales', 'expenses', 'cash', 'profitLoss', 'inventory', 'receivables', 'payables'].forEach((x) => names.add(x as LoaderName))
  if (/sale|revenue|recovery|collection|customer/.test(text)) names.add('sales')
  if (/expense|kharcha|gaya/.test(text)) names.add('expenses')
  if (/cash|bank|paisa|flow|contra|receipt|payment|petty/.test(text)) names.add('cash')
  if (/profit|loss|p&l|pl|munafa/.test(text)) names.add('profitLoss')
  if (/balance sheet|asset|liability|equity|capital/.test(text)) names.add('balanceSheet')
  if (/trial|ledger|day-book|day book|voucher|debit|credit|journal/.test(text)) names.add('trialBalance')
  if (/stock|inventory|wac|valuation|product/.test(text)) names.add('inventory')
  if (/receiv|recovery|customer|lena/.test(text)) names.add('receivables')
  if (/payable|supplier|vendor|dena|purchase/.test(text)) names.add('payables')
  if (screen === 'reports') ['profitLoss', 'balanceSheet', 'trialBalance'].forEach((x) => names.add(x as LoaderName))
  return names
}

async function buildBusinessContext(session: SessionUser, screen: AiScreen, prompt: string, period: ResolvedAiPeriod) {
  const permissions = session.permissions
  const { from: fromDate, to: toDate } = period
  const selected = selectedLoaders(screen, prompt)
  const tasks: Array<[LoaderName, Promise<unknown>]> = []

  if (selected.has('sales') && (permissions.has('can_view_sales_reports') || permissions.has('can_view_sales'))) {
    tasks.push(['sales', reportSalesSummary(session.businessId, fromDate, toDate)])
  }
  if (selected.has('expenses') && (permissions.has('can_view_ledgers') || permissions.has('can_view_pl'))) {
    tasks.push(['expenses', reportExpenseSummary(session.businessId, fromDate, toDate)])
  }
  if (selected.has('cash') && permissions.has('can_view_ledgers')) {
    tasks.push(['cash', reportCashFlow(session.businessId, fromDate, toDate)])
  }
  if (selected.has('profitLoss') && permissions.has('can_view_pl')) {
    tasks.push(['profitLoss', reportProfitLoss(session.businessId, fromDate, toDate)])
  }
  if (selected.has('balanceSheet') && permissions.has('can_view_balance_sheet')) {
    tasks.push(['balanceSheet', reportBalanceSheet(session.businessId, toDate)])
  }
  if (selected.has('trialBalance') && permissions.has('can_view_trial_balance')) {
    tasks.push(['trialBalance', reportTrialBalance(session.businessId)])
  }
  if (selected.has('inventory') && (permissions.has('can_view_inventory_reports') || permissions.has('can_view_products'))) {
    tasks.push(['inventory', reportInventoryValuation(session.businessId)])
  }
  if (selected.has('receivables') && permissions.has('can_view_customer_ledger')) {
    tasks.push(['receivables', reportCustomerOutstanding(session.businessId)])
  }
  if (selected.has('payables') && permissions.has('can_view_vendor_ledger')) {
    tasks.push(['payables', reportVendorOutstanding(session.businessId)])
  }

  const settled = await Promise.allSettled(tasks.map(([, task]) => task))
  const context: Record<string, unknown> = { period }
  const financialValues: AllowedFinancialValue[] = []
  const addValue = (label: string, value: bigint, classification: AllowedFinancialValue['classification']) => financialValues.push({ label, value: value.toString(), classification })
  const unavailable: string[] = []

  settled.forEach((result, index) => {
    const name = tasks[index][0]
    if (result.status === 'rejected') {
      unavailable.push(name)
      return
    }
    const rows = Array.isArray(result.value) ? result.value as any[] : []
    if (name === 'sales') context.sales = {
      invoiceCount: Number(sum(rows, 'invoice_count')),
      billed: sum(rows, 'total_subtotal').toString(),
      received: sum(rows, 'total_paid').toString(),
      outstanding: sum(rows, 'total_outstanding').toString(),
      returns: Number(sum(rows, 'returned_count')),
    }
    if (name === 'sales') { addValue('Sales billed', sum(rows, 'total_subtotal'), 'period_activity'); addValue('Amount received', sum(rows, 'total_paid'), 'period_activity') }
    if (name === 'expenses') { const total = sum(rows, 'total_amount'); context.expenses = { total: total.toString(), categories: rows.length }; addValue('Expenses', total, 'period_activity') }
    if (name === 'cash') context.cash = {
      opening: sum(rows, 'opening_balance').toString(),
      inflow: sum(rows, 'total_debit').toString(),
      outflow: sum(rows, 'total_credit').toString(),
      closing: sum(rows, 'closing_balance').toString(),
    }
    if (name === 'cash') { addValue('Cash inflow', sum(rows, 'total_debit'), 'period_activity'); addValue('Cash outflow', sum(rows, 'total_credit'), 'period_activity') }
    if (name === 'profitLoss') {
      const revenue = rows.filter((row) => row.section === 'REVENUE')
      const expenses = rows.filter((row) => row.section === 'EXPENSE')
      const revenueTotal = sum(revenue, 'amount')
      const expenseTotal = sum(expenses, 'amount')
      context.profitLoss = { revenue: revenueTotal.toString(), expenses: expenseTotal.toString(), netProfit: (revenueTotal - expenseTotal).toString() }
      addValue('Profit or loss', revenueTotal - expenseTotal, 'period_activity')
    }
    if (name === 'balanceSheet') {
      const assets = sum(rows.filter((row) => row.section === 'ASSET'), 'balance')
      const liabilities = sum(rows.filter((row) => row.section === 'LIABILITY'), 'balance')
      const equity = sum(rows.filter((row) => row.section === 'EQUITY'), 'balance')
      context.balanceSheet = { assets: assets.toString(), liabilities: liabilities.toString(), equity: equity.toString(), balanced: assets === liabilities + equity }
    }
    if (name === 'trialBalance') {
      const debit = sum(rows, 'total_debit')
      const credit = sum(rows, 'total_credit')
      context.trialBalance = { debit: debit.toString(), credit: credit.toString(), difference: (debit - credit).toString(), accountsWithActivity: rows.length }
    }
    if (name === 'inventory') context.inventory = {
      products: rows.length,
      quantity: rows.reduce((total, row) => total + Number(row.current_stock ?? 0), 0),
      value: sum(rows, 'stock_value').toString(),
      lowStock: rows.filter((row) => Number(row.current_stock ?? 0) >= 0 && Number(row.current_stock ?? 0) <= Number(row.low_stock_threshold ?? 5)).length,
      negativeStock: rows.filter((row) => Number(row.current_stock ?? 0) < 0).length,
    }
    if (name === 'receivables') context.receivables = {
      parties: rows.length,
      total: sum(rows, 'outstanding').toString(),
      ...(wantsPartyNames(prompt) ? { top: rows.slice(0, 5).map((row) => ({ name: String(row.customer_name ?? 'Customer'), outstanding: String(row.outstanding ?? 0) })) } : {}),
    }
    if (name === 'receivables') addValue('Receivables', sum(rows, 'outstanding'), 'current_snapshot')
    if (name === 'payables') context.payables = {
      parties: rows.length,
      total: sum(rows, 'outstanding').toString(),
      ...(wantsPartyNames(prompt) ? { top: rows.slice(0, 5).map((row) => ({ name: String(row.vendor_name ?? 'Supplier'), outstanding: String(row.outstanding ?? 0) })) } : {}),
    }
    if (name === 'payables') addValue('Payables', sum(rows, 'outstanding'), 'current_snapshot')
  })

  context.allowedFinancialValues = financialValues
  if (unavailable.length) context.unavailableSections = unavailable
  return context
}

export async function buildAiContext(args: ContextArgs): Promise<Record<string, unknown>> {
  const base: Record<string, unknown> = {
    role: args.session.roleName,
    screen: args.screen,
    readOnly: true,
    currency: 'PKR paisas unless stated otherwise',
    period: args.period,
    screenGuide: SCREEN_GUIDES[args.screen] ?? { purpose: 'Explain only the authorized screen and supplied context.' },
  }

  if (args.mode === 'field-help') {
    return { ...base, field: args.field, dataScope: 'safe field metadata only' }
  }
  if (args.session.roleName === 'Salesman') {
    if (!args.session.permissions.has('can_view_own_sales')) return { ...base, scope: 'general_sales_help_only', authorizedAggregates: false }
    return { ...base, ...(await buildSalesmanContext(args.session, args.screen, args.period)) }
  }
  if (args.session.roleName === 'Rider') {
    if (!args.session.permissions.has('can_view_own_orders') && !args.session.permissions.has('can_view_delivery_orders')) return { ...base, scope: 'general_delivery_help_only', authorizedAggregates: false }
    return { ...base, ...(await buildRiderContext(args.session, args.period)) }
  }
  return { ...base, ...(await buildBusinessContext(args.session, args.screen, args.prompt, args.period)) }
}
