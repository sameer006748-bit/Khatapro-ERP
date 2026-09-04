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
  riderName?: string | null
  cashAvailable?: boolean
  cash?: {
    outstandingCod: string
    invoiceCount: number
    settledCod: string
    latestSettlementDate: string | null
  } | null
  recentOrders: Array<{
    id: string
    invoiceId: string
    invoiceNo: string | null
    status: string
    customerName: string | null
    customerPhone: string | null
    customerAddress: string | null
    customerCity: string | null
    deliveryNote: string | null
    totalCodAmount: string
    codCollectedAmount: string
  }>
}

async function fetchRiderDashboard(signal?: AbortSignal): Promise<RiderDashboardData> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timer = window.setTimeout(abort, 12_000)
  try {
    const response = await fetch('/api/rider-dashboard', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
    if (response.status === 403) {
      const body = await response.json().catch(() => null)
      if (body?.error === 'RIDER_LINK_REQUIRED') throw new Error('NotLinked')
      throw new Error('Forbidden')
    }
    if (response.status === 401) throw new Error('Unauthorized')
    if (!response.ok) throw new Error('DASHBOARD_LOAD_FAILED')
    return response.json()
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

export function useRiderDashboard() {
  return useQuery({
    queryKey: ['rider-dashboard'],
    queryFn: ({ signal }) => fetchRiderDashboard(signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof Error && ['Unauthorized', 'Forbidden', 'NotLinked'].includes(error.message)) {
        return false
      }
      return shouldRetryApiRequest(failureCount, error)
    },
  })
}
