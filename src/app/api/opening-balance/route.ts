/**
 * POST /api/opening-balance — post an opening balance for a single account.
 *
 * Per the master prompt: "Opening balances must be posted through a
 * balanced Opening Voucher against Opening Balance Equity / Owner Capital.
 * Do not store opening balances only as display fields."
 *
 * Flow:
 *   - User specifies an account + opening amount + debit-or-credit side.
 *   - Server posts a JV-type voucher with voucher_type='OP':
 *       line 1: debit (or credit) the target account
 *       line 2: opposite side against "Opening Balance Equity" (3030)
 *   - This guarantees the trial balance is balanced from day one.
 *
 * Money is BigInt paisas — parsed from string.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postVoucherSmart, VoucherError } from '@/lib/accounting/voucher-supabase'
import { getAccountById, getAccountByCode } from '@/lib/accounting/data-access'
import { parseMoney, formatMoney } from '@/lib/format'

const Schema = z.object({
  accountId: z.string().min(1),
  amount: z.string().min(1), // "Rs 5,000" or "5000" or "5000.00"
  side: z.enum(['debit', 'credit']),
  memo: z.string().optional(),
})

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_post_opening_voucher')

  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_INPUT', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const { accountId, amount, side, memo } = parsed.data

  const amt = parseMoney(amount)
  if (amt === null || amt <= 0n) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
  }

  // Verify target account (reads from Supabase when live, Prisma otherwise).
  const target = await getAccountById(su.businessId, accountId)
  if (!target || !target.isActive) {
    return NextResponse.json({ error: 'INVALID_ACCOUNT' }, { status: 400 })
  }

  // Find the Opening Balance Equity account (code 3030) for this business.
  const equity = await getAccountByCode(su.businessId, '3030')
  if (!equity) {
    return NextResponse.json({ error: 'OPENING_BALANCE_EQUITY_MISSING' }, { status: 500 })
  }

  // Build the Opening Voucher: target on one side, equity on the other.
  const lines =
    side === 'debit'
      ? [
          { accountId: target.id, debit: amt, credit: 0n, memo: memo ?? `Opening balance: ${target.name}` },
          { accountId: equity.id, debit: 0n, credit: amt, memo: `Opening balance offset` },
        ]
      : [
          { accountId: target.id, debit: 0n, credit: amt, memo: memo ?? `Opening balance: ${target.name}` },
          { accountId: equity.id, debit: amt, credit: 0n, memo: `Opening balance offset` },
        ]

  try {
    const voucherId = await postVoucherSmart({
      businessId: su.businessId,
      voucherType: 'OP',
      voucherDate: new Date(),
      memo: `Opening Balance: ${target.name} (${formatMoney(amt)})`,
      lines,
      referenceId: target.id,
      referenceType: 'opening_balance',
      postedBy: su.userId,
    })
    return NextResponse.json({ ok: true, voucherId, voucherType: 'OP' })
  } catch (e) {
    const err = e as VoucherError
    return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
  }
}
