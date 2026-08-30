/**
 * GET /api/trial-balance — Trial Balance report.
 * Returns debit/credit/balance per active account.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { trialBalanceSmart, trialBalanceViaLegacySupabase } from '@/lib/accounting/voucher-supabase'
import { getAccountingAvailability } from '@/lib/accounting/availability'
import { resolveRequestId, safeApiError, withObservability } from '@/lib/observability'

export const GET = withObservability('/api/trial-balance', async (req: Request) => {
  const requestId = resolveRequestId(req)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_view_trial_balance')
  const capability = await getAccountingAvailability(su.businessId)
  let rows
  try {
    rows = capability.path === 'operational-fallback'
      ? await trialBalanceViaLegacySupabase(su.businessId)
      : await trialBalanceSmart(su.businessId)
  } catch (error) {
    return safeApiError({
      route: '/api/trial-balance',
      requestId,
      errorCode: 'TRIAL_BALANCE_LOAD_FAILED',
      userMessage: 'Trial Balance could not be loaded. Please try again.',
      error,
    })
  }

  let grandDebit = 0n
  let grandCredit = 0n
  for (const r of rows) {
    grandDebit += r.totalDebit
    grandCredit += r.totalCredit
  }

  return NextResponse.json({
    availability: { accounting: true },
    rows: rows.map((r) => ({
      accountId: r.account.id,
      accountCode: r.account.code,
      accountName: r.account.name,
      categoryCode: r.account.category.code,
      categoryName: r.account.category.name,
      categoryType: r.account.category.type,
      totalDebit: r.totalDebit.toString(),
      totalCredit: r.totalCredit.toString(),
      balance: r.balance.toString(),
    })),
    grandDebit: grandDebit.toString(),
    grandCredit: grandCredit.toString(),
    isBalanced: grandDebit === grandCredit,
  })
})
