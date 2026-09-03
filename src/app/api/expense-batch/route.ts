import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postExpenseBatch } from '@/lib/vouchers/data-access'
import { parseMoney } from '@/lib/format'
import { resolveRequestId, safeMutationError } from '@/lib/observability'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { usesLegacyTransactionSchema } from '@/lib/identity/legacy-bridge'
import { getAccountById } from '@/lib/accounting/data-access'

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const LineSchema = z.object({
  expenseAccountId: z.string().min(1),
  // Optional: the category the screen cascaded from. Sent so the server can
  // confirm the account really sits under it — UI filtering is never trusted.
  categoryId: z.string().trim().min(1).max(64).optional(),
  description: z.string().optional(),
  amount: z.string().min(1),
})
const Schema = z.object({
  expenseDate: z.string(),
  paymentAccountId: z.string().min(1),
  lines: z.array(LineSchema).min(1),
  reference: z.string().optional(),
  notes: z.string().optional(),
  idempotencyKey: z.string().uuid().optional(),
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
  const usesUuidLedger = isSupabaseConfigured() && !await usesLegacyTransactionSchema()
  if (usesUuidLedger) {
    if (!isUuid(parsed.data.paymentAccountId)) return NextResponse.json({ error: 'Invalid payment account ID' }, { status: 400 })
    for (const l of parsed.data.lines) {
      if (!isUuid(l.expenseAccountId)) return NextResponse.json({ error: `Invalid expense account ID: ${l.expenseAccountId}` }, { status: 400 })
    }
  }
  for (const l of parsed.data.lines) {
    const amt = parseMoney(l.amount)
    if (amt === null || amt <= 0n) return NextResponse.json({ error: `Invalid amount on line: ${l.amount}` }, { status: 400 })
  }

  const [paymentAccount, ...expenseAccounts] = await Promise.all([
    getAccountById(su.businessId, parsed.data.paymentAccountId),
    ...parsed.data.lines.map((line) => getAccountById(su.businessId, line.expenseAccountId)),
  ])
  if (!paymentAccount?.isActive || !paymentAccount.isBusinessAccount || paymentAccount.category.type !== 'Asset') {
    return NextResponse.json({ error: 'INVALID_PAYMENT_ACCOUNT' }, { status: 400 })
  }
  if (expenseAccounts.some((account) => !account?.isActive || account.category.type !== 'Expense')) {
    return NextResponse.json({ error: 'INVALID_EXPENSE_ACCOUNT' }, { status: 400 })
  }
  // System-managed expense accounts (Purchases / COGS, Salesman Commission
  // Expense, …) are posted by their own workflows. They stay visible in the
  // reports, but a manual batch may never target them. Business (cash / bank /
  // wallet) and party accounts are not manual expense destinations either.
  if (expenseAccounts.some((account) => account?.isSystem === true
    || account?.isBusinessAccount === true
    || account?.isPartyAccount === true)) {
    return NextResponse.json({
      error: 'INVALID_EXPENSE_ACCOUNT',
      message: 'One selected account is maintained by the system and cannot be used for a manual expense.',
    }, { status: 400 })
  }
  // The account must really belong to the category the line was cascaded from,
  // whether it is linked to that category directly or to one of its
  // subcategories.
  const classificationMismatch = parsed.data.lines.some((line, index) => {
    if (!line.categoryId) return false
    const category = expenseAccounts[index]?.category
    if (!category) return true
    return category.depth === 2 ? category.parentId !== line.categoryId : category.id !== line.categoryId
  })
  if (classificationMismatch) {
    return NextResponse.json({
      error: 'INVALID_EXPENSE_ACCOUNT',
      message: 'One selected account does not belong to the chosen category.',
    }, { status: 400 })
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
      idempotencyKey: parsed.data.idempotencyKey ?? crypto.randomUUID(),
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
