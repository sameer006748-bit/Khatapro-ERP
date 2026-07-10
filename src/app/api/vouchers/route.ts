/**
 * POST /api/vouchers — post a new voucher via postVoucher() (the local
 * equivalent of the Supabase post_voucher() RPC). Balanced-voucher
 * validation is enforced server-side.
 *
 * GET /api/vouchers — list vouchers (with lines) for the current business.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postVoucher, VoucherError } from '@/lib/accounting/voucher'
import { parseMoney } from '@/lib/format'

const LineSchema = z.object({
  accountId: z.string().min(1),
  debit: z.string().min(1).optional(),  // paisas as string (BigInt-safe)
  credit: z.string().min(1).optional(),
  memo: z.string().optional(),
})

const PostSchema = z.object({
  voucherType: z.enum(['JV', 'OP', 'RC', 'PM', 'CT', 'PC']),
  voucherDate: z.string(), // yyyy-MM-dd
  memo: z.string().optional(),
  lines: z.array(LineSchema).min(2),
})

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_post_journal_voucher')

  const body = await req.json().catch(() => null)
  const parsed = PostSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_INPUT', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const { voucherType, voucherDate, memo, lines } = parsed.data

  // Convert lines: parse money strings to BigInt paisas.
  let lineInputs
  try {
    lineInputs = lines.map((l) => {
      const debit = l.debit ? parseMoney(l.debit) : 0n
      const credit = l.credit ? parseMoney(l.credit) : 0n
      if (debit === null || credit === null) {
        throw new VoucherError('Invalid money format', 'INVALID_MONEY')
      }
      return {
        accountId: l.accountId,
        debit,
        credit,
        memo: l.memo ?? null,
      }
    })
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, code: (e as VoucherError).code ?? 'INVALID_MONEY' },
      { status: 400 },
    )
  }

  try {
    const voucherId = await postVoucher({
      businessId: su.businessId,
      voucherType,
      voucherDate: new Date(voucherDate),
      memo: memo ?? null,
      lines: lineInputs,
      postedBy: su.userId,
    })
    return NextResponse.json({ ok: true, voucherId })
  } catch (e) {
    const err = e as VoucherError
    const status =
      err.code === 'UNBALANCED' || err.code === 'INVALID_LINE' || err.code === 'TOO_FEW_LINES'
        ? 400
        : 500
    return NextResponse.json({ error: err.message, code: err.code }, { status })
  }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_view_vouchers')

  const vouchers = await db.voucher.findMany({
    where: { businessId: su.businessId },
    include: { lines: { include: { account: { include: { category: true } } } } },
    orderBy: { postedAt: 'desc' },
    take: 100,
  })

  return NextResponse.json({
    rows: vouchers.map((v) => ({
      id: v.id,
      voucherType: v.voucherType,
      voucherDate: v.voucherDate,
      memo: v.memo,
      isCancelled: v.isCancelled,
      postedAt: v.postedAt,
      totalDebit: v.totalDebit.toString(),
      totalCredit: v.totalCredit.toString(),
      lines: v.lines.map((l) => ({
        id: l.id,
        accountId: l.accountId,
        accountCode: l.account.code,
        accountName: l.account.name,
        categoryCode: l.account.category.code,
        debit: l.debit.toString(),
        credit: l.credit.toString(),
        memo: l.memo,
      })),
    })),
  })
}
