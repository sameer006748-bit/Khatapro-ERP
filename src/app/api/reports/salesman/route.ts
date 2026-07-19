/**
 * GET /api/reports/salesman?type=X&fromDate=Y&toDate=Z
 *
 * Restricted salesman reports — returns data scoped to the authenticated
 * salesman's own invoices/collections/returns/commissions only.
 *
 * SECURITY:
 *   - Server resolves salesman_id from the authenticated user via
 *     resolveSalesmanIdForUser. Any salesmanId supplied in query params
 *     or body is IGNORED.
 *   - User MUST have can_view_own_sales permission.
 *   - Returns 403 if user has no linked salesman record.
 *
 * Sub-report types:
 *   - my-sales-summary  : aggregate stats (count, total, paid, outstanding, returned)
 *   - my-sales-detail   : list of invoices in period
 *   - my-collections    : list of payment_allocations for salesman's invoices
 *   - my-returns        : list of sales_returns for salesman's invoices
 *   - my-commission     : list of salesman_commissions with status
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, hasPermission } from '@/lib/auth/permissions'
import { resolveSalesmanIdForUser } from '@/lib/sales/data-access'
import {
  reportMySalesSummary,
  reportMySalesDetail,
  reportMyCollections,
  reportMyReturns,
  reportMyCommission,
} from '@/lib/reports/data-access'
import { withObservability } from '@/lib/observability'

const VALID_TYPES = new Set([
  'my-sales-summary',
  'my-sales-detail',
  'my-collections',
  'my-returns',
  'my-commission',
])

export const GET = withObservability('/api/reports/salesman', async (req: Request) => {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  // Salesman-only gate: caller must have can_view_own_sales.
  if (!hasPermission(loaded, 'can_view_own_sales')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const url = new URL(req.url)
  const type = url.searchParams.get('type') || ''
  if (!VALID_TYPES.has(type)) {
    return NextResponse.json({ error: 'UNKNOWN_SALESMAN_REPORT_TYPE' }, { status: 400 })
  }

  // CRITICAL: server resolves salesman_id from authenticated user.
  // Ignore any salesmanId in query params.
  const salesmanId = await resolveSalesmanIdForUser(
    loaded.businessId,
    loaded.supabaseUserUuid,
    loaded.userId,
  )
  if (!salesmanId) {
    return NextResponse.json(
      { error: 'Your user account is not linked to a salesman record. Ask the Owner to link your account.' },
      { status: 403 },
    )
  }

  const fromDate = url.searchParams.get('fromDate') || new Date().toISOString().slice(0, 8) + '01'
  const toDate = url.searchParams.get('toDate') || new Date().toISOString().slice(0, 10)

  try {
    const bid = loaded.businessId
    switch (type) {
      case 'my-sales-summary':
        return NextResponse.json({
          summary: await reportMySalesSummary(bid, salesmanId, fromDate, toDate),
        })
      case 'my-sales-detail':
        return NextResponse.json({
          rows: await reportMySalesDetail(bid, salesmanId, fromDate, toDate),
        })
      case 'my-collections':
        return NextResponse.json({
          rows: await reportMyCollections(bid, salesmanId, fromDate, toDate),
        })
      case 'my-returns':
        return NextResponse.json({
          rows: await reportMyReturns(bid, salesmanId, fromDate, toDate),
        })
      case 'my-commission':
        return NextResponse.json({
          rows: await reportMyCommission(bid, salesmanId, fromDate, toDate),
        })
      default:
        return NextResponse.json({ error: 'UNKNOWN_SALESMAN_REPORT_TYPE' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
})
