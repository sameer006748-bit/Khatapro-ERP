import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { reverseVoucher, getVoucherDetail } from '@/lib/vouchers/data-access'

const Schema = z.object({ reason: z.string().optional() })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_reverse_voucher')
  const { id: voucherId } = await params
  const body = await req.json().catch(() => ({}))
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })

  // Pre-check: is the voucher already cancelled?
  const detail = await getVoucherDetail(su.businessId, voucherId)
  if (!detail) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (detail.isCancelled) return NextResponse.json({ error: 'Voucher already cancelled' }, { status: 400 })

  try {
    const result = await reverseVoucher({
      businessId: su.businessId,
      voucherId,
      reason: parsed.data.reason ?? null,
      createdBy: su.userId,
    })
    if (result.blocked) {
      return NextResponse.json({ error: 'BLOCKED', blockReason: result.blockReason }, { status: 403 })
    }
    return NextResponse.json({ ok: true, reversalVoucherId: result.reversalVoucherId })
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
}
