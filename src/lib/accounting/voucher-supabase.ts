/**
 * Server-side voucher posting via Supabase `post_voucher()` RPC.
 *
 * This is the production path. When Supabase env vars are configured,
 * the API routes call this instead of the Prisma `postVoucher()`.
 *
 * The RPC runs as SECURITY DEFINER inside Postgres, so it bypasses RLS
 * to insert into vouchers + voucher_lines (which have no INSERT policy
 * for regular users). The RPC itself enforces balanced-voucher validation.
 *
 * Money is BigInt paisas — passed as string to preserve precision over JSON.
 *
 * Phase 2.1: posted_by is now the real Supabase auth.users UUID, fetched
 * from User.supabaseUserUuid (populated by scripts/align-supabase-auth.ts).
 */
import 'server-only'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { db } from '@/lib/db'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { writeAudit } from '@/lib/auth/permissions'
import { bizDateString } from '@/lib/dates'
import type { VoucherLineInput, PostVoucherInput } from '@/lib/accounting/voucher'
import { VoucherError } from '@/lib/accounting/voucher'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Resolve the user identifier used for posted_by / created_by columns.
 *
 * Production (Supabase configured): the authenticated `userId` IS already the
 * Supabase auth.users UUID — see `loadSessionUser()`. We must NOT touch
 * Prisma/SQLite here (it does not exist on Vercel). Validate the id is a real
 * UUID and return it unchanged; fail closed with a safe internal error if it
 * is malformed rather than silently accepting a bad id.
 *
 * Local development (Supabase NOT configured): preserve the historical
 * behaviour of mapping a Prisma cuid → its linked Supabase UUID (or null).
 */
export async function resolveSupabaseUuid(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null

  if (isSupabaseConfigured()) {
    if (!UUID_RE.test(userId)) {
      throw new VoucherError('Invalid authenticated user identifier', 'INVALID_USER')
    }
    return userId
  }

  const u = await db.user.findUnique({
    where: { id: userId },
    select: { supabaseUserUuid: true },
  })
  return u?.supabaseUserUuid ?? null
}

export async function postVoucherViaSupabase(input: PostVoucherInput): Promise<string> {
  const { businessId, voucherType, voucherDate, memo, lines, referenceId, referenceType, postedBy } = input
  const admin = getAdminSupabase()

  // Pre-flight client validation (mirrors the RPC's checks) so we get
  // clean VoucherError exceptions instead of PostgREST error strings.
  if (lines.length < 2) {
    throw new VoucherError('Voucher must have at least 2 lines', 'TOO_FEW_LINES')
  }
  let totalDebit = 0n
  let totalCredit = 0n
  for (const line of lines) {
    if (line.debit < 0n || line.credit < 0n) {
      throw new VoucherError('Negative debit/credit not allowed', 'NEGATIVE_AMOUNT')
    }
    const hasDebit = line.debit > 0n
    const hasCredit = line.credit > 0n
    if (hasDebit === hasCredit) {
      throw new VoucherError('Each line must have exactly one of debit/credit > 0', 'INVALID_LINE')
    }
    totalDebit += line.debit
    totalCredit += line.credit
  }
  if (totalDebit !== totalCredit) {
    throw new VoucherError(
      `Unbalanced voucher: total debit ${totalDebit} <> total credit ${totalCredit}`,
      'UNBALANCED',
    )
  }
  if (totalDebit === 0n) {
    throw new VoucherError('Zero-value voucher not allowed', 'ZERO_VALUE')
  }

  // Phase 2.1: resolve the real Supabase auth.users UUID for posted_by.
  const supabasePostedBy = await resolveSupabaseUuid(postedBy)

  // Call the post_voucher() RPC.
  // Lines are passed as JSONB with debit/credit as STRING (BigInt-safe over JSON).
  const linesJson = lines.map((l, i) => ({
    account_id: l.accountId,
    debit: l.debit.toString(),
    credit: l.credit.toString(),
    memo: l.memo ?? null,
    idx: i + 1,
  }))

  const { data, error } = await admin.rpc('post_voucher', {
    p_business_id: businessId,
    p_voucher_type: voucherType,
    p_voucher_date: bizDateString(voucherDate),
    p_memo: memo ?? null,
    p_lines: linesJson,
    p_reference_id: referenceId ?? null,
    p_reference_type: referenceType ?? null,
    p_posted_by: supabasePostedBy,
  })

  if (error) {
    // The RPC raises exceptions with descriptive messages — surface them.
    const msg = error.message || 'RPC failed'
    if (msg.includes('Unbalanced')) {
      throw new VoucherError(msg, 'UNBALANCED')
    }
    if (msg.includes('at least 2 lines')) {
      throw new VoucherError(msg, 'TOO_FEW_LINES')
    }
    if (msg.includes('Invalid or inactive account')) {
      throw new VoucherError(msg, 'INVALID_ACCOUNT')
    }
    throw new VoucherError(msg, 'RPC_ERROR')
  }

  const voucherId = data as string

  // Write a local audit entry too (the RPC writes one in Supabase, but the
  // local audit_logs table is what the /api/audit-logs route reads when
  // running in Prisma-fallback mode). When fully on Supabase, the Supabase
  // audit_logs table is the source of truth and this is a no-op duplicate.
  // Phase 2.1: include the Supabase UUID in details for full traceability.
  try {
    await writeAudit({
      businessId,
      userId: postedBy ?? null,
      action: 'POST_VOUCHER',
      entity: 'voucher',
      entityId: voucherId,
      details: {
        voucher_type: voucherType,
        voucher_date: bizDateString(voucherDate),
        total_debit: totalDebit.toString(),
        total_credit: totalCredit.toString(),
        line_count: lines.length,
        source: 'supabase_rpc',
        supabase_posted_by: supabasePostedBy,
      },
    })
  } catch {
    // Audit write failure is non-fatal.
  }

  return voucherId
}

/**
 * Trial Balance via Supabase `trial_balance()` RPC.
 */
export async function trialBalanceViaSupabase(
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
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('trial_balance', {
    p_business_id: businessId,
    p_from_date: fromDate ? bizDateString(fromDate) : null,
    p_to_date: toDate ? bizDateString(toDate) : null,
  })

  if (error) throw new VoucherError(error.message, 'RPC_ERROR')
  if (!data) return []

  const rows = data as Array<{
    account_id: string
    account_code: string
    account_name: string
    category_code: string
    category_name: string
    category_type: string
    total_debit: string
    total_credit: string
    balance: string
  }>

  return rows.map((r) => ({
    account: {
      id: r.account_id,
      code: r.account_code,
      name: r.account_name,
      category: { code: r.category_code, name: r.category_name, type: r.category_type },
    },
    totalDebit: BigInt(r.total_debit),
    totalCredit: BigInt(r.total_credit),
    balance: BigInt(r.balance),
  }))
}

/**
 * Account ledger drill-down via Supabase `account_ledger()` RPC.
 */
export async function accountLedgerViaSupabase(
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
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('account_ledger', {
    p_business_id: businessId,
    p_account_id: accountId,
    p_from_date: fromDate ? bizDateString(fromDate) : null,
    p_to_date: toDate ? bizDateString(toDate) : null,
  })

  if (error) throw new VoucherError(error.message, 'RPC_ERROR')
  if (!data) return []

  const rows = data as Array<{
    line_id: string
    voucher_id: string
    voucher_type: string
    voucher_date: string
    memo: string | null
    debit: string
    credit: string
    running_balance: string
  }>

  return rows.map((r) => ({
    lineId: r.line_id,
    voucherId: r.voucher_id,
    voucherType: r.voucher_type,
    voucherDate: new Date(r.voucher_date),
    memo: r.memo,
    debit: BigInt(r.debit),
    credit: BigInt(r.credit),
    runningBalance: BigInt(r.running_balance),
  }))
}

/**
 * Cancel voucher via Supabase `cancel_voucher()` RPC.
 */
export async function cancelVoucherViaSupabase(
  voucherId: string,
  cancelledBy: string,
  reason?: string | null,
): Promise<string> {
  const admin = getAdminSupabase()
  // Phase 2.1: resolve the real Supabase auth.users UUID for cancelled_by.
  const supabaseCancelledBy = await resolveSupabaseUuid(cancelledBy)
  const { data, error } = await admin.rpc('cancel_voucher', {
    p_voucher_id: voucherId,
    p_cancelled_by: supabaseCancelledBy,
    p_reason: reason ?? null,
  })
  if (error) throw new VoucherError(error.message, 'RPC_ERROR')
  return data as string
}

/**
 * Unified dispatcher: uses Supabase RPC when configured AND migrations are
 * applied, Prisma otherwise. This is what the API routes actually call.
 */
export async function postVoucherSmart(input: PostVoucherInput): Promise<string> {
  if (await isSupabaseLive()) {
    return postVoucherViaSupabase(input)
  }
  // Lazy-import the Prisma implementation to avoid loading it when on Supabase.
  const { postVoucher } = await import('@/lib/accounting/voucher')
  return postVoucher(input)
}

export async function trialBalanceSmart(
  businessId: string,
  fromDate?: Date,
  toDate?: Date,
) {
  if (await isSupabaseLive()) {
    return trialBalanceViaSupabase(businessId, fromDate, toDate)
  }
  const { trialBalance } = await import('@/lib/accounting/voucher')
  return trialBalance(businessId, fromDate, toDate)
}

export async function accountLedgerSmart(
  businessId: string,
  accountId: string,
  fromDate?: Date,
  toDate?: Date,
) {
  if (await isSupabaseLive()) {
    return accountLedgerViaSupabase(businessId, accountId, fromDate, toDate)
  }
  const { accountLedger } = await import('@/lib/accounting/voucher')
  return accountLedger(businessId, accountId, fromDate, toDate)
}

export async function cancelVoucherSmart(
  voucherId: string,
  cancelledBy: string,
  reason?: string | null,
) {
  if (await isSupabaseLive()) {
    return cancelVoucherViaSupabase(voucherId, cancelledBy, reason)
  }
  const { cancelVoucher } = await import('@/lib/accounting/voucher')
  return cancelVoucher(voucherId, cancelledBy, reason)
}

/**
 * True when Supabase env vars are set AND Phase 2 migrations are applied.
 *
 * We cache the migration check result in a module-level variable to avoid
 * hitting the Supabase API on every voucher post. The cache is cleared on
 * server restart (which is fine for dev; in production the env is stable).
 */
let _supabasePhase2Checked = false
let _supabasePhase2Applied = false

async function isSupabaseLive(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !pub || !svc) return false
  if (url.includes('<') || pub.includes('<') || svc.includes('<')) return false

  if (_supabasePhase2Checked) return _supabasePhase2Applied

  _supabasePhase2Checked = true
  try {
    const admin = getAdminSupabase()
    // Use a real select (not head) so PostgREST returns an error when the
    // table doesn't exist in the schema cache.
    const { data, error } = await admin
      .from('vouchers')
      .select('id')
      .limit(1)
    // Table exists if no error AND we got an array (even if empty).
    _supabasePhase2Applied = !error && Array.isArray(data)
  } catch {
    _supabasePhase2Applied = false
  }
  return _supabasePhase2Applied
}

// Re-export VoucherError for API routes that import from this module.
export { VoucherError } from '@/lib/accounting/voucher'
export type { VoucherLineInput, PostVoucherInput } from '@/lib/accounting/voucher'

// Avoid unused import warning when db is only used in fallback paths.
void db
