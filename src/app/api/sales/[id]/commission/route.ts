/**
 * GET /api/sales/[id]/commission — item-level commission detail for one invoice.
 *
 * Commission is internal business data:
 *   - `can_view_sales` (Owner/Admin/Accountant) sees any invoice.
 *   - `can_view_own_sales` sees only invoices attributed to their own salesman
 *     record.
 * Individual per-item entries are returned; totals are derived from them rather
 * than replacing them.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, hasPermission } from '@/lib/auth/permissions'
import {
  getInvoiceCommissionDetail,
  resolveSalesmanIdForUser,
  verifyInvoiceOwnership,
} from '@/lib/sales/data-access'
import { withObservability } from '@/lib/observability'

const getCommission = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await loadSessionUser((session.user as any).id)
  if (!su) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const canViewAll = hasPermission(su, 'can_view_sales')
  const canViewOwn = hasPermission(su, 'can_view_own_sales')
  if (!canViewAll && !canViewOwn) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await params

  if (!canViewAll && canViewOwn) {
    const ownSalesmanId = await resolveSalesmanIdForUser(su.businessId, su.supabaseUserUuid, su.userId)
    if (!ownSalesmanId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    const owns = await verifyInvoiceOwnership(su.businessId, id, ownSalesmanId)
    if (!owns) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const detail = await getInvoiceCommissionDetail(su.businessId, id)
  return NextResponse.json(detail)
}

export const GET = withObservability('/api/sales/[id]/commission', getCommission)
