/**
 * POST /api/setup/business-accounts/link — bring an existing ledger money
 * account under management.
 *
 * The accounts seeded with the chart (1010 Cash, 1020 Petty Cash, 1030 Bank,
 * 1040 Easypaisa, 1050 JazzCash) are ledger accounts with no money-account row,
 * so nothing on any screen could rename, reclassify or deactivate them. This
 * route adds the missing row against the ledger account that is already there.
 *
 * What it deliberately does not do: create a second ledger account, change the
 * numeric code, touch the balance, or alter one posted entry. The ledger row is
 * reused as-is, so the account keeps its accounting identity and its history and
 * simply becomes editable. Running it twice is a no-op that returns the same
 * account, on both data paths.
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
import { deriveMoneyIdentity } from '@/lib/accounting/money-account-identity'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { usesLegacyTransactionSchema } from '@/lib/identity/legacy-bridge'
import {
  BUSINESS_ACCOUNTS_UNAVAILABLE_MESSAGE,
  LegacyBusinessAccountsUnavailableError,
  linkLegacyLedgerMoneyAccount,
} from '@/lib/accounting/legacy-business-accounts'

const LinkSchema = z.object({
  ledgerAccountId: z.string().trim().min(1).max(64),
  /** Which of the two money types it should be listed under, if not the guess. */
  type: z.enum(BUSINESS_ACCOUNT_TYPES).optional(),
})

const NOT_A_MONEY_ACCOUNT = 'That account is not one of your Cash or Bank accounts.'

function unavailableResponse() {
  return NextResponse.json(
    { error: 'FEATURE_UNAVAILABLE', message: BUSINESS_ACCOUNTS_UNAVAILABLE_MESSAGE },
    { status: 503 },
  )
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  const su = await requirePermission(loaded, 'can_manage_setup')
  const body = await req.json().catch(() => null)
  const parsed = LinkSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  }
  const { ledgerAccountId } = parsed.data

  if (isSupabaseConfigured()) {
    if (!await usesLegacyTransactionSchema()) return unavailableResponse()
    try {
      // The stored label is the one the owner chose, or — when the row is being
      // linked straight from the list — the one its code and name already imply.
      const probe = await linkLegacyLedgerMoneyAccount({
        businessId: su.businessId,
        actorProfileId: su.profileId,
        ledgerAccountId,
        type: parsed.data.type,
      })
      if (!probe.ok) {
        return probe.reason === 'NOT_FOUND'
          ? NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
          : NextResponse.json({ error: 'NOT_A_MONEY_ACCOUNT', message: NOT_A_MONEY_ACCOUNT }, { status: 400 })
      }
      const row = probe.row
      if (!probe.alreadyLinked) {
        await writeAudit({
          businessId: su.businessId,
          userId: su.userId,
          action: 'MONEY_ACCOUNT_LINK',
          entity: 'business_account',
          entityId: row.id,
          details: {
            name: row.name,
            identity: deriveMoneyIdentity({ name: row.name, type: row.type, ledgerCode: row.accountCode }),
            ledgerCode: row.accountCode,
            after: { code: row.accountCode, name: row.name, type: row.type, isActive: row.isActive },
          },
        })
      }
      return NextResponse.json({ ok: true, alreadyLinked: probe.alreadyLinked, id: row.id })
    } catch (error) {
      if (error instanceof LegacyBusinessAccountsUnavailableError) return unavailableResponse()
      throw error
    }
  }

  const account = await db.account.findFirst({
    where: { id: ledgerAccountId, businessId: su.businessId },
    include: { category: true, businessAccount: true },
  })
  if (!account) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (!account.isBusinessAccount || account.category.type !== 'Asset') {
    return NextResponse.json({ error: 'NOT_A_MONEY_ACCOUNT', message: NOT_A_MONEY_ACCOUNT }, { status: 400 })
  }
  // Already managed: answer with the account that exists rather than creating a
  // second one. `accountId` is unique, so this is also enforced by the database.
  if (account.businessAccount) {
    return NextResponse.json({ ok: true, alreadyLinked: true, id: account.businessAccount.id })
  }

  const type = parsed.data.type
    ?? moneyTypeFromLedgerAccount({ code: account.code, name: account.name })
  const created = await db.businessAccount.create({
    data: {
      businessId: su.businessId,
      accountId: account.id,
      name: account.name,
      type,
      isActive: account.isActive,
    },
  })

  await writeAudit({
    businessId: su.businessId,
    userId: su.userId,
    action: 'MONEY_ACCOUNT_LINK',
    entity: 'business_account',
    entityId: created.id,
    details: {
      name: account.name,
      identity: deriveMoneyIdentity({ name: account.name, type, ledgerCode: account.code }),
      ledgerCode: account.code,
      after: { code: account.code, name: account.name, type, isActive: created.isActive },
    },
  })

  return NextResponse.json({ ok: true, alreadyLinked: false, id: created.id })
}
