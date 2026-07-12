import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, hasPermission } from '@/lib/auth/permissions'
import { reportProfitLoss, reportBalanceSheet, reportSalesSummary, reportInventoryValuation, reportCashFlow, reportExpenseSummary, reportCustomerOutstanding, reportVendorOutstanding, reportSalesDetail, reportPurchaseDetail, reportStockMovements, reportDeliverySummary, reportCodSettlements, reportProductProfitability, reportTrialBalance, reportExceptions } from '@/lib/reports/data-access'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const url = new URL(req.url)
  const type = url.searchParams.get('type') || 'overview'
  const fromDate = url.searchParams.get('fromDate') || new Date().toISOString().slice(0, 8) + '01'
  const toDate = url.searchParams.get('toDate') || new Date().toISOString().slice(0, 10)

  // Permission checks based on report type
  const permMap: Record<string, string> = {
    'profit-loss': 'can_view_pl',
    'balance-sheet': 'can_view_balance_sheet',
    'trial-balance': 'can_view_trial_balance',
    'cash-flow': 'can_view_ledgers',
    'expense': 'can_view_ledgers',
    'sales-summary': 'can_view_sales_reports',
    'sales-detail': 'can_view_sales_reports',
    'customer-outstanding': 'can_view_customer_ledger',
    'inventory-valuation': 'can_view_inventory_reports',
    'stock-movements': 'can_view_inventory_reports',
    'product-profitability': 'can_view_inventory_reports',
    'purchase-detail': 'can_view_purchase_reports',
    'vendor-outstanding': 'can_view_vendor_ledger',
    'delivery-summary': 'can_view_delivery_reports',
    'cod-settlements': 'can_view_delivery_reports',
    'exceptions': 'can_view_audit_reports',
    'overview': 'can_view_trial_balance',
  }
  const requiredPerm = permMap[type]
  if (requiredPerm && !hasPermission(loaded, requiredPerm)) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  try {
    const bid = loaded.businessId
    switch (type) {
      case 'profit-loss': return NextResponse.json({ rows: await reportProfitLoss(bid, fromDate, toDate) })
      case 'balance-sheet': return NextResponse.json({ rows: await reportBalanceSheet(bid, toDate) })
      case 'trial-balance': return NextResponse.json({ rows: await reportTrialBalance(bid) })
      case 'sales-summary': return NextResponse.json({ rows: await reportSalesSummary(bid, fromDate, toDate) })
      case 'inventory-valuation': return NextResponse.json({ rows: await reportInventoryValuation(bid) })
      case 'cash-flow': return NextResponse.json({ rows: await reportCashFlow(bid, fromDate, toDate) })
      case 'expense': return NextResponse.json({ rows: await reportExpenseSummary(bid, fromDate, toDate) })
      case 'customer-outstanding': return NextResponse.json({ rows: await reportCustomerOutstanding(bid) })
      case 'vendor-outstanding': return NextResponse.json({ rows: await reportVendorOutstanding(bid) })
      case 'sales-detail': return NextResponse.json({ rows: await reportSalesDetail(bid, fromDate, toDate) })
      case 'purchase-detail': return NextResponse.json({ rows: await reportPurchaseDetail(bid, fromDate, toDate) })
      case 'stock-movements': return NextResponse.json({ rows: await reportStockMovements(bid, fromDate, toDate) })
      case 'product-profitability': return NextResponse.json({ rows: await reportProductProfitability(bid, fromDate, toDate) })
      case 'exceptions': return NextResponse.json({ rows: await reportExceptions(bid) })
      case 'delivery-summary': return NextResponse.json({ rows: await reportDeliverySummary(bid) })
      case 'cod-settlements': return NextResponse.json({ rows: await reportCodSettlements(bid) })
      case 'overview': {
        const [pl, bs, inv, cash, sales, expenses] = await Promise.all([
          reportProfitLoss(bid, fromDate, toDate),
          reportBalanceSheet(bid, toDate),
          reportInventoryValuation(bid),
          reportCashFlow(bid, fromDate, toDate),
          reportSalesSummary(bid, fromDate, toDate),
          reportExpenseSummary(bid, fromDate, toDate),
        ])
        const revenue = pl.filter(r => r.section === 'REVENUE').reduce((s, r) => s + Number(r.amount), 0)
        const expensesTotal = pl.filter(r => r.section === 'EXPENSE').reduce((s, r) => s + Number(r.amount), 0)
        const cogs = pl.filter(r => r.account_code === '5010').reduce((s, r) => s + Number(r.amount), 0)
        const assets = bs.filter(r => r.section === 'ASSET').reduce((s, r) => s + Number(r.balance), 0)
        const liabilities = bs.filter(r => r.section === 'LIABILITY').reduce((s, r) => s + Number(r.balance), 0)
        const equity = bs.filter(r => r.section === 'EQUITY').reduce((s, r) => s + Number(r.balance), 0)
        const invValue = inv.reduce((s, r) => s + Number(r.stock_value), 0)
        const cashBalance = cash.reduce((s, r) => s + Number(r.closing_balance), 0)
        const custRecv = bs.find(r => r.account_code === '1200')?.balance || '0'
        const vendorPay = bs.find(r => r.account_code === '2010')?.balance || '0'
        const riderCod = bs.find(r => r.account_code === '1310')?.balance || '0'
        return NextResponse.json({
          kpis: {
            netSales: String(revenue),
            grossProfit: String(revenue - cogs),
            netProfit: String(revenue - expensesTotal),
            totalExpenses: String(expensesTotal),
            cashBalance: String(cashBalance),
            customerReceivable: String(custRecv),
            vendorPayable: String(vendorPay),
            inventoryValue: String(invValue),
            codPending: String(riderCod),
          },
          assets: String(assets),
          liabilities: String(liabilities),
          equity: String(equity),
          balanced: assets === liabilities + equity,
        })
      }
      default: return NextResponse.json({ error: 'UNKNOWN_REPORT_TYPE' }, { status: 400 })
    }
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
}
