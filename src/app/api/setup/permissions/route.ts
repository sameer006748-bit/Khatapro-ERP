/**
 * Full permission catalog grouped by module. Used by the role-management
 * UI to render the permission matrix.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createAuthClient } from '@/lib/supabase/auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requireOwner } from '@/lib/auth/permissions'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  await requireOwner(loaded)

  if (!isSupabaseConfigured()) {
    // Local fallback
    const { db } = await import('@/lib/db')
    const all = await db.permission.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }] })

    const grouped: Record<string, Array<{ code: string; description: string | null }>> = {}
    for (const p of all) {
      if (!grouped[p.module]) grouped[p.module] = []
      grouped[p.module].push({ code: p.code, description: p.description })
    }

    return NextResponse.json({ modules: grouped })
  }

  // Supabase mode
  const supabase = createAuthClient()
  const { data: permissions, error } = await supabase
    .from('permissions')
    .select('code, module, description')
    .order('module', { ascending: true })
    .order('code', { ascending: true })

  if (error) {
    return NextResponse.json({ error: 'FETCH_FAILED' }, { status: 500 })
  }

  const grouped: Record<string, Array<{ code: string; description: string | null }>> = {}
  for (const p of permissions || []) {
    if (!grouped[p.module]) grouped[p.module] = []
    grouped[p.module].push({ code: p.code, description: p.description })
  }

  return NextResponse.json({ modules: grouped })
}
