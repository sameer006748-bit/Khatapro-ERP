/**
 * GET /api/riders/available-users — list Rider-role users not yet linked to a rider.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { db } from '@/lib/db'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_manage_riders')

  const riderRole = await db.role.findFirst({ where: { name: 'Rider', businessId: su.businessId } })
  if (!riderRole) return NextResponse.json({ rows: [] })

  const users = await db.user.findMany({
    where: { profile: { roleId: riderRole.id, businessId: su.businessId, isActive: true } },
    include: { profile: { select: { displayName: true } } },
  })

  const { getAdminSupabase } = await import('@/lib/supabase/admin')
  const admin = getAdminSupabase()
  const { data: linkedRiders } = await admin.from('riders').select('user_id').eq('business_id', su.businessId).not('user_id', 'is', null)
  const linkedUserIds = new Set((linkedRiders ?? []).map((r: any) => r.user_id))

  return NextResponse.json({
    rows: users.map(u => ({
      id: u.id,
      email: u.email,
      displayName: u.profile?.displayName ?? u.email,
      alreadyLinked: linkedUserIds.has(u.id),
    })),
  })
}
