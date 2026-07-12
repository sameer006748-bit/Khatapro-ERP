/**
 * Phase 6 Vouchers data-access — Supabase RPCs for Payment/Receipt/Journal/Contra/Expense/Reverse/DayBook.
 * All money is BigInt paisas. UI sends paisas as strings.
 */
import 'server-only'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { resolveSupabaseUuid } from '@/lib/accounting/voucher-supabase'
import { bizDateString } from '@/lib/dates'

let _p6Checked = false
let _p6Live = false

async function isPhase6Live(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !svc || url.includes('<') || svc.includes('<')) return false
  if (_p6Checked) return _p6Live
  _p6Checked = true
  try {
    const admin = getAdminSupabase()
    const { data, error } = await admin.from('expenses').select('id').limit(1)
    _p6Live = !error && Array.isArray(data)
  } catch { _p6Live = false }
  return _p6Live
}

// ─── Post Payment Voucher ───
export async function postPaymentVoucher(input: {
  businessId: string; paymentDate: Date; paidFromAccountId: string; debitAccountId: string
  amountPaisas: bigint; vendorId?: string | null; reference?: string | null; notes?: string | null; createdBy?: string | null
}): Promise<{ paymentId: string; paymentNo: string; voucherId: string }> {
  const admin = getAdminSupabase()
  const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)
  const { data, error } = await admin.rpc('post_payment_voucher', {
    p_business_id: input.businessId,
    p_payment_date: bizDateString(input.paymentDate),
    p_paid_from_account_id: input.paidFromAccountId,
    p_debit_account_id: input.debitAccountId,
    p_amount_paisas: input.amountPaisas.toString(),
    p_vendor_id: input.vendorId ?? null,
    p_reference: input.reference ?? null,
    p_notes: input.notes ?? null,
    p_created_by: supabaseCreatedBy,
  })
  if (error) throw new Error(`post_payment_voucher: ${error.message}`)
  const r = data as any
  return { paymentId: r.payment_id, paymentNo: r.payment_no, voucherId: r.voucher_id }
}

// ─── Post Receipt Voucher ───
export async function postReceiptVoucher(input: {
  businessId: string; receiptDate: Date; receivedIntoAccountId: string; creditAccountId: string
  amountPaisas: bigint; customerId?: string | null; reference?: string | null; notes?: string | null; createdBy?: string | null
  invoiceId?: string | null
}): Promise<{ receiptId: string; receiptNo: string; voucherId: string }> {
  const admin = getAdminSupabase()
  const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)
  const { data, error } = await admin.rpc('post_receipt_voucher', {
    p_business_id: input.businessId,
    p_receipt_date: bizDateString(input.receiptDate),
    p_received_into_account_id: input.receivedIntoAccountId,
    p_credit_account_id: input.creditAccountId,
    p_amount_paisas: input.amountPaisas.toString(),
    p_customer_id: input.customerId ?? null,
    p_reference: input.reference ?? null,
    p_notes: input.notes ?? null,
    p_created_by: supabaseCreatedBy,
    p_invoice_id: input.invoiceId ?? null,
  })
  if (error) throw new Error(`post_receipt_voucher: ${error.message}`)
  const r = data as any
  return { receiptId: r.receipt_id, receiptNo: r.receipt_no, voucherId: r.voucher_id }
}

// ─── Post Journal Voucher ───
export async function postJournalVoucher(input: {
  businessId: string; jvDate: Date; memo: string
  lines: Array<{ accountId: string; debit: bigint; credit: bigint; memo?: string | null }>
  reference?: string | null; createdBy?: string | null
}): Promise<{ voucherId: string; voucherNo: string }> {
  const admin = getAdminSupabase()
  const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)
  const linesJson = input.lines.map(l => ({
    account_id: l.accountId,
    debit: l.debit.toString(),
    credit: l.credit.toString(),
    memo: l.memo ?? null,
  }))
  const { data, error } = await admin.rpc('post_journal_voucher', {
    p_business_id: input.businessId,
    p_jv_date: bizDateString(input.jvDate),
    p_memo: input.memo,
    p_lines: linesJson,
    p_reference: input.reference ?? null,
    p_created_by: supabaseCreatedBy,
  })
  if (error) throw new Error(`post_journal_voucher: ${error.message}`)
  const r = data as any
  return { voucherId: r.voucher_id, voucherNo: r.voucher_no }
}

// ─── Post Contra Entry ───
export async function postContraEntry(input: {
  businessId: string; contraDate: Date; fromAccountId: string; toAccountId: string
  amountPaisas: bigint; reference?: string | null; notes?: string | null; createdBy?: string | null
}): Promise<{ contraId: string; contraNo: string; voucherId: string }> {
  const admin = getAdminSupabase()
  const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)
  const { data, error } = await admin.rpc('post_contra_entry', {
    p_business_id: input.businessId,
    p_contra_date: bizDateString(input.contraDate),
    p_from_account_id: input.fromAccountId,
    p_to_account_id: input.toAccountId,
    p_amount_paisas: input.amountPaisas.toString(),
    p_reference: input.reference ?? null,
    p_notes: input.notes ?? null,
    p_created_by: supabaseCreatedBy,
  })
  if (error) throw new Error(`post_contra_entry: ${error.message}`)
  const r = data as any
  return { contraId: r.contra_id, contraNo: r.contra_no, voucherId: r.voucher_id }
}

// ─── Post Expense Batch ───
export async function postExpenseBatch(input: {
  businessId: string; expenseDate: Date; paymentAccountId: string
  lines: Array<{ expenseAccountId: string; description?: string | null; amountPaisas: bigint }>
  reference?: string | null; notes?: string | null; createdBy?: string | null
}): Promise<{ expenseId: string; expenseNo: string; voucherId: string }> {
  const admin = getAdminSupabase()
  const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)
  const linesJson = input.lines.map(l => ({
    expense_account_id: l.expenseAccountId,
    description: l.description ?? null,
    amount_paisas: l.amountPaisas.toString(),
  }))
  const { data, error } = await admin.rpc('post_expense_batch', {
    p_business_id: input.businessId,
    p_expense_date: bizDateString(input.expenseDate),
    p_payment_account_id: input.paymentAccountId,
    p_lines: linesJson,
    p_reference: input.reference ?? null,
    p_notes: input.notes ?? null,
    p_created_by: supabaseCreatedBy,
  })
  if (error) throw new Error(`post_expense_batch: ${error.message}`)
  const r = data as any
  return { expenseId: r.expense_id, expenseNo: r.expense_no, voucherId: r.voucher_id }
}

// ─── Reverse Voucher (safe — blocks source-controlled documents) ───
export async function reverseVoucher(input: {
  businessId: string; voucherId: string; reason?: string | null; createdBy?: string | null
}): Promise<{ blocked: boolean; blockReason?: string; reversalVoucherId?: string }> {
  const admin = getAdminSupabase()
  const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)
  const { data, error } = await admin.rpc('reverse_voucher_safe', {
    p_voucher_id: input.voucherId,
    p_business_id: input.businessId,
    p_cancelled_by: supabaseCreatedBy,
    p_reason: input.reason ?? null,
  })
  if (error) throw new Error(`reverse_voucher_safe: ${error.message}`)
  const r = data as any
  if (r.blocked) return { blocked: true, blockReason: r.block_reason }
  return { blocked: false, reversalVoucherId: r.reversal_voucher_id }
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
  const { data, error } = await admin.rpc('day_book', {
    p_business_id: businessId,
    p_from_date: filters?.fromDate ?? null,
    p_to_date: filters?.toDate ?? null,
    p_voucher_type: filters?.voucherType ?? null,
  })
  if (error) throw new Error(`day_book: ${error.message}`)
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
    const { data, error } = await admin.from('vouchers')
      .select(`id, voucher_no, voucher_type, voucher_date, memo, is_cancelled, posted_at, posted_by,
               total_debit, total_credit, reference_type, reference_id, cancel_voucher_id,
               voucher_lines!inner(id, account_id, debit, credit, memo, line_order,
                 account:accounts(id, code, name, category:account_categories(code)))`)
      .eq('id', voucherId).eq('business_id', businessId).maybeSingle()
    if (error || !data) return null
    const v = data as any
    return {
      id: v.id,
      voucherNo: v.voucher_no,
      voucherType: v.voucher_type,
      voucherDate: v.voucher_date,
      memo: v.memo,
      isCancelled: v.is_cancelled,
      postedAt: v.posted_at,
      postedBy: v.posted_by,
      totalDebit: String(v.total_debit),
      totalCredit: String(v.total_credit),
      referenceType: v.reference_type,
      referenceId: v.reference_id,
      cancelVoucherId: v.cancel_voucher_id,
      lines: (v.voucher_lines ?? []).sort((a: any, b: any) => (a.line_order ?? 0) - (b.line_order ?? 0)).map((l: any) => ({
        id: l.id,
        accountId: l.account_id,
        accountCode: l.account?.code ?? '',
        accountName: l.account?.name ?? '',
        categoryCode: l.account?.category?.code ?? '',
        debit: String(l.debit),
        credit: String(l.credit),
        memo: l.memo,
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
  const { data, error } = await admin.from('expenses')
    .select(`id, expense_no, expense_date, payment_account_id, total_amount, reference, notes, status, voucher_id,
             expense_lines(id, expense_account_id, description, amount)`)
    .eq('business_id', businessId)
    .order('expense_date', { ascending: false }).order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listExpenses: ${error.message}`)
  return (data ?? []).map((r: any) => ({
    id: r.id,
    expenseNo: r.expense_no,
    expenseDate: r.expense_date,
    paymentAccountId: r.payment_account_id,
    totalAmount: String(r.total_amount),
    reference: r.reference,
    notes: r.notes,
    status: r.status,
    voucherId: r.voucher_id,
    lines: (r.expense_lines ?? []).map((l: any) => ({
      id: l.id,
      expenseAccountId: l.expense_account_id,
      description: l.description,
      amount: String(l.amount),
    })),
  }))
}

// ─── Get account balance from voucher_lines (for Petty Cash balance) ───
export async function getAccountBalance(businessId: string, accountId: string): Promise<bigint> {
  const admin = getAdminSupabase()
  // Get all non-cancelled voucher_ids for this business
  const { data: vouchers } = await admin.from('vouchers')
    .select('id').eq('business_id', businessId).eq('is_cancelled', false)
  const voucherIds = (vouchers ?? []).map((v: any) => v.id)
  if (voucherIds.length === 0) return 0n
  const { data, error } = await admin.from('voucher_lines')
    .select('debit, credit')
    .eq('account_id', accountId)
    .in('voucher_id', voucherIds)
  if (error) return 0n
  let debit = 0n; let credit = 0n
  for (const l of data ?? []) { debit += BigInt(l.debit); credit += BigInt(l.credit) }
  return debit - credit
}
