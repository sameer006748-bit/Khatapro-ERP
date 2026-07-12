import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission, hasPermission } from '@/lib/auth/permissions'
import { listRiders, createRider } from '@/lib/delivery/data-access'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (!hasPermission(loaded, 'can_view_delivery_orders') && !hasPermission(loaded, 'can_manage_riders')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  const rows = await listRiders(loaded.businessId)
  return NextResponse.json({ rows })
}

const Schema = z.object({
  name: z.string().min(1), phone: z.string().optional(), zone: z.string().optional(),
  vehicleType: z.string().optional(), userId: z.string().nullable().optional(),
})

export async function POST(req: Request) {
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
    const { db } = await import('@/lib/db')
    // Check user exists, belongs to same business, and has Rider role
    const user = await db.user.findUnique({
      where: { id: parsed.data.userId },
      include: { profile: { include: { role: true } } },
    })
    if (!user || !user.profile) return NextResponse.json({ error: 'Linked user not found' }, { status: 400 })
    if (user.profile.businessId !== su.businessId) return NextResponse.json({ error: 'User does not belong to this business' }, { status: 400 })
    if (user.profile.role.name !== 'Rider') return NextResponse.json({ error: 'Linked user must have Rider role' }, { status: 400 })
    // Check not already linked to another rider
    const { getAdminSupabase } = await import('@/lib/supabase/admin')
    const admin = getAdminSupabase()
    const { data: existing } = await admin.from('riders').select('id, name').eq('business_id', su.businessId).eq('user_id', parsed.data.userId).maybeSingle()
    if (existing) return NextResponse.json({ error: `User already linked to rider: ${existing.name}` }, { status: 400 })
  }

  try {
    const row = await createRider(su.businessId, parsed.data.name, parsed.data.phone, parsed.data.zone, parsed.data.vehicleType, parsed.data.userId ?? null)
    return NextResponse.json({ row })
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
}
