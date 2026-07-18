import { useQuery } from '@tanstack/react-query'

export interface OwnerDashboardData {
  today: string
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
    details: string
  }>
}

async function fetchOwnerDashboard(): Promise<OwnerDashboardData> {
  const r = await fetch('/api/dashboard/owner', { cache: 'no-store' })
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) {
      throw new Error('Unauthorized')
    }
    throw new Error('DASHBOARD_LOAD_FAILED')
  }
  return r.json()
}

export function useOwnerDashboard() {
  return useQuery({
    queryKey: ['owner-dashboard'],
    queryFn: fetchOwnerDashboard,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message === 'Unauthorized') return false
      return failureCount < 2
    },
  })
}