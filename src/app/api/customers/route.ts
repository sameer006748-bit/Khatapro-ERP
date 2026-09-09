import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { hasPermission, loadSessionUser } from '@/lib/auth/permissions'
import { listCustomers } from '@/lib/sales/data-access'
import { withObservability, measurePerformanceStage } from '@/lib/observability'

export const GET = withObservability('/api/customers', async () => {
  const session = await measurePerformanceStage(
    'session.getServerSession',
    () => getServerSession(authOptions),
  )
  if (!session?.user) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }
  const user = await loadSessionUser((session.user as any).id)
  if (!user) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }
  const allowed = hasPermission(user, 'can_create_sales')
    || hasPermission(user, 'can_view_sales')
    || hasPermission(user, 'can_view_customer_ledger')
  if (!allowed) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  const rows = await measurePerformanceStage(
    'endpoint.customersList',
    () => listCustomers(user.businessId),
  )
  return NextResponse.json({ rows })
}, { performanceTiming: true })
