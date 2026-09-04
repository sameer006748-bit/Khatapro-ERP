/**
 * POST /api/expense-batch — several expense lines paid from one account.
 *
 * A line names an expense *category* ("Lunch Expense"); the ledger account it
 * posts to is resolved here, on the server, from that category's linked account.
 * A line may still name an account directly, which is how the accounts that
 * predate categories stay usable. Either way the resolved account passes exactly
 * the same checks as before — active, under the fixed Expense root, not system,
 * business or party managed, and really belonging to the chosen category.
 */
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
import {
  CATEGORY_NOT_READY_MESSAGE,
  CATEGORY_UNAVAILABLE_MESSAGE,
  resolveCategoryLedgerAccounts,
  safeAudit,
  type CategoryLedgerResolution,
} from '@/lib/accounting/category-ledger'

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const LineSchema = z.object({
  // The category the user picked. The server turns it into a ledger account, so
  // the browser never decides where an expense lands.
  categoryId: z.string().trim().min(1).max(64).optional(),
  // Or an account chosen directly, for accounts that have no category.
  expenseAccountId: z.string().trim().min(1).max(64).optional(),
  description: z.string().optional(),
  amount: z.string().min(1),
}).refine((line) => Boolean(line.categoryId ?? line.expenseAccountId), {
  message: 'Choose an expense category',
  path: ['categoryId'],
})
const Schema = z.object({
  expenseDate: z.string(),
  paymentAccountId: z.string().min(1),
  lines: z.array(LineSchema).min(1),
  reference: z.string().optional(),
  notes: z.string().optional(),
  idempotencyKey: z.string().uuid().optional(),
})

/** A line with its ledger account resolved, plus the category it came from. */
type ResolvedLine = {
  expenseAccountId: string
  description: string | null
  amountPaisas: bigint
  categoryId?: string
  categoryName?: string
}

function categoryRejected(categoryId: string, resolution: CategoryLedgerResolution | null) {
  const notReady = resolution?.notReady.includes(categoryId) === true
  return NextResponse.json({
    error: 'INVALID_EXPENSE_CATEGORY',
    message: notReady ? CATEGORY_NOT_READY_MESSAGE : CATEGORY_UNAVAILABLE_MESSAGE,
  }, { status: 400 })
}
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_create_expense_batch')
  const requestId = resolveRequestId(req)
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  for (const l of parsed.data.lines) {
    const amt = parseMoney(l.amount)
    if (amt === null || amt <= 0n) return NextResponse.json({ error: `Invalid amount on line: ${l.amount}` }, { status: 400 })
  }

  const usesLegacyAccounting = isSupabaseConfigured() && await usesLegacyTransactionSchema()
  const usesUuidLedger = isSupabaseConfigured() && !usesLegacyAccounting
  const categoryIds = parsed.data.lines
    .map((line) => line.categoryId)
    .filter((id): id is string => Boolean(id))
  let resolution: CategoryLedgerResolution | null = null
  if (categoryIds.length > 0) {
    // Categories only exist in the legacy accounting schema; anywhere else the
    // line has to name its account.
    if (!usesLegacyAccounting) return categoryRejected(categoryIds[0], null)
    try {
      resolution = await resolveCategoryLedgerAccounts(su.businessId, categoryIds)
    } catch (error) {
      return safeMutationError({
        route: '/api/expense-batch',
        requestId,
        errorCode: 'EXPENSE_BATCH_FAILED',
        userMessage: 'Expense batch could not be posted.',
        error,
      })
    }
  }

  const lines: ResolvedLine[] = []
  for (const line of parsed.data.lines) {
    const amountPaisas = parseMoney(line.amount)
    if (amountPaisas === null) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
    const shared = { description: line.description ?? null, amountPaisas }
    if (line.categoryId) {
      const linked = resolution?.resolved.get(line.categoryId)
      if (!linked) return categoryRejected(line.categoryId, resolution)
      lines.push({
        ...shared,
        expenseAccountId: linked.accountId,
        categoryId: linked.categoryId,
        categoryName: linked.categoryName,
      })
      continue
    }
    if (!line.expenseAccountId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
    lines.push({ ...shared, expenseAccountId: line.expenseAccountId })
  }
  if (usesUuidLedger) {
    if (!isUuid(parsed.data.paymentAccountId)) return NextResponse.json({ error: 'Invalid payment account ID' }, { status: 400 })
    for (const line of lines) {
      if (!isUuid(line.expenseAccountId)) return NextResponse.json({ error: `Invalid expense account ID: ${line.expenseAccountId}` }, { status: 400 })
    }
  }

  const [paymentAccount, ...expenseAccounts] = await Promise.all([
    getAccountById(su.businessId, parsed.data.paymentAccountId),
    ...lines.map((line) => getAccountById(su.businessId, line.expenseAccountId)),
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
  // The account must really belong to the category the line came from, whether
  // it is linked to that category directly or to one of its subcategories.
  const classificationMismatch = lines.some((line, index) => {
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
  try {
    const result = await postExpenseBatch({
      businessId: su.businessId,
      expenseDate: new Date(parsed.data.expenseDate),
      paymentAccountId: parsed.data.paymentAccountId,
      lines: lines.map((line) => ({
        expenseAccountId: line.expenseAccountId,
        description: line.description,
        amountPaisas: line.amountPaisas,
      })),
      reference: parsed.data.reference ?? null,
      notes: parsed.data.notes ?? null,
      createdBy: su.userId,
      idempotencyKey: parsed.data.idempotencyKey ?? crypto.randomUUID(),
    })
    // Which categories this batch was posted from, in the client's own words.
    // Skipped on a replay, so one posting is never audited twice.
    const categories = [...new Set(lines.map((line) => line.categoryName).filter(Boolean))]
    if (categories.length > 0 && !result.idempotent) {
      await safeAudit({
        businessId: su.businessId,
        userId: su.userId,
        action: 'EXPENSE_POSTED_WITH_CATEGORY',
        entity: 'expense',
        entityId: result.expenseId,
        details: {
          expense_no: result.expenseNo,
          categories: categories.join(', '),
          paid_from: paymentAccount.name,
        },
      })
    }
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
