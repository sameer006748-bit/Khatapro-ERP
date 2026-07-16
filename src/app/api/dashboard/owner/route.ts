import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { listInvoices } from '@/lib/sales/data-access'
import { listPurchases } from '@/lib/purchases/data-access'
import { listProducts } from '@/lib/products/data-access'
import { listExpenses } from '@/lib/vouchers/data-access'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getAccountByCode } from '@/lib/accounting/data-access'
import { bizDateString } from '@/lib/dates'

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user)
      return NextResponse.json({ error: 'DASHBOARD_LOAD_FAILED' }, { status: 401 })
    const loaded = await loadSessionUser((session.user as any).id)
    if (!loaded)
      return NextResponse.json({ error: 'DASHBOARD_LOAD_FAILED' }, { status: 401 })

    // Owner/Admin always have access; other roles need trial balance permission.
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
    const admin = getAdminSupabase()

    // ── 1. Load all data in parallel ──
    const [invoices, purchases, products, expenses, salesAccount, arAccount, apAccount] =
      await Promise.all([
        listInvoices(bid, { type: undefined }),
        listPurchases(bid),
        listProducts(bid),
        listExpenses(bid),
        getAccountByCode(bid, '4010'),
        getAccountByCode(bid, '1200'),
        getAccountByCode(bid, '2010'),
      ])

    // ── 2. Sort ──
    const sortedInvoices = invoices
      .filter(inv => !inv.isCancelled && !inv.isReturned)
      .sort((a, b) => (b.invoiceDate || '').localeCompare(a.invoiceDate || ''))
    const sortedPurchases = purchases
      .sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''))

    // ── 3. Filter today's records ──
    const todayInvoices = sortedInvoices.filter(inv => inv.invoiceDate?.startsWith(today))
    const todayExpenseRecords = expenses.filter(
      ex => ex.expenseDate?.startsWith(today) && ex.status !== 'cancelled',
    )

    // ── 4. Sales counts by type ──
    const salesByType = {
      counter: { count: 0, amount: BigInt(0) },
      online: { count: 0, amount: BigInt(0) },
      ofc: { count: 0, amount: BigInt(0) },
    }
    for (const inv of todayInvoices) {
      const amt = BigInt(inv.total)
      if (inv.invoiceType === 'COUNTER') {
        salesByType.counter.count++
        salesByType.counter.amount += amt
      } else if (inv.invoiceType === 'ONLINE') {
        salesByType.online.count++
        salesByType.online.amount += amt
      } else if (inv.invoiceType === 'OFC') {
        salesByType.ofc.count++
        salesByType.ofc.amount += amt
      }
    }

    // ── 5. Today KPIs ──
    const todaySales = todayInvoices.reduce((sum, inv) => sum + BigInt(inv.total), 0n)
    const todaySalesNumber = Number(todaySales)
    const todayExpensesPaisas = todayExpenseRecords.reduce(
      (sum, ex) => sum + BigInt(ex.totalAmount),
      0n,
    )
    const todayExpensesNumber = Number(todayExpensesPaisas)

    // ── 6. Collections (receipts) ──
    let todayCollectionsNumber: number | null = null
    let collectionsAvailable = false
    try {
      const { data: receiptsRaw, error: receiptsError } = await admin
        .from('receipts')
        .select('id, amount, voucher_id')
        .eq('business_id', bid)
        .eq('receipt_date', today)
        .eq('status', 'posted')
        .is('reversal_voucher_id', null)

      if (!receiptsError && Array.isArray(receiptsRaw)) {
        const receiptRows = receiptsRaw as any[]
        if (receiptRows.length === 0) {
          todayCollectionsNumber = 0
          collectionsAvailable = true
        } else {
          const voucherIds = Array.from(
            new Set(
              receiptRows
                .map(r => r.voucher_id)
                .filter((v): v is string => typeof v === 'string' && v.length > 0),
            ),
          )
          const allowedVoucherIds = new Set<string>()
          if (voucherIds.length > 0) {
            const { data: vouchersRaw } = await admin
              .from('vouchers')
              .select('id, is_cancelled')
              .eq('business_id', bid)
              .in('id', voucherIds)
            const vouchers = (vouchersRaw ?? []) as any[]
            for (const v of vouchers) {
              if (v && !v.is_cancelled) allowedVoucherIds.add(v.id)
            }
          }
          const sum = receiptRows
            .filter(r => !r.voucher_id || allowedVoucherIds.has(r.voucher_id))
            .reduce((s, r) => s + BigInt(r.amount ?? 0), 0n)
          todayCollectionsNumber = Number(sum)
          collectionsAvailable = true
        }
      }
    } catch {
      collectionsAvailable = false
    }

    // ── 7. Net cash flow ──
    let todayNetCashFlowNumber: number | null = null
    let netCashFlowAvailable = false
    if (collectionsAvailable && todayCollectionsNumber !== null) {
      todayNetCashFlowNumber = todayCollectionsNumber - todayExpensesNumber
      netCashFlowAvailable = true
    }

    // ── 8. Account balances ──
    const receivablesBalance = arAccount ? Number(arAccount.balanceCache) : 0
    const payablesBalance = apAccount ? Number(-apAccount.balanceCache) : 0
    const totalSalesBalance = salesAccount ? Number(-salesAccount.balanceCache) : 0

    // ── 9. Stock counts ──
    const lowStockProducts = products.filter(p => {
      const stock = p.currentStock ?? 0
      if (stock < 0) return false
      const threshold = p.lowStockThreshold ?? 5
      return stock <= threshold
    })
    const negativeStockProducts = products.filter(p => (p.currentStock ?? 0) < 0)

    // ── 10. Recent slices ──
    const recentInvoices = sortedInvoices.slice(0, 5)
    const recentPurchases = sortedPurchases.slice(0, 5)

    // ── 11. Audit logs ──
    const { data: auditLogsRaw } = await admin
      .from('audit_logs')
      .select('id, timestamp, action, entity, entity_id, details')
      .eq('business_id', bid)
      .order('timestamp', { ascending: false })
      .limit(20)
    const auditLogs = (auditLogsRaw ?? []).map((r: any) => {
      const details =
        typeof r.details === 'string'
          ? r.details
          : JSON.stringify(r.details ?? null)
      return {
        id: r.id,
        timestamp: r.timestamp,
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        details: details.length > 200 ? details.slice(0, 200) + '...' : details,
      }
    })

    // ── 12. Response ──
    return NextResponse.json({
      today,
      kpis: {
        todaySales: todaySalesNumber,
        todaySalesPaisas: todaySales.toString(),
        todayCollections: todayCollectionsNumber,
        todayExpenses: todayExpensesNumber,
        todayExpensesPaisas: todayExpensesPaisas.toString(),
        todayNetCashFlow: todayNetCashFlowNumber,
        totalReceivables: receivablesBalance,
        totalPayables: payablesBalance,
        totalSales: totalSalesBalance,
        lowStockCount: lowStockProducts.length,
        negativeStockCount: negativeStockProducts.length,
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
      recentPurchases: recentPurchases.map(pur => ({
        id: pur.id,
        purchaseNo: pur.purchaseNo,
        vendorName: pur.vendorName,
        purchaseDate: pur.purchaseDate,
        total: pur.total,
        paidAmount: pur.paidAmount,
        status: pur.status,
      })),
      lowStockProducts: lowStockProducts.slice(0, 6).map(p => ({
        id: p.id,
        name: p.name,
        currentStock: p.currentStock,
        lowStockThreshold: p.lowStockThreshold ?? 5,
      })),
      negativeStockProducts: negativeStockProducts.slice(0, 6).map(p => ({
        id: p.id,
        name: p.name,
        currentStock: p.currentStock,
      })),
      auditLogs,
    })
  } catch {
    return NextResponse.json(
      { error: 'DASHBOARD_LOAD_FAILED' },
      { status: 500 },
    )
  }
}