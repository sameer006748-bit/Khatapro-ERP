export type AccountSubcategory = {
  id: string
  label: string
}

export type AccountCategoryDefinition = {
  id: string
  label: string
  subcategories: readonly AccountSubcategory[]
}

/**
 * System-defined presentation categories. IDs are deliberately stable and
 * separate from display labels; this layer never writes accounting records.
 */
export const ACCOUNT_CATEGORY_DEFINITIONS = [
  { id: 'sales', label: 'Sales', subcategories: [{ id: 'counter-sale', label: 'Counter Sale' }, { id: 'online-sale', label: 'Online Sale' }, { id: 'ofc-sale', label: 'OFC Sale' }] },
  { id: 'expenses', label: 'Expenses', subcategories: [{ id: 'rent', label: 'Rent' }, { id: 'salary', label: 'Salary' }, { id: 'utilities', label: 'Utilities' }, { id: 'delivery', label: 'Delivery' }, { id: 'marketing', label: 'Marketing' }, { id: 'miscellaneous', label: 'Miscellaneous' }] },
  { id: 'accounts-receivable', label: 'Accounts Receivable', subcategories: [{ id: 'customer-collections', label: 'Customer Collections' }] },
  { id: 'accounts-payable', label: 'Accounts Payable', subcategories: [{ id: 'vendor-payments', label: 'Vendor Payments' }] },
  { id: 'purchases', label: 'Purchases', subcategories: [{ id: 'stock-purchases', label: 'Stock Purchases' }, { id: 'purchase-returns', label: 'Purchase Returns' }] },
  { id: 'capital', label: 'Capital', subcategories: [{ id: 'owner-capital', label: 'Owner Capital' }, { id: 'drawings', label: 'Drawings' }] },
  { id: 'current-assets', label: 'Current Assets', subcategories: [{ id: 'cash', label: 'Cash' }, { id: 'bank', label: 'Bank' }, { id: 'wallet', label: 'Wallet' }, { id: 'petty-cash', label: 'Petty Cash' }] },
  { id: 'salesman', label: 'Salesman', subcategories: [{ id: 'commissions', label: 'Commissions' }, { id: 'payouts', label: 'Payouts' }] },
] as const satisfies readonly AccountCategoryDefinition[]

export const UNCATEGORIZED_CATEGORY = { id: 'uncategorized', label: 'Uncategorized', subcategories: [] } as const

export type MoneyActivity = {
  voucherId: string
  voucherType?: string | null
  memo?: string | null
  sourceLabel?: string | null
  voucherDate?: string | null
  totalDebit?: string | number | bigint | null
  totalCredit?: string | number | bigint | null
}

export type ClassifiedMoneyActivity = {
  activity: MoneyActivity
  parentId: string
  subcategoryId?: string
  amount: bigint
}

export type AccountCategorySummary = {
  parentId: string
  subcategoryId?: string
  amount: bigint
  activityCount: number
}

function amount(value: MoneyActivity['totalDebit']): bigint {
  try { return BigInt(value ?? 0) } catch { return 0n }
}

/** Classifies only reliable, already-loaded operational voucher types. */
export function classifyMoneyActivity(activity: MoneyActivity): ClassifiedMoneyActivity {
  const type = activity.voucherType
  if (type === 'SI') return { activity, parentId: 'sales', amount: amount(activity.totalDebit) }
  if (type === 'EX') return { activity, parentId: 'expenses', subcategoryId: 'miscellaneous', amount: amount(activity.totalCredit) }
  if (type === 'RC') return { activity, parentId: 'accounts-receivable', subcategoryId: 'customer-collections', amount: amount(activity.totalDebit) }
  if (type === 'PM') return { activity, parentId: 'accounts-payable', subcategoryId: 'vendor-payments', amount: amount(activity.totalCredit) }
  if (type === 'PU') return { activity, parentId: 'purchases', subcategoryId: 'stock-purchases', amount: amount(activity.totalCredit) }
  if (type === 'PR') return { activity, parentId: 'purchases', subcategoryId: 'purchase-returns', amount: amount(activity.totalDebit) }
  if (type === 'CT') return { activity, parentId: 'current-assets', amount: amount(activity.totalDebit) }
  return { activity, parentId: UNCATEGORIZED_CATEGORY.id, amount: amount(activity.totalDebit) || amount(activity.totalCredit) }
}

export function summarizeAccountSubcategories(activities: readonly MoneyActivity[]): AccountCategorySummary[] {
  const totals = new Map<string, AccountCategorySummary>()
  for (const parent of ACCOUNT_CATEGORY_DEFINITIONS) {
    totals.set(parent.id, { parentId: parent.id, amount: 0n, activityCount: 0 })
    for (const subcategory of parent.subcategories) totals.set(`${parent.id}:${subcategory.id}`, { parentId: parent.id, subcategoryId: subcategory.id, amount: 0n, activityCount: 0 })
  }
  totals.set(UNCATEGORIZED_CATEGORY.id, { parentId: UNCATEGORIZED_CATEGORY.id, amount: 0n, activityCount: 0 })
  for (const entry of activities.map(classifyMoneyActivity)) {
    const parent = totals.get(entry.parentId)!
    parent.amount += entry.amount; parent.activityCount += 1
    if (entry.subcategoryId) {
      const child = totals.get(`${entry.parentId}:${entry.subcategoryId}`)!
      child.amount += entry.amount; child.activityCount += 1
    }
  }
  return [...totals.values()]
}

export function matchesAccountSubcategory(entry: ClassifiedMoneyActivity, parentId: string, subcategoryId?: string): boolean {
  return entry.parentId === parentId && (subcategoryId === undefined || entry.subcategoryId === subcategoryId)
}
