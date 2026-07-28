import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, hasPermission } from '@/lib/auth/permissions'
import { riderDashboardSummary, getRiderByUserId, listDeliveryOrders } from '@/lib/delivery/data-access'
import { resolveRequestId, safeApiError, withObservability } from '@/lib/observability'
import { isSupabaseConfigured } from '@/lib/supabase/config'

export const GET = withObservability('/api/rider-dashboard', async (request: Request) => {
  const requestId = resolveRequestId(request)
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const loaded = await loadSessionUser((session.user as any).id)
    if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

    // For Rider role: return their own dashboard
    if (loaded.roleName === 'Rider') {
      if (!isSupabaseConfigured()) {
        return NextResponse.json({
          available: false,
          reason: 'DELIVERY_MIGRATION_REQUIRED',
          message: 'Not available until delivery migration',
          summary: null,
          riderId: null,
          recentOrders: [],
        })
      }
      const rider = await getRiderByUserId(loaded.businessId, loaded.userId)
      if (!rider) return NextResponse.json({ error: 'No rider profile linked to your account' }, { status: 403 })
      const [summary, orders] = await Promise.all([
        riderDashboardSummary(loaded.businessId, rider.id),
        listDeliveryOrders(loaded.businessId, rider.id),
      ])
      const recentOrders = orders.slice(0, 10).map(o => ({
        id: o.id,
        invoiceNo: o.invoiceNo,
        status: o.status,
        customerName: o.customerName,
        customerAddress: o.customerAddress,
        totalCodAmount: o.totalCodAmount,
        codCollectedAmount: o.codCollectedAmount,
      }))
      return NextResponse.json({ summary, riderId: rider.id, recentOrders })
    }

    // For Owner/Accountant: need can_view_delivery_orders
    if (!hasPermission(loaded, 'can_view_delivery_orders')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
    return NextResponse.json({ summary: null })
  } catch (error) {
    return safeApiError({
      route: '/api/rider-dashboard',
      requestId,
      errorCode: 'DASHBOARD_LOAD_FAILED',
      userMessage: 'The rider dashboard could not be loaded.',
      error,
    })
  }
})
