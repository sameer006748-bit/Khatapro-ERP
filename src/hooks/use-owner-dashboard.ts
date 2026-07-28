import { useQuery } from '@tanstack/react-query'
import { bizPresetDateRange, dashboardDateRangeQuery, type BusinessDateRange } from '@/lib/dates'
import { apiFetchJson, shouldRetryApiRequest } from '@/lib/api-client'

export interface OwnerDashboardData {
  today: string
  range: BusinessDateRange
  dataSource: 'uuid-ledger' | 'operational-fallback'
  kpis: {
    todaySales: number | null
    todaySalesPaisas: string | null
    todayCollections: number | null
    todayExpenses: number | null
    todayExpensesPaisas: string | null
    todayNetCashFlow: number | null
    totalReceivables: number | null
    totalPayables: number | null
    totalSales: number | null
    lowStockCount: number | null
    negativeStockCount: number | null
    todayPurchases: number | null
    cashBalance: number | null
    bankBalance: number | null
    cashInflow: number | null
    cashOutflow: number | null
    bankInflow: number | null
    bankOutflow: number | null
    totalInflow: number | null
    totalOutflow: number | null
    periodSalesReturns: number | null
    periodPurchaseReturns: number | null
    periodCogs: number | null
    approxProfit: number | null
    periodReceivablesMovement: number | null
    periodPayablesMovement: number | null
    pendingOutstanding: number | null
  }
  availability: {
    todaySales: boolean
    todayCollections: boolean
    todayExpenses: boolean
    todayNetCashFlow: boolean
    todayPurchases: boolean
    periodSalesReturns: boolean
    periodPurchaseReturns: boolean
    periodCogs: boolean
    approxProfit: boolean
    cashBalance: boolean
    bankBalance: boolean
    cashMovement: boolean
    bankMovement: boolean
    totalReceivables: boolean
    totalPayables: boolean
    totalSales: boolean
    receivablesMovement: boolean
    payablesMovement: boolean
    lowStockCount: boolean
    negativeStockCount: boolean
  }
  salesByType: {
    counter: { count: number; amount: string }
    online: { count: number; amount: string }
    ofc: { count: number; amount: string }
    other: { count: number; amount: string }
  }
  recentInvoices: Array<{
    id: string
    invoiceNo: string
    invoiceType: string
    invoiceDate: string
    customerName: string | null
    salesmanName: string | null
    total: string
    paidAmount: string
  }>
  recentPurchases: Array<{
    id: string
    purchaseNo: string
    vendorName: string | null
    purchaseDate: string
    total: string
    paidAmount: string
    status: string
  }>
  lowStockProducts: Array<{
    id: string
    name: string
    currentStock: number
    lowStockThreshold: number
  }>
  negativeStockProducts: Array<{
    id: string
    name: string
    currentStock: number
  }>
  auditLogs: Array<{
    id: string
    timestamp: string
    action: string
    entity: string
    entityId: string | null
  }>
}

async function fetchOwnerDashboard(range: BusinessDateRange, signal?: AbortSignal): Promise<OwnerDashboardData> {
  const query = dashboardDateRangeQuery(range)
  return apiFetchJson(`/api/dashboard/owner?${query}`, { cache: 'no-store', signal })
}

export function useOwnerDashboard(range: BusinessDateRange = bizPresetDateRange('today')) {
  return useQuery({
    queryKey: ['owner-dashboard', range.from, range.to],
    queryFn: ({ signal }) => fetchOwnerDashboard(range, signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: shouldRetryApiRequest,
  })
}

// ── Salesman scoped dashboard: own-sales-only, no business-wide accounting ──
export interface OwnSalesDashboardData {
  summary: {
    invoiceCount: number
    totalAmount: string
    paidAmount: string
    outstandingAmount: string
    returnedAmount: string
  }
  rows: Array<{
    id: string
    invoice_no: string
    invoice_type: string
    invoice_date: string
    customer_name: string | null
    total: string | number
  }>
}

async function fetchOwnSalesDashboard(signal?: AbortSignal): Promise<OwnSalesDashboardData> {
  const { bizDateString } = await import('@/lib/dates')
  const today = bizDateString(new Date())
  const qs = `fromDate=${today}&toDate=${today}`
  const [summaryPayload, detailPayload] = await Promise.all([
    apiFetchJson<{ summary: OwnSalesDashboardData['summary'] }>(
      `/api/reports/salesman?type=my-sales-summary&${qs}`,
      { cache: 'no-store', signal },
    ),
    apiFetchJson<{ rows?: OwnSalesDashboardData['rows'] }>(
      `/api/reports/salesman?type=my-sales-detail&${qs}`,
      { cache: 'no-store', signal },
    ),
  ])
  return { summary: summaryPayload.summary, rows: (detailPayload.rows ?? []).slice(0, 5) }
}

export function useOwnSalesDashboard() {
  return useQuery({
    queryKey: ['own-sales-dashboard'],
    queryFn: ({ signal }) => fetchOwnSalesDashboard(signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: shouldRetryApiRequest,
  })
}
