/**
 * POST /api/sales/[id]/return — post a sales return for the given invoice.
 * Posts a line-linked historical return, restores stock, and adjusts only the
 * commission earned for the eligible returned units.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postLinkedSaleReturn } from '@/lib/sales/data-access'
import { LegacyIdentityMigrationRequiredError } from '@/lib/identity/legacy-bridge'

const ReturnSchema = z.object({
  items: z.array(z.object({ invoiceItemId: z.string().min(1).max(80), qty: z.number().int().positive() })).min(1),
  refundMode: z.enum(['CREDIT', 'CASH', 'BANK']),
  refundAccountId: z.string().min(1).max(80).optional(),
  reason: z.string().max(200).optional(),
  idempotencyKey: z.string().uuid(),
}).superRefine((value, ctx) => {
  if (value.refundMode !== 'CREDIT' && !value.refundAccountId) {
    ctx.addIssue({ code: 'custom', path: ['refundAccountId'], message: 'A refund account is required.' })
  }
  const ids = value.items.map((item) => item.invoiceItemId)
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', path: ['items'], message: 'Each invoice item may appear only once.' })
  }
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
      refundAccountId: parsed.data.refundAccountId,
      idempotencyKey: parsed.data.idempotencyKey,
      actorId: su.userId,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    if (e instanceof LegacyIdentityMigrationRequiredError) {
      return NextResponse.json({
        error: e.code,
        message: e.message,
        migration: e.migration,
      }, { status: 409 })
    }
    const msg = (e as Error).message
    const status = msg.includes('idempotency key')
      ? 409
      : msg.includes('not found') || msg.includes('does not belong') || msg.includes('exceeds') || msg.includes('cannot') || msg.includes('required') || msg.includes('positive') || msg.includes('duplicate')
        ? 400
        : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
