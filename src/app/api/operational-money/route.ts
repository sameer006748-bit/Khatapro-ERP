import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth/authOptions'
import { hasPermission, isOwner, loadSessionUser } from '@/lib/auth/permissions'
import { listOperationalMoney } from '@/lib/money/operational-money'
import { resolveRequestId, safeApiError } from '@/lib/observability'

export async function GET(request: Request) {
  const requestId = resolveRequestId(request)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (!isOwner(loaded) && !hasPermission(loaded, 'can_view_account_balances') && !hasPermission(loaded, 'can_create_contra')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  try {
    return NextResponse.json(await listOperationalMoney({ businessId: loaded.businessId, actorProfileId: loaded.profileId }))
  } catch (error) {
    return safeApiError({ route: '/api/operational-money', requestId, errorCode: 'OPERATIONAL_MONEY_READ_FAILED', userMessage: 'Business money accounts could not be loaded.', error })
  }
}
