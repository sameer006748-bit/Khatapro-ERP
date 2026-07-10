/**
 * GET /api/trial-balance — Trial Balance report.
 * Returns debit/credit/balance per active account.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { trialBalanceSmart } from '@/lib/accounting/voucher-supabase'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_view_trial_balance')

  const rows = await trialBalanceSmart(su.businessId)

  let grandDebit = 0n
  let grandCredit = 0n
  for (const r of rows) {
    grandDebit += r.totalDebit
    grandCredit += r.totalCredit
  }

  return NextResponse.json({
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
}
