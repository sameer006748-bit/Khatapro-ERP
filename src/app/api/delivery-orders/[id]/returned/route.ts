import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission, hasPermission } from '@/lib/auth/permissions'
import { returnRiderDelivery, getDeliveryOrder, getRiderByUserId } from '@/lib/delivery/data-access'
import { resolveRequestId, safeMutationError } from '@/lib/observability'

const Schema = z.object({ returnReason: z.string().optional(), idempotencyKey: z.string().uuid().optional() })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = resolveRequestId(req)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (!hasPermission(loaded, 'can_mark_returned')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })

  const order = await getDeliveryOrder(loaded.businessId, id)
  if (!order) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  // For riders: verify they own this order
  if (loaded.roleName === 'Rider') {
    const rider = await getRiderByUserId(loaded.businessId, loaded.userId)
    if (!rider) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    if (order.riderId !== rider.id) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
  }

  try {
    const result = await returnRiderDelivery({ businessId: loaded.businessId, invoiceId: order.invoiceId, reason: parsed.data.returnReason ?? null, idempotencyKey: parsed.data.idempotencyKey ?? crypto.randomUUID() })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return safeMutationError({
      route: '/api/delivery-orders/[id]/returned',
      requestId,
      errorCode: 'DELIVERY_RETURN_FAILED',
      userMessage: 'The return could not be recorded.',
      error,
    })
  }
}
