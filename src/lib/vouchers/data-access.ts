/**
 * Phase 6 Vouchers data-access — Supabase RPCs for Payment/Receipt/Journal/Contra/Expense/Reverse/DayBook.
 * All money is BigInt paisas. UI sends paisas as strings.
 */
import 'server-only'
import { randomUUID } from 'crypto'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { resolveSupabaseUuid } from '@/lib/accounting/voucher-supabase'
import { bizDateString } from '@/lib/dates'
import { probeTable } from '@/lib/supabase/phase-probe'

const _p6cache = { lastChecked: 0, lastResult: false }

async function isPhase6Live(): Promise<boolean> {
  return probeTable(_p6cache, 'ledger_vouchers')
}

async function postCanonicalVoucher(input: {
  businessId: string
  voucherType: string
  date: Date
  narration: string
  lines: Array<{ accountId: string; debit: bigint; credit: bigint; narration?: string | null }>
  sourceType?: string | null
  sourceId?: string | null
  reference?: string | null
  idempotencyKey?: string | null
  actorId?: string | null
}) {
  const actorId = await resolveSupabaseUuid(input.actorId)
  if (!actorId) throw new Error('Server-attributed voucher actor is unavailable')
  const { data, error } = await getAdminSupabase().rpc('post_ledger_voucher', {
    p_business_id: input.businessId,
    p_voucher_type: input.voucherType,
    p_transaction_date: bizDateString(input.date),
    p_narration: input.narration,
    p_lines: input.lines.map((line, index) => ({
      account_id: line.accountId,
      debit_paisas: line.debit.toString(),
      credit_paisas: line.credit.toString(),
      line_narration: line.narration ?? null,
      source_line_reference: String(index + 1),
    })),
    p_source_type: input.sourceType ?? null,
    p_source_id: input.sourceId ?? null,
    p_idempotency_key: input.idempotencyKey ?? randomUUID(),
    p_posted_by: actorId,
    p_reference: input.reference ?? null,
    p_readable_number: null,
    p_reverses_voucher_id: null,
  })
  if (error) throw new Error(`post_ledger_voucher: ${error.message}`)
  return data as { voucher_id: string; readable_number: string; idempotent: boolean }
}

// ─── Post Payment Voucher ───
export async function postPaymentVoucher(input: {
  businessId: string; paymentDate: Date; paidFromAccountId: string; debitAccountId: string
  amountPaisas: bigint; vendorId?: string | null; reference?: string | null; notes?: string | null; createdBy?: string | null
  idempotencyKey?: string | null
}): Promise<{ paymentId: string; paymentNo: string; voucherId: string }> {
  const result = await postCanonicalVoucher({
    businessId: input.businessId,
    voucherType: 'PV',
    date: input.paymentDate,
    narration: input.notes ?? 'Payment voucher',
    lines: [
      { accountId: input.debitAccountId, debit: input.amountPaisas, credit: 0n, narration: 'Payment debit' },
      { accountId: input.paidFromAccountId, debit: 0n, credit: input.amountPaisas, narration: 'Funds paid' },
    ],
    sourceType: input.vendorId && input.idempotencyKey ? 'vendor_payment' : null,
    sourceId: input.vendorId && input.idempotencyKey ? `${input.vendorId}:${input.idempotencyKey}` : null,
    reference: input.reference,
    idempotencyKey: input.idempotencyKey,
    actorId: input.createdBy,
  })
  return {
    paymentId: result.voucher_id,
    paymentNo: result.readable_number,
    voucherId: result.voucher_id,
  }
}

// ─── Post Receipt Voucher ───
// Phase 8 supports basic receipts only. Allocation and retry inputs remain in
// this boundary type solely so stale callers can be rejected without data loss.
export async function postReceiptVoucher(input: {
  businessId: string; receiptDate: Date; receivedIntoAccountId: string; creditAccountId: string
  amountPaisas: bigint; customerId?: string | null; reference?: string | null; notes?: string | null; createdBy?: string | null
  invoiceId?: string | null
  allocations?: Array<{ invoiceId: string; allocatedAmount: bigint }> | null
  idempotencyKey?: string | null
}): Promise<{ receiptId: string; receiptNo: string; voucherId: string }> {
  if (input.allocations?.length) {
    throw new Error('Receipt allocations require the invoice-specific collection workflow')
  }
  const result = await postCanonicalVoucher({
    businessId: input.businessId,
    voucherType: 'RV',
    date: input.receiptDate,
    narration: input.notes ?? 'Receipt voucher',
    lines: [
      { accountId: input.receivedIntoAccountId, debit: input.amountPaisas, credit: 0n, narration: 'Funds received' },
      { accountId: input.creditAccountId, debit: 0n, credit: input.amountPaisas, narration: 'Receipt credit' },
    ],
    sourceType: input.invoiceId ? 'invoice_receipt' : null,
    sourceId: input.invoiceId ?? null,
    reference: input.reference,
    idempotencyKey: input.idempotencyKey,
    actorId: input.createdBy,
  })
  return {
    receiptId: result.voucher_id,
    receiptNo: result.readable_number,
    voucherId: result.voucher_id,
  }
}

// ─── Post Journal Voucher ───
export async function postJournalVoucher(input: {
  businessId: string; jvDate: Date; memo: string
  lines: Array<{ accountId: string; debit: bigint; credit: bigint; memo?: string | null }>
  reference?: string | null; createdBy?: string | null
  idempotencyKey?: string | null
}): Promise<{ voucherId: string; voucherNo: string }> {
  const result = await postCanonicalVoucher({
    businessId: input.businessId,
    voucherType: 'JV',
    date: input.jvDate,
    narration: input.memo,
    lines: input.lines.map(line => ({
      accountId: line.accountId,
      debit: line.debit,
      credit: line.credit,
      narration: line.memo,
    })),
    reference: input.reference,
    idempotencyKey: input.idempotencyKey,
    actorId: input.createdBy,
  })
  return { voucherId: result.voucher_id, voucherNo: result.readable_number }
}

// ─── Post Contra Entry ───
export async function postContraEntry(input: {
  businessId: string; contraDate: Date; fromAccountId: string; toAccountId: string
  amountPaisas: bigint; reference?: string | null; notes?: string | null; createdBy?: string | null
  idempotencyKey?: string | null
}): Promise<{ contraId: string; contraNo: string; voucherId: string }> {
  const result = await postCanonicalVoucher({
    businessId: input.businessId,
    voucherType: 'CT',
    date: input.contraDate,
    narration: input.notes ?? 'Contra transfer',
    lines: [
      { accountId: input.toAccountId, debit: input.amountPaisas, credit: 0n, narration: 'Transfer in' },
      { accountId: input.fromAccountId, debit: 0n, credit: input.amountPaisas, narration: 'Transfer out' },
    ],
    reference: input.reference,
    idempotencyKey: input.idempotencyKey,
    actorId: input.createdBy,
  })
  return {
    contraId: result.voucher_id,
    contraNo: result.readable_number,
    voucherId: result.voucher_id,
  }
}

// ─── Post Expense Batch ───
export async function postExpenseBatch(input: {
  businessId: string; expenseDate: Date; paymentAccountId: string
  lines: Array<{ expenseAccountId: string; description?: string | null; amountPaisas: bigint }>
  reference?: string | null; notes?: string | null; createdBy?: string | null
  idempotencyKey?: string | null
}): Promise<{ expenseId: string; expenseNo: string; voucherId: string }> {
  const total = input.lines.reduce((sum, line) => sum + line.amountPaisas, 0n)
  const result = await postCanonicalVoucher({
    businessId: input.businessId,
    voucherType: 'EXP',
    date: input.expenseDate,
    narration: input.notes ?? 'Expense batch',
    lines: [
      ...input.lines.map(line => ({
        accountId: line.expenseAccountId,
        debit: line.amountPaisas,
        credit: 0n,
        narration: line.description,
      })),
      {
        accountId: input.paymentAccountId,
        debit: 0n,
        credit: total,
        narration: 'Expense payment',
      },
    ],
    reference: input.reference,
    idempotencyKey: input.idempotencyKey,
    actorId: input.createdBy,
  })
  return {
    expenseId: result.voucher_id,
    expenseNo: result.readable_number,
    voucherId: result.voucher_id,
  }
}

// ─── Reverse Voucher (safe — blocks source-controlled documents) ───
export async function reverseVoucher(input: {
  businessId: string; voucherId: string; reason?: string | null; createdBy?: string | null
}): Promise<{ blocked: boolean; blockReason?: string; reversalVoucherId?: string }> {
  const admin = getAdminSupabase()
  const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)
  const { data, error } = await admin.rpc('reverse_ledger_voucher', {
    p_business_id: input.businessId,
    p_voucher_id: input.voucherId,
    p_reversal_date: bizDateString(new Date()),
    p_reason: input.reason ?? 'Correction',
    p_idempotency_key: `reversal:${input.voucherId}`,
    p_posted_by: supabaseCreatedBy,
  })
  if (error) throw new Error(`reverse_ledger_voucher: ${error.message}`)
  const r = data as { voucher_id: string }
  return { blocked: false, reversalVoucherId: r.voucher_id }
}

// ─── Day Book ───
export type DayBookRow = {
  voucherId: string; voucherNo: string | null; voucherType: string; voucherDate: string
  memo: string | null; totalDebit: string; totalCredit: string; isCancelled: boolean
  postedAt: string; postedBy: string | null; referenceType: string | null; referenceId: string | null
  sourceLabel: string
  lines: Array<{
    lineId: string; accountId: string; accountCode: string; accountName: string
    debit: string; credit: string; memo: string | null
  }>
}

export async function dayBook(
  businessId: string,
  filters?: { fromDate?: string | null; toDate?: string | null; voucherType?: string | null },
): Promise<DayBookRow[]> {
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('ledger_day_book', {
    p_business_id: businessId,
    p_from_date: filters?.fromDate ?? null,
    p_to_date: filters?.toDate ?? null,
    p_voucher_type: filters?.voucherType ?? null,
  })
  if (error) throw new Error(`ledger_day_book: ${error.message}`)
  if (!data || !Array.isArray(data)) return []
  return (data as any[]).map(r => ({
    voucherId: r.voucher_id,
    voucherNo: r.voucher_no,
    voucherType: r.voucher_type,
    voucherDate: r.voucher_date,
    memo: r.memo,
    totalDebit: String(r.total_debit ?? '0'),
    totalCredit: String(r.total_credit ?? '0'),
    isCancelled: r.is_cancelled,
    postedAt: r.posted_at,
    postedBy: r.posted_by,
    referenceType: r.reference_type,
    referenceId: r.reference_id,
    sourceLabel: r.source_label,
    lines: (r.lines ?? []).map((l: any) => ({
      lineId: l.line_id,
      accountId: l.account_id,
      accountCode: l.account_code,
      accountName: l.account_name,
      debit: String(l.debit ?? '0'),
      credit: String(l.credit ?? '0'),
      memo: l.memo,
    })),
  }))
}

// ─── Get Voucher Detail (with lines + reversal info) ───
export type VoucherDetail = {
  id: string; voucherNo: string | null; voucherType: string; voucherDate: string
  memo: string | null; isCancelled: boolean; postedAt: string; postedBy: string | null
  totalDebit: string; totalCredit: string
  referenceType: string | null; referenceId: string | null
  cancelVoucherId: string | null
  lines: Array<{
    id: string; accountId: string; accountCode: string; accountName: string
    categoryCode: string; debit: string; credit: string; memo: string | null
  }>
}

export async function getVoucherDetail(businessId: string, voucherId: string): Promise<VoucherDetail | null> {
  if (await isPhase6Live()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin.from('ledger_vouchers')
      .select(`id, readable_number, voucher_type, transaction_date, narration, posted_at, posted_by,
               total_debit_paisas, total_credit_paisas, source_type, source_id, reverses_voucher_id,
               ledger_voucher_lines!inner(id, account_id, debit_paisas, credit_paisas, line_narration, line_number,
                 account:ledger_accounts(id, account_code, account_name, category:ledger_account_categories(stable_code)))`)
      .eq('id', voucherId).eq('business_id', businessId).maybeSingle()
    if (error || !data) return null
    const v = data as any
    return {
      id: v.id,
      voucherNo: v.readable_number,
      voucherType: v.voucher_type,
      voucherDate: v.transaction_date,
      memo: v.narration,
      isCancelled: false,
      postedAt: v.posted_at,
      postedBy: v.posted_by,
      totalDebit: String(v.total_debit_paisas),
      totalCredit: String(v.total_credit_paisas),
      referenceType: v.source_type,
      referenceId: v.source_id,
      cancelVoucherId: v.reverses_voucher_id,
      lines: (v.ledger_voucher_lines ?? []).sort((a: any, b: any) => (a.line_number ?? 0) - (b.line_number ?? 0)).map((l: any) => ({
        id: l.id,
        accountId: l.account_id,
        accountCode: l.account?.account_code ?? '',
        accountName: l.account?.account_name ?? '',
        categoryCode: l.account?.category?.stable_code ?? '',
        debit: String(l.debit_paisas),
        credit: String(l.credit_paisas),
        memo: l.line_narration,
      })),
    }
  }
  return null
}

// ─── List Expenses (for Petty Cash workspace + general listing) ───
export type ExpenseRow = {
  id: string; expenseNo: string; expenseDate: string; paymentAccountId: string
  totalAmount: string; reference: string | null; notes: string | null; status: string
  voucherId: string | null
  lines: Array<{ id: string; expenseAccountId: string; description: string | null; amount: string }>
}

export async function listExpenses(businessId: string, limit = 100): Promise<ExpenseRow[]> {
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('ledger_day_book', {
    p_business_id: businessId,
    p_from_date: null,
    p_to_date: null,
    p_voucher_type: 'EXP',
  })
  if (error) throw new Error(`listExpenses: ${error.message}`)
  return (data ?? []).slice(0, limit).map((row: any) => {
    const debitLines = (row.lines ?? []).filter((line: any) => BigInt(line.debit ?? 0) > 0n)
    const paymentLine = (row.lines ?? []).find((line: any) => BigInt(line.credit ?? 0) > 0n)
    return {
      id: row.voucher_id,
      expenseNo: row.voucher_no,
      expenseDate: row.voucher_date,
      paymentAccountId: paymentLine?.account_id ?? '',
      totalAmount: String(row.total_debit ?? '0'),
      reference: row.source_label ?? null,
      notes: row.memo ?? null,
      status: 'posted',
      voucherId: row.voucher_id,
      lines: debitLines.map((line: any) => ({
        id: line.line_id,
        expenseAccountId: line.account_id,
        description: line.memo,
        amount: String(line.debit ?? '0'),
      })),
    }
  })
}

// ─── Get account balance from voucher_lines (for Petty Cash balance) ───
export async function getAccountBalance(businessId: string, accountId: string): Promise<bigint> {
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('ledger_account_balance_paisas', {
    p_business_id: businessId,
    p_account_id: accountId,
    p_as_of_date: null,
  })
  if (error || data === null) return 0n
  return BigInt(data as string | number)
}
