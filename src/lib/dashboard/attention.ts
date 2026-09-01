export type AttentionSeverity = 'critical' | 'due-soon' | 'watch'

export type DashboardAttentionItem = {
  id: string
  kind: 'negative-stock' | 'low-stock' | 'payment-account'
  title: string
  detail: string
  severity: AttentionSeverity
  urgency: number
  destination: string
  actionLabel: string
}

type StockProduct = {
  id: string
  name: string
  currentStock: number
  lowStockThreshold?: number
}

const severityOrder: Record<AttentionSeverity, number> = {
  critical: 0,
  'due-soon': 1,
  watch: 2,
}

/**
 * Keeps the command queue predictable even when a future supported source
 * contributes a Due Soon item. Higher urgency wins within one severity.
 */
export function sortDashboardAttention(items: DashboardAttentionItem[]) {
  return [...items].sort((a, b) =>
    severityOrder[a.severity] - severityOrder[b.severity]
    || b.urgency - a.urgency
    || a.title.localeCompare(b.title),
  )
}

/**
 * Attention is deliberately limited to conditions already present in the
 * owner-dashboard payload. There is no supported due-date source in this
 * payload yet, so this function does not infer a "Due Soon" condition.
 */
export function buildDashboardAttention(input: {
  negativeStockProducts: StockProduct[]
  lowStockProducts: StockProduct[]
  paymentAccounts: { activeCount: number | null; state: 'available' | 'not-tracked' | 'error' }
}) {
  const items: DashboardAttentionItem[] = [
    ...input.negativeStockProducts.map((product) => ({
      id: `negative-${product.id}`,
      kind: 'negative-stock' as const,
      title: `${product.name} has negative stock`,
      detail: `${product.currentStock} units recorded`,
      severity: 'critical' as const,
      urgency: Math.abs(product.currentStock),
      destination: '/?page=inventory',
      actionLabel: 'Review Stock',
    })),
    ...(input.paymentAccounts.state === 'available' && input.paymentAccounts.activeCount === 0
      ? [{
          id: 'payment-accounts',
          kind: 'payment-account' as const,
          title: 'No active payment account',
          detail: 'Add or activate a business account to receive payments.',
          severity: 'critical' as const,
          urgency: Number.MAX_SAFE_INTEGER,
          destination: '/?page=business-accounts',
          actionLabel: 'Open Business Accounts',
        }]
      : []),
    ...input.lowStockProducts.map((product) => ({
      id: `low-${product.id}`,
      kind: 'low-stock' as const,
      title: `${product.name} is low in stock`,
      detail: `${product.currentStock} remaining; threshold ${product.lowStockThreshold}`,
      severity: 'watch' as const,
      urgency: (product.lowStockThreshold ?? 0) - product.currentStock,
      destination: '/?page=inventory',
      actionLabel: 'Review Stock',
    })),
  ]

  return sortDashboardAttention(items)
}

/**
 * The payload lists a bounded sample of affected products but counts them all.
 * Business Insights used to restate those totals as its own card; stating the
 * remainder here keeps the total visible without a duplicate section.
 */
export function describeAttentionOverflow(input: {
  negativeStockProducts: StockProduct[]
  lowStockProducts: StockProduct[]
  negativeStockCount: number | null
  lowStockCount: number | null
}): string | null {
  const parts: string[] = []
  const negativeHidden = (input.negativeStockCount ?? 0) - input.negativeStockProducts.length
  const lowHidden = (input.lowStockCount ?? 0) - input.lowStockProducts.length
  if (negativeHidden > 0) parts.push(`${negativeHidden} more with negative stock`)
  if (lowHidden > 0) parts.push(`${lowHidden} more below their stock threshold`)
  return parts.length === 0 ? null : `${parts.join(' and ')} are not listed here.`
}
