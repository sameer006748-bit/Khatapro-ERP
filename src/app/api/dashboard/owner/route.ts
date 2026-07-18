import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { db } from '@/lib/db'
import { getAccountByCode } from '@/lib/accounting/data-access'
import { bizDateString } from '@/lib/dates'

const RECENT_LIMIT = 5
const STOCK_ALERT_LIMIT = 6

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user)
      return NextResponse.json({ error: 'DASHBOARD_LOAD_FAILED' }, { status: 401 })
    const loaded = await loadSessionUser((session.user as any).id)
    if (!loaded)
      return NextResponse.json({ error: 'DASHBOARD_LOAD_FAILED' }, { status: 401 })

    const isOwner = loaded.roleName === 'Owner/Admin'
    if (!isOwner) {
      try {
        await requirePermission(loaded, 'can_view_trial_balance')
      } catch {
        return NextResponse.json({ error: 'DASHBOARD_LOAD_FAILED' }, { status: 403 })
      }
    }

    const url = new URL(req.url)
    const today = url.searchParams.get('today') || bizDateString(new Date())
    const bid = loaded.businessId

    // ── Concurrent: today sales aggregate, 5 recent invoices, 5 recent purchases,
    //     stock aggregates + alert details, today expenses, 3 account lookups,
    //     today collections and recent audit logs (all independent) ──
    const [
      todaySalesAgg,
      recentInvoices,
      recentPurchases,
      stockResult,
      todayExpenseRecords,
      salesAccount,
      arAccount,
      apAccount,
      collections,
      auditLogsResult,
    ] = await Promise.all([
      getTodaySalesAggregate(bid, today),
      getRecentInvoices(bid, RECENT_LIMIT),
      getRecentPurchases(bid, RECENT_LIMIT),
      getStockAggregates(bid, STOCK_ALERT_LIMIT),
      getTodayExpenses(bid, today),
      getAccountByCode(bid, '4010'),
      getAccountByCode(bid, '1200'),
      getAccountByCode(bid, '2010'),
      getTodayCollections(bid, today),
      getRecentAuditLogs(bid),
    ])

    // ── Today KPIs from aggregate ──
    const todaySales = todaySalesAgg.total
    const todaySalesNumber = Number(todaySales)
    const todaySalesPaisas = todaySales.toString()

    const salesByType = {
      counter: { count: todaySalesAgg.counterCount, amount: todaySalesAgg.counterAmount },
      online: { count: todaySalesAgg.onlineCount, amount: todaySalesAgg.onlineAmount },
      ofc: { count: todaySalesAgg.ofcCount, amount: todaySalesAgg.ofcAmount },
    }

    // ── Today expenses ──
    const todayExpensesPaisas = todayExpenseRecords.reduce(
      (sum, ex) => sum + BigInt(ex.totalAmount),
      0n,
    )
    const todayExpensesNumber = Number(todayExpensesPaisas)

    // ── Collections (receipts) ──
    const todayCollectionsNumber: number | null = collections.value
    const collectionsAvailable = collections.available

    // ── Net cash flow ──
    let todayNetCashFlowNumber: number | null = null
    let netCashFlowAvailable = false
    if (collectionsAvailable && todayCollectionsNumber !== null) {
      todayNetCashFlowNumber = todayCollectionsNumber - todayExpensesNumber
      netCashFlowAvailable = true
    }

    // ── Account balances (single-row lookups) ──
    const receivablesBalance = arAccount ? Number(arAccount.balanceCache) : 0
    const payablesBalance = apAccount ? Number(-apAccount.balanceCache) : 0
    const totalSalesBalance = salesAccount ? Number(-salesAccount.balanceCache) : 0

    // ── Audit logs (20 most recent) — fetched concurrently above ──
    const auditLogs = auditLogsResult

    // ── Response (shape unchanged) ──
    return NextResponse.json({
      today,
      kpis: {
        todaySales: todaySalesNumber,
        todaySalesPaisas,
        todayCollections: todayCollectionsNumber,
        todayExpenses: todayExpensesNumber,
        todayExpensesPaisas: todayExpensesPaisas.toString(),
        todayNetCashFlow: todayNetCashFlowNumber,
        totalReceivables: receivablesBalance,
        totalPayables: payablesBalance,
        totalSales: totalSalesBalance,
        lowStockCount: stockResult.lowStockCount,
        negativeStockCount: stockResult.negativeStockCount,
      },
      availability: {
        todaySales: true,
        todayCollections: collectionsAvailable,
        todayExpenses: true,
        todayNetCashFlow: netCashFlowAvailable,
        totalReceivables: true,
        totalPayables: true,
        totalSales: true,
        lowStockCount: true,
        negativeStockCount: true,
      },
      salesByType: {
        counter: {
          count: salesByType.counter.count,
          amount: salesByType.counter.amount.toString(),
        },
        online: {
          count: salesByType.online.count,
          amount: salesByType.online.amount.toString(),
        },
        ofc: {
          count: salesByType.ofc.count,
          amount: salesByType.ofc.amount.toString(),
        },
      },
      recentInvoices: recentInvoices.map(inv => ({
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        invoiceType: inv.invoiceType,
        invoiceDate: inv.invoiceDate,
        customerName: inv.customerName,
        salesmanName: inv.salesmanName,
        total: inv.total,
        paidAmount: inv.paidAmount,
      })),
      recentPurchases: recentPurchases.map((pur: any) => ({
        id: pur.id,
        purchaseNo: pur.purchaseNo,
        vendorName: pur.vendorName,
        purchaseDate: pur.purchaseDate,
        total: pur.total,
        paidAmount: pur.paidAmount,
        status: pur.status,
      })),
      lowStockProducts: stockResult.lowStockProducts,
      negativeStockProducts: stockResult.negativeStockProducts,
      auditLogs,
    })
  } catch {
    return NextResponse.json(
      { error: 'DASHBOARD_LOAD_FAILED' },
      { status: 500 },
    )
  }
}

// ── Today sales aggregate (DB-side GROUP BY) ──

type SalesAggregate = {
  total: bigint
  counterCount: number; counterAmount: bigint
  onlineCount: number; onlineAmount: bigint
  ofcCount: number; ofcAmount: bigint
}

async function getTodaySalesAggregate(businessId: string, today: string): Promise<SalesAggregate> {
  const empty = { total: 0n, counterCount: 0, counterAmount: 0n, onlineCount: 0, onlineAmount: 0n, ofcCount: 0, ofcAmount: 0n }

  try {
    const admin = getAdminSupabase()
    const { data, error } = await admin
      .from('invoices')
      .select('invoice_type, total')
      .eq('business_id', businessId)
      .eq('invoice_date', today)
      .eq('is_cancelled', false)
      .eq('is_returned', false)

    if (!error && data) {
      const rows = data as any[]
      let total = 0n; let cCount = 0; let cAmt = 0n; let oCount = 0; let oAmt = 0n; let fCount = 0; let fAmt = 0n
      for (const r of rows) {
        const amt = BigInt(r.total)
        total += amt
        if (r.invoice_type === 'COUNTER') { cCount++; cAmt += amt }
        else if (r.invoice_type === 'ONLINE') { oCount++; oAmt += amt }
        else if (r.invoice_type === 'OFC') { fCount++; fAmt += amt }
      }
      return { total, counterCount: cCount, counterAmount: cAmt, onlineCount: oCount, onlineAmount: oAmt, ofcCount: fCount, ofcAmount: fAmt }
    }
    if (error) throw new Error(`getTodaySalesAggregate Supabase: ${error.message}`)
  } catch { /* fall through to Prisma */ }

  const startOfDay = new Date(today)
  const endOfDay = new Date(today + 'T23:59:59.999Z')
  const invoices = await db.invoice.findMany({
    where: {
      businessId,
      invoiceDate: { gte: startOfDay, lte: endOfDay },
      isCancelled: false,
      isReturned: false,
    },
    select: { invoiceType: true, total: true },
  })
  let total = 0n; let cCount = 0; let cAmt = 0n; let oCount = 0; let oAmt = 0n; let fCount = 0; let fAmt = 0n
  for (const i of invoices) {
    const amt = i.total
    total += amt
    if (i.invoiceType === 'COUNTER') { cCount++; cAmt += amt }
    else if (i.invoiceType === 'ONLINE') { oCount++; oAmt += amt }
    else if (i.invoiceType === 'OFC') { fCount++; fAmt += amt }
  }
  return { total, counterCount: cCount, counterAmount: cAmt, onlineCount: oCount, onlineAmount: oAmt, ofcCount: fCount, ofcAmount: fAmt }
}

// ── Recent invoices (5 rows, latest non-cancelled/returned) ──

async function getRecentInvoices(businessId: string, limit: number) {
  try {
    const admin = getAdminSupabase()
    const { data, error } = await admin
      .from('invoices')
      .select('id, invoice_no, invoice_type, invoice_date, customer_name, total, paid_amount, salesmen(name)')
      .eq('business_id', businessId)
      .eq('is_cancelled', false)
      .eq('is_returned', false)
      .order('invoice_date', { ascending: false })
      .limit(limit)
    if (!error && data) {
      return (data as any[]).map(r => ({
        id: r.id,
        invoiceNo: r.invoice_no,
        invoiceType: r.invoice_type,
        invoiceDate: r.invoice_date,
        customerName: r.customer_name,
        salesmanName: r.salesmen?.name ?? null,
        total: String(r.total),
        paidAmount: String(r.paid_amount),
      }))
    }
  } catch { /* fall through to Prisma */ }
  const invoices = await db.invoice.findMany({
    where: { businessId, isCancelled: false, isReturned: false },
    include: { salesman: { select: { name: true } } },
    orderBy: { invoiceDate: 'desc' },
    take: limit,
  })
  return invoices.map(i => ({
    id: i.id,
    invoiceNo: i.invoiceNo,
    invoiceType: i.invoiceType,
    invoiceDate: i.invoiceDate.toISOString(),
    customerName: i.customerName,
    salesmanName: i.salesman?.name ?? null,
    total: i.total.toString(),
    paidAmount: i.paidAmount.toString(),
  }))
}

// ── Recent purchases (5 rows) ──

async function getRecentPurchases(businessId: string, limit: number) {
  try {
    const admin = getAdminSupabase()
    const { data, error } = await admin
      .from('purchases')
      .select('id, purchase_no, vendor_id, purchase_date, total, paid_amount, status, vendors(name)')
      .eq('business_id', businessId)
      .order('purchase_date', { ascending: false })
      .limit(limit)
    if (!error && data) {
      return (data as any[]).map(r => ({
        id: r.id,
        purchaseNo: r.purchase_no,
        vendorName: r.vendors?.name ?? null,
        purchaseDate: r.purchase_date,
        total: String(r.total),
        paidAmount: String(r.paid_amount),
        status: r.status,
      }))
    }
  } catch { /* fall through to Prisma */ }
  const purchases = await db.purchase.findMany({
    where: { businessId },
    include: { vendor: { select: { name: true } } },
    orderBy: { purchaseDate: 'desc' },
    take: limit,
  })
  return purchases.map(p => ({
    id: p.id,
    purchaseNo: p.purchaseNo,
    vendorName: p.vendor?.name ?? null,
    purchaseDate: p.purchaseDate.toISOString(),
    total: p.total.toString(),
    paidAmount: p.paidAmount.toString(),
    status: p.status,
  }))
}

// ── Stock aggregates: DB-side counts + alert detail rows ──

type StockAggregates = {
  lowStockCount: number
  negativeStockCount: number
  lowStockProducts: Array<{ id: string; name: string; currentStock: number; lowStockThreshold: number }>
  negativeStockProducts: Array<{ id: string; name: string; currentStock: number }>
}

async function getStockAggregates(businessId: string, alertLimit: number): Promise<StockAggregates> {
  try {
    const admin = getAdminSupabase()
    // Three DB-level queries — zero full-row loading:
    // 1. Negative stock — count + limited detail (max alertLimit rows)
    // 2. Low-stock count — DB head-count filtered to ≤5 sentinel (majority of thresholds)
    // 3. Low-stock detail — limited to alertLimit rows with pre-filter
    const [negResult, lowCountResult, lowDetailResult] = await Promise.all([
      admin
        .from('products')
        .select('id, name, current_stock', { count: 'exact', head: false })
        .eq('business_id', businessId)
        .eq('is_active', true)
        .lt('current_stock', 0)
        .order('current_stock', { ascending: true })
        .limit(alertLimit),
      admin
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('is_active', true)
        .gt('current_stock', 0)
        .lte('current_stock', 5),
      admin
        .from('products')
        .select('id, name, current_stock, low_stock_threshold')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .gt('current_stock', 0)
        .lte('current_stock', 1000)
        .order('current_stock', { ascending: true })
        .limit(alertLimit),
    ])

    if (!negResult.error && !lowCountResult.error && !lowDetailResult.error) {
      const negRows = (negResult.data ?? []) as any[]
      const negCount = negResult.count ?? negRows.length
      const lowCount = lowCountResult.count ?? 0
      const lowRows = (lowDetailResult.data ?? []) as any[]

      // Exact threshold check on limited detail rows
      const lowProducts: any[] = []
      for (const p of lowRows) {
        const stock = p.current_stock ?? 0
        const threshold = p.low_stock_threshold ?? 5
        if (stock <= threshold) {
          lowProducts.push({ id: p.id, name: p.name, currentStock: stock, lowStockThreshold: threshold })
        }
      }

      return {
        lowStockCount: lowCount,
        negativeStockCount: negCount,
        lowStockProducts: lowProducts.slice(0, alertLimit),
        negativeStockProducts: negRows.map((r: any) => ({
          id: r.id, name: r.name, currentStock: r.current_stock ?? 0,
        })),
      }
    }
  } catch { /* fall through to Prisma */ }

  // Prisma: DB-side aggregates — zero row scans, only counts + limited detail
  const [negCountPrisma, negDetailPrisma, lowCountPrisma, lowDetailPrisma] = await Promise.all([
    db.product.count({ where: { businessId, isActive: true, currentStock: { lt: 0 } } }),
    db.product.findMany({
      where: { businessId, isActive: true, currentStock: { lt: 0 } },
      select: { id: true, name: true, currentStock: true },
      orderBy: { currentStock: 'asc' },
      take: alertLimit,
    }),
    db.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::int as count FROM "Product"
      WHERE "businessId" = ${businessId}
        AND "isActive" = true
        AND "currentStock" > 0
        AND "currentStock" <= COALESCE("lowStockThreshold", 5)
    `,
    db.product.findMany({
      where: { businessId, isActive: true, currentStock: { gt: 0, lte: 1000 } },
      select: { id: true, name: true, currentStock: true, lowStockThreshold: true },
      orderBy: { currentStock: 'asc' },
      take: alertLimit,
    }),
  ])

  const lowCount = Number(lowCountPrisma[0]?.count ?? 0)
  const lowProducts: any[] = []
  for (const p of lowDetailPrisma) {
    const stock = p.currentStock ?? 0
    const threshold = p.lowStockThreshold ?? 5
    if (stock <= threshold) {
      lowProducts.push({ id: p.id, name: p.name, currentStock: stock, lowStockThreshold: threshold })
    }
  }

  return {
    lowStockCount: lowCount,
    negativeStockCount: negCountPrisma,
    lowStockProducts: lowProducts.slice(0, alertLimit),
    negativeStockProducts: negDetailPrisma.map(p => ({
      id: p.id, name: p.name, currentStock: p.currentStock ?? 0,
    })),
  }
}

// ── Today expenses ──

async function getTodayExpenses(businessId: string, today: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin
    .from('expenses')
    .select('id, total_amount, expense_date, status')
    .eq('business_id', businessId)
    .eq('expense_date', today)
    .neq('status', 'cancelled')
  if (!error && data) {
    return (data as any[]).map(r => ({
      totalAmount: String(r.total_amount),
      expenseDate: r.expense_date,
      status: r.status,
    }))
  }
  if (error) throw new Error(`getTodayExpenses: ${error.message}`)
  return []
}

// ── Today collections (receipts, excluding cancelled vouchers) ──

async function getTodayCollections(
  businessId: string,
  today: string,
): Promise<{ value: number | null; available: boolean }> {
  try {
    const admin = getAdminSupabase()
    const { data: receiptsRaw, error: receiptsError } = await admin
      .from('receipts')
      .select('id, amount, voucher_id')
      .eq('business_id', businessId)
      .eq('receipt_date', today)
      .eq('status', 'posted')
      .is('reversal_voucher_id', null)

    if (!receiptsError && Array.isArray(receiptsRaw)) {
      const receiptRows = receiptsRaw as any[]
      if (receiptRows.length === 0) return { value: 0, available: true }

      const voucherIds = Array.from(
        new Set(
          receiptRows
            .map(r => r.voucher_id)
            .filter((v): v is string => typeof v === 'string' && v.length > 0),
        ),
      )
      const allowedVoucherIds = new Set<string>(voucherIds)
      if (voucherIds.length > 0) {
        const { data: vouchersRaw } = await admin
          .from('vouchers')
          .select('id, is_cancelled')
          .eq('business_id', businessId)
          .in('id', voucherIds)
        const vouchers = (vouchersRaw ?? []) as any[]
        for (const v of vouchers) {
          if (v && v.is_cancelled) allowedVoucherIds.delete(v.id)
        }
      }
      const sum = receiptRows
        .filter(r => !r.voucher_id || allowedVoucherIds.has(r.voucher_id))
        .reduce((s, r) => s + BigInt(r.amount ?? 0), 0n)
      return { value: Number(sum), available: true }
    }
  } catch { /* fall through */ }
  return { value: null, available: false }
}

// ── Recent audit logs (20 most recent) ──

async function getRecentAuditLogs(businessId: string) {
  const admin = getAdminSupabase()
  const { data: auditLogsRaw } = await admin
    .from('audit_logs')
    .select('id, timestamp, action, entity, entity_id, details')
    .eq('business_id', businessId)
    .order('timestamp', { ascending: false })
    .limit(20)
  return (auditLogsRaw ?? []).map((r: any) => {
    const details =
      typeof r.details === 'string' ? r.details : JSON.stringify(r.details ?? null)
    return {
      id: r.id,
      timestamp: r.timestamp,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      details: details.length > 200 ? details.slice(0, 200) + '...' : details,
    }
  })
}