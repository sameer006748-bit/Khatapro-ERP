/**
 * GET /api/salesmen — list salesmen for the current business.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { hasPermission, loadSessionUser } from '@/lib/auth/permissions'
import { listSalesmen } from '@/lib/sales/data-access'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await loadSessionUser((session.user as any).id)
  if (!su) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const rows = await listSalesmen(su.businessId)

  // Every sale form uses this route to attribute a bill, so the names stay
  // available to anyone who can create a sale. The commission rate is a
  // commercial term rather than part of that choice: no screen renders it from
  // here, commission is computed server-side when the sale posts, and a
  // salesman reads their own earnings through the commission report, which is
  // already scoped to their own record. So the rate travels only to the roles
  // that see sales business-wide or administer Setup - a Salesman does not
  // receive their colleagues' rates for the asking.
  const canSeeRates = hasPermission(su, 'can_view_sales')
    || hasPermission(su, 'can_manage_setup')

  return NextResponse.json({
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      isActive: r.isActive,
      ...(canSeeRates ? { commissionPct: r.commissionPct } : {}),
    })),
  })
}
