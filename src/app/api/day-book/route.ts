import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission, hasPermission } from '@/lib/auth/permissions'
import { dayBook } from '@/lib/vouchers/data-access'
import { withObservability } from '@/lib/observability'

export const GET = withObservability('/api/day-book', async (req: Request) => {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (!hasPermission(loaded, 'can_view_day_book') && !hasPermission(loaded, 'can_view_vouchers')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  const url = new URL(req.url)
  const filters = {
    fromDate: url.searchParams.get('fromDate'),
    toDate: url.searchParams.get('toDate'),
    voucherType: url.searchParams.get('voucherType'),
  }
  try {
    const rows = await dayBook(loaded.businessId, filters)
    return NextResponse.json({ rows })
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
})
