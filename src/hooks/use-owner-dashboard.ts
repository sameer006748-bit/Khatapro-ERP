import { useQuery } from '@tanstack/react-query'
import { bizPresetDateRange, type BusinessDateRange } from '@/lib/dates'

export interface OwnerDashboardData {
  today: string
  range: BusinessDateRange
  kpis: {
    todaySales: number
    todaySalesPaisas: string
    todayCollections: number | null
    todayExpenses: number
    todayExpensesPaisas: string
    todayNetCashFlow: number | null
    totalReceivables: number
    totalPayables: number
    totalSales: number
    lowStockCount: number
    negativeStockCount: number
    todayPurchases: number | null
    cashBalance: number | null
    bankBalance: number | null
    periodReceivablesMovement: number | null
    periodPayablesMovement: number | null
  }
  availability: {
    todaySales: boolean
    todayCollections: boolean
    todayExpenses: boolean
    todayNetCashFlow: boolean
    totalReceivables: boolean
    totalPayables: boolean
    totalSales: boolean
    lowStockCount: boolean
    negativeStockCount: boolean
  }
  salesByType: {
    counter: { count: number; amount: string }
    online: { count: number; amount: string }
    ofc: { count: number; amount: string }
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

async function fetchOwnerDashboard(range: BusinessDateRange): Promise<OwnerDashboardData> {
  const params = new URLSearchParams({ from: range.from, to: range.to })
  const r = await fetch(`/api/dashboard/owner?${params.toString()}`, { cache: 'no-store' })
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) {
      throw new Error('Unauthorized')
    }
    throw new Error('DASHBOARD_LOAD_FAILED')
  }
  return r.json()
}

export function useOwnerDashboard(range: BusinessDateRange = bizPresetDateRange('today')) {
  return useQuery({
    queryKey: ['owner-dashboard', range.from, range.to],
    queryFn: () => fetchOwnerDashboard(range),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message === 'Unauthorized') return false
      return failureCount < 2
    },
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
