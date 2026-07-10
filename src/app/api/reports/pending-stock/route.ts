/**
 * GET /api/reports/pending-stock — products with negative stock or pending entry needs
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { pendingStockReport } from '@/lib/products/data-access'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_view_stock_report')

  const rows = await pendingStockReport(su.businessId)
  return NextResponse.json({ rows })
}
