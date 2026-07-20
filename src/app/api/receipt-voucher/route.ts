import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postReceiptVoucher } from '@/lib/vouchers/data-access'
import { parseMoney } from '@/lib/format'
import { assertPhase8ReceiptFeatures } from '@/lib/supabase/rpc-compatibility'
import { resolveRequestId, safeMutationError } from '@/lib/observability'

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

const AllocationSchema = z.object({
  invoiceId: z.string().min(1),
  allocatedAmount: z.string().min(1),
})

const Schema = z.object({
  receiptDate: z.string(),
  receivedIntoAccountId: z.string().min(1),
  creditAccountId: z.string().min(1),
  amount: z.string().min(1),
  customerId: z.string().nullable().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
  invoiceId: z.string().nullable().optional(),
  allocations: z.array(AllocationSchema).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
})

export async function POST(req: Request) {
  const requestId = resolveRequestId(req)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_create_receipt_voucher')
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  try {
    assertPhase8ReceiptFeatures({
      invoiceId: parsed.data.invoiceId,
      allocations: parsed.data.allocations,
      idempotencyKey: parsed.data.idempotencyKey,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
  if (!isUuid(parsed.data.receivedIntoAccountId)) return NextResponse.json({ error: 'Invalid received-into account ID' }, { status: 400 })
  if (!isUuid(parsed.data.creditAccountId)) return NextResponse.json({ error: 'Invalid credit account ID' }, { status: 400 })
  if (parsed.data.receivedIntoAccountId === parsed.data.creditAccountId) return NextResponse.json({ error: 'Received-into and credit accounts must differ' }, { status: 400 })
  const amountPaisas = parseMoney(parsed.data.amount)
  if (amountPaisas === null || amountPaisas <= 0n) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })

  try {
    const result = await postReceiptVoucher({
      businessId: su.businessId,
      receiptDate: new Date(parsed.data.receiptDate),
      receivedIntoAccountId: parsed.data.receivedIntoAccountId,
      creditAccountId: parsed.data.creditAccountId,
      amountPaisas,
      customerId: parsed.data.customerId ?? null,
      reference: parsed.data.reference ?? null,
      notes: parsed.data.notes ?? null,
      createdBy: su.userId,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return safeMutationError({ route: '/api/receipt-voucher', requestId, errorCode: 'RECEIPT_VOUCHER_FAILED', userMessage: 'The receipt voucher could not be posted.', error })
  }
}
