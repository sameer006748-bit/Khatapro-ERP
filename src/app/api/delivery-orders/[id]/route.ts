import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, hasPermission } from '@/lib/auth/permissions'
import { getDeliveryOrder, getRiderByUserId } from '@/lib/delivery/data-access'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (!hasPermission(loaded, 'can_view_delivery_orders')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  const { id } = await params
  const order = await getDeliveryOrder(loaded.businessId, id)
  if (!order) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  // Riders can only see their own orders
  if (loaded.roleName === 'Rider') {
    const rider = await getRiderByUserId(loaded.businessId, loaded.userId)
    if (!rider || order.riderId !== rider.id) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
  }

  return NextResponse.json({ order })
}
