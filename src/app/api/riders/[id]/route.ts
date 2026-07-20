import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { updateRider } from '@/lib/delivery/data-access'
import { resolveRequestId, safeMutationError } from '@/lib/observability'

const Schema = z.object({
  name: z.string().min(1).optional(), phone: z.string().nullable().optional(),
  zone: z.string().nullable().optional(), vehicleType: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = resolveRequestId(req)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_manage_riders')
  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  try {
    await updateRider(su.businessId, id, parsed.data)
    return NextResponse.json({ ok: true })
  } catch (error) { return safeMutationError({ route: '/api/riders/[id]', requestId, errorCode: 'RIDER_UPDATE_FAILED', userMessage: 'The rider could not be updated.', error }) }
}
