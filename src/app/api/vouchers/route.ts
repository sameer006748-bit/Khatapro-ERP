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
import { postVoucherSmart, VoucherError } from '@/lib/accounting/voucher-supabase'
import { parseMoney } from '@/lib/format'
import { resolveRequestId, safeMutationError, withObservability } from '@/lib/observability'

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
  idempotencyKey: z.string().uuid().optional(),
})

export async function POST(req: Request) {
  const requestId = resolveRequestId(req)
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
  const { voucherType, voucherDate, memo, lines, idempotencyKey } = parsed.data

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
    const voucherId = await postVoucherSmart({
      businessId: su.businessId,
      voucherType,
      voucherDate: new Date(voucherDate),
      memo: memo ?? null,
      lines: lineInputs,
      postedBy: su.userId,
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    })
    return NextResponse.json({ ok: true, voucherId })
  } catch (e) {
    const err = e as VoucherError
    if (err.code === 'UNBALANCED' || err.code === 'INVALID_LINE' || err.code === 'TOO_FEW_LINES') {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
    }
    return safeMutationError({ route: '/api/vouchers', requestId, errorCode: 'VOUCHER_POST_FAILED', userMessage: 'The voucher could not be posted.', error: e })
  }
}

const getVouchers = async () => {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_view_vouchers')

  // Dual-path: read from Supabase when live, Prisma otherwise.
  const { isUsingSupabase } = await import('@/lib/accounting/data-access')
  if (await isUsingSupabase()) {
    const { getAdminSupabase } = await import('@/lib/supabase/admin')
    const admin = getAdminSupabase()
    const { data, error } = await admin
      .from('ledger_vouchers')
      .select(`
        id, readable_number, voucher_type, transaction_date, narration, posted_at,
        total_debit_paisas, total_credit_paisas,
        ledger_voucher_lines (
          id, account_id, debit_paisas, credit_paisas, line_narration,
          account:ledger_accounts (
            account_code, account_name,
            category:ledger_account_categories ( stable_code )
          )
        )
      `)
      .eq('business_id', su.businessId)
      .order('posted_at', { ascending: false })
      .limit(100)
    if (error) {
      throw new Error('voucher_list_failed')
    }
    return NextResponse.json({
      rows: (data ?? []).map((v: any) => ({
        id: v.id,
        voucherType: v.voucher_type,
        voucherNo: v.readable_number,
        voucherDate: v.transaction_date,
        memo: v.narration,
        isCancelled: false,
        postedAt: v.posted_at,
        totalDebit: String(v.total_debit_paisas),
        totalCredit: String(v.total_credit_paisas),
        lines: (v.ledger_voucher_lines ?? []).map((l: any) => ({
          id: l.id,
          accountId: l.account_id,
          accountCode: l.account?.account_code ?? '',
          accountName: l.account?.account_name ?? '',
          categoryCode: l.account?.category?.stable_code ?? '',
          debit: String(l.debit_paisas),
          credit: String(l.credit_paisas),
          memo: l.line_narration,
        })),
      })),
    })
  }

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

export const GET = withObservability('/api/vouchers', getVouchers)
