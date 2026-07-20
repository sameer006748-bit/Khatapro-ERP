/**
 * GET /api/sales/[id] — invoice detail with items + payments.
 *
 * Permission rules:
 *   - Users with can_view_sales can view ANY invoice (Owner/Admin/Accountant).
 *   - Users with can_view_own_sales can view only invoices where
 *     invoice.salesman_id matches their linked salesman record.
 *   - No other users can view invoices.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, hasPermission } from '@/lib/auth/permissions'
import { getInvoice, resolveSalesmanIdForUser, verifyInvoiceOwnership } from '@/lib/sales/data-access'
import { withObservability } from '@/lib/observability'

const getSale = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await loadSessionUser((session.user as any).id)
  if (!su) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const canViewAll = hasPermission(su, 'can_view_sales')
  const canViewOwn = hasPermission(su, 'can_view_own_sales')

  if (!canViewAll && !canViewOwn) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const { id } = await params

  // If user can only view own sales, verify ownership BEFORE returning data.
  if (!canViewAll && canViewOwn) {
    const userSalesmanId = await resolveSalesmanIdForUser(su.businessId, su.supabaseUserUuid, su.userId)
    if (!userSalesmanId) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
    const isOwner = await verifyInvoiceOwnership(su.businessId, id, userSalesmanId)
    if (!isOwner) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
  }

  const invoice = await getInvoice(su.businessId, id)
  if (!invoice) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ invoice })
}

export const GET = withObservability('/api/sales/[id]', getSale)
