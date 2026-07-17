'use client'

import { motion } from 'framer-motion'
import { format } from 'date-fns'
import {
  ShoppingCart,
  Wallet,
  TrendingUp,
  TrendingDown,
  ArrowDownToLine,
  ArrowUpFromLine,
  FileText,
  ArrowRight,
  RefreshCw,
} from 'lucide-react'
import { useOwnerDashboard } from '@/hooks/use-owner-dashboard'
import { GlassPanel, KpiCard, QuickActionButton, SectionHeader, EmptyState } from '@/components/erp/dashboard-components'
import { useRouter } from 'next/navigation'

function formatPKR(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Not available'
  if (value >= 1000000) return `PKR ${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `PKR ${(value / 1000).toFixed(1)}K`
  return `PKR ${value.toFixed(0)}`
}

function formatDateTime(iso: string): string {
  try { return format(new Date(iso), 'HH:mm') } catch { return iso }
}

export function AccountantDashboard({ user }: { user: any }) {
  const router = useRouter()
  const { data, isLoading, error, refetch } = useOwnerDashboard()

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.05 } },
  }
  const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <GlassPanel padding="p-8">
          <div className="h-8 w-64 rounded-lg bg-white/40 animate-pulse mb-2" />
          <div className="h-4 w-96 rounded-lg bg-white/40 animate-pulse" />
        </GlassPanel>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="rounded-2xl border border-white/10 bg-white/60 dark:bg-white/5 p-5 animate-pulse">
              <div className="h-3 w-20 rounded bg-white/40 mb-3" />
              <div className="h-8 w-24 rounded bg-white/40 mb-2" />
              <div className="h-3 w-16 rounded bg-white/40" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <GlassPanel padding="p-8">
          <h1 className="text-2xl font-semibold mb-2">Welcome, {user.displayName.split(' ')[0]}.</h1>
          <p className="text-muted-foreground">Unable to load dashboard data.</p>
          <button onClick={() => refetch()} className="mt-4 flex items-center gap-2 text-sm text-primary hover:underline">
            <RefreshCw className="size-4" /> Retry
          </button>
        </GlassPanel>
      </div>
    )
  }

  const quickActions = [
    { label: 'Journal Voucher', icon: FileText, action: () => router.push('/?page=journal-voucher') },
    { label: 'Receipt Voucher', icon: ArrowDownToLine, action: () => router.push('/?page=receipt-voucher') },
    { label: 'Payment Voucher', icon: ArrowUpFromLine, action: () => router.push('/?page=payment-voucher') },
    { label: 'Expenses', icon: Wallet, action: () => router.push('/?page=expense-batch') },
    { label: 'Day Book', icon: FileText, action: () => router.push('/?page=day-book') },
    { label: 'Trial Balance', icon: TrendingUp, action: () => router.push('/?page=trial-balance') },
  ]

  const kpis = [
    {
      label: 'Today Sales', value: formatPKR(data.kpis.todaySales),
      sub: `${data.salesByType.counter.count} counter \u00B7 ${data.salesByType.online.count} online \u00B7 ${data.salesByType.ofc.count} OFC`,
      icon: ShoppingCart, accent: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    },
    {
      label: 'Today Collections',
      value: data.availability.todayCollections ? formatPKR(data.kpis.todayCollections) : 'Not available',
      sub: data.availability.todayCollections ? 'Cash received today' : 'Receipt data unavailable',
      icon: Wallet, accent: 'bg-green-500/10 text-green-600 dark:text-green-400',
    },
    {
      label: 'Today Expenses', value: formatPKR(data.kpis.todayExpenses),
      sub: 'Operating expenses',
      icon: ArrowUpFromLine, accent: 'bg-red-500/10 text-red-600 dark:text-red-400',
    },
    {
      label: 'Net Cash Flow',
      value: data.availability.todayNetCashFlow ? formatPKR(data.kpis.todayNetCashFlow) : 'Not available',
      sub: data.availability.todayNetCashFlow ? (data.kpis.todayNetCashFlow! >= 0 ? 'Positive flow' : 'Negative flow') : 'Waiting for collections',
      icon: data.availability.todayNetCashFlow ? (data.kpis.todayNetCashFlow! >= 0 ? TrendingUp : TrendingDown) : TrendingDown,
      accent: data.availability.todayNetCashFlow ? (data.kpis.todayNetCashFlow! >= 0 ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'bg-orange-500/10 text-orange-600 dark:text-orange-400') : 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
    },
  ]

  const karachiTime = new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit',
  })

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={item}>
        <GlassPanel padding="p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                  {format(new Date(), 'EEEE, MMMM d, yyyy')}
                </span>
                <span className="text-[11px] text-muted-foreground/60">\u00B7</span>
                <span className="text-[11px] text-muted-foreground/60" data-num>{karachiTime} PKT</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground mb-2">
                Welcome, {user.displayName.split(' ')[0]}.
              </h1>
              <p className="text-sm text-muted-foreground max-w-2xl">
                Day-to-day finance operations \u2014 sales, purchases, vouchers, and reports.
              </p>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/50 border border-white/10">
              <span className="text-xs font-medium text-foreground">{user.roleName}</span>
            </div>
          </div>
        </GlassPanel>
      </motion.div>

      <motion.div variants={item}>
        <GlassPanel padding="p-5 sm:p-6">
          <SectionHeader title="Quick Actions" subtitle="Create new transactions instantly" />
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {quickActions.map(action => (
              <QuickActionButton key={action.label} label={action.label} icon={action.icon} onClick={action.action} />
            ))}
          </div>
        </GlassPanel>
      </motion.div>

      <motion.div variants={item}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map((kpi, idx) => (
            <KpiCard key={kpi.label} label={kpi.label} value={kpi.value} sub={kpi.sub} icon={kpi.icon} accent={kpi.accent} delay={idx * 0.05} />
          ))}
        </div>
      </motion.div>

      <div className="grid lg:grid-cols-2 gap-6">
        <motion.div variants={item}>
          <GlassPanel padding="p-5 sm:p-6">
            <SectionHeader title="Recent Invoices" subtitle="Latest sales transactions"
              action={<button onClick={() => router.push('/?page=sales-list')} className="text-xs text-primary hover:underline flex items-center gap-1">View all <ArrowRight className="size-3" /></button>} />
            {data.recentInvoices.length === 0 ? <EmptyState message="No invoices yet" /> : (
              <div className="space-y-2">
                {data.recentInvoices.map(inv => (
                  <div key={inv.id} className="flex items-center justify-between p-3 rounded-xl bg-white/50 border border-white/10 hover:bg-white/70 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><FileText className="size-4 text-primary" /></div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{inv.invoiceNo}</div>
                        <div className="text-xs text-muted-foreground truncate">{inv.customerName || 'Walk-in'} \u00B7 {formatDateTime(inv.invoiceDate)}</div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <div className="text-sm font-semibold text-foreground">{formatPKR(Number(inv.total))}</div>
                      <div className="text-[11px] text-muted-foreground">{inv.invoiceType}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassPanel>
        </motion.div>

        <motion.div variants={item}>
          <GlassPanel padding="p-5 sm:p-6">
            <SectionHeader title="Recent Purchases" subtitle="Latest procurement entries"
              action={<button onClick={() => router.push('/?page=purchases')} className="text-xs text-primary hover:underline flex items-center gap-1">View all <ArrowRight className="size-3" /></button>} />
            {data.recentPurchases.length === 0 ? <EmptyState message="No purchases yet" /> : (
              <div className="space-y-2">
                {data.recentPurchases.map(pur => (
                  <div key={pur.id} className="flex items-center justify-between p-3 rounded-xl bg-white/50 border border-white/10 hover:bg-white/70 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="size-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0"><Wallet className="size-4 text-amber-600 dark:text-amber-400" /></div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{pur.purchaseNo}</div>
                        <div className="text-xs text-muted-foreground truncate">{pur.vendorName || 'Unknown'} \u00B7 {formatDateTime(pur.purchaseDate)}</div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <div className="text-sm font-semibold text-foreground">{formatPKR(Number(pur.total))}</div>
                      <div className="text-[11px] text-muted-foreground">{pur.status}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassPanel>
        </motion.div>
      </div>
    </motion.div>
  )
}