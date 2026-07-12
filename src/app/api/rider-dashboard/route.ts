import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, hasPermission } from '@/lib/auth/permissions'
import { riderDashboardSummary, getRiderByUserId } from '@/lib/delivery/data-access'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  // For Rider role: return their own dashboard
  if (loaded.roleName === 'Rider') {
    const rider = await getRiderByUserId(loaded.businessId, loaded.userId)
    if (!rider) return NextResponse.json({ error: 'No rider profile linked to your account' }, { status: 403 })
    const summary = await riderDashboardSummary(loaded.businessId, rider.id)
    return NextResponse.json({ summary, riderId: rider.id })
  }

  // For Owner/Accountant: need can_view_delivery_orders
  if (!hasPermission(loaded, 'can_view_delivery_orders')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  // Return overview (all riders) — for now return empty, the UI will fetch per-rider
  return NextResponse.json({ summary: null })
}
