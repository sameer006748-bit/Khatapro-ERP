import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { hasPermission } from '@/lib/auth/permissions'
import { sessionUserFromHydratedUser } from '@/lib/auth/session-user'
import { reportProfitLoss, reportBalanceSheet, reportSalesSummary, reportInventoryValuation, reportCashFlow, reportExpenseSummary, reportCustomerOutstanding, reportVendorOutstanding, reportSalesDetail, reportPurchaseDetail, reportStockMovements, reportDeliverySummary, reportCodSettlements, reportProductProfitability, reportTrialBalance, reportExceptions, reportMoneyAccountCodes } from '@/lib/reports/data-access'
import { sumMoneyAccountBalances } from '@/lib/reports/money-account-balance'
import { resolveRequestId, safeApiError, withObservability, measurePerformanceStage } from '@/lib/observability'
import { bizDateString } from '@/lib/dates'
import { isSchemaUnavailableError } from '@/lib/dashboard/compatibility'
import { unavailableAccountingPayload } from '@/lib/accounting/availability'
import { buildClassificationOverlay, tryListAccountClassification } from '@/lib/accounting/legacy-account-classification'

/**
 * Reports whose rows are one-per-ledger-account, so the custom classification
 * can be attached as labels. The rows themselves — and therefore every total,
 * section and statement placement — are returned exactly as the report RPC
 * produced them.
 */
const CLASSIFIABLE_REPORTS = new Set(['profit-loss', 'balance-sheet', 'expense'])

type ReportClassification = {
  hasCustomClassification: boolean
  categories: Array<{ id: string; name: string; rootId: string; isActive: boolean }>
  subcategories: Array<{ id: string; name: string; rootId: string; categoryId: string; isActive: boolean }>
  /** Keyed by account code, because the legacy report RPCs return codes. */
  accounts: Record<string, {
    categoryId: string
    categoryName: string | null
    subcategoryId: string | null
    subcategoryName: string | null
  }>
}

const EMPTY_CLASSIFICATION: ReportClassification = {
  hasCustomClassification: false, categories: [], subcategories: [], accounts: {},
}

/** Best-effort; null keeps a report byte-identical to its pre-classification output. */
async function reportClassification(
  type: string,
  businessId: string,
  actorProfileId: string,
): Promise<ReportClassification | null> {
  if (!CLASSIFIABLE_REPORTS.has(type)) return null
  const tree = await tryListAccountClassification(businessId, actorProfileId)
  if (!tree) return null
  const overlay = buildClassificationOverlay(tree)
  if (!overlay.hasCustomClassification) return EMPTY_CLASSIFICATION
  const accounts: ReportClassification['accounts'] = {}
  for (const [code, label] of Object.entries(overlay.byAccountCode)) {
    if (!label.categoryId) continue
    accounts[code] = {
      categoryId: label.categoryId,
      categoryName: label.categoryName,
      subcategoryId: label.subcategoryId,
      subcategoryName: label.subcategoryName,
    }
  }
  return {
    hasCustomClassification: true,
    categories: overlay.categories,
    subcategories: overlay.subcategories,
    accounts,
  }
}

export const GET = withObservability('/api/reports', async (req: Request) => {
  const requestId = resolveRequestId(req)
  const session = await measurePerformanceStage(
    'session.getServerSession',
    () => getServerSession(authOptions),
  )
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = sessionUserFromHydratedUser(session.user)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const url = new URL(req.url)
  const type = url.searchParams.get('type') || 'overview'
  const businessToday = bizDateString(new Date())
  const fromDate = url.searchParams.get('fromDate') || businessToday.slice(0, 8) + '01'
  const toDate = url.searchParams.get('toDate') || businessToday

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
    return await measurePerformanceStage('endpoint.reportWorkload', async () => {
      switch (type) {
        case 'profit-loss': {
        // The report rows and the classification overlay are independent reads;
        // run them in parallel so label enrichment never serializes behind the RPC.
        const [rows, classification] = await Promise.all([
          reportProfitLoss(bid, fromDate, toDate),
          reportClassification(type, bid, loaded.profileId),
        ])
        return NextResponse.json({ rows, classification })
      }
      case 'balance-sheet': {
        const [rows, classification] = await Promise.all([
          reportBalanceSheet(bid, toDate),
          reportClassification(type, bid, loaded.profileId),
        ])
        return NextResponse.json({ rows, classification })
      }
      case 'trial-balance': return NextResponse.json({ rows: await reportTrialBalance(bid, fromDate, toDate) })
      case 'sales-summary': return NextResponse.json({ rows: await reportSalesSummary(bid, fromDate, toDate) })
      case 'inventory-valuation': return NextResponse.json({ rows: await reportInventoryValuation(bid) })
      case 'cash-flow': return NextResponse.json({ rows: await reportCashFlow(bid, fromDate, toDate) })
      case 'expense': {
        const [rows, classification] = await Promise.all([
          reportExpenseSummary(bid, fromDate, toDate),
          reportClassification(type, bid, loaded.profileId),
        ])
        return NextResponse.json({ rows, classification })
      }
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
        const [pl, bs, moneyAccountCodes] = await Promise.all([
          reportProfitLoss(bid, fromDate, toDate),
          reportBalanceSheet(bid, toDate),
          reportMoneyAccountCodes(bid),
        ])
        const sumAmount = (rows: any[]) => rows.reduce((sum, row) => sum + BigInt(row.amount ?? 0), 0n)
        const sumBalance = (rows: any[]) => rows.reduce((sum, row) => sum + BigInt(row.balance ?? 0), 0n)
        const revenue = sumAmount(pl.filter(r => r.section === 'REVENUE'))
        const cogs = sumAmount(pl.filter(r => r.section === 'COST_OF_GOODS_SOLD'))
        const expensesTotal = sumAmount(pl.filter(r => r.section === 'EXPENSE'))
        const assets = sumBalance(bs.filter(r => r.section === 'ASSET'))
        const liabilities = sumBalance(bs.filter(r => r.section === 'LIABILITY'))
        const equity = sumBalance(bs.filter(r => r.section === 'EQUITY'))
        // This is the same concept as Accounts & Balances → Total Available:
        // every active Asset ledger explicitly configured as a business money
        // account, including user-created accounts whose code is not 1010-1040.
        const cashBalance = sumMoneyAccountBalances(bs, moneyAccountCodes)
        const custRecv = BigInt(bs.find(r => r.account_code === '1200')?.balance ?? 0)
        const vendorPay = BigInt(bs.find(r => r.account_code === '2010')?.balance ?? 0)
        const invValue = BigInt(bs.find(r => r.account_code === '1100')?.balance ?? 0)
        // Rider COD sits at '1310' (Rider COD Receivable) in the legacy
        // production chart and at '1300' (Rider Held COD) in the UUID ledger
        // chart. Prefer the legacy code where it exists — the legacy chart also
        // carries a '1300' salesman control account, so a first-match lookup
        // across both codes would report Rs 0.00 on production.
        const riderCodRow = bs.find(r => r.account_code === '1310') ?? bs.find(r => r.account_code === '1300')
        const riderCod = BigInt(riderCodRow?.balance ?? 0)
        return NextResponse.json({
          kpis: {
            netSales: String(revenue),
            grossProfit: String(revenue - cogs),
            netProfit: String(revenue - cogs - expensesTotal),
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
    })
  } catch (error) {
    if (isSchemaUnavailableError(error instanceof Error ? error : { message: String(error) })) {
      return NextResponse.json(unavailableAccountingPayload(
        { rows: [] },
        'schema-unavailable',
      ))
    }
    return safeApiError({
      route: '/api/reports',
      requestId,
      errorCode: 'REPORT_LOAD_FAILED',
      userMessage: 'The report could not be loaded.',
      error,
    })
  }
}, { performanceTiming: true })
