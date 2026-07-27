import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { bizDateString, isBusinessDateRange } from '@/lib/dates'
import { buildOwnerDashboardPayload } from '@/lib/dashboard/owner-summary'
import { resolveRequestId, safeApiError, withObservability } from '@/lib/observability'

export const GET = withObservability('/api/dashboard/owner', async (req: Request) => {
  const requestId = resolveRequestId(req)
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'DASHBOARD_LOAD_FAILED' }, { status: 401 })
    }
    const loaded = await loadSessionUser((session.user as any).id)
    if (!loaded) {
      return NextResponse.json({ error: 'DASHBOARD_LOAD_FAILED' }, { status: 401 })
    }

    if (loaded.roleName !== 'Owner/Admin') {
      try {
        await requirePermission(loaded, 'can_view_trial_balance')
      } catch {
        return NextResponse.json({ error: 'DASHBOARD_LOAD_FAILED' }, { status: 403 })
      }
    }

    const url = new URL(req.url)
    const today = bizDateString(new Date())
    const range = {
      from: url.searchParams.get('from') || url.searchParams.get('today') || today,
      to: url.searchParams.get('to') || url.searchParams.get('from') || url.searchParams.get('today') || today,
    }
    if (!isBusinessDateRange(range)) {
      return NextResponse.json({ error: 'INVALID_DATE_RANGE' }, { status: 400 })
    }

    return NextResponse.json(await buildOwnerDashboardPayload({
      businessId: loaded.businessId,
      range,
      today,
      requestId,
    }))
  } catch (error) {
    return safeApiError({
      route: '/api/dashboard/owner',
      requestId,
      errorCode: 'DASHBOARD_LOAD_FAILED',
      userMessage: 'The dashboard could not be loaded.',
      error,
    })
  }
})
