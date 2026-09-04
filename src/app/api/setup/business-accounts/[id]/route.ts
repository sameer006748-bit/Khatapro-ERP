/**
 * A single business (payment) account: edit, activate/deactivate, delete.
 *
 * Payment accounts are user-created data an Owner maintains over time, so they
 * need more than "create". Three rules matter here:
 *
 *  1. The ledger account and the business account are one thing to the user, so
 *     a rename syncs `Account.name` and (de)activation syncs `Account.isActive`.
 *     Sale screens list business accounts via the COA filter
 *     `isBusinessAccount && isActive`, so deactivating here is exactly what
 *     removes an account from new sales without touching posted invoices.
 *  2. An account that money has moved through is never deleted — posted
 *     invoices, vouchers and purchase payments must stay readable. Deletion is
 *     refused with the referencing counts so the Owner can deactivate instead.
 *  3. Legacy type labels ('Petty Cash', 'JazzCash', …) stay editable so rows
 *     written by earlier releases can be saved — and moved to Cash or Bank —
 *     without a data migration.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission, writeAudit } from '@/lib/auth/permissions'
import { ACCEPTED_BUSINESS_ACCOUNT_TYPES, ACCOUNT_IN_USE_MESSAGE } from '@/lib/accounting/business-account-types'
import { deriveMoneyIdentity } from '@/lib/accounting/money-account-identity'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { usesLegacyTransactionSchema } from '@/lib/identity/legacy-bridge'
import {
  BUSINESS_ACCOUNTS_UNAVAILABLE_MESSAGE,
  LegacyBusinessAccountsUnavailableError,
  deleteLegacyBusinessAccount,
  listLegacyBusinessAccounts,
  updateLegacyBusinessAccount,
  type BusinessAccountRecord,
} from '@/lib/accounting/legacy-business-accounts'

const UpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  type: z.enum(ACCEPTED_BUSINESS_ACCOUNT_TYPES).optional(),
  accountHolder: z.string().max(80).nullable().optional(),
  bankName: z.string().max(80).nullable().optional(),
  accountNumber: z.string().max(40).nullable().optional(),
  isActive: z.boolean().optional(),
})

type Ctx = { params: Promise<{ id: string }> }

type SessionUser = Awaited<ReturnType<typeof requirePermission>>
type AuthResult =
  | { error: NextResponse; su?: never }
  | { error?: never; su: SessionUser }

function unavailableResponse() {
  return NextResponse.json(
    { error: 'FEATURE_UNAVAILABLE', message: BUSINESS_ACCOUNTS_UNAVAILABLE_MESSAGE },
    { status: 503 },
  )
}

async function authorize(): Promise<AuthResult> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { error: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) }
  const loaded = await loadSessionUser((session.user as any).id)
  const su = await requirePermission(loaded, 'can_manage_setup')
  return { su }
}

/** The shape both this route and the collection route return. */
function serialize(row: {
  id: string; name: string; type: string; accountHolder: string | null
  bankName: string | null; accountNumber: string | null; isActive: boolean; createdAt: Date
  account: { id: string; code: string; name: string; balanceCache: bigint; category: { name: string; type: string } }
}) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    accountHolder: row.accountHolder,
    bankName: row.bankName,
    accountNumber: row.accountNumber,
    isActive: row.isActive,
    createdAt: row.createdAt,
    ledger: {
      id: row.account.id,
      code: row.account.code,
      name: row.account.name,
      category: row.account.category.name,
      categoryType: row.account.category.type,
      balancePaisas: row.account.balanceCache.toString(),
    },
  }
}

function serializeLegacy(row: BusinessAccountRecord) {
  return {
    id: row.id,
    identity: row.identity ?? deriveMoneyIdentity({
      name: row.name,
      type: row.type,
      ledgerCode: row.accountCode,
    }),
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
 * The four things an owner reads back off an audit entry. Bank name, account
 * holder and account number are deliberately absent, and so are internal ids.
 */
type MoneyAccountSnapshot = {
  code: string
  identity: string
  name: string
  type: string
  isActive: boolean
}

/**
 * Name the event after what actually changed, so the audit log reads as
 * "Money account renamed" rather than a generic update.
 */
function moneyAccountAction(before: MoneyAccountSnapshot | null, after: MoneyAccountSnapshot) {
  if (before && before.isActive !== after.isActive) {
    return after.isActive ? 'MONEY_ACCOUNT_REACTIVATE' : 'MONEY_ACCOUNT_DEACTIVATE'
  }
  if (before && before.type !== after.type) return 'MONEY_ACCOUNT_TYPE_CHANGE'
  if (before && before.name !== after.name) return 'MONEY_ACCOUNT_RENAME'
  return 'MONEY_ACCOUNT_UPDATE'
}

/**
 * One readable audit row per edit. The legacy database function records its own
 * bare row as well; this one is what the Audit Log renders, because it carries
 * the before/after the owner needs to see.
 */
async function auditMoneyAccountUpdate(input: {
  su: SessionUser
  businessAccountId: string
  before: MoneyAccountSnapshot | null
  after: MoneyAccountSnapshot
}) {
  await writeAudit({
    businessId: input.su.businessId,
    userId: input.su.userId,
    action: moneyAccountAction(input.before, input.after),
    entity: 'business_account',
    entityId: input.businessAccountId,
    details: {
      name: input.after.name,
      // The identity the account reads by, alongside the ledger code it posts
      // to — the two references an owner recognises the account from.
      identity: input.after.identity,
      ledgerCode: input.after.code,
      ...(input.before ? { before: input.before } : {}),
      after: input.after,
    },
  })
}

/**
 * The row as it stood before a legacy edit, read through the same listing the
 * screen uses. Best effort: a failure here must not fail the edit, it only
 * costs the audit entry its "before" half.
 */
async function legacySnapshotBefore(
  su: SessionUser,
  businessAccountId: string,
): Promise<MoneyAccountSnapshot | null> {
  try {
    const rows = await listLegacyBusinessAccounts(su.businessId, su.profileId)
    const row = rows.find((candidate) => candidate.id === businessAccountId)
    return row
      ? {
          code: row.accountCode,
          identity: row.identity ?? deriveMoneyIdentity({
            name: row.name,
            type: row.type,
            ledgerCode: row.accountCode,
          }),
          name: row.name,
          type: row.type,
          isActive: row.isActive,
        }
      : null
  } catch {
    return null
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await authorize()
  if (auth.error) return auth.error
  const su = auth.su
  const { id } = await ctx.params

  const body = await req.json().catch(() => null)
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  }
  const patch = parsed.data
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'NOTHING_TO_UPDATE' }, { status: 400 })
  }

  if (isSupabaseConfigured()) {
    if (!await usesLegacyTransactionSchema()) return unavailableResponse()
    try {
      const before = await legacySnapshotBefore(su, id)
      const row = await updateLegacyBusinessAccount({
        businessId: su.businessId,
        businessAccountId: id,
        actorProfileId: su.profileId,
        patch,
      })
      await auditMoneyAccountUpdate({
        su,
        businessAccountId: id,
        before,
        after: {
          code: row.accountCode,
          identity: row.identity ?? deriveMoneyIdentity({
            name: row.name,
            type: row.type,
            ledgerCode: row.accountCode,
          }),
          name: row.name,
          type: row.type,
          isActive: row.isActive,
        },
      })
      return NextResponse.json({ row: serializeLegacy(row) })
    } catch (error) {
      if (error instanceof LegacyBusinessAccountsUnavailableError) return unavailableResponse()
      throw error
    }
  }

  const existing = await db.businessAccount.findFirst({
    where: { id, businessId: su.businessId },
    include: { account: { select: { code: true } } },
  })
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  // The ledger account and the business account move together, so both writes
  // are in one transaction: a half-applied rename would show two names.
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.businessAccount.update({
      where: { id: existing.id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.accountHolder !== undefined ? { accountHolder: patch.accountHolder } : {}),
        ...(patch.bankName !== undefined ? { bankName: patch.bankName } : {}),
        ...(patch.accountNumber !== undefined ? { accountNumber: patch.accountNumber } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      },
      include: { account: { include: { category: true } } },
    })

    if (patch.name !== undefined || patch.isActive !== undefined) {
      await tx.account.update({
        where: { id: existing.accountId },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        },
      })
    }

    return row
  })

  await auditMoneyAccountUpdate({
    su,
    businessAccountId: existing.id,
    before: {
      code: existing.account.code,
      identity: deriveMoneyIdentity({
        name: existing.name,
        type: existing.type,
        ledgerCode: existing.account.code,
      }),
      name: existing.name,
      type: existing.type,
      isActive: existing.isActive,
    },
    after: {
      code: updated.account.code,
      // The local fallback has no persisted column. Preserve the identity from
      // the pre-update snapshot so its audit still proves rename/type stability.
      identity: deriveMoneyIdentity({
        name: existing.name,
        type: existing.type,
        ledgerCode: existing.account.code,
      }),
      name: updated.name,
      type: updated.type,
      isActive: updated.isActive,
    },
  })

  // Re-read so the returned ledger name/active state reflect the synced writes.
  const fresh = await db.businessAccount.findUnique({
    where: { id: updated.id },
    include: { account: { include: { category: true } } },
  })
  return NextResponse.json({ row: serialize(fresh ?? updated) })
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await authorize()
  if (auth.error) return auth.error
  const su = auth.su
  const { id } = await ctx.params

  if (isSupabaseConfigured()) {
    if (!await usesLegacyTransactionSchema()) return unavailableResponse()
    try {
      const result = await deleteLegacyBusinessAccount({
        businessId: su.businessId,
        businessAccountId: id,
        actorProfileId: su.profileId,
      })
      if (!result.deleted && result.error === 'ACCOUNT_IN_USE') {
        return NextResponse.json(
          {
            error: 'ACCOUNT_IN_USE',
            message: ACCOUNT_IN_USE_MESSAGE,
            references: result.references,
          },
          { status: 409 },
        )
      }
      return NextResponse.json({ ok: true, deletedId: result.deleted_id ?? id })
    } catch (error) {
      if (error instanceof LegacyBusinessAccountsUnavailableError) return unavailableResponse()
      throw error
    }
  }

  const existing = await db.businessAccount.findFirst({
    where: { id, businessId: su.businessId },
    include: { account: true },
  })
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  // Money that has moved through an account is history. Refuse the delete and
  // say exactly what references it, so the Owner deactivates instead.
  const [paymentAllocations, voucherLines, purchasePayments] = await Promise.all([
    db.paymentAllocation.count({ where: { accountId: existing.accountId } }),
    db.voucherLine.count({ where: { accountId: existing.accountId } }),
    db.purchasePayment.count({ where: { accountId: existing.accountId } }),
  ])
  const references = paymentAllocations + voucherLines + purchasePayments
  if (references > 0 || existing.account.balanceCache !== 0n) {
    return NextResponse.json(
      {
        error: 'ACCOUNT_IN_USE',
        message: ACCOUNT_IN_USE_MESSAGE,
        references: { paymentAllocations, voucherLines, purchasePayments },
      },
      { status: 409 },
    )
  }

  await db.$transaction(async (tx) => {
    await tx.businessAccount.delete({ where: { id: existing.id } })
    await tx.account.delete({ where: { id: existing.accountId } })
  })

  await writeAudit({
    businessId: su.businessId,
    userId: su.userId,
    action: 'MONEY_ACCOUNT_DELETE',
    entity: 'business_account',
    entityId: existing.id,
    details: {
      name: existing.name,
      identity: deriveMoneyIdentity({
        name: existing.name,
        type: existing.type,
        ledgerCode: existing.account.code,
      }),
      ledgerCode: existing.account.code,
      before: {
        code: existing.account.code,
        name: existing.name,
        type: existing.type,
        isActive: existing.isActive,
      },
    },
  })

  return NextResponse.json({ ok: true, deletedId: existing.id })
}
