import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission, hasPermission } from '@/lib/auth/permissions'
import { assignRider, getDeliveryOrder } from '@/lib/delivery/data-access'
import { resolveRequestId, safeMutationError } from '@/lib/observability'

const Schema = z.object({ riderId: z.string().min(1) })

/**
 * POST /api/delivery-orders/[id]/assign
 *
 * `can_assign_rider` (Owner/Admin, Accountant) may assign or re-assign at any
 * point in the delivery lifecycle — unchanged.
 *
 * An order creator holding only `can_create_online_orders` (Salesman) may make
 * the FIRST assignment on an order that is still `pending` and has no rider.
 * That is exactly what the Online/OFC sale screen does immediately after
 * posting; it does not grant the power to pull a rider off a delivery that is
 * already assigned or in flight, so no existing authorization is weakened.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = resolveRequestId(req)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const canAssignAny = hasPermission(loaded, 'can_assign_rider')
  const su = canAssignAny
    ? loaded
    : await requirePermission(loaded, 'can_create_online_orders')
  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  if (!canAssignAny) {
    const order = await getDeliveryOrder(su.businessId, id)
    if (!order) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (order.riderId || order.status !== 'pending') {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
  }
  try {
    await assignRider(su.businessId, id, parsed.data.riderId, su.userId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return safeMutationError({
      route: '/api/delivery-orders/[id]/assign',
      requestId,
      errorCode: 'RIDER_ASSIGN_FAILED',
      userMessage: 'The rider could not be assigned.',
      error,
    })
  }
}
