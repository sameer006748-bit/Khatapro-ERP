/**
 * Audit log list (with can_view_audit_log permission).
 * Dual-path: reads from Supabase when live, Prisma otherwise.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { db } from '@/lib/db'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { isUsingSupabase } from '@/lib/accounting/data-access'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_view_audit_log')

  if (await isUsingSupabase()) {
    const { getAdminSupabase } = await import('@/lib/supabase/admin')
    const admin = getAdminSupabase()
    const { data, error } = await admin
      .from('audit_logs')
      .select('id, timestamp, action, entity, entity_id, user_id, details')
      .eq('business_id', su.businessId)
      .order('timestamp', { ascending: false })
      .limit(200)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({
      rows: (data ?? []).map((r: any) => ({
        id: r.id,
        timestamp: r.timestamp,
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        userId: r.user_id,
        details: typeof r.details === 'string' ? r.details : JSON.stringify(r.details ?? null),
      })),
    })
  }

  const rows = await db.auditLog.findMany({
    where: { businessId: su.businessId },
    orderBy: { timestamp: 'desc' },
    take: 200,
  })

  return NextResponse.json({
    rows: rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      userId: r.userId,
      details: r.details,
    })),
  })
}
