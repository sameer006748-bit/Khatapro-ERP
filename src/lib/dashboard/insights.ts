export type DashboardInsight = {
  id: 'negative-cash' | 'negative-stock' | 'low-stock' | 'payment-account'
  title: string
  detail: string
  destination: string
  actionLabel: string
  priority: number
}

/**
 * Uses only values already present in the dashboard payload. These are factual
 * signals, not predictions or inferred thresholds.
 */
export function buildDashboardInsights(input: {
  netCashMovement: number | null
  netCashMovementAvailable: boolean
  negativeStockCount: number | null
  lowStockCount: number | null
  paymentAccounts: { activeCount: number | null; state: 'available' | 'not-tracked' | 'error' }
}) {
  const insights: DashboardInsight[] = []

  if (input.netCashMovementAvailable && input.netCashMovement !== null && input.netCashMovement < 0) {
    insights.push({
      id: 'negative-cash',
      title: 'Cash movement is negative for this period.',
      detail: 'More money moved out than in.',
      destination: '/?page=accounts',
      actionLabel: 'View Money',
      priority: 0,
    })
  }
  if ((input.negativeStockCount ?? 0) > 0) {
    insights.push({
      id: 'negative-stock',
      title: `${input.negativeStockCount} product${input.negativeStockCount === 1 ? '' : 's'} have negative stock.`,
      detail: 'Stock quantity needs correction.',
      destination: '/?page=inventory',
      actionLabel: 'Review Stock',
      priority: 1,
    })
  }
  if ((input.lowStockCount ?? 0) > 0) {
    insights.push({
      id: 'low-stock',
      title: `${input.lowStockCount} item${input.lowStockCount === 1 ? '' : 's'} are below their stock threshold.`,
      detail: 'Each threshold is configured per product.',
      destination: '/?page=inventory',
      actionLabel: 'Review Stock',
      priority: 2,
    })
  }
  if (input.paymentAccounts.state === 'available' && input.paymentAccounts.activeCount === 0) {
    insights.push({
      id: 'payment-account',
      title: 'No active payment account is available.',
      detail: 'Add or activate an account to receive payments.',
      destination: '/?page=business-accounts',
      actionLabel: 'Open Business Accounts',
      priority: 3,
    })
  }

  return insights.sort((a, b) => a.priority - b.priority)
}
