/**
 * Server-side voucher posting — the Prisma/SQLite local-preview equivalent
 * of the Supabase `post_voucher()` RPC.
 *
 * Rules enforced (mirrors supabase/migrations/00002_phase2_accounting.sql):
 *   - At least 2 lines
 *   - Each line: exactly one of debit > 0 / credit > 0 (xor)
 *   - No negative debit/credit
 *   - Account must belong to the same business and be active
 *   - total_debit == total_credit (balanced) — otherwise REJECTED
 *   - Zero-value voucher not allowed
 *   - Audit log entry written
 *   - balance_cache on each affected account updated (signed: debit - credit)
 *
 * In production (Supabase), the API route calls the `post_voucher()` RPC
 * via the admin client instead — but the validation is identical because
 * the SQL function enforces the same rules server-side.
 *
 * Money is BigInt paisas — never floating-point.
 */
import 'server-only'
import { db } from '@/lib/db'
import { writeAudit } from '@/lib/auth/permissions'
import { bizDateString } from '@/lib/dates'

export type VoucherLineInput = {
  accountId: string
  debit: bigint
  credit: bigint
  memo?: string | null
}

export type PostVoucherInput = {
  businessId: string
  voucherType: string
  voucherDate: Date
  memo?: string | null
  lines: VoucherLineInput[]
  referenceId?: string | null
  referenceType?: string | null
  postedBy?: string | null
}

export class VoucherError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'VoucherError'
  }
}

export async function postVoucher(input: PostVoucherInput): Promise<string> {
  const { businessId, voucherType, voucherDate, memo, lines, referenceId, referenceType, postedBy } = input

  // 1. At least 2 lines.
  if (lines.length < 2) {
    throw new VoucherError('Voucher must have at least 2 lines', 'TOO_FEW_LINES')
  }

  // 2. Validate each line.
  let totalDebit = 0n
  let totalCredit = 0n
  for (const line of lines) {
    if (line.debit < 0n || line.credit < 0n) {
      throw new VoucherError('Negative debit/credit not allowed', 'NEGATIVE_AMOUNT')
    }
    const hasDebit = line.debit > 0n
    const hasCredit = line.credit > 0n
    if (hasDebit === hasCredit) {
      // Both true or both false → invalid.
      throw new VoucherError(
        'Each line must have exactly one of debit/credit > 0',
        'INVALID_LINE',
      )
    }
    totalDebit += line.debit
    totalCredit += line.credit
  }

  // 3. Balanced: total debit MUST equal total credit.
  if (totalDebit !== totalCredit) {
    throw new VoucherError(
      `Unbalanced voucher: total debit ${totalDebit} <> total credit ${totalCredit}`,
      'UNBALANCED',
    )
  }
  if (totalDebit === 0n) {
    throw new VoucherError('Zero-value voucher not allowed', 'ZERO_VALUE')
  }

  // 4. Validate every account belongs to the same business and is active.
  const accountIds = Array.from(new Set(lines.map((l) => l.accountId)))
  const accounts = await db.account.findMany({
    where: { id: { in: accountIds }, businessId, isActive: true },
    select: { id: true },
  })
  if (accounts.length !== accountIds.length) {
    throw new VoucherError(
      'One or more accounts are invalid, inactive, or belong to a different business',
      'INVALID_ACCOUNT',
    )
  }

  // 5. Post inside a transaction: header + lines + balance cache update.
  const voucher = await db.$transaction(async (tx) => {
    const v = await tx.voucher.create({
      data: {
        businessId,
        voucherType,
        voucherDate,
        memo: memo ?? null,
        referenceId: referenceId ?? null,
        referenceType: referenceType ?? null,
        postedBy: postedBy ?? null,
        totalDebit,
        totalCredit,
      },
    })

    // Insert lines.
    await tx.voucherLine.createMany({
      data: lines.map((l, i) => ({
        businessId,
        voucherId: v.id,
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        memo: l.memo ?? null,
        lineOrder: i,
      })),
    })

    // Update balance_cache: signed (debit - credit) delta per account.
    const deltas = new Map<string, bigint>()
    for (const l of lines) {
      const d = (l.debit - l.credit)
      deltas.set(l.accountId, (deltas.get(l.accountId) ?? 0n) + d)
    }
    for (const [accountId, delta] of deltas) {
      const acc = await tx.account.findUnique({ where: { id: accountId }, select: { balanceCache: true } })
      if (!acc) continue
      await tx.account.update({
        where: { id: accountId },
        data: { balanceCache: acc.balanceCache + delta },
      })
    }

    return v
  })

  // 6. Audit log.
  await writeAudit({
    businessId,
    userId: postedBy ?? null,
    action: 'POST_VOUCHER',
    entity: 'voucher',
    entityId: voucher.id,
    details: {
      voucher_type: voucherType,
      voucher_date: bizDateString(voucherDate),
      total_debit: totalDebit.toString(),
      total_credit: totalCredit.toString(),
      line_count: lines.length,
    },
  })

  return voucher.id
}

/**
 * Cancel a posted voucher by posting a reversing voucher.
 * No hard delete — original record stays. Full audit trail.
 */
export async function cancelVoucher(
  voucherId: string,
  cancelledBy: string,
  reason?: string | null,
): Promise<string> {
  const original = await db.voucher.findUnique({
    where: { id: voucherId },
    include: { lines: true },
  })
  if (!original) throw new VoucherError('Voucher not found', 'NOT_FOUND')
  if (original.isCancelled) throw new VoucherError('Already cancelled', 'ALREADY_CANCELLED')

  // Build reversing lines (swap debit<->credit).
  const reverseLines: VoucherLineInput[] = original.lines.map((l) => ({
    accountId: l.accountId,
    debit: l.credit,
    credit: l.debit,
    memo: `REVERSAL: ${l.memo ?? ''}`,
  }))

  // Post the reversal via postVoucher so it goes through the same validation.
  const reversalId = await postVoucher({
    businessId: original.businessId,
    voucherType: original.voucherType,
    voucherDate: original.voucherDate,
    memo: `CANCEL: ${original.memo ?? ''}`,
    lines: reverseLines,
    referenceId: original.id,
    referenceType: 'voucher_cancel',
    postedBy: cancelledBy,
  })

  // Mark the original as cancelled.
  await db.voucher.update({
    where: { id: voucherId },
    data: {
      isCancelled: true,
      cancelledAt: new Date(),
      cancelledBy,
      cancelVoucherId: reversalId,
    },
  })

  await writeAudit({
    businessId: original.businessId,
    userId: cancelledBy,
    action: 'CANCEL_VOUCHER',
    entity: 'voucher',
    entityId: voucherId,
    details: { reversal_voucher_id: reversalId, reason: reason ?? null },
  })

  return reversalId
}

/**
 * Trial Balance — aggregate debit/credit/balance per active account.
 * Excludes cancelled vouchers.
 */
export async function trialBalance(
  businessId: string,
  fromDate?: Date,
  toDate?: Date,
): Promise<Array<{
  account: {
    id: string
    code: string
    name: string
    category: { code: string; name: string; type: string }
  }
  totalDebit: bigint
  totalCredit: bigint
  balance: bigint
}>> {
  const accounts = await db.account.findMany({
    where: { businessId, isActive: true },
    include: { category: true },
    orderBy: { code: 'asc' },
  })

  type TrialBalanceRow = {
    account: {
      id: string
      code: string
      name: string
      category: { code: string; name: string; type: string }
    }
    totalDebit: bigint
    totalCredit: bigint
    balance: bigint
  }
  const result: TrialBalanceRow[] = []
  for (const a of accounts) {
    const lines = await db.voucherLine.findMany({
      where: {
        accountId: a.id,
        businessId,
        voucher: {
          isCancelled: false,
          ...(fromDate || toDate
            ? {
                voucherDate: {
                  ...(fromDate ? { gte: fromDate } : {}),
                  ...(toDate ? { lte: toDate } : {}),
                },
              }
            : {}),
        },
      },
      select: { debit: true, credit: true },
    })
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0n)
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0n)
    result.push({
      account: {
        id: a.id,
        code: a.code,
        name: a.name,
        category: { code: a.category.code, name: a.category.name, type: a.category.type },
      },
      totalDebit,
      totalCredit,
      balance: totalDebit - totalCredit,
    })
  }
  return result
}

/**
 * Account ledger drill-down — every line touching an account, with
 * running balance (debit - credit cumulative).
 */
export async function accountLedger(
  businessId: string,
  accountId: string,
  fromDate?: Date,
  toDate?: Date,
): Promise<Array<{
  lineId: string
  voucherId: string
  voucherType: string
  voucherDate: Date
  memo: string | null
  debit: bigint
  credit: bigint
  runningBalance: bigint
}>> {
  const lines = await db.voucherLine.findMany({
    where: {
      accountId,
      businessId,
      voucher: {
        isCancelled: false,
        ...(fromDate || toDate
          ? {
              voucherDate: {
                ...(fromDate ? { gte: fromDate } : {}),
                ...(toDate ? { lte: toDate } : {}),
              },
            }
          : {}),
      },
    },
    include: { voucher: true },
    orderBy: [{ voucher: { voucherDate: 'asc' } }, { voucher: { postedAt: 'asc' } }, { lineOrder: 'asc' }],
  })

  let running = 0n
  return lines.map((l) => {
    running += l.debit - l.credit
    return {
      lineId: l.id,
      voucherId: l.voucherId,
      voucherType: l.voucher.voucherType,
      voucherDate: l.voucher.voucherDate,
      memo: l.memo ?? l.voucher.memo,
      debit: l.debit,
      credit: l.credit,
      runningBalance: running,
    }
  })
}
