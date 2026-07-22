import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, hasPermission } from '@/lib/auth/permissions'
import { riderCodBalances } from '@/lib/delivery/data-access'
import { resolveRequestId, safeApiError, withObservability } from '@/lib/observability'

export const GET = withObservability('/api/rider-cod/balances', async (request: Request) => {
  const requestId = resolveRequestId(request)
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const loaded = await loadSessionUser((session.user as any).id)
    if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    if (loaded.roleName !== 'Rider' && !hasPermission(loaded, 'can_confirm_cod_submission')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
    return NextResponse.json({ rows: await riderCodBalances(loaded.businessId) })
  } catch (error) {
    return safeApiError({ route: '/api/rider-cod/balances', requestId, errorCode: 'RIDER_COD_BALANCES_FAILED', userMessage: 'Rider COD balances could not be loaded.', error })
  }
})
