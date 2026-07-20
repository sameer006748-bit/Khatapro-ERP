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
import { resolveRequestId, safeApiError, withObservability } from '@/lib/observability'

export const GET = withObservability('/api/audit-logs', async (req: Request) => {
  const requestId = resolveRequestId(req)
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
      .select('id, timestamp, action, entity, entity_id, user_id')
      .eq('business_id', su.businessId)
      .order('timestamp', { ascending: false })
      .limit(200)
    if (error) {
      return safeApiError({
        route: '/api/audit-logs',
        requestId,
        errorCode: 'AUDIT_LOG_LOAD_FAILED',
        userMessage: 'Audit entries could not be loaded.',
        error,
      })
    }
    return NextResponse.json({
      rows: (data ?? []).map((r: any) => ({
        id: r.id,
        timestamp: r.timestamp,
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        actorCategory: r.user_id ? 'Authenticated user' : 'System',
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
      actorCategory: r.userId ? 'Authenticated user' : 'System',
    })),
  })
})
