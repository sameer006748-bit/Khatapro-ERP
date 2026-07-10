/**
 * Full permission catalog grouped by module. Used by the role-management
 * UI to render the permission matrix.
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
  await requireOwner(loaded)

  const all = await db.permission.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }] })

  const grouped: Record<string, Array<{ code: string; description: string | null }>> = {}
  for (const p of all) {
    if (!grouped[p.module]) grouped[p.module] = []
    grouped[p.module].push({ code: p.code, description: p.description })
  }

  return NextResponse.json({ modules: grouped })
}
