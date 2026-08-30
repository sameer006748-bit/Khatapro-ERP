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
 *     written by earlier releases can be saved without a data migration.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission, writeAudit } from '@/lib/auth/permissions'
import { ACCEPTED_BUSINESS_ACCOUNT_TYPES } from '@/lib/accounting/business-account-types'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { usesLegacyTransactionSchema } from '@/lib/identity/legacy-bridge'
import {
  BUSINESS_ACCOUNTS_UNAVAILABLE_MESSAGE,
  LegacyBusinessAccountsUnavailableError,
  deleteLegacyBusinessAccount,
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
      const row = await updateLegacyBusinessAccount({
        businessId: su.businessId,
        businessAccountId: id,
        actorProfileId: su.profileId,
        patch,
      })
      return NextResponse.json({ row: serializeLegacy(row) })
    } catch (error) {
      if (error instanceof LegacyBusinessAccountsUnavailableError) return unavailableResponse()
      throw error
    }
  }

  const existing = await db.businessAccount.findFirst({
    where: { id, businessId: su.businessId },
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

  await writeAudit({
    businessId: su.businessId,
    userId: su.userId,
    action: 'UPDATE',
    entity: 'business_account',
    entityId: existing.id,
    details: { patch, ledgerAccountId: existing.accountId },
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
            message: 'This account is used by posted transactions and cannot be deleted. Deactivate it instead — it will stop appearing on new sales while old invoices stay readable.',
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
        message:
          'This account is used by posted transactions and cannot be deleted. Deactivate it instead — it will stop appearing on new sales while old invoices stay readable.',
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
    action: 'DELETE',
    entity: 'business_account',
    entityId: existing.id,
    details: { name: existing.name, type: existing.type, ledgerAccountId: existing.accountId },
  })

  return NextResponse.json({ ok: true, deletedId: existing.id })
}
