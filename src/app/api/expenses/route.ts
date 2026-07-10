import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, hasPermission } from '@/lib/auth/permissions'
import { listExpenses } from '@/lib/vouchers/data-access'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (!hasPermission(loaded, 'can_view_day_book') && !hasPermission(loaded, 'can_view_vouchers')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  try {
    const rows = await listExpenses(loaded.businessId)
    return NextResponse.json({ rows })
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
}
