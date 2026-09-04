import { useQuery } from '@tanstack/react-query'
import { shouldRetryApiRequest } from '@/lib/api-client'

export interface RiderDashboardData {
  available?: boolean
  reason?: string
  message?: string
  summary: {
    assigned: number
    outForDelivery: number
    deliveredToday: number
    codPending: string
    earningsPayable: string
  } | null
  riderId: string | null
  recentOrders: Array<{
    id: string
    invoiceNo: string | null
    status: string
    customerName: string | null
    customerAddress: string | null
    totalCodAmount: string
    codCollectedAmount: string
  }>
}

async function fetchRiderDashboard(signal?: AbortSignal): Promise<RiderDashboardData> {
  const r = await fetch('/api/rider-dashboard', {
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  })
  // 403 here means the authenticated Rider has no linked rider record — a
  // configuration state, not a transient error. Surface it distinctly so the
  // UI can show an actionable "not linked" message instead of a generic error.
  if (r.status === 403) throw new Error('NotLinked')
  if (r.status === 401) throw new Error('Unauthorized')
  if (!r.ok) throw new Error('DASHBOARD_LOAD_FAILED')
  return r.json()
}

export function useRiderDashboard() {
  return useQuery({
    queryKey: ['rider-dashboard'],
    queryFn: ({ signal }) => fetchRiderDashboard(signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof Error && (error.message === 'Unauthorized' || error.message === 'NotLinked')) {
        return false
      }
      return shouldRetryApiRequest(failureCount, error)
    },
  })
}
