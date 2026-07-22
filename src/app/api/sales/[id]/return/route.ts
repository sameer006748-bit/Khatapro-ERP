/**
 * POST /api/sales/[id]/return — post a sales return for the given invoice.
 * Reverses the original sale: posts reversing voucher, restores stock,
 * does NOT reverse already-accrued commission.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postLinkedSaleReturn } from '@/lib/sales/data-access'

const ReturnSchema = z.object({
  items: z.array(z.object({ invoiceItemId: z.string().uuid(), qty: z.number().int().positive() })).min(1),
  refundMode: z.enum(['CREDIT', 'CASH', 'BANK']),
  reason: z.string().max(200).optional(),
  idempotencyKey: z.string().uuid(),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_cancel_sales')

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const parsed = ReturnSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  }

  try {
    const result = await postLinkedSaleReturn({
      businessId: su.businessId, invoiceId: id, items: parsed.data.items,
      refundMode: parsed.data.refundMode, reason: parsed.data.reason,
      idempotencyKey: parsed.data.idempotencyKey,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const msg = (e as Error).message
    const status = msg.includes('not found') || msg.includes('exceeds') || msg.includes('cannot') ? 400 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
