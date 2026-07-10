/**
 * Roles + their permission codes (Owner/Admin only). Used by the
 * permission-management UI.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { db } from '@/lib/db'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requireOwner } from '@/lib/auth/permissions'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requireOwner(loaded)

  const roles = await db.role.findMany({
    where: { businessId: su.businessId },
    include: { permissions: { include: { permission: true } } },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json({
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      isSystem: r.isSystem,
      description: r.description,
      permissions: r.permissions.map((rp) => ({
        code: rp.permission.code,
        module: rp.permission.module,
        description: rp.permission.description,
      })),
    })),
  })
}
