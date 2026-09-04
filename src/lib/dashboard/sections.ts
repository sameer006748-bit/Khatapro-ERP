/**
 * Section order and visibility for the one shared command center.
 *
 * There is a single set of dashboard components; roles differ only in the
 * order sections appear and whether a section is shown at all. Decisions are
 * made from the permission set, matching how navigation already gates pages,
 * so a re-scoped role needs no change here.
 */

export type DashboardSectionId =
  | 'hero'
  | 'attention'
  | 'insights'
  | 'cash-position'
  | 'pulse'
  | 'breakdown'
  | 'activity'

/** Operational reading order: what needs doing, then how the business ran. */
const OPERATIONS_FIRST: DashboardSectionId[] = [
  'hero', 'attention', 'insights', 'cash-position', 'pulse', 'breakdown', 'activity',
]

/** Finance reading order: balances and interpreted money signals come first. */
const FINANCE_FIRST: DashboardSectionId[] = [
  'hero', 'cash-position', 'insights', 'attention', 'pulse', 'breakdown', 'activity',
]

/** A section is shown only when the viewer already has the underlying page. */
const SECTION_PERMISSIONS: Partial<Record<DashboardSectionId, string>> = {
  'cash-position': 'can_view_account_balances',
  breakdown: 'can_view_sales',
  activity: 'can_view_audit_log',
}

/** Page key → the permission navigation requires, for drill-down guarding. */
const DESTINATION_PERMISSIONS: Record<string, string> = {
  'sales-list': 'can_view_sales',
  purchases: 'can_view_purchases',
  inventory: 'can_view_products',
  accounts: 'can_view_account_balances',
  'business-accounts': 'can_view_setup',
  'day-book': 'can_view_day_book',
  delivery: 'can_view_delivery_orders',
  'expense-batch': 'can_create_expense_batch',
}

function pageKey(destination: string): string | null {
  const query = destination.split('?')[1]
  return query ? new URLSearchParams(query).get('page') : null
}

/**
 * Reads the books but does not administer the business — an accounting-focused
 * role. Derived from permissions, never from a role name.
 */
export function prefersFinanceFirstDashboard(permissions: string[]): boolean {
  return permissions.includes('can_view_trial_balance') && !permissions.includes('can_manage_setup')
}

export function resolveDashboardSections(permissions: string[]): DashboardSectionId[] {
  const order = prefersFinanceFirstDashboard(permissions) ? FINANCE_FIRST : OPERATIONS_FIRST
  return order.filter((section) => {
    const required = SECTION_PERMISSIONS[section]
    return !required || permissions.includes(required)
  })
}

/**
 * Whether a dashboard item may offer its drill-down. An unknown destination is
 * left open; navigation itself still fails closed on a page the role lacks.
 */
export function canOpenDashboardDestination(permissions: string[], destination: string): boolean {
  const key = pageKey(destination)
  if (!key) return true
  const required = DESTINATION_PERMISSIONS[key]
  return !required || permissions.includes(required)
}
