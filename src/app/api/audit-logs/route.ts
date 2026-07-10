/**
 * Audit log list (Owner/Admin only).
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { db } from '@/lib/db'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_view_audit_log')

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
