import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postExpenseBatch } from '@/lib/vouchers/data-access'
import { parseMoney } from '@/lib/format'
import { resolveRequestId, safeMutationError } from '@/lib/observability'

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const LineSchema = z.object({
  expenseAccountId: z.string().min(1),
  description: z.string().optional(),
  amount: z.string().min(1),
})
const Schema = z.object({
  expenseDate: z.string(),
  paymentAccountId: z.string().min(1),
  lines: z.array(LineSchema).min(1),
  reference: z.string().optional(),
  notes: z.string().optional(),
})

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_create_expense_batch')
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  if (!isUuid(parsed.data.paymentAccountId)) return NextResponse.json({ error: 'Invalid payment account ID' }, { status: 400 })
  for (const l of parsed.data.lines) {
    if (!isUuid(l.expenseAccountId)) return NextResponse.json({ error: `Invalid expense account ID: ${l.expenseAccountId}` }, { status: 400 })
    const amt = parseMoney(l.amount)
    if (amt === null || amt <= 0n) return NextResponse.json({ error: `Invalid amount on line: ${l.amount}` }, { status: 400 })
  }
  const requestId = resolveRequestId(req)
  try {
    const result = await postExpenseBatch({
      businessId: su.businessId,
      expenseDate: new Date(parsed.data.expenseDate),
      paymentAccountId: parsed.data.paymentAccountId,
      lines: parsed.data.lines.map(l => ({
        expenseAccountId: l.expenseAccountId,
        description: l.description ?? null,
        amountPaisas: parseMoney(l.amount)!,
      })),
      reference: parsed.data.reference ?? null,
      notes: parsed.data.notes ?? null,
      createdBy: su.userId,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return safeMutationError({
      route: '/api/expense-batch',
      requestId,
      errorCode: 'EXPENSE_BATCH_FAILED',
      userMessage: 'Expense batch could not be posted.',
      error: e,
    })
  }
}
