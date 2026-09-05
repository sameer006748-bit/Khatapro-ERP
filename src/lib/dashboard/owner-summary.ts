import { getAdminSupabase } from '@/lib/supabase/admin'
import { getAccountByCode } from '@/lib/accounting/data-access'
import { listLegacyBusinessAccounts } from '@/lib/accounting/legacy-business-accounts'
import { normalizeBusinessAccountType } from '@/lib/accounting/business-account-types'
import { db } from '@/lib/db'
import {
  reportCashFlow,
  reportCustomerOutstanding,
  reportSalesDetail,
  reportSalesSummary,
  reportVendorOutstanding,
} from '@/lib/reports/data-access'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { usesLegacyTransactionSchema } from '@/lib/identity/legacy-bridge'
import { bizDateString, bizPreviousDateRange, businessDateLabels } from '@/lib/dates'
import {
  detectLedgerCapability,
  isolateDashboardMetric,
  isSchemaUnavailableError,
  type PostgrestLikeError,
} from './compatibility'
import { buildCashPosition, type CashPositionAccount, type CashPositionState } from './cash-position'
import { buildDailySeries, buildMetricComparison, type SeriesPoint } from './trends'
import { buildRecentDashboardActivity } from './recent-activity'

/** reportSalesDetail caps at 500 rows; a capped read cannot back a per-day series. */
const SALES_DETAIL_ROW_LIMIT = 500

type Range = { from: string; to: string }
type Metric<T> = { value: T | null; available: boolean }
type Movement = { inflow: number; outflow: number }
type MetricState = 'available' | 'not-tracked' | 'error'

function errorShape(error: unknown): PostgrestLikeError {
  return error && typeof error === 'object' ? error as PostgrestLikeError : { message: String(error) }
}

async function isolated<T>(
  name: string,
  unavailable: Map<string, MetricState>,
  query: () => Promise<T>,
): Promise<Metric<T>> {
  const result = await isolateDashboardMetric(query)
  if (result.available) return { value: result.value, available: true }
  const shaped = errorShape(result.error)
  unavailable.set(name, isSchemaUnavailableError(shaped) ? 'not-tracked' : 'error')
  console.warn('[dashboard] metric unavailable', {
    metric: name,
    category: isSchemaUnavailableError(shaped) ? 'schema-unavailable' : 'query-failed',
    code: shaped.code ?? null,
  })
  return { value: null, available: false }
}

function metricStates(availability: Record<string, boolean>, unavailable?: Map<string, MetricState>) {
  return Object.fromEntries(Object.entries(availability).map(([name, available]) => [
    name,
    available ? 'available' : unavailable?.get(name) ?? 'not-tracked',
  ])) as Record<string, MetricState>
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

/**
 * `invoices` has no status column: cancelled and returned are separate boolean
 * flags (migration 00004), so a posted invoice is one with neither flag set.
 */
function isPostedInvoice(row: any): boolean {
  return !row.is_cancelled && !row.is_returned
}

/**
 * Trend shaping for the hero KPIs.
 *
 * Receivables and payables are listed with explicit nulls: they are
 * point-in-time balances with no per-day history and no measured "balance as
 * of the previous period" in this payload, so they are never compared here.
 * A flow metric only gets a series when the dated source it is bucketed from
 * is the same source the headline value was summed from.
 */
function buildTrends(input: {
  previousRange: Range | null
  labels: string[] | null
  sales: number | null
  salesPoints: SeriesPoint[] | null
  previousSales: number | null
  netCash: number | null
  netCashPoints: SeriesPoint[] | null
  previousNetCash: number | null
}) {
  return {
    previousRange: input.previousRange,
    metrics: {
      todaySales: {
        series: buildDailySeries({ labels: input.labels, points: input.salesPoints }),
        comparison: buildMetricComparison({ current: input.sales, previous: input.previousSales }),
      },
      todayNetCashFlow: {
        series: buildDailySeries({ labels: input.labels, points: input.netCashPoints }),
        comparison: buildMetricComparison({ current: input.netCash, previous: input.previousNetCash }),
      },
      totalReceivables: { series: null as number[] | null, comparison: null },
      totalPayables: { series: null as number[] | null, comparison: null },
    },
  }
}

async function buildLocalOperationalPayload(input: {
  businessId: string
  profileId: string
  range: Range
  today: string
  requestId: string
}) {
  const startedAt = Date.now()
  const from = new Date(`${input.range.from}T00:00:00+05:00`)
  const to = new Date(`${input.range.to}T23:59:59.999+05:00`)
  const previousRange = bizPreviousDateRange(input.range)
  const seriesLabels = businessDateLabels(input.range)
  const [invoices, purchases, products, auditLogs, paymentAccountRows, previousInvoices] = await Promise.all([
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
        details: true,
      },
      orderBy: { timestamp: 'desc' },
      take: 20,
    }),
    db.businessAccount.findMany({
      where: { businessId: input.businessId },
      select: { type: true, isActive: true, account: { select: { balanceCache: true } } },
    }),
    previousRange
      ? db.invoice.findMany({
        where: {
          businessId: input.businessId,
          invoiceDate: {
            gte: new Date(`${previousRange.from}T00:00:00+05:00`),
            lte: new Date(`${previousRange.to}T23:59:59.999+05:00`),
          },
        },
        select: { total: true, isCancelled: true, isReturned: true },
      })
      : Promise.resolve(null),
  ])
  const postedInvoices = invoices.filter(invoice => !invoice.isCancelled && !invoice.isReturned)
  const postedPurchases = purchases.filter(purchase => purchase.status.toLowerCase() !== 'cancelled')
  const todaySales = Number(postedInvoices.reduce((total, invoice) => total + invoice.total, 0n))
  const todayPurchases = Number(postedPurchases.reduce((total, purchase) => total + purchase.total, 0n))
  const previousSales = previousInvoices === null
    ? null
    : Number(previousInvoices
      .filter(invoice => !invoice.isCancelled && !invoice.isReturned)
      .reduce((total, invoice) => total + invoice.total, 0n))
  const activePaymentAccountCount = paymentAccountRows.filter(account => account.isActive).length
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
  // Local balances come from the same account.balanceCache the Business
  // Accounts page reads, so the panel cannot disagree with that page.
  const cashPosition = buildCashPosition({
    state: 'available',
    normalizeType: normalizeBusinessAccountType,
    accounts: paymentAccountRows.map(row => ({
      type: row.type,
      isActive: row.isActive,
      balancePaisas: row.account.balanceCache.toString(),
    })),
  })
  const trends = buildTrends({
    previousRange,
    labels: seriesLabels,
    sales: todaySales,
    salesPoints: postedInvoices.map(invoice => ({
      date: bizDateString(invoice.invoiceDate),
      value: Number(invoice.total),
    })),
    previousSales,
    netCash: null,
    netCashPoints: null,
    previousNetCash: null,
  })
  return {
    today: input.today,
    range: input.range,
    dataSource: 'operational-fallback',
    trends,
    cashPosition,
    operationalCounts: {
      counts: {
        invoices: postedInvoices.length,
        collections: null,
        expenses: null,
        purchases: postedPurchases.length,
        salesReturns: null,
        purchaseReturns: null,
      },
      states: {
        invoices: 'available' as const,
        collections: 'not-tracked' as const,
        expenses: 'not-tracked' as const,
        purchases: 'available' as const,
        salesReturns: 'not-tracked' as const,
        purchaseReturns: 'not-tracked' as const,
      },
    },
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
    metricStates: metricStates(availability),
    paymentAccounts: { activeCount: activePaymentAccountCount, state: 'available' as const },
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
    recentActivity: {
      state: 'available' as const,
      items: buildRecentDashboardActivity(auditLogs.map(row => ({
        id: row.id, timestamp: row.timestamp.toISOString(), action: row.action,
        entity: row.entity, entityId: row.entityId, details: row.details,
      }))),
    },
  }
}

export async function buildOwnerDashboardPayload(input: {
  businessId: string
  profileId: string
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
  const unavailable = new Map<string, MetricState>()
  const { businessId: bid, range } = input
  const capability = await detectLedgerCapability(admin, bid, range.to)
  const legacyReports = capability.path === 'operational-fallback' && await usesLegacyTransactionSchema()
  const previousRange = bizPreviousDateRange(range)
  const seriesLabels = businessDateLabels(range)

  // One query per operational source. Each optional metric is isolated, while
  // authentication and business-scope errors still fail the request.
  const [invoiceQ, recentInvoiceQ, paymentQ, cashFlowQ, expenseQ, purchaseQ, salesReturnQ, purchaseReturnQ, customerQ, payableQ, paymentAccountsQ, productQ, auditQ, prevSalesQ, prevCashQ, prevPaymentQ, prevExpenseQ] = await Promise.all([
    legacyReports
      ? isolated('todaySales', unavailable, () => reportSalesSummary(bid, range.from, range.to))
      : isolated('todaySales', unavailable, async () => rowsOrThrow(await admin.from('invoices')
      .select('id, invoice_type, invoice_date, customer_name, total, paid_amount, is_cancelled, is_returned')
      .eq('business_id', bid).gte('invoice_date', range.from).lte('invoice_date', range.to)
      .order('invoice_date', { ascending: false }))),
    legacyReports
      ? isolated('recentInvoices', unavailable, () => reportSalesDetail(bid, range.from, range.to))
      : Promise.resolve<Metric<any[]> | null>(null),
    isolated('todayCollections', unavailable, async () => rowsOrThrow(await admin.from('payments')
      .select('amount, direction, payment_mode, created_at, invoice_id')
      .eq('business_id', bid).gte('created_at', boundary(range.from))
      .lte('created_at', boundary(range.to, true)))),
    legacyReports
      ? isolated('todayNetCashFlow', unavailable, () => reportCashFlow(bid, range.from, range.to))
      : Promise.resolve<Metric<any[]> | null>(null),
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
    legacyReports
      ? isolated('totalReceivables', unavailable, () => reportCustomerOutstanding(bid))
      : isolated('totalReceivables', unavailable, async () => rowsOrThrow(await admin.from('customers')
      .select('credit').eq('business_id', bid))),
    legacyReports
      ? isolated('totalPayables', unavailable, () => reportVendorOutstanding(bid))
      : isolated('totalPayables', unavailable, async () => rowsOrThrow(await admin.from('purchases')
      .select('outstanding_amount, status').eq('business_id', bid))),
    legacyReports
      ? isolated('paymentAccounts', unavailable, () => listLegacyBusinessAccounts(bid, input.profileId))
      : Promise.resolve<Metric<any[]> | null>(null),
    isolated('stock', unavailable, async () => rowsOrThrow(await admin.from('products')
      .select('id, name, current_stock, low_stock_threshold, is_active')
      .eq('business_id', bid).eq('is_active', true))),
    isolated('auditLogs', unavailable, async () => rowsOrThrow(await admin.from('audit_logs')
      .select('id, timestamp, action, entity, entity_id, details').eq('business_id', bid)
      .order('timestamp', { ascending: false }).limit(20))),
    // Prior-period reads run inside the same bounded batch and always hit the
    // same source as the current-period headline, so a comparison can never
    // mix two definitions of the same metric.
    previousRange === null
      ? Promise.resolve<Metric<any[]> | null>(null)
      : legacyReports
        ? isolated('previousSales', unavailable, () => reportSalesSummary(bid, previousRange.from, previousRange.to))
        : isolated('previousSales', unavailable, async () => rowsOrThrow(await admin.from('invoices')
          // Unfiltered on purpose: the current-period headline sums every row
          // this same select returns, so the comparison base must match it.
          .select('total').eq('business_id', bid)
          .gte('invoice_date', previousRange.from).lte('invoice_date', previousRange.to))),
    previousRange !== null && legacyReports
      ? isolated('previousNetCash', unavailable, () => reportCashFlow(bid, previousRange.from, previousRange.to))
      : Promise.resolve<Metric<any[]> | null>(null),
    previousRange !== null && !legacyReports
      ? isolated('previousCollections', unavailable, async () => rowsOrThrow(await admin.from('payments')
        .select('amount, direction').eq('business_id', bid)
        .gte('created_at', boundary(previousRange.from)).lte('created_at', boundary(previousRange.to, true))))
      : Promise.resolve<Metric<any[]> | null>(null),
    previousRange !== null && !legacyReports
      ? isolated('previousExpenses', unavailable, async () => rowsOrThrow(await admin.from('expenses')
        .select('total_amount, status').eq('business_id', bid)
        .gte('expense_date', previousRange.from).lte('expense_date', previousRange.to)))
      : Promise.resolve<Metric<any[]> | null>(null),
  ])

  const invoices = legacyReports
    ? (recentInvoiceQ?.value ?? [])
    : (invoiceQ.value ?? []).filter(isPostedInvoice)
  const saleTypes = {
    counter: { count: 0, amount: 0n }, online: { count: 0, amount: 0n },
    ofc: { count: 0, amount: 0n }, other: { count: 0, amount: 0n },
  }
  let sales: number | null = invoiceQ.available ? 0 : null
  if (sales !== null) {
    let total = 0n
    for (const invoice of invoiceQ.value ?? []) {
      const amount = BigInt(legacyReports ? invoice.total_subtotal ?? 0 : invoice.total ?? 0)
      total += amount
      const invoiceType = String(invoice.invoice_type ?? '').toUpperCase()
      const bucket = invoiceType === 'COUNTER' ? saleTypes.counter
        : invoiceType === 'ONLINE' ? saleTypes.online
          : invoiceType === 'OFC' ? saleTypes.ofc : saleTypes.other
      bucket.count += Number(legacyReports ? invoice.invoice_count ?? 0 : 1)
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
  let receivablesMovement = !legacyReports && invoiceQ.available
    ? Number(invoices.reduce((value, row) => value + BigInt(row.total ?? 0) - BigInt(row.paid_amount ?? 0), 0n))
    : null
  let payablesMovement = purchaseQ.available ? sum(periodPurchases, 'outstanding_amount') : null
  let receivables = customerQ.available ? sum(customerQ.value ?? [], legacyReports ? 'outstanding' : 'credit') : null
  let payables = payableQ.available
    ? legacyReports
      ? sum(payableQ.value ?? [], 'outstanding')
      : sum((payableQ.value ?? []).filter(row => String(row.status ?? '').toLowerCase() !== 'cancelled'), 'outstanding_amount')
    : null
  const netCashMovement = legacyReports
    ? cashFlowQ?.available ? Number((cashFlowQ.value ?? []).reduce((total, row) => total + BigInt(row.total_debit ?? 0) - BigInt(row.total_credit ?? 0), 0n)) : null
    : received !== null && expenses !== null ? received - expenses : null

  // Prior-period totals, each read from the source that produced the headline.
  const previousSales = prevSalesQ?.available
    ? sum(prevSalesQ.value ?? [], legacyReports ? 'total_subtotal' : 'total')
    : null
  const previousReceived = prevPaymentQ?.available
    ? sum((prevPaymentQ.value ?? []).filter(row => String(row.direction).toLowerCase() === 'received'), 'amount')
    : null
  const previousExpenses = prevExpenseQ?.available
    ? sum((prevExpenseQ.value ?? []).filter(row => String(row.status ?? '').toLowerCase() !== 'cancelled'), 'total_amount')
    : null
  const previousNetCash = legacyReports
    ? prevCashQ?.available
      ? Number((prevCashQ.value ?? []).reduce((total, row) => total + BigInt(row.total_debit ?? 0) - BigInt(row.total_credit ?? 0), 0n))
      : null
    : previousReceived !== null && previousExpenses !== null ? previousReceived - previousExpenses : null

  // A series is built only from a dated read of the very same source. On the
  // legacy path reportSalesDetail sums to report_sales_summary's subtotal, but
  // only while it is under its own row cap; past that the series is dropped.
  const salesDetailRows = recentInvoiceQ?.value ?? null
  const salesPoints: SeriesPoint[] | null = legacyReports
    ? salesDetailRows && salesDetailRows.length < SALES_DETAIL_ROW_LIMIT
      ? salesDetailRows.map(row => ({ date: row.invoice_date ?? null, value: Number(BigInt(row.subtotal ?? 0)) }))
      : null
    : invoiceQ.available
      ? (invoiceQ.value ?? []).map(row => ({ date: row.invoice_date ?? null, value: Number(BigInt(row.total ?? 0)) }))
      : null
  // Legacy net cash comes from report_cash_flow, which reports no dates, so it
  // has no per-day history and is deliberately left without a sparkline.
  const netCashPoints: SeriesPoint[] | null = legacyReports || !paymentQ.available || !expenseQ.available
    ? null
    : [
      ...(paymentQ.value ?? [])
        .filter(row => String(row.direction).toLowerCase() === 'received')
        .map(row => ({
          date: row.created_at ? bizDateString(row.created_at) : null,
          value: Number(BigInt(row.amount ?? 0)),
        })),
      ...(expenseQ.value ?? [])
        .filter(row => String(row.status ?? '').toLowerCase() !== 'cancelled')
        .map(row => ({ date: row.expense_date ?? null, value: -Number(BigInt(row.total_amount ?? 0)) })),
    ]
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
  } else if (!legacyReports) {
    for (const name of ['cashBalance', 'bankBalance', 'cashMovement', 'bankMovement', 'periodCogs', 'totalSales']) {
      unavailable.set(name, 'not-tracked')
    }
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
    todayNetCashFlow: netCashMovement !== null, todayPurchases: purchases !== null,
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
    unavailableMetrics: Array.from(unavailable.keys()),
  })
  const saleType = (item: { count: number; amount: bigint }) => ({ count: item.count, amount: item.amount.toString() })
  const paymentAccountsState: CashPositionState = !legacyReports
    ? 'not-tracked'
    : paymentAccountsQ?.available ? 'available' : unavailable.get('paymentAccounts') === 'not-tracked' ? 'not-tracked' : 'error'
  // Same rows the Business Accounts page reads, already fetched above: the
  // panel adds no request and inherits that page's detection unchanged.
  const cashPosition = buildCashPosition({
    state: paymentAccountsState,
    normalizeType: normalizeBusinessAccountType,
    accounts: paymentAccountsState !== 'available' ? null : (paymentAccountsQ?.value ?? []).map((account): CashPositionAccount => ({
      type: account.type,
      isActive: account.isActive,
      balancePaisas: account.balancePaisas,
    })),
  })
  const pulseState = (available: boolean, metric: string): MetricState =>
    available ? 'available' : unavailable.get(metric) ?? 'not-tracked'
  const receivedPayments = (paymentQ.value ?? []).filter(row => String(row.direction).toLowerCase() === 'received')
  const postedExpenses = (expenseQ.value ?? []).filter(row => String(row.status ?? '').toLowerCase() !== 'cancelled')

  return {
    today: input.today, range, dataSource: capability.path,
    trends: buildTrends({
      previousRange,
      labels: seriesLabels,
      sales,
      salesPoints,
      previousSales,
      netCash: netCashMovement,
      netCashPoints,
      previousNetCash,
    }),
    cashPosition,
    operationalCounts: {
      counts: {
        invoices: invoiceQ.available ? Object.values(saleTypes).reduce((count, bucket) => count + bucket.count, 0) : null,
        collections: paymentQ.available ? receivedPayments.length : null,
        expenses: expenseQ.available ? postedExpenses.length : null,
        purchases: purchaseQ.available ? periodPurchases.length : null,
        salesReturns: salesReturnQ.available ? (salesReturnQ.value ?? []).length : null,
        purchaseReturns: purchaseReturnQ.available ? (purchaseReturnQ.value ?? []).length : null,
      },
      states: {
        invoices: pulseState(invoiceQ.available, 'todaySales'),
        collections: pulseState(paymentQ.available, 'todayCollections'),
        expenses: pulseState(expenseQ.available, 'todayExpenses'),
        purchases: pulseState(purchaseQ.available, 'todayPurchases'),
        salesReturns: pulseState(salesReturnQ.available, 'periodSalesReturns'),
        purchaseReturns: pulseState(purchaseReturnQ.available, 'periodPurchaseReturns'),
      },
    },
    kpis: {
      todaySales: sales, todaySalesPaisas: sales === null ? null : String(sales),
      todayCollections: received, todayExpenses: expenses,
      todayExpensesPaisas: expenses === null ? null : String(expenses),
      todayNetCashFlow: netCashMovement,
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
    metricStates: metricStates(availability, unavailable),
    paymentAccounts: legacyReports
      ? { activeCount: paymentAccountsQ?.available ? (paymentAccountsQ.value ?? []).filter((account) => account.isActive).length : null, state: paymentAccountsQ?.available ? 'available' as const : unavailable.get('paymentAccounts') ?? 'error' }
      : { activeCount: null, state: 'not-tracked' as const },
    salesByType: { counter: saleType(saleTypes.counter), online: saleType(saleTypes.online), ofc: saleType(saleTypes.ofc), other: saleType(saleTypes.other) },
    recentInvoices: invoices.slice(0, 5).map(row => ({
      id: row.id, invoiceNo: legacyReports ? row.invoice_no ?? row.id : row.id, invoiceType: row.invoice_type, invoiceDate: row.invoice_date,
      customerName: row.customer_name, salesmanName: null, total: String(row.total ?? 0), paidAmount: String(row.paid_amount ?? 0),
    })),
    recentPurchases: periodPurchases.slice(0, 5).map(row => ({
      id: row.id, purchaseNo: row.purchase_no ?? row.id, vendorName: null, purchaseDate: row.purchase_date,
      total: String(row.total ?? 0), paidAmount: String(row.paid_amount ?? 0), status: row.status,
    })),
    lowStockProducts: stock?.lowStockProducts ?? [], negativeStockProducts: stock?.negativeStockProducts ?? [],
    recentActivity: {
      state: auditQ.available ? 'available' as const : unavailable.get('auditLogs') ?? 'error',
      items: auditQ.available ? buildRecentDashboardActivity((auditQ.value ?? []).map(row => ({
        id: row.id, timestamp: row.timestamp, action: row.action,
        entity: row.entity, entityId: row.entity_id, details: row.details,
      }))) : [],
    },
  }
}
