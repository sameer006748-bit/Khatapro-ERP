/**
 * GET /api/trial-balance — Trial Balance report.
 * Returns debit/credit/balance per active account.
 *
 * The custom account classification (migration 00042) is attached as labels
 * only: the rows and the grand totals below are computed exactly as before, so
 * a business without categories — or a deployment without the classification
 * layer — gets byte-identical output.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { trialBalanceSmart, trialBalanceViaLegacySupabase } from '@/lib/accounting/voucher-supabase'
import { getAccountingAvailability } from '@/lib/accounting/availability'
import {
  buildClassificationOverlay,
  tryListAccountClassification,
  type ClassificationOverlay,
} from '@/lib/accounting/legacy-account-classification'
import { resolveRequestId, safeApiError, withObservability } from '@/lib/observability'

/** Selector options for the report filters; empty when there is nothing to filter by. */
function classificationPayload(overlay: ClassificationOverlay | null) {
  if (!overlay?.hasCustomClassification) {
    return { hasCustomClassification: false, roots: [], categories: [], subcategories: [] }
  }
  return {
    hasCustomClassification: true,
    roots: overlay.roots,
    categories: overlay.categories,
    subcategories: overlay.subcategories,
  }
}


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

  // Best-effort: null when this deployment has no classification layer or the
  // actor may not read it. Never able to change a figure below.
  const tree = await tryListAccountClassification(su.businessId, su.profileId)
  const overlay = tree ? buildClassificationOverlay(tree) : null

  return NextResponse.json({
    availability: { accounting: true },
    classification: classificationPayload(overlay),
    rows: rows.map((r) => {
      const label = overlay?.byAccountId[r.account.id] ?? overlay?.byAccountCode[r.account.code] ?? null
      return {
        accountId: r.account.id,
        accountCode: r.account.code,
        accountName: r.account.name,
        categoryCode: r.account.category.code,
        categoryName: r.account.category.name,
        categoryType: r.account.category.type,
        rootId: label?.rootId ?? null,
        classCategoryId: label?.categoryId ?? null,
        classCategoryName: label?.categoryName ?? null,
        classSubcategoryId: label?.subcategoryId ?? null,
        classSubcategoryName: label?.subcategoryName ?? null,
        totalDebit: r.totalDebit.toString(),
        totalCredit: r.totalCredit.toString(),
        balance: r.balance.toString(),
      }
    }),
    grandDebit: grandDebit.toString(),
    grandCredit: grandCredit.toString(),
    isBalanced: grandDebit === grandCredit,
  })
})
