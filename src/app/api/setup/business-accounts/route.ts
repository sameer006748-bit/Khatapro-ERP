/**
 * Business accounts — list (with linked ledger account + current cached
 * balance) and create. Creating a BusinessAccount atomically creates a
 * linked sub-account under Asset and links it 1:1.
 *
 * The "current balance" in Phase 1 is always 0 because no vouchers exist
 * yet. From Phase 2 onward, balanceCache is recomputed server-side by
 * post_voucher() — never written by the client.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission, writeAudit } from '@/lib/auth/permissions'

const BUSINESS_ACCOUNT_TYPES = [
  'Cash', 'Petty Cash', 'Bank', 'Easypaisa', 'JazzCash', 'Wallet', 'Custom / Other',
] as const

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(BUSINESS_ACCOUNT_TYPES),
  accountHolder: z.string().max(80).optional(),
  bankName: z.string().max(80).optional(),
  accountNumber: z.string().max(40).optional(),
})

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await loadSessionUser((session.user as any).id)
  if (!su) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const rows = await db.businessAccount.findMany({
    where: { businessId: su.businessId },
    include: { account: { include: { category: true } } },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
  })

  return NextResponse.json({
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      accountHolder: r.accountHolder,
      bankName: r.bankName,
      accountNumber: r.accountNumber,
      isActive: r.isActive,
      createdAt: r.createdAt,
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
    })),
  })
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

  await writeAudit({
    businessId: su.businessId,
    userId: su.userId,
    action: 'CREATE',
    entity: 'business_account',
    entityId: created.id,
    details: { name, type, ledgerCode: newCode, ledgerAccountId: created.accountId },
  })

  return NextResponse.json({
    row: {
      id: created.id,
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
