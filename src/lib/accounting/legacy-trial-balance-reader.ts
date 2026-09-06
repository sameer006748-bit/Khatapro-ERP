import 'server-only'

import { aggregateLegacyTrialBalance, type LegacyTrialBalanceLine } from '@/lib/accounting/legacy-trial-balance'
import { getAdminSupabase } from '@/lib/supabase/admin'

const PAGE_SIZE = 1000

async function readPostedLines(
  businessId: string,
  fromDate?: string | null,
  toDate?: string | null,
): Promise<LegacyTrialBalanceLine[]> {
  const admin = getAdminSupabase()
  const rows: LegacyTrialBalanceLine[] = []

  for (let start = 0; ; start += PAGE_SIZE) {
    let query: any = admin
      .from('voucher_lines')
      .select('id, account_id, debit, credit, vouchers!inner(voucher_date, is_cancelled, business_id)')
      .eq('business_id', businessId)
      .eq('vouchers.business_id', businessId)
      .eq('vouchers.is_cancelled', false)
      .order('id', { ascending: true })
      .range(start, start + PAGE_SIZE - 1)

    if (fromDate) query = query.gte('vouchers.voucher_date', fromDate)
    if (toDate) query = query.lte('vouchers.voucher_date', toDate)

    const { data, error } = await query
    if (error) throw new Error(`Trial Balance posted lines failed: ${error.message}`)
    const page = (data ?? []) as Array<{ account_id: string; debit: string | number; credit: string | number }>
    rows.push(...page.map((line) => ({
      accountId: line.account_id,
      debit: line.debit ?? 0,
      credit: line.credit ?? 0,
    })))
    if (page.length < PAGE_SIZE) break
  }

  return rows
}

/**
 * Correct legacy Trial Balance reader. The deployed `trial_balance` RPC drops
 * inactive accounts with history and places voucher filters on a LEFT JOIN,
 * so its sums ignore both cancellation and date boundaries.
 */
export async function readLegacyTrialBalance(
  businessId: string,
  fromDate?: string | null,
  toDate?: string | null,
) {
  const admin = getAdminSupabase()
  const [categoryResult, accountResult, lines] = await Promise.all([
    admin
      .from('account_categories')
      .select('id, code, name, type')
      .eq('business_id', businessId),
    admin
      .from('accounts')
      .select('id, code, name, category_id, is_active')
      .eq('business_id', businessId),
    readPostedLines(businessId, fromDate, toDate),
  ])

  if (categoryResult.error) throw new Error(`Trial Balance categories failed: ${categoryResult.error.message}`)
  if (accountResult.error) throw new Error(`Trial Balance accounts failed: ${accountResult.error.message}`)

  const categories = new Map((categoryResult.data ?? []).map((category) => [category.id, category]))
  const accounts = (accountResult.data ?? []).map((account) => {
    const category = categories.get(account.category_id)
    if (!category) throw new Error(`Trial Balance account has no business category: ${account.id}`)
    return {
      id: account.id,
      code: account.code,
      name: account.name,
      isActive: account.is_active !== false,
      category: { code: category.code, name: category.name, type: category.type },
    }
  })

  return aggregateLegacyTrialBalance(accounts, lines)
}
