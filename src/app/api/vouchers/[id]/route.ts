/**
 * GET /api/vouchers/[id] — voucher detail with lines.
 * Dual-path: Supabase when live, Prisma fallback.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { db } from '@/lib/db'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { getVoucherDetail } from '@/lib/vouchers/data-access'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_view_vouchers')

  const { id } = await params

  // Try Supabase first.
  const supaDetail = await getVoucherDetail(su.businessId, id)
  if (supaDetail) return NextResponse.json({ voucher: supaDetail })

  // Prisma fallback.
  const v = await db.voucher.findFirst({
    where: { id, businessId: su.businessId },
    include: { lines: { include: { account: { include: { category: true } } }, orderBy: { lineOrder: 'asc' } } },
  })
  if (!v) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  return NextResponse.json({
    voucher: {
      id: v.id,
      voucherNo: v.voucherNo,
      voucherType: v.voucherType,
      voucherDate: v.voucherDate,
      memo: v.memo,
      isCancelled: v.isCancelled,
      postedAt: v.postedAt,
      postedBy: v.postedBy ?? null,
      totalDebit: v.totalDebit.toString(),
      totalCredit: v.totalCredit.toString(),
      referenceType: null,
      referenceId: null,
      cancelVoucherId: null,
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
    },
  })
}
