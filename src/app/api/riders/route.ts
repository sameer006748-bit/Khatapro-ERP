import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission, hasPermission } from '@/lib/auth/permissions'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { listRiders, listAssignableRiders, createRider } from '@/lib/delivery/data-access'
import { resolveRequestId, safeMutationError, withObservability } from '@/lib/observability'

/**
 * GET /api/riders — rider roster.
 *
 * Two audiences, two shapes:
 *   - Delivery managers (`can_view_delivery_orders` / `can_manage_riders`) get
 *     the full administrative roster, active and inactive alike.
 *   - Order creators (`can_create_online_orders`, i.e. Salesman) get only the
 *     ACTIVE riders of their own business, with just the fields the "Assign
 *     Rider" selector renders. Without this branch the Salesman's request was
 *     rejected 403 and the sale screen showed an empty dropdown with no
 *     explanation, which is the production symptom this fixes.
 *
 * Both branches are scoped to the caller's own `businessId`, so no roster can
 * cross a business boundary. Anyone holding none of the three permissions
 * still fails closed.
 */
async function getRiders() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const canManageDelivery = hasPermission(loaded, 'can_view_delivery_orders')
    || hasPermission(loaded, 'can_manage_riders')
  const canCreateOrders = hasPermission(loaded, 'can_create_online_orders')
  if (!canManageDelivery && !canCreateOrders) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  const rows = canManageDelivery
    ? await listRiders(loaded.businessId)
    : await listAssignableRiders(loaded.businessId)
  return NextResponse.json({ rows })
}

export const GET = withObservability('/api/riders', getRiders)

const Schema = z.object({
  name: z.string().min(1), phone: z.string().optional(), zone: z.string().optional(),
  vehicleType: z.string().optional(), userId: z.string().nullable().optional(),
})

export async function POST(req: Request) {
  const requestId = resolveRequestId(req)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_manage_riders')
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })

  // Validate linked user if provided
  if (parsed.data.userId) {
    const { getAdminSupabase } = await import('@/lib/supabase/admin')
    const admin = getAdminSupabase()

    if (isSupabaseConfigured()) {
      // Production: validate against Supabase, keyed on the Supabase auth UUID
      // (profiles.user_id) so the stored riders.user_id matches the rider
      // dashboard lookup. Prisma/SQLite is unavailable on serverless.
      const { data: profile } = await admin
        .from('profiles')
        .select('user_id, business_id, role:roles ( name )')
        .eq('business_id', su.businessId)
        .eq('user_id', parsed.data.userId)
        .maybeSingle()
      if (!profile) return NextResponse.json({ error: 'Linked user not found' }, { status: 400 })
      const roleName = (profile as any).role?.name
      if (roleName !== 'Rider') return NextResponse.json({ error: 'Linked user must have Rider role' }, { status: 400 })
      const { data: existing } = await admin.from('riders').select('id, name').eq('business_id', su.businessId).eq('user_id', parsed.data.userId).maybeSingle()
      if (existing) return NextResponse.json({ error: `User already linked to rider: ${existing.name}` }, { status: 400 })
    } else {
      // Local development fallback: Prisma + SQLite
      const { db } = await import('@/lib/db')
      const user = await db.user.findUnique({
        where: { id: parsed.data.userId },
        include: { profile: { include: { role: true } } },
      })
      if (!user || !user.profile) return NextResponse.json({ error: 'Linked user not found' }, { status: 400 })
      if (user.profile.businessId !== su.businessId) return NextResponse.json({ error: 'User does not belong to this business' }, { status: 400 })
      if (user.profile.role.name !== 'Rider') return NextResponse.json({ error: 'Linked user must have Rider role' }, { status: 400 })
      const { data: existing } = await admin.from('riders').select('id, name').eq('business_id', su.businessId).eq('user_id', parsed.data.userId).maybeSingle()
      if (existing) return NextResponse.json({ error: `User already linked to rider: ${existing.name}` }, { status: 400 })
    }
  }

  try {
    const row = await createRider(su.businessId, parsed.data.name, parsed.data.phone, parsed.data.zone, parsed.data.vehicleType, parsed.data.userId ?? null)
    return NextResponse.json({ row })
  } catch (error) {
    return safeMutationError({
      route: '/api/riders',
      requestId,
      errorCode: 'RIDER_CREATE_FAILED',
      userMessage: 'The rider could not be created.',
      error,
    })
  }
}
