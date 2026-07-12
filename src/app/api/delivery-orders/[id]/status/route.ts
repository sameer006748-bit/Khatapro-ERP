import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, hasPermission } from '@/lib/auth/permissions'
import { updateDeliveryStatus, getDeliveryOrder, getRiderByUserId } from '@/lib/delivery/data-access'

const Schema = z.object({ newStatus: z.string(), note: z.string().optional() })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (!hasPermission(loaded, 'can_update_delivery_status')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({}))
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

  try {
    await updateDeliveryStatus(loaded.businessId, id, parsed.data.newStatus, parsed.data.note ?? null, loaded.userId)
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
}
