import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, hasPermission } from '@/lib/auth/permissions'
import { riderDashboardSummary, getRiderForSession, listDeliveryOrders, riderCodBalances } from '@/lib/delivery/data-access'
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
      const rider = await getRiderForSession(loaded)
      if (!rider) return NextResponse.json({ error: 'RIDER_LINK_REQUIRED' }, { status: 403 })
      const [summary, orders] = await Promise.all([
        riderDashboardSummary(loaded.businessId, rider.id),
        listDeliveryOrders(loaded.businessId, rider.id),
      ])
      const cashResult = await Promise.allSettled([riderCodBalances(loaded.businessId, rider.id)])
      const cashRows = cashResult[0].status === 'fulfilled' ? cashResult[0].value : []
      const recentOrders = orders.map(o => ({
        id: o.id,
        invoiceId: o.invoiceId,
        invoiceNo: o.invoiceNo,
        status: o.status,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        customerAddress: o.customerAddress,
        customerCity: o.customerCity,
        deliveryNote: o.deliveryNote,
        totalCodAmount: o.totalCodAmount,
        codCollectedAmount: o.codCollectedAmount,
      }))
      return NextResponse.json({
        summary,
        riderId: rider.id,
        riderName: rider.name,
        recentOrders,
        cash: cashRows[0] ?? null,
        cashAvailable: cashResult[0].status === 'fulfilled',
      })
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
