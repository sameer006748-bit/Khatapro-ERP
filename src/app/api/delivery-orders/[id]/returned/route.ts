import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, hasPermission } from '@/lib/auth/permissions'
import { getDeliveryOrder, getDeliveryOrderItems, getRiderByUserId, recordDeliveryOutcome } from '@/lib/delivery/data-access'
import { resolveRequestId, safeMutationError } from '@/lib/observability'

const Schema = z.object({
  returnReason: z.string().optional(),
  idempotencyKey: z.string().uuid().optional(),
  items: z.array(z.object({
    invoiceItemId: z.string().uuid(),
    deliveredQty: z.number().int().nonnegative().default(0),
    returnedQty: z.number().int().positive(),
  })).min(1).optional(),
})

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
    const currentItems = await getDeliveryOrderItems(loaded.businessId, order.invoiceId)
    const items = parsed.data.items ?? currentItems
      .filter(item => item.remainingQty > 0)
      .map(item => ({
        invoiceItemId: item.invoiceItemId,
        deliveredQty: 0,
        returnedQty: item.remainingQty,
      }))
    const result = await recordDeliveryOutcome({
      businessId: loaded.businessId,
      invoiceId: order.invoiceId,
      items,
      cashCollected: 0n,
      reason: parsed.data.returnReason ?? null,
      idempotencyKey: parsed.data.idempotencyKey ?? crypto.randomUUID(),
      actorId: loaded.userId,
    })
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
