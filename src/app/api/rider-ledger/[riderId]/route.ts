import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { riderLedger, getRiderByUserId } from '@/lib/delivery/data-access'

export async function GET(req: Request, { params }: { params: Promise<{ riderId: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  // Riders can view only their own ledger
  let riderId = (await params).riderId
  if (loaded.roleName === 'Rider') {
    const rider = await getRiderByUserId(loaded.businessId, loaded.userId)
    if (!rider || rider.id !== riderId) {
      return NextResponse.json({ error: 'FORBIDDEN — can only view your own ledger' }, { status: 403 })
    }
  } else {
    await requirePermission(loaded, 'can_view_rider_ledger')
  }
  const url = new URL(req.url)
  const rows = await riderLedger(loaded.businessId, riderId, url.searchParams.get('fromDate'), url.searchParams.get('toDate'))
  return NextResponse.json({ rows })
}
