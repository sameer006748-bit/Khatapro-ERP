import { useQuery } from '@tanstack/react-query'
import { bizPresetDateRange, type BusinessDateRange } from '@/lib/dates'
import { shouldRetryDashboardRequest } from '@/lib/dashboard/compatibility'

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

class DashboardFetchError extends Error {
  constructor(public readonly status: number) {
    super(status === 401 || status === 403 ? 'Unauthorized' : 'DASHBOARD_LOAD_FAILED')
  }
}

async function fetchOwnerDashboard(range: BusinessDateRange, signal?: AbortSignal): Promise<OwnerDashboardData> {
  const params = new URLSearchParams({ from: range.from, to: range.to })
  const r = await fetch(`/api/dashboard/owner?${params.toString()}`, { cache: 'no-store', signal })
  if (!r.ok) {
    throw new DashboardFetchError(r.status)
  }
  return r.json()
}

export function useOwnerDashboard(range: BusinessDateRange = bizPresetDateRange('today')) {
  return useQuery({
    queryKey: ['owner-dashboard', range.from, range.to],
    queryFn: ({ signal }) => fetchOwnerDashboard(range, signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: (failureCount, error) =>
      shouldRetryDashboardRequest(failureCount, error instanceof DashboardFetchError ? error.status : undefined),
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

async function fetchOwnSalesDashboard(): Promise<OwnSalesDashboardData> {
  const { bizDateString } = await import('@/lib/dates')
  const today = bizDateString(new Date())
  const qs = `fromDate=${today}&toDate=${today}`
  const [sumRes, detRes] = await Promise.all([
    fetch(`/api/reports/salesman?type=my-sales-summary&${qs}`, { cache: 'no-store' }),
    fetch(`/api/reports/salesman?type=my-sales-detail&${qs}`, { cache: 'no-store' }),
  ])
  if (!sumRes.ok || !detRes.ok) {
    if ([sumRes.status, detRes.status].some((s) => s === 401 || s === 403)) {
      throw new Error('Unauthorized')
    }
    throw new Error('DASHBOARD_LOAD_FAILED')
  }
  const summary = (await sumRes.json()).summary
  const rows = (await detRes.json()).rows ?? []
  return { summary, rows: rows.slice(0, 5) }
}

export function useOwnSalesDashboard() {
  return useQuery({
    queryKey: ['own-sales-dashboard'],
    queryFn: fetchOwnSalesDashboard,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message === 'Unauthorized') return false
      return failureCount < 2
    },
  })
}
