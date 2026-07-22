/** Invoice-specific collection: customer receipts remain unallocated otherwise. */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { receiveInvoicePayment } from '@/lib/sales/data-access'

const Schema = z.object({
  amount: z.string().regex(/^\d+$/),
  mode: z.enum(['CASH', 'BANK', 'CARD', 'OTHER']),
  idempotencyKey: z.string().uuid(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_create_sales')
  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  try {
    const { id } = await params
    const result = await receiveInvoicePayment({ businessId: su.businessId, invoiceId: id, amount: BigInt(parsed.data.amount), mode: parsed.data.mode, idempotencyKey: parsed.data.idempotencyKey })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = (error as Error).message
    return NextResponse.json({ error: message }, { status: message.includes('exceeds') ? 400 : 500 })
  }
}
