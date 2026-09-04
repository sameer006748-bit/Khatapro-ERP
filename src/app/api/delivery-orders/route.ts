import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, hasPermission } from '@/lib/auth/permissions'
import { listDeliveryOrders, getRiderForSession } from '@/lib/delivery/data-access'
import { withObservability } from '@/lib/observability'

const getDeliveryOrders = async (req: Request) => {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (loaded.roleName === 'Rider'
    ? !hasPermission(loaded, 'can_view_own_orders') && !hasPermission(loaded, 'can_view_delivery_orders')
    : !hasPermission(loaded, 'can_view_delivery_orders')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  const url = new URL(req.url)
  let riderId: string | null = url.searchParams.get('riderId')

  // Riders see only their own orders
  if (loaded.roleName === 'Rider') {
    const rider = await getRiderForSession(loaded)
    if (!rider) return NextResponse.json({ error: 'RIDER_LINK_REQUIRED' }, { status: 403 })
    riderId = rider.id
  }

  const rows = await listDeliveryOrders(loaded.businessId, riderId)
  return NextResponse.json({ rows })
}

export const GET = withObservability('/api/delivery-orders', getDeliveryOrders)
