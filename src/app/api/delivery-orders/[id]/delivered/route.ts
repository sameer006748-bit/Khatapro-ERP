import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission, hasPermission } from '@/lib/auth/permissions'
import { markDelivered, getDeliveryOrder, getRiderByUserId } from '@/lib/delivery/data-access'
import { parseMoney } from '@/lib/format'
import { resolveRequestId, safeMutationError } from '@/lib/observability'

const Schema = z.object({
  collectedAmount: z.string().min(1),
  recipientName: z.string().optional(),
  deliveryNote: z.string().optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = resolveRequestId(req)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (!hasPermission(loaded, 'can_mark_delivered')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })

  // For riders: verify they own this order
  if (loaded.roleName === 'Rider') {
    const rider = await getRiderByUserId(loaded.businessId, loaded.userId)
    if (!rider) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    const order = await getDeliveryOrder(loaded.businessId, id)
    if (!order || order.riderId !== rider.id) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
  }

  const collectedAmount = parseMoney(parsed.data.collectedAmount)
  if (collectedAmount === null || collectedAmount < 0n) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
  }

  try {
    const result = await markDelivered(loaded.businessId, id, collectedAmount, parsed.data.recipientName ?? null, parsed.data.deliveryNote ?? null, loaded.userId)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return safeMutationError({
      route: '/api/delivery-orders/[id]/delivered',
      requestId,
      errorCode: 'DELIVERY_CONFIRM_FAILED',
      userMessage: 'The delivery could not be confirmed.',
      error,
    })
  }
}
