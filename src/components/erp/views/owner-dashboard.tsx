'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CircleDollarSign,
  Landmark,
  Minus,
  Package,
  RefreshCw,
  ShoppingCart,
  Smartphone,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { navigateShell } from '@/lib/navigation/shell-navigation'
import { useOwnerDashboard, type DashboardMetricTrend } from '@/hooks/use-owner-dashboard'
import { formatWholeRupees } from '@/lib/format'
import { bizFormat, bizPresetDateRange, businessDaySpan, isBusinessDateRange, type BusinessDateRange } from '@/lib/dates'
import { buildDashboardAttention, describeAttentionOverflow, type AttentionSeverity, type DashboardAttentionItem } from '@/lib/dashboard/attention'
import { buildDashboardInsights, type DashboardInsight } from '@/lib/dashboard/insights'
import { sparklinePoints } from '@/lib/dashboard/trends'
import type { CashPosition } from '@/lib/dashboard/cash-position'
import { buildOperationalPulse, operationalPulseHasError } from '@/lib/dashboard/operational-pulse'
import { canOpenDashboardDestination, resolveDashboardSections, type DashboardSectionId } from '@/lib/dashboard/sections'

type MetricState = 'available' | 'not-tracked' | 'error'

function metricDisplay(value: number | null, state: MetricState) {
  if (state === 'error') return 'Unable to load'
  if (state !== 'available' || value === null) return 'Not tracked'
  return formatWholeRupees(value)
}

const SPARKLINE_WIDTH = 96
const SPARKLINE_HEIGHT = 20

/**
 * A shape, not a chart: no axes, no labels, no tooltip. It is drawn only when
 * the payload supplied a real per-day series, so an absent sparkline always
 * means "this metric has no supported history", never "nothing happened".
 */
function Sparkline({ series, label }: { series: number[]; label: string }) {
  const points = sparklinePoints(series, SPARKLINE_WIDTH, SPARKLINE_HEIGHT)
  if (!points) return null
  return <svg viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`} width={SPARKLINE_WIDTH} height={SPARKLINE_HEIGHT} className="text-primary/70" role="img" aria-label={`${label} day-by-day shape for this period`} preserveAspectRatio="none">
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
  </svg>
}

/** Compact wording only. A missing comparison renders nothing at all. */
function ComparisonNote({ trend, periodLabel }: { trend: DashboardMetricTrend; periodLabel: string | null }) {
  const comparison = trend.comparison
  if (!comparison || !periodLabel) return null
  const Icon = comparison.direction === 'up' ? TrendingUp : comparison.direction === 'down' ? TrendingDown : Minus
  const tone = comparison.direction === 'flat' ? 'text-muted-foreground' : comparison.direction === 'up' ? 'text-emerald-700' : 'text-destructive'
  const change = comparison.direction === 'flat'
    ? 'No change'
    : comparison.percent === null
      ? formatWholeRupees(Math.abs(comparison.delta))
      : `${Math.abs(comparison.percent)}%`
  return <span className={`inline-flex items-center gap-1 text-xs font-medium ${tone}`}>
    <Icon className="size-3" aria-hidden />{change} vs {periodLabel}
  </span>
}

function HeroMetric({ label, value, state, detail, icon: Icon, onRetry, onOpen, actionLabel, trend, periodLabel }: {
  label: string
  value: number | null
  state: MetricState
  detail: string
  icon: LucideIcon
  onRetry: () => void
  onOpen?: () => void
  actionLabel?: string
  trend: DashboardMetricTrend
  periodLabel: string | null
}) {
  const unavailable = state === 'error'
  const showTrend = state === 'available'
  const content = <>
    <div className="flex items-center justify-between gap-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><Icon className="size-4 text-primary" aria-hidden /></div>
    <div className="mt-3 flex items-end justify-between gap-2">
      <p className={`text-2xl font-semibold tracking-tight ${unavailable ? 'text-muted-foreground' : 'text-foreground'}`} data-num>{metricDisplay(value, state)}</p>
      {showTrend && trend.series && <Sparkline series={trend.series} label={label} />}
    </div>
    <div className="mt-1 min-h-4 text-xs text-muted-foreground">{unavailable ? null : detail}</div>
    {showTrend && <div className="min-h-4"><ComparisonNote trend={trend} periodLabel={periodLabel} /></div>}
  </>
  if (onOpen && !unavailable) {
    return <button type="button" onClick={onOpen} className="rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      {content}
      <span className="mt-3 inline-flex min-h-5 items-center gap-1 text-xs font-medium text-primary">{actionLabel} <ArrowRight className="size-3" aria-hidden /></span>
    </button>
  }
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      {content}
      {unavailable && <button type="button" onClick={onRetry} className="mt-2 min-h-8 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Retry</button>}
    </section>
  )
}

const CASH_GROUP_ICON: Record<string, LucideIcon> = { Cash: Wallet, Bank: Landmark, Wallet: Smartphone, Other: Building2 }

/**
 * One panel, balances only. Zero, unavailable and not-tracked are three
 * different sentences: a missing measurement is never shown as Rs 0. Account
 * names, bank names and numbers are deliberately not part of this payload.
 */
function CashPositionPanel({ cashPosition, onOpen, onRetry, canOpen }: {
  cashPosition: CashPosition
  onOpen: () => void
  onRetry: () => void
  canOpen: boolean
}) {
  const { state, groups, accountCount, totalPaisas } = cashPosition
  return <section className="rounded-xl border border-border bg-card p-4" aria-label="Cash Position">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex items-center gap-2"><Wallet className="size-4 text-primary" aria-hidden /><div><h2 className="text-sm font-semibold">Cash Position</h2><p className="text-xs text-muted-foreground">Current balance of active payment accounts.</p></div></div>
      {state === 'available' && totalPaisas !== null && <p className="text-right text-sm font-semibold text-foreground" data-num>{formatWholeRupees(BigInt(totalPaisas))}<span className="ml-1 text-xs font-normal text-muted-foreground">total</span></p>}
    </div>
    {state === 'error'
      ? <p className="mt-3 text-sm text-muted-foreground">Unable to load account balances <button type="button" onClick={onRetry} className="ml-1 min-h-8 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Retry</button></p>
      : state === 'not-tracked'
        ? <p className="mt-3 text-sm text-muted-foreground">Account balances are not tracked on this data source.</p>
        : accountCount === 0
          ? <p className="mt-3 text-sm text-muted-foreground">No active payment accounts.</p>
          : <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{groups.map((group) => {
            const GroupIcon = CASH_GROUP_ICON[group.type] ?? Building2
            return <div key={group.type} className="rounded-lg bg-muted/50 p-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><GroupIcon className="size-3.5" aria-hidden />{group.type}</p>
              <p className="mt-1 text-sm font-semibold text-foreground" data-num>{formatWholeRupees(BigInt(group.balancePaisas))}</p>
              <p className="text-xs text-muted-foreground">{group.accountCount} account{group.accountCount === 1 ? '' : 's'}</p>
            </div>
          })}</div>}
    {state === 'available' && canOpen && <button type="button" onClick={onOpen} className="mt-3 inline-flex min-h-8 items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Open Business Accounts <ArrowRight className="size-3" aria-hidden /></button>}
  </section>
}

/** Counts, never money: how many documents the period contains. */
function OperationalPulse({ items, hasError, onOpen, onRetry, periodLabel }: {
  items: ReturnType<typeof buildOperationalPulse>
  hasError: boolean
  onOpen: (destination: string) => void
  onRetry: () => void
  periodLabel: string
}) {
  return <section className="rounded-xl border border-border bg-card p-4" aria-label="Operational Pulse">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex items-center gap-2"><CircleDollarSign className="size-4 text-primary" aria-hidden /><div><h2 className="text-sm font-semibold">Operational Pulse</h2><p className="text-xs text-muted-foreground">How many documents were recorded in {periodLabel}.</p></div></div>
      {hasError && <button type="button" onClick={onRetry} className="min-h-8 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Retry</button>}
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{items.map((item) => <button type="button" key={item.key} onClick={() => onOpen(item.destination)} aria-label={`${item.count} ${item.label} in ${periodLabel}`} className="rounded-lg bg-muted/50 p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <p className="text-lg font-semibold leading-none text-foreground" data-num>{item.count}</p>
      <p className="mt-1 text-xs text-muted-foreground">{item.label}</p>
    </button>)}</div>
  </section>
}

const attentionStyle: Record<AttentionSeverity, { label: string; badge: string; tone: string }> = {
  critical: { label: 'Critical', badge: 'border-destructive/30 bg-destructive/10 text-destructive', tone: 'text-destructive' },
  'due-soon': { label: 'Due Soon', badge: 'border-amber-300 bg-amber-50 text-amber-800', tone: 'text-amber-700' },
  watch: { label: 'Watch', badge: 'border-sky-300 bg-sky-50 text-sky-800', tone: 'text-sky-700' },
}

const ROW_CLASS = 'flex min-w-0 items-start gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left'
const ROW_INTERACTIVE = ' transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

function AttentionItem({ item, onOpen, canOpen }: { item: DashboardAttentionItem; onOpen: (destination: string) => void; canOpen: boolean }) {
  const style = attentionStyle[item.severity]
  const Icon = item.kind === 'negative-stock' ? AlertTriangle : item.kind === 'low-stock' ? Package : Wallet
  const body = <>
    <Icon className={`mt-0.5 size-4 shrink-0 ${style.tone}`} aria-hidden />
    <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium text-foreground">{item.title}</span><span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.badge}`}>{style.label}</span></span><span className="mt-0.5 block text-xs text-muted-foreground">{item.detail}</span></span>
    {canOpen && <span className="inline-flex min-h-8 shrink-0 items-center gap-1 text-xs font-medium text-primary">{item.actionLabel}<ArrowRight className="size-3" aria-hidden /></span>}
  </>
  if (!canOpen) return <div className={ROW_CLASS}>{body}</div>
  return <button type="button" onClick={() => onOpen(item.destination)} aria-label={`${item.actionLabel}: ${item.title}`} className={ROW_CLASS + ROW_INTERACTIVE}>{body}</button>
}

function InsightItem({ item, onOpen, canOpen }: { item: DashboardInsight; onOpen: (destination: string) => void; canOpen: boolean }) {
  const body = <>
    <CircleDollarSign className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
    <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-foreground">{item.title}</span><span className="mt-0.5 block text-xs text-muted-foreground">{item.detail}</span></span>
    {canOpen && <span className="inline-flex min-h-8 shrink-0 items-center gap-1 text-xs font-medium text-primary">{item.actionLabel}<ArrowRight className="size-3" aria-hidden /></span>}
  </>
  if (!canOpen) return <div className={ROW_CLASS}>{body}</div>
  return <button type="button" onClick={() => onOpen(item.destination)} aria-label={`${item.actionLabel}: ${item.title}`} className={ROW_CLASS + ROW_INTERACTIVE}>{body}</button>
}

type RecentActivityProps = {
  state: 'available' | 'not-tracked' | 'error'
  items: Array<{
    id: string
    timestamp: string
    kind: 'sale' | 'purchase' | 'payment' | 'expense' | 'transfer' | 'return' | 'rider' | 'entry'
    title: string
    reference: string | null
    amount: string | null
    destination: string
  }>
  onOpen: (destination: string) => void
  onRetry: () => void
}

function RecentActivity({ state, items, onOpen, onRetry }: RecentActivityProps) {
  const iconFor = (kind: RecentActivityProps['items'][number]['kind']) => kind === 'sale' ? ShoppingCart : kind === 'purchase' ? Package : kind === 'payment' || kind === 'expense' ? Wallet : kind === 'return' ? AlertTriangle : Building2
  return <section className="rounded-xl border border-border bg-card p-4" aria-label="Recent Activity"><div className="flex items-center gap-2"><Building2 className="size-4 text-primary" aria-hidden /><div><h2 className="text-sm font-semibold">Recent Activity</h2><p className="text-xs text-muted-foreground">Latest business events.</p></div></div><div className="mt-3 space-y-1">{state === 'error' ? <div className="py-3 text-sm text-muted-foreground">Unable to load recent activity <button type="button" onClick={onRetry} className="ml-1 min-h-8 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Retry</button></div> : state === 'not-tracked' ? <p className="py-3 text-sm text-muted-foreground">Recent activity is not available.</p> : items.length === 0 ? <p className="py-3 text-sm text-muted-foreground">No recent activity</p> : items.map((item) => { const Icon = iconFor(item.kind); return <button type="button" key={item.id} onClick={() => onOpen(item.destination)} aria-label={`${item.title}${item.reference ? ` ${item.reference}` : ''}`} className="flex w-full min-w-0 items-start gap-3 border-t border-border/60 py-3 text-left first:border-t-0 first:pt-0 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-foreground">{item.title}{item.reference ? ` · ${item.reference}` : ''}</span><span className="mt-0.5 block text-xs text-muted-foreground">{bizFormat(item.timestamp, 'datetime')}</span></span>{item.amount && <span className="shrink-0 text-xs font-medium text-foreground" data-num>{formatWholeRupees(BigInt(item.amount))}</span>}</button> })}</div></section>
}

export function OwnerDashboard({ user }: { user: { displayName: string; roleName: string; permissions?: string[] } }) {
  const permissions = user.permissions ?? []
  const [range, setRange] = useState<BusinessDateRange>(() => bizPresetDateRange('today'))
  const [preset, setPreset] = useState<'today' | 'last3' | 'last7' | 'month' | 'custom'>('today')
  const [customFrom, setCustomFrom] = useState(range.from)
  const [customTo, setCustomTo] = useState(range.to)
  const [rangeError, setRangeError] = useState('')
  const [showAllAttention, setShowAllAttention] = useState(false)
  const [showAllInsights, setShowAllInsights] = useState(false)
  const { data, isLoading, isFetching, error, refetch } = useOwnerDashboard(range)

  useEffect(() => {
    const aiPeriod = preset === 'today' ? { preset: 'today' as const } : preset === 'month' ? { preset: 'this-month' as const } : preset === 'last3' ? { preset: 'last3' as const } : preset === 'last7' ? { preset: 'last7' as const } : { preset: 'custom' as const, from: range.from, to: range.to }
    const label = preset === 'today' ? 'Today' : preset === 'month' ? 'This Month' : preset === 'last3' ? 'Last 3 Days' : preset === 'last7' ? 'Last 7 Days' : 'Custom Range'
    window.dispatchEvent(new CustomEvent('khatapro-ai-period', { detail: { period: aiPeriod, label } }))
  }, [preset, range])

  const activeRangeLabel = preset === 'today' ? 'Today' : preset === 'last3' ? 'Last 3 Days' : preset === 'last7' ? 'Last 7 Days' : preset === 'month' ? 'This Month' : `${range.from} to ${range.to}`
  const setPresetRange = (next: 'today' | 'last3' | 'last7' | 'month') => {
    const nextRange = bizPresetDateRange(next)
    setPreset(next); setRangeError('')
    if (range.from !== nextRange.from || range.to !== nextRange.to) setRange(nextRange)
  }
  const applyCustomRange = () => {
    const nextRange = { from: customFrom, to: customTo }
    if (!isBusinessDateRange(nextRange)) { setRangeError('End date must be on or after start date.'); return }
    setPreset('custom'); setRangeError('')
    if (range.from !== nextRange.from || range.to !== nextRange.to) setRange(nextRange)
  }

  if (isLoading && !data) return <div className="space-y-4" aria-label="Loading dashboard"><div className="h-32 animate-pulse rounded-xl bg-muted" /><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((key) => <div key={key} className="h-32 animate-pulse rounded-xl bg-muted" />)}</div></div>
  if (error || !data) return <div className="rounded-xl border border-border bg-card p-6"><h1 className="text-xl font-semibold">Business command center</h1><p className="mt-2 text-sm text-muted-foreground">Unable to load dashboard.</p><button onClick={() => refetch()} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"><RefreshCw className="size-4" /> Retry</button></div>

  const stateFor = (name: string): MetricState => data.metricStates[name] ?? (data.availability[name as keyof typeof data.availability] ? 'available' : 'not-tracked')
  const hasPeriodActivity = (data.kpis.todaySales ?? 0) !== 0 || (data.kpis.todayCollections ?? 0) !== 0 || (data.kpis.todayExpenses ?? 0) !== 0 || (data.kpis.todayPurchases ?? 0) !== 0
  const canOpen = (destination: string) => canOpenDashboardDestination(permissions, destination)
  const openDestination = (destination: string) => { if (canOpen(destination)) navigateShell(destination) }
  // Wording comes from the measured previous range, so a 5-day custom range
  // never claims to be compared against "last week".
  const previousPeriodLabel = data.trends.previousRange === null
    ? null
    : businessDaySpan(data.trends.previousRange) === 1 ? 'previous day' : `previous ${businessDaySpan(data.trends.previousRange)} days`
  const attentionItems = buildDashboardAttention({
    negativeStockProducts: data.negativeStockProducts,
    lowStockProducts: data.lowStockProducts,
    paymentAccounts: data.paymentAccounts,
  })
  const attentionOverflow = describeAttentionOverflow({
    negativeStockProducts: data.negativeStockProducts,
    lowStockProducts: data.lowStockProducts,
    negativeStockCount: data.kpis.negativeStockCount,
    lowStockCount: data.kpis.lowStockCount,
  })
  const visibleAttentionItems = showAllAttention ? attentionItems : attentionItems.slice(0, 4)
  const insights = buildDashboardInsights({
    netCashMovement: data.kpis.todayNetCashFlow,
    netCashMovementAvailable: stateFor('todayNetCashFlow') === 'available',
    salesComparison: data.trends.metrics.todaySales.comparison,
    netCashComparison: data.trends.metrics.todayNetCashFlow.comparison,
    previousPeriodLabel,
    formatAmount: (paisas) => formatWholeRupees(paisas),
  })
  const visibleInsights = showAllInsights ? insights : insights.slice(0, 3)
  const pulseItems = buildOperationalPulse({
    counts: data.operationalCounts.counts,
    states: data.operationalCounts.states,
    canOpen,
  })
  const pulseHasError = operationalPulseHasError(data.operationalCounts.states)
  const heroMetrics = [
    { label: 'Sales', value: data.kpis.todaySales, state: stateFor('todaySales'), detail: data.kpis.todaySales === 0 ? 'No activity in this period' : activeRangeLabel, icon: ShoppingCart, destination: '/?page=sales-list', actionLabel: 'View Sales', trend: data.trends.metrics.todaySales },
    { label: 'Net Cash Movement', value: data.kpis.todayNetCashFlow, state: stateFor('todayNetCashFlow'), detail: data.kpis.todayNetCashFlow === 0 ? 'No movement in this period' : activeRangeLabel, icon: CircleDollarSign, destination: '/?page=accounts', actionLabel: 'View Money', trend: data.trends.metrics.todayNetCashFlow },
    { label: 'Receivables', value: data.kpis.totalReceivables, state: stateFor('totalReceivables'), detail: data.kpis.totalReceivables === 0 ? 'Current balance is Rs 0' : 'Current balance', icon: Users, destination: '/?page=accounts', actionLabel: 'View Receivables', trend: data.trends.metrics.totalReceivables },
    { label: 'Payables', value: data.kpis.totalPayables, state: stateFor('totalPayables'), detail: data.kpis.totalPayables === 0 ? 'Current balance is Rs 0' : 'Current balance', icon: Wallet, destination: '/?page=purchases', actionLabel: 'View Payables', trend: data.trends.metrics.totalPayables },
  ]

  const sectionNodes: Partial<Record<DashboardSectionId, ReactNode>> = {
    hero: <div key="hero">
      <section aria-label="Business overview"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{heroMetrics.map(({ destination, ...metric }) => <HeroMetric key={metric.label} {...metric} periodLabel={previousPeriodLabel} onRetry={() => refetch()} onOpen={canOpen(destination) ? () => navigateShell(destination) : undefined} />)}</div></section>
      {!hasPeriodActivity && <p className="mt-5 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">No activity in this period.</p>}
    </div>,
    attention: attentionItems.length === 0 ? null : <section key="attention" className="rounded-xl border border-border bg-muted/20 p-4" aria-label="Needs Attention"><div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-foreground">Needs Attention</h2><p className="text-xs text-muted-foreground">Actionable items, ordered by urgency.</p></div><span className="shrink-0 text-xs text-muted-foreground">{attentionItems.length} item{attentionItems.length === 1 ? '' : 's'}</span></div><div className="mt-3 grid gap-2">{visibleAttentionItems.map((item) => <AttentionItem key={item.id} item={item} onOpen={openDestination} canOpen={canOpen(item.destination)} />)}</div>{attentionItems.length > 4 && <button type="button" onClick={() => setShowAllAttention((shown) => !shown)} className="mt-3 min-h-9 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{showAllAttention ? 'Show Less' : `Show ${attentionItems.length - 4} More`}</button>}{attentionOverflow && <p className="mt-3 text-xs text-muted-foreground">{attentionOverflow}</p>}</section>,
    insights: insights.length === 0 ? null : <section key="insights" className="rounded-xl border border-border bg-muted/20 p-4" aria-label="Business Insights"><div><h2 className="text-sm font-semibold text-foreground">Business Insights</h2><p className="text-xs text-muted-foreground">Factual signals from current business data.</p></div><div className="mt-3 grid gap-2">{visibleInsights.map((item) => <InsightItem key={item.id} item={item} onOpen={openDestination} canOpen={canOpen(item.destination)} />)}</div>{insights.length > 3 && <button type="button" onClick={() => setShowAllInsights((shown) => !shown)} className="mt-3 min-h-9 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{showAllInsights ? 'Show Less' : `Show ${insights.length - 3} More`}</button>}</section>,
    'cash-position': <CashPositionPanel key="cash-position" cashPosition={data.cashPosition} onOpen={() => openDestination('/?page=business-accounts')} onRetry={() => refetch()} canOpen={canOpen('/?page=business-accounts')} />,
    pulse: pulseItems.length === 0 && !pulseHasError ? null : <OperationalPulse key="pulse" items={pulseItems} hasError={pulseHasError} onOpen={openDestination} onRetry={() => refetch()} periodLabel={activeRangeLabel} />,
    breakdown: <section key="breakdown" className="rounded-xl border border-border bg-card p-4"><div className="flex items-center gap-2"><Building2 className="size-4 text-primary" /><h2 className="text-sm font-semibold">Sales by channel</h2></div><p className="mt-1 text-xs text-muted-foreground">Posted sales in {activeRangeLabel}.</p><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{[['Counter', data.salesByType.counter], ['Online', data.salesByType.online], ['OFC', data.salesByType.ofc], ['Other', data.salesByType.other]].map(([label, value]) => <div key={label as string} className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">{label as string}</p><p className="mt-1 text-sm font-semibold" data-num>{formatWholeRupees(Number((value as { amount: string }).amount))}</p><p className="text-xs text-muted-foreground">{(value as { count: number }).count} invoices</p></div>)}</div></section>,
    activity: <RecentActivity key="activity" {...data.recentActivity} onOpen={openDestination} onRetry={() => refetch()} />,
  }

  return (
    <main className="space-y-5" aria-busy={isFetching}>
      <header className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start"><div><p className="text-xs font-medium text-muted-foreground">{format(new Date(), 'EEEE, MMMM d, yyyy')} • {user.roleName}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Business command center</h1><p className="mt-1 text-sm text-muted-foreground">A clear view of the business for {activeRangeLabel}.</p></div>{isFetching && <span className="text-xs font-medium text-muted-foreground">Updating selected period…</span>}</div>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Business summary date range">{([['today', 'Today'], ['last3', 'Last 3 Days'], ['last7', 'Last 7 Days'], ['month', 'This Month']] as const).map(([key, label]) => <button key={key} onClick={() => setPresetRange(key)} className={`rounded-md border px-3 py-1.5 text-xs font-medium ${preset === key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-muted'}`}>{label}</button>)}<button onClick={() => setPreset('custom')} className={`rounded-md border px-3 py-1.5 text-xs font-medium ${preset === 'custom' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-muted'}`}>Custom range</button></div>
        {preset === 'custom' && <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]"><input aria-label="Start date" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-xs" /><input aria-label="End date" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-xs" /><button onClick={applyCustomRange} className="h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Apply</button><button onClick={() => setPresetRange('today')} className="h-9 rounded-md border border-border px-3 text-xs font-medium">Reset</button></div>}
        {rangeError && <p className="mt-2 text-xs text-destructive">{rangeError}</p>}
      </header>

      {resolveDashboardSections(permissions).map((section) => sectionNodes[section] ?? null)}
    </main>
  )
}
