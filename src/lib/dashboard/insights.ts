import type { MetricComparison } from './trends'

export type DashboardInsight = {
  id: 'negative-cash' | 'sales-trend' | 'cash-trend'
  title: string
  detail: string
  destination: string
  actionLabel: string
  priority: number
}

/**
 * Interpreted signals only — a relation between measured values, never a raw
 * value repeated from another section.
 *
 * Stock counts and the missing-payment-account condition used to live here as
 * well. They are actionable problems, so Needs Attention owns them: keeping a
 * second copy here restated the same rows one card lower. Everything below is
 * derived from values the payload actually measured, and a signal is dropped
 * outright rather than approximated.
 *
 * `formatAmount` is injected so this module stays free of UI dependencies and
 * so money is rendered by the app's single canonical formatter.
 */
export function buildDashboardInsights(input: {
  netCashMovement: number | null
  netCashMovementAvailable: boolean
  salesComparison: MetricComparison | null
  netCashComparison: MetricComparison | null
  previousPeriodLabel: string | null
  formatAmount: (paisas: number) => string
}) {
  const insights: DashboardInsight[] = []
  const label = input.previousPeriodLabel
  const money = input.formatAmount

  const negativeCash = input.netCashMovementAvailable
    && input.netCashMovement !== null
    && input.netCashMovement < 0

  if (negativeCash) {
    insights.push({
      id: 'negative-cash',
      title: 'Cash movement is negative for this period.',
      detail: 'More money moved out than in.',
      destination: '/?page=accounts',
      actionLabel: 'View Money',
      priority: 0,
    })
  }

  if (label && input.salesComparison && input.salesComparison.direction !== 'flat') {
    const { direction, percent, delta, previous } = input.salesComparison
    insights.push({
      id: 'sales-trend',
      title: percent === null
        ? `Sales are ${money(Math.abs(delta))} ${direction === 'up' ? 'higher' : 'lower'} than the ${label}.`
        : `Sales are ${direction === 'up' ? 'up' : 'down'} ${Math.abs(percent)}% versus the ${label}.`,
      detail: `The ${label} recorded ${money(previous)}.`,
      destination: '/?page=sales-list',
      actionLabel: 'View Sales',
      priority: 1,
    })
  }

  // Direction versus the previous period only adds something when the sign of
  // the current period is not already the headline.
  if (!negativeCash && label && input.netCashComparison && input.netCashComparison.direction !== 'flat') {
    const { direction, percent, delta, previous } = input.netCashComparison
    insights.push({
      id: 'cash-trend',
      title: percent === null
        ? `Net cash movement is ${money(Math.abs(delta))} ${direction === 'up' ? 'higher' : 'lower'} than the ${label}.`
        : `Net cash movement is ${direction === 'up' ? 'up' : 'down'} ${Math.abs(percent)}% versus the ${label}.`,
      detail: `The ${label} recorded ${money(previous)}.`,
      destination: '/?page=accounts',
      actionLabel: 'View Money',
      priority: 2,
    })
  }

  return insights.sort((a, b) => a.priority - b.priority)
}
