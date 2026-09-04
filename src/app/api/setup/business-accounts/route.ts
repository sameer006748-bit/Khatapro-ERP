/**
 * Money accounts — the one list the management screen reads, and create.
 *
 * The list is a union of two things the owner sees as one:
 *  1. rows in `business_accounts` (created through this app), and
 *  2. ledger money accounts with no `business_accounts` row of their own — the
 *     accounts seeded with the chart (1010 Cash, 1020 Petty Cash, 1030 Bank,
 *     1040 Easypaisa, 1050 JazzCash). Those exist only in the chart, so before
 *     this they could not be renamed, moved or deactivated from any screen.
 *     They are listed here as `linked: false` and become fully manageable once
 *     linked, which reuses the existing ledger row and never creates a second.
 *
 * Every row also carries a readable `identity` (`CASH`, `PETTY-CASH`,
 * `BANK-UBL`) derived server-side so one account reads the same everywhere. The
 * numeric ledger code stays the accounting number and the posting key.
 *
 * Creating a money account atomically creates a linked sub-account under Asset
 * and links it 1:1. `balanceCache` is recomputed server-side by post_voucher()
 * — never written by the client.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission, writeAudit } from '@/lib/auth/permissions'
import {
  BUSINESS_ACCOUNT_TYPES,
  moneyTypeFromLedgerAccount,
} from '@/lib/accounting/business-account-types'
import { assignMoneyIdentities, deriveMoneyIdentity } from '@/lib/accounting/money-account-identity'
import { getChartOfAccounts } from '@/lib/accounting/data-access'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { usesLegacyTransactionSchema } from '@/lib/identity/legacy-bridge'
import {
  BUSINESS_ACCOUNTS_UNAVAILABLE_MESSAGE,
  LegacyBusinessAccountsUnavailableError,
  createLegacyBusinessAccount,
  listLegacyBusinessAccounts,
  type BusinessAccountRecord,
} from '@/lib/accounting/legacy-business-accounts'

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(BUSINESS_ACCOUNT_TYPES),
  accountHolder: z.string().max(80).optional(),
  bankName: z.string().max(80).optional(),
  accountNumber: z.string().max(40).optional(),
})

/** One money account as every screen reads it. */
type MoneyAccountRow = {
  id: string
  /** False for a ledger money account that has no `business_accounts` row yet. */
  linked: boolean
  /** Readable business identity. The list endpoint is its authority. */
  identity: string
  name: string
  type: string
  accountHolder: string | null
  bankName: string | null
  accountNumber: string | null
  isActive: boolean
  createdAt: string | null
  ledger: {
    id: string
    code: string
    name: string
    category: string
    categoryType: string
    balancePaisas: string
  }
}

function unavailableResponse() {
  return NextResponse.json(
    { error: 'FEATURE_UNAVAILABLE', message: BUSINESS_ACCOUNTS_UNAVAILABLE_MESSAGE },
    { status: 503 },
  )
}

function serializeLegacy(row: BusinessAccountRecord): Omit<MoneyAccountRow, 'identity'> {
  return {
    id: row.id,
    linked: true,
    name: row.name,
    type: row.type,
    accountHolder: row.accountHolder,
    bankName: row.bankName,
    accountNumber: row.accountNumber,
    isActive: row.isActive,
    createdAt: row.createdAt,
    ledger: {
      id: row.accountId,
      code: row.accountCode,
      name: row.name,
      category: row.categoryName,
      categoryType: row.categoryType,
      balancePaisas: row.balancePaisas,
    },
  }
}

/**
 * Ledger money accounts that have no money-account row yet. Read through the
 * shared chart reader, so this works the same on the legacy production schema
 * and on Prisma without a new database function. Best effort: the managed rows
 * are the primary payload, so a chart read that fails must not empty the screen.
 */
async function listUnlinkedLedgerMoneyAccounts(
  businessId: string,
  linkedLedgerAccountIds: ReadonlySet<string>,
): Promise<Omit<MoneyAccountRow, 'identity'>[]> {
  let chart
  try {
    chart = await getChartOfAccounts(businessId)
  } catch {
    return []
  }
  const rows: Omit<MoneyAccountRow, 'identity'>[] = []
  for (const category of chart) {
    if (category.type !== 'Asset') continue
    for (const account of category.accounts) {
      // Only money accounts: inventory and receivable control accounts are
      // Asset accounts too, and they are not money the business holds.
      if (!account.isBusinessAccount) continue
      if (linkedLedgerAccountIds.has(account.id)) continue
      rows.push({
        // No money-account row exists, so the ledger account is what an action
        // on this row addresses. `linked: false` is what the screen branches on.
        id: account.id,
        linked: false,
        name: account.name,
        type: moneyTypeFromLedgerAccount({ code: account.code, name: account.name }),
        accountHolder: null,
        bankName: null,
        accountNumber: null,
        isActive: account.isActive,
        createdAt: null,
        ledger: {
          id: account.id,
          code: account.code,
          name: account.name,
          category: category.name,
          categoryType: category.type,
          balancePaisas: account.balanceCache.toString(),
        },
      })
    }
  }
  return rows
}

/**
 * Identity is assigned across the whole business at once, in ledger-code order.
 * Codes are immutable and allocated upward, so a new account never takes an
 * identity an existing one already reads by.
 */
function withIdentities(rows: Omit<MoneyAccountRow, 'identity'>[]): MoneyAccountRow[] {
  const ordered = [...rows].sort((a, b) => a.ledger.code.localeCompare(b.ledger.code, 'en', { numeric: true }))
  const identities = assignMoneyIdentities(ordered.map((row) => ({
    name: row.name,
    type: row.type,
    ledgerCode: row.ledger.code,
    hints: [row.bankName, row.accountHolder],
  })))
  return ordered.map((row, index) => ({ ...row, identity: identities[index] }))
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await loadSessionUser((session.user as any).id)
  if (!su) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  if (isSupabaseConfigured()) {
    if (!await usesLegacyTransactionSchema()) return unavailableResponse()
    try {
      const managed = (await listLegacyBusinessAccounts(su.businessId, su.profileId)).map(serializeLegacy)
      const unlinked = await listUnlinkedLedgerMoneyAccounts(
        su.businessId,
        new Set(managed.map((row) => row.ledger.id)),
      )
      return NextResponse.json({ rows: withIdentities([...managed, ...unlinked]) })
    } catch (error) {
      if (error instanceof LegacyBusinessAccountsUnavailableError) return unavailableResponse()
      throw error
    }
  }

  const rows = await db.businessAccount.findMany({
    where: { businessId: su.businessId },
    include: { account: { include: { category: true } } },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
  })

  const managed: Omit<MoneyAccountRow, 'identity'>[] = rows.map((r) => ({
    id: r.id,
    linked: true,
    name: r.name,
    type: r.type,
    accountHolder: r.accountHolder,
    bankName: r.bankName,
    accountNumber: r.accountNumber,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    ledger: {
      id: r.account.id,
      code: r.account.code,
      name: r.account.name,
      category: r.account.category.name,
      categoryType: r.account.category.type,
      // Phase 1: balanceCache is always 0. From Phase 2 onwards this is
      // recomputed server-side by post_voucher() — never written by client.
      balancePaisas: r.account.balanceCache.toString(),
    },
  }))
  const unlinked = await listUnlinkedLedgerMoneyAccounts(
    su.businessId,
    new Set(managed.map((row) => row.ledger.id)),
  )

  return NextResponse.json({ rows: withIdentities([...managed, ...unlinked]) })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  const su = await requirePermission(loaded, 'can_manage_setup')
  const body = await req.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  }
  const { name, type, accountHolder, bankName, accountNumber } = parsed.data

  if (isSupabaseConfigured()) {
    if (!await usesLegacyTransactionSchema()) return unavailableResponse()
    try {
      const created = await createLegacyBusinessAccount({
        businessId: su.businessId,
        actorProfileId: su.profileId,
        idempotencyKey: req.headers.get('x-idempotency-key') ?? crypto.randomUUID(),
        name,
        type,
        accountHolder,
        bankName,
        accountNumber,
      })
      const row = serializeLegacy(created)
      return NextResponse.json({ row: { ...row, identity: deriveMoneyIdentity({ name, type, ledgerCode: row.ledger.code }) } })
    } catch (error) {
      if (error instanceof LegacyBusinessAccountsUnavailableError) return unavailableResponse()
      throw error
    }
  }

  // 1. Find the Asset category for this business.
  const assetCat = await db.accountCategory.findUnique({
    where: { businessId_code: { businessId: su.businessId, code: 'ASSET' } },
  })
  if (!assetCat) return NextResponse.json({ error: 'ASSET_CATEGORY_MISSING' }, { status: 500 })

  // 2. Allocate the next account code under Asset for business accounts.
  //    Use a locked counter pattern: max existing 1xxx code + 1.
  const existing = await db.account.findMany({
    where: { businessId: su.businessId, code: { startsWith: '1' } },
    orderBy: { code: 'desc' },
  })
  let nextNum = 1060
  for (const a of existing) {
    const n = parseInt(a.code, 10)
    if (!isNaN(n) && n > nextNum) nextNum = n
  }
  // Business accounts get codes 1060, 1061, 1062, ... skipping reserved 1100/1200 ranges.
  if (nextNum < 1060) nextNum = 1060
  if (nextNum >= 1100 && nextNum < 1200) nextNum = 1200 // skip Inventory control account range
  if (nextNum >= 1200) nextNum = 1200 // 1200+ reserved for receivables; bump into 1900 range
  if (nextNum >= 1200 && nextNum < 1900) nextNum = 1900
  const newCode = String(nextNum).padStart(4, '0')

  // 3. Atomic create: account + business account in one transaction.
  const created = await db.$transaction(async (tx) => {
    const account = await tx.account.create({
      data: {
        businessId: su.businessId,
        code: newCode,
        name,
        categoryId: assetCat.id,
        isBusinessAccount: true,
        balanceCache: 0n,
      },
    })
    const ba = await tx.businessAccount.create({
      data: {
        businessId: su.businessId,
        accountId: account.id,
        name,
        type,
        accountHolder: accountHolder ?? null,
        bankName: bankName ?? null,
        accountNumber: accountNumber ?? null,
        isActive: true,
      },
      include: { account: { include: { category: true } } },
    })
    return ba
  })

  const identity = deriveMoneyIdentity({ name, type, ledgerCode: newCode })

  // Readable audit detail only: what the account is called, the identity it
  // reads by, and the ledger code the owner sees on screen.
  await writeAudit({
    businessId: su.businessId,
    userId: su.userId,
    action: 'MONEY_ACCOUNT_CREATE',
    entity: 'business_account',
    entityId: created.id,
    details: { name, identity, ledgerCode: newCode, after: { name, type, code: newCode, isActive: true } },
  })

  return NextResponse.json({
    row: {
      id: created.id,
      linked: true,
      identity,
      name: created.name,
      type: created.type,
      accountHolder: created.accountHolder,
      bankName: created.bankName,
      accountNumber: created.accountNumber,
      isActive: created.isActive,
      createdAt: created.createdAt,
      ledger: {
        id: created.account.id,
        code: created.account.code,
        name: created.account.name,
        category: created.account.category.name,
        categoryType: created.account.category.type,
        balancePaisas: created.account.balanceCache.toString(),
      },
    },
  })
}
