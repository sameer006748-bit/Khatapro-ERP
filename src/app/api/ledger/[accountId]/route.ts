/**
 * GET /api/ledger/[accountId] — ledger drill-down for one account.
 * Returns every line touching the account with running balance.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { accountLedgerSmart } from '@/lib/accounting/voucher-supabase'
import { getAccountById } from '@/lib/accounting/data-access'
import { withObservability } from '@/lib/observability'

export const GET = withObservability(
  '/api/ledger/[accountId]',
  async (
    _req: Request,
    { params }: { params: Promise<{ accountId: string }> },
  ) => {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const loaded = await loadSessionUser((session.user as any).id)
    if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const su = await requirePermission(loaded, 'can_view_ledgers')

    const { accountId } = await params

    // Verify the account belongs to the user's business (reads from Supabase
    // when live, Prisma otherwise).
    const acct = await getAccountById(su.businessId, accountId)
    if (!acct) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

    const lines = await accountLedgerSmart(su.businessId, accountId)

    return NextResponse.json({
      account: {
        id: acct.id,
        code: acct.code,
        name: acct.name,
        category: { code: acct.category.code, name: acct.category.name, type: acct.category.type },
        balanceCache: acct.balanceCache.toString(),
      },
      lines: lines.map((l) => ({
        lineId: l.lineId,
        voucherId: l.voucherId,
        voucherType: l.voucherType,
        voucherDate: l.voucherDate,
        memo: l.memo,
        debit: l.debit.toString(),
        credit: l.credit.toString(),
        runningBalance: l.runningBalance.toString(),
      })),
    })
  },
)
