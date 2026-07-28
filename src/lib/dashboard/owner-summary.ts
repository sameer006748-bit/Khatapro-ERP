import { getAdminSupabase } from '@/lib/supabase/admin'
import { getAccountByCode } from '@/lib/accounting/data-access'
import { db } from '@/lib/db'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import {
  detectLedgerCapability,
  isolateDashboardMetric,
  isSchemaUnavailableError,
  type PostgrestLikeError,
} from './compatibility'

type Range = { from: string; to: string }
type Metric<T> = { value: T | null; available: boolean }
type Movement = { inflow: number; outflow: number }

function errorShape(error: unknown): PostgrestLikeError {
  return error && typeof error === 'object' ? error as PostgrestLikeError : { message: String(error) }
}

async function isolated<T>(
  name: string,
  unavailable: Set<string>,
  query: () => Promise<T>,
): Promise<Metric<T>> {
  const result = await isolateDashboardMetric(query)
  if (result.available) return { value: result.value, available: true }
  const shaped = errorShape(result.error)
  unavailable.add(name)
  console.warn('[dashboard] metric unavailable', {
    metric: name,
    category: isSchemaUnavailableError(shaped) ? 'schema-unavailable' : 'query-failed',
    code: shaped.code ?? null,
  })
  return { value: null, available: false }
}

function rowsOrThrow(result: { data: unknown; error: PostgrestLikeError | null }): any[] {
  if (result.error) throw result.error
  return Array.isArray(result.data) ? result.data : []
}

function sum(rows: any[], column: string): number {
  return Number(rows.reduce((value, row) => value + BigInt(row[column] ?? 0), 0n))
}

function boundary(date: string, end = false): string {
  return `${date}T${end ? '23:59:59.999' : '00:00:00'}+05:00`
}

function isPostedInvoice(row: any): boolean {
  return !['cancelled', 'returned'].includes(String(row.status ?? '').toLowerCase())
}

async function buildLocalOperationalPayload(input: {
  businessId: string
  range: Range
  today: string
  requestId: string
}) {
  const startedAt = Date.now()
  const from = new Date(`${input.range.from}T00:00:00+05:00`)
  const to = new Date(`${input.range.to}T23:59:59.999+05:00`)
  const [invoices, purchases, products, auditLogs] = await Promise.all([
    db.invoice.findMany({
      where: { businessId: input.businessId, invoiceDate: { gte: from, lte: to } },
      select: {
        id: true,
        invoiceNo: true,
        invoiceType: true,
        invoiceDate: true,
        customerName: true,
        total: true,
        paidAmount: true,
        isCancelled: true,
        isReturned: true,
      },
      orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
    }),
    db.purchase.findMany({
      where: { businessId: input.businessId, purchaseDate: { gte: from, lte: to } },
      select: {
        id: true,
        purchaseNo: true,
        purchaseDate: true,
        total: true,
        paidAmount: true,
        status: true,
        vendor: { select: { name: true } },
      },
      orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }],
    }),
    db.product.findMany({
      where: { businessId: input.businessId, isActive: true },
      select: {
        id: true,
        name: true,
        currentStock: true,
        lowStockThreshold: true,
      },
    }),
    db.auditLog.findMany({
      where: { businessId: input.businessId },
      select: {
        id: true,
        timestamp: true,
        action: true,
        entity: true,
        entityId: true,
      },
      orderBy: { timestamp: 'desc' },
      take: 20,
    }),
  ])
  const postedInvoices = invoices.filter(invoice => !invoice.isCancelled && !invoice.isReturned)
  const postedPurchases = purchases.filter(purchase => purchase.status.toLowerCase() !== 'cancelled')
  const todaySales = Number(postedInvoices.reduce((total, invoice) => total + invoice.total, 0n))
  const todayPurchases = Number(postedPurchases.reduce((total, purchase) => total + purchase.total, 0n))
  const saleTypes = {
    counter: { count: 0, amount: 0n },
    online: { count: 0, amount: 0n },
    ofc: { count: 0, amount: 0n },
    other: { count: 0, amount: 0n },
  }
  for (const invoice of postedInvoices) {
    const type = invoice.invoiceType.toUpperCase()
    const bucket = type === 'COUNTER' ? saleTypes.counter
      : type === 'ONLINE' ? saleTypes.online
        : type === 'OFC' ? saleTypes.ofc : saleTypes.other
    bucket.count += 1
    bucket.amount += invoice.total
  }
  const negative = products.filter(product => product.currentStock < 0)
  const low = products.filter(product => product.currentStock > 0
    && product.currentStock <= product.lowStockThreshold)
  const unavailableNames = [
    'todayCollections', 'todayExpenses', 'todayNetCashFlow',
    'periodSalesReturns', 'periodPurchaseReturns', 'periodCogs', 'approxProfit',
    'cashBalance', 'bankBalance', 'cashMovement', 'bankMovement',
    'totalReceivables', 'totalPayables', 'totalSales',
    'receivablesMovement', 'payablesMovement',
  ]
  const availability = {
    todaySales: true,
    todayCollections: false,
    todayExpenses: false,
    todayNetCashFlow: false,
    todayPurchases: true,
    periodSalesReturns: false,
    periodPurchaseReturns: false,
    periodCogs: false,
    approxProfit: false,
    cashBalance: false,
    bankBalance: false,
    cashMovement: false,
    bankMovement: false,
    totalReceivables: false,
    totalPayables: false,
    totalSales: false,
    receivablesMovement: false,
    payablesMovement: false,
    lowStockCount: true,
    negativeStockCount: true,
  }
  console.info('[dashboard] owner summary', {
    requestId: input.requestId,
    path: 'operational-fallback',
    capabilityReason: 'supabase-not-configured',
    durationMs: Date.now() - startedAt,
    unavailableMetrics: unavailableNames,
  })
  const saleType = (item: { count: number; amount: bigint }) => ({
    count: item.count,
    amount: item.amount.toString(),
  })
  return {
    today: input.today,
    range: input.range,
    dataSource: 'operational-fallback',
    kpis: {
      todaySales,
      todaySalesPaisas: String(todaySales),
      todayCollections: null,
      todayExpenses: null,
      todayExpensesPaisas: null,
      todayNetCashFlow: null,
      todayPurchases,
      cashBalance: null,
      bankBalance: null,
      cashInflow: null,
      cashOutflow: null,
      bankInflow: null,
      bankOutflow: null,
      totalInflow: null,
      totalOutflow: null,
      periodSalesReturns: null,
      periodPurchaseReturns: null,
      periodCogs: null,
      approxProfit: null,
      periodReceivablesMovement: null,
      periodPayablesMovement: null,
      totalReceivables: null,
      totalPayables: null,
      totalSales: null,
      pendingOutstanding: null,
      lowStockCount: low.length,
      negativeStockCount: negative.length,
    },
    availability,
    salesByType: {
      counter: saleType(saleTypes.counter),
      online: saleType(saleTypes.online),
      ofc: saleType(saleTypes.ofc),
      other: saleType(saleTypes.other),
    },
    recentInvoices: postedInvoices.slice(0, 5).map(invoice => ({
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      invoiceType: invoice.invoiceType,
      invoiceDate: invoice.invoiceDate.toISOString(),
      customerName: invoice.customerName,
      salesmanName: null,
      total: invoice.total.toString(),
      paidAmount: invoice.paidAmount.toString(),
    })),
    recentPurchases: postedPurchases.slice(0, 5).map(purchase => ({
      id: purchase.id,
      purchaseNo: purchase.purchaseNo,
      vendorName: purchase.vendor.name,
      purchaseDate: purchase.purchaseDate.toISOString(),
      total: purchase.total.toString(),
      paidAmount: purchase.paidAmount.toString(),
      status: purchase.status,
    })),
    lowStockProducts: low.slice(0, 6).map(product => ({
      id: product.id,
      name: product.name,
      currentStock: product.currentStock,
      lowStockThreshold: product.lowStockThreshold,
    })),
    negativeStockProducts: negative.slice(0, 6).map(product => ({
      id: product.id,
      name: product.name,
      currentStock: product.currentStock,
    })),
    auditLogs: auditLogs.map(row => ({
      id: row.id,
      timestamp: row.timestamp.toISOString(),
      action: row.action,
      entity: row.entity,
      entityId: row.entityId,
    })),
  }
}

export async function buildOwnerDashboardPayload(input: {
  businessId: string
  range: Range
  today: string
  requestId: string
}) {
  if (!isSupabaseConfigured()) {
    if (process.env.VERCEL) {
      throw Object.assign(new Error('Serverless runtime database is not configured.'), {
        name: 'ServerlessDatabaseProhibitedError',
      })
    }
    return buildLocalOperationalPayload(input)
  }
  const startedAt = Date.now()
  const admin: any = getAdminSupabase()
  const unavailable = new Set<string>()
  const { businessId: bid, range } = input
  const capability = await detectLedgerCapability(admin, bid, range.to)

  // One query per operational source. Each optional metric is isolated, while
  // authentication and business-scope errors still fail the request.
  const [invoiceQ, paymentQ, expenseQ, purchaseQ, salesReturnQ, purchaseReturnQ, customerQ, payableQ, productQ, auditQ] = await Promise.all([
    isolated('todaySales', unavailable, async () => rowsOrThrow(await admin.from('invoices')
      .select('id, invoice_type, invoice_date, customer_name, total, paid, status')
      .eq('business_id', bid).gte('invoice_date', range.from).lte('invoice_date', range.to)
      .order('invoice_date', { ascending: false }))),
    isolated('todayCollections', unavailable, async () => rowsOrThrow(await admin.from('payments')
      .select('amount, direction, payment_mode, created_at, invoice_id')
      .eq('business_id', bid).gte('created_at', boundary(range.from))
      .lte('created_at', boundary(range.to, true)))),
    isolated('todayExpenses', unavailable, async () => rowsOrThrow(await admin.from('expenses')
      .select('total_amount, expense_date, status').eq('business_id', bid)
      .gte('expense_date', range.from).lte('expense_date', range.to))),
    isolated('todayPurchases', unavailable, async () => rowsOrThrow(await admin.from('purchases')
      .select('id, purchase_no, purchase_date, total, paid_amount, outstanding_amount, status')
      .eq('business_id', bid).gte('purchase_date', range.from).lte('purchase_date', range.to)
      .order('purchase_date', { ascending: false }))),
    isolated('periodSalesReturns', unavailable, async () => rowsOrThrow(await admin.from('sale_return_documents')
      .select('total, return_date, status').eq('business_id', bid)
      .gte('return_date', boundary(range.from)).lte('return_date', boundary(range.to, true))
      .eq('status', 'posted'))),
    isolated('periodPurchaseReturns', unavailable, async () => rowsOrThrow(await admin.from('purchase_returns')
      .select('total_amount, return_date').eq('business_id', bid)
      .gte('return_date', range.from).lte('return_date', range.to))),
    isolated('totalReceivables', unavailable, async () => rowsOrThrow(await admin.from('customers')
      .select('credit').eq('business_id', bid))),
    isolated('totalPayables', unavailable, async () => rowsOrThrow(await admin.from('purchases')
      .select('outstanding_amount, status').eq('business_id', bid))),
    isolated('stock', unavailable, async () => rowsOrThrow(await admin.from('products')
      .select('id, name, current_stock, low_stock_threshold, is_active')
      .eq('business_id', bid).eq('is_active', true))),
    isolated('auditLogs', unavailable, async () => rowsOrThrow(await admin.from('audit_logs')
      .select('id, timestamp, action, entity, entity_id').eq('business_id', bid)
      .order('timestamp', { ascending: false }).limit(20))),
  ])

  const invoices = (invoiceQ.value ?? []).filter(isPostedInvoice)
  const saleTypes = {
    counter: { count: 0, amount: 0n }, online: { count: 0, amount: 0n },
    ofc: { count: 0, amount: 0n }, other: { count: 0, amount: 0n },
  }
  let sales: number | null = invoiceQ.available ? 0 : null
  if (sales !== null) {
    let total = 0n
    for (const invoice of invoices) {
      const amount = BigInt(invoice.total ?? 0)
      total += amount
      const invoiceType = String(invoice.invoice_type ?? '').toUpperCase()
      const bucket = invoiceType === 'COUNTER' ? saleTypes.counter
        : invoiceType === 'ONLINE' ? saleTypes.online
          : invoiceType === 'OFC' ? saleTypes.ofc : saleTypes.other
      bucket.count += 1
      bucket.amount += amount
    }
    sales = Number(total)
  }

  // Rider delivery tables are intentionally absent here. COD is Received only
  // when settlement creates a real payments row with direction=Received.
  const received = paymentQ.available
    ? sum((paymentQ.value ?? []).filter(row => String(row.direction).toLowerCase() === 'received'), 'amount')
    : null
  const expenses = expenseQ.available
    ? sum((expenseQ.value ?? []).filter(row => String(row.status ?? '').toLowerCase() !== 'cancelled'), 'total_amount')
    : null
  const periodPurchases = (purchaseQ.value ?? [])
    .filter(row => String(row.status ?? '').toLowerCase() !== 'cancelled')
  const purchases = purchaseQ.available ? sum(periodPurchases, 'total') : null
  const salesReturns = salesReturnQ.available ? sum(salesReturnQ.value ?? [], 'total') : null
  const purchaseReturns = purchaseReturnQ.available ? sum(purchaseReturnQ.value ?? [], 'total_amount') : null
  let receivablesMovement = invoiceQ.available
    ? Number(invoices.reduce((value, row) => value + BigInt(row.total ?? 0) - BigInt(row.paid ?? 0), 0n))
    : null
  let payablesMovement = purchaseQ.available ? sum(periodPurchases, 'outstanding_amount') : null
  let receivables = customerQ.available ? sum(customerQ.value ?? [], 'credit') : null
  let payables = payableQ.available
    ? sum((payableQ.value ?? []).filter(row => String(row.status ?? '').toLowerCase() !== 'cancelled'), 'outstanding_amount')
    : null
  let cashBalance: number | null = null
  let bankBalance: number | null = null
  let cashMovement: Movement | null = null
  let bankMovement: Movement | null = null
  let cogs: number | null = null
  let totalSales: number | null = null

  if (capability.path === 'uuid-ledger') {
    const accountQ = await isolated('ledgerAccounts', unavailable, async () => Promise.all([
      getAccountByCode(bid, '4000'), getAccountByCode(bid, '1200'), getAccountByCode(bid, '2010'),
      getAccountByCode(bid, '1010'), getAccountByCode(bid, '1020'),
    ]))
    if (accountQ.value) {
      const [salesAccount, ar, ap, cash, bank] = accountQ.value
      totalSales = salesAccount ? Number(salesAccount.balanceCache) : null
      receivables = ar ? Number(ar.balanceCache) : null
      payables = ap ? Number(ap.balanceCache) : null
      cashBalance = cash ? Number(cash.balanceCache) : null
      bankBalance = bank ? Number(bank.balanceCache) : null
      const ids = [ar, ap, cash, bank].filter(Boolean).map(account => account!.id)
      const lineQ = await isolated('ledgerMovement', unavailable, async () => ids.length === 0 ? [] : rowsOrThrow(
        await admin.from('ledger_voucher_lines')
          .select('account_id, debit_paisas, credit_paisas, ledger_vouchers!inner(transaction_date)')
          .eq('business_id', bid).in('account_id', ids)
          .gte('ledger_vouchers.transaction_date', range.from)
          .lte('ledger_vouchers.transaction_date', range.to),
      ))
      if (lineQ.value) {
        const accountRows = (id?: string) => lineQ.value!.filter(row => row.account_id === id)
        const movement = (id: string | undefined, liability = false) => id ? Number(accountRows(id).reduce((value, row) => {
          const debit = BigInt(row.debit_paisas ?? 0); const credit = BigInt(row.credit_paisas ?? 0)
          return value + (liability ? credit - debit : debit - credit)
        }, 0n)) : null
        const money = (id?: string): Movement | null => id ? {
          inflow: sum(accountRows(id), 'debit_paisas'), outflow: sum(accountRows(id), 'credit_paisas'),
        } : null
        receivablesMovement = movement(ar?.id)
        payablesMovement = movement(ap?.id, true)
        cashMovement = money(cash?.id)
        bankMovement = money(bank?.id)
      }
    }
    const cogsQ = await isolated('periodCogs', unavailable, async () => {
      const rows = rowsOrThrow(await admin.rpc('ledger_profit_loss', {
        p_business_id: bid, p_from_date: range.from, p_to_date: range.to,
      }))
      return sum(rows.filter(row => row.section === 'COST_OF_GOODS_SOLD'), 'amount')
    })
    cogs = cogsQ.value
  } else {
    for (const name of ['cashBalance', 'bankBalance', 'cashMovement', 'bankMovement', 'periodCogs', 'totalSales']) unavailable.add(name)
  }

  const products = productQ.value ?? []
  const negative = products.filter(row => Number(row.current_stock ?? 0) < 0)
  const low = products.filter(row => Number(row.current_stock ?? 0) > 0
    && Number(row.current_stock ?? 0) <= Number(row.low_stock_threshold ?? 5))
  const stock = productQ.available ? {
    lowStockCount: low.length, negativeStockCount: negative.length,
    lowStockProducts: low.slice(0, 6).map(row => ({ id: row.id, name: row.name, currentStock: row.current_stock ?? 0, lowStockThreshold: row.low_stock_threshold ?? 5 })),
    negativeStockProducts: negative.slice(0, 6).map(row => ({ id: row.id, name: row.name, currentStock: row.current_stock ?? 0 })),
  } : null
  const approxProfit = sales !== null && salesReturns !== null && expenses !== null && cogs !== null
    ? sales - salesReturns - cogs - expenses : null
  const availability = {
    todaySales: sales !== null, todayCollections: received !== null, todayExpenses: expenses !== null,
    todayNetCashFlow: received !== null && expenses !== null, todayPurchases: purchases !== null,
    periodSalesReturns: salesReturns !== null, periodPurchaseReturns: purchaseReturns !== null,
    periodCogs: cogs !== null, approxProfit: approxProfit !== null,
    cashBalance: cashBalance !== null, bankBalance: bankBalance !== null,
    cashMovement: cashMovement !== null, bankMovement: bankMovement !== null,
    totalReceivables: receivables !== null, totalPayables: payables !== null, totalSales: totalSales !== null,
    receivablesMovement: receivablesMovement !== null, payablesMovement: payablesMovement !== null,
    lowStockCount: stock !== null, negativeStockCount: stock !== null,
  }
  console.info('[dashboard] owner summary', {
    requestId: input.requestId, path: capability.path, capabilityReason: capability.reason,
    durationMs: Date.now() - startedAt,
    unavailableMetrics: Object.entries(availability).filter(([, ok]) => !ok).map(([name]) => name),
  })
  const saleType = (item: { count: number; amount: bigint }) => ({ count: item.count, amount: item.amount.toString() })

  return {
    today: input.today, range, dataSource: capability.path,
    kpis: {
      todaySales: sales, todaySalesPaisas: sales === null ? null : String(sales),
      todayCollections: received, todayExpenses: expenses,
      todayExpensesPaisas: expenses === null ? null : String(expenses),
      todayNetCashFlow: received !== null && expenses !== null ? received - expenses : null,
      todayPurchases: purchases, cashBalance, bankBalance,
      cashInflow: cashMovement?.inflow ?? null, cashOutflow: cashMovement?.outflow ?? null,
      bankInflow: bankMovement?.inflow ?? null, bankOutflow: bankMovement?.outflow ?? null,
      totalInflow: cashMovement && bankMovement ? cashMovement.inflow + bankMovement.inflow : null,
      totalOutflow: cashMovement && bankMovement ? cashMovement.outflow + bankMovement.outflow : null,
      periodSalesReturns: salesReturns, periodPurchaseReturns: purchaseReturns, periodCogs: cogs,
      approxProfit, periodReceivablesMovement: receivablesMovement, periodPayablesMovement: payablesMovement,
      totalReceivables: receivables, totalPayables: payables, totalSales,
      pendingOutstanding: receivables !== null && payables !== null ? receivables + payables : null,
      lowStockCount: stock?.lowStockCount ?? null, negativeStockCount: stock?.negativeStockCount ?? null,
    },
    availability,
    salesByType: { counter: saleType(saleTypes.counter), online: saleType(saleTypes.online), ofc: saleType(saleTypes.ofc), other: saleType(saleTypes.other) },
    recentInvoices: invoices.slice(0, 5).map(row => ({
      id: row.id, invoiceNo: row.id, invoiceType: row.invoice_type, invoiceDate: row.invoice_date,
      customerName: row.customer_name, salesmanName: null, total: String(row.total ?? 0), paidAmount: String(row.paid ?? 0),
    })),
    recentPurchases: periodPurchases.slice(0, 5).map(row => ({
      id: row.id, purchaseNo: row.purchase_no ?? row.id, vendorName: null, purchaseDate: row.purchase_date,
      total: String(row.total ?? 0), paidAmount: String(row.paid_amount ?? 0), status: row.status,
    })),
    lowStockProducts: stock?.lowStockProducts ?? [], negativeStockProducts: stock?.negativeStockProducts ?? [],
    auditLogs: (auditQ.value ?? []).map(row => ({ id: row.id, timestamp: row.timestamp, action: row.action, entity: row.entity, entityId: row.entity_id })),
  }
}
