import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postPaymentVoucher } from '@/lib/vouchers/data-access'
import { parseMoney } from '@/lib/format'
import { resolveRequestId, safeMutationError } from '@/lib/observability'

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const Schema = z.object({
  paymentDate: z.string(),
  paidFromAccountId: z.string().min(1),
  debitAccountId: z.string().min(1),
  amount: z.string().min(1), // rupees as string
  vendorId: z.string().nullable().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
})

export async function POST(req: Request) {
  const requestId = resolveRequestId(req)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_create_payment_voucher')
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  if (!isUuid(parsed.data.paidFromAccountId)) return NextResponse.json({ error: 'Invalid paid-from account ID' }, { status: 400 })
  if (!isUuid(parsed.data.debitAccountId)) return NextResponse.json({ error: 'Invalid debit account ID' }, { status: 400 })
  if (parsed.data.paidFromAccountId === parsed.data.debitAccountId) return NextResponse.json({ error: 'Paid-from and debit accounts must differ (use Contra for same-account transfer)' }, { status: 400 })
  const amountPaisas = parseMoney(parsed.data.amount)
  if (amountPaisas === null || amountPaisas <= 0n) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
  try {
    const result = await postPaymentVoucher({
      businessId: su.businessId,
      paymentDate: new Date(parsed.data.paymentDate),
      paidFromAccountId: parsed.data.paidFromAccountId,
      debitAccountId: parsed.data.debitAccountId,
      amountPaisas,
      vendorId: parsed.data.vendorId ?? null,
      reference: parsed.data.reference ?? null,
      notes: parsed.data.notes ?? null,
      createdBy: su.userId,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return safeMutationError({ route: '/api/payment-voucher', requestId, errorCode: 'PAYMENT_VOUCHER_FAILED', userMessage: 'The payment voucher could not be posted.', error })
  }
}
