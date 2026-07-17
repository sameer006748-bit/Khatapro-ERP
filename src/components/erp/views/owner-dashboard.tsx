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
  Package,
  AlertTriangle,
  Receipt,
  FileText,
  Users,
  Activity,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Brain,
} from 'lucide-react'
import { useOwnerDashboard } from '@/hooks/use-owner-dashboard'
import { useAiSettings } from '@/hooks/use-ai-settings'
import { GlassPanel, KpiCard, QuickActionButton, SectionHeader, EmptyState } from '@/components/erp/dashboard-components'
import { formatWholeRupees } from '@/lib/format'
import { useRouter } from 'next/navigation'


function formatDateTime(iso: string): string {
  try { return format(new Date(iso), 'HH:mm') } catch { return iso }
}

export function OwnerDashboard({ user }: { user: any }) {
  const router = useRouter()
  const { data, isLoading, error, refetch } = useOwnerDashboard()
  const { data: aiSettings } = useAiSettings()

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
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
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
    { label: 'Counter Sale', icon: ShoppingCart, action: () => router.push('/?page=counter-sale') },
    { label: 'Online Sale', icon: ShoppingCart, action: () => router.push('/?page=online-sale') },
    { label: 'OFC Sale', icon: ShoppingCart, action: () => router.push('/?page=ofc-sale') },
    { label: 'New Purchase', icon: Receipt, action: () => router.push('/?page=purchases') },
    { label: 'Receipt Voucher', icon: ArrowDownToLine, action: () => router.push('/?page=receipt-voucher') },
    { label: 'Payment Voucher', icon: ArrowUpFromLine, action: () => router.push('/?page=payment-voucher') },
  ]

  const kpis = [
    {
      label: 'Today Sales', value: formatWholeRupees(data.kpis.todaySales, true).replace('Rs ', 'PKR '),
      sub: `${data.salesByType.counter.count} counter \u00B7 ${data.salesByType.online.count} online \u00B7 ${data.salesByType.ofc.count} OFC`,
      icon: ShoppingCart, accent: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    },
    {
      label: 'Today Collections',
      value: data.availability.todayCollections ? formatWholeRupees(data.kpis.todayCollections, true).replace('Rs ', 'PKR ') : 'Not available',
      sub: data.availability.todayCollections ? 'Cash received today' : 'Receipt data unavailable',
      icon: ArrowDownToLine, accent: 'bg-green-500/10 text-green-600 dark:text-green-400',
    },
    {
      label: 'Today Expenses', value: formatWholeRupees(data.kpis.todayExpenses, true).replace('Rs ', 'PKR '),
      sub: 'Operating expenses',
      icon: ArrowUpFromLine, accent: 'bg-red-500/10 text-red-600 dark:text-red-400',
    },
    {
      label: 'Net Cash Flow',
      value: data.availability.todayNetCashFlow ? formatWholeRupees(data.kpis.todayNetCashFlow, true).replace('Rs ', 'PKR ') : 'Not available',
      sub: data.availability.todayNetCashFlow ? (data.kpis.todayNetCashFlow! >= 0 ? 'Positive flow' : 'Negative flow') : 'Waiting for collections',
      icon: data.availability.todayNetCashFlow ? (data.kpis.todayNetCashFlow! >= 0 ? TrendingUp : TrendingDown) : TrendingDown,
      accent: data.availability.todayNetCashFlow ? (data.kpis.todayNetCashFlow! >= 0 ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'bg-orange-500/10 text-orange-600 dark:text-orange-400') : 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
    },
    {
      label: 'Receivables', value: formatWholeRupees(data.kpis.totalReceivables, true).replace('Rs ', 'PKR '),
      sub: 'Outstanding from customers', icon: Users, accent: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    },
    {
      label: 'Payables', value: formatWholeRupees(data.kpis.totalPayables, true).replace('Rs ', 'PKR '),
      sub: 'Owed to vendors', icon: Wallet, accent: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    },
    {
      label: 'Total Sales', value: formatWholeRupees(data.kpis.totalSales, true).replace('Rs ', 'PKR '),
      sub: 'Lifetime revenue', icon: TrendingUp, accent: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
    },
    {
      label: 'Stock Alerts',
      value: `${data.kpis.lowStockCount + data.kpis.negativeStockCount}`,
      sub: `${data.kpis.negativeStockCount} negative`,
      icon: AlertTriangle,
      accent: (data.kpis.lowStockCount + data.kpis.negativeStockCount) > 0
        ? 'bg-red-500/10 text-red-600 dark:text-red-400'
        : 'bg-green-500/10 text-green-600 dark:text-green-400',
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
                Your business is running smoothly. Review today's performance, manage stock, and process new transactions.
              </p>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/50 border border-white/10">
              <Sparkles className="size-4 text-primary" />
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
                      <div className="text-sm font-semibold text-foreground">{formatWholeRupees(Number(inv.total), true).replace('Rs ', 'PKR ')}</div>
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
                      <div className="size-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0"><Receipt className="size-4 text-amber-600 dark:text-amber-400" /></div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{pur.purchaseNo}</div>
                        <div className="text-xs text-muted-foreground truncate">{pur.vendorName || 'Unknown'} \u00B7 {formatDateTime(pur.purchaseDate)}</div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <div className="text-sm font-semibold text-foreground">{formatWholeRupees(Number(pur.total), true).replace('Rs ', 'PKR ')}</div>
                      <div className="text-[11px] text-muted-foreground">{pur.status}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassPanel>
        </motion.div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <motion.div variants={item}>
          <GlassPanel padding="p-5 sm:p-6">
            <SectionHeader title="Stock Alerts" subtitle={`${data.kpis.lowStockCount + data.kpis.negativeStockCount} items need attention`}
              action={<button onClick={() => router.push('/?page=inventory')} className="text-xs text-primary hover:underline flex items-center gap-1">Manage stock <ArrowRight className="size-3" /></button>} />
            {(data.kpis.lowStockCount + data.kpis.negativeStockCount) === 0 ? <EmptyState message="All stock levels healthy" /> : (
              <div className="space-y-2">
                {data.negativeStockProducts.slice(0, 3).map(p => (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-red-500/5 border border-red-500/10">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="size-9 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0"><AlertTriangle className="size-4 text-red-600 dark:text-red-400" /></div>
                      <div className="min-w-0"><div className="text-sm font-medium text-foreground truncate">{p.name}</div><div className="text-xs text-red-600 dark:text-red-400 font-medium">Negative stock: {p.currentStock}</div></div>
                    </div>
                  </div>
                ))}
                {data.lowStockProducts.slice(0, 3).map(p => (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-amber-500/5 border border-amber-500/10">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="size-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0"><Package className="size-4 text-amber-600 dark:text-amber-400" /></div>
                      <div className="min-w-0"><div className="text-sm font-medium text-foreground truncate">{p.name}</div><div className="text-xs text-amber-600 dark:text-amber-400 font-medium">Low stock: {p.currentStock} left</div></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassPanel>
        </motion.div>

        <motion.div variants={item}>
          <GlassPanel padding="p-5 sm:p-6">
            <SectionHeader title="Recent Activity" subtitle="Latest audit trail entries"
              action={<button onClick={() => router.push('/?page=audit')} className="text-xs text-primary hover:underline flex items-center gap-1">View all <ArrowRight className="size-3" /></button>} />
            {data.auditLogs.length === 0 ? <EmptyState message="No activity yet" /> : (
              <div className="space-y-2">
                {data.auditLogs.map(log => (
                  <div key={log.id} className="flex items-start gap-3 p-3 rounded-xl bg-white/50 border border-white/10">
                    <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Activity className="size-4 text-primary" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm font-medium text-foreground capitalize">{log.action.replace(/_/g, ' ')}</span>
                        <span className="text-[11px] text-muted-foreground">{formatDateTime(log.timestamp)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{log.entity} {log.entityId ? `\u00B7 ${log.entityId.slice(0, 8)}` : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassPanel>
        </motion.div>
      </div>

      <motion.div variants={item}>
        <GlassPanel padding="p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center"><Brain className="size-4 text-primary" /></div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">AI Business Brief</h3>
                <p className="text-[11px] text-muted-foreground">{aiSettings?.connected ? 'Gemini connected' : 'Not configured'}</p>
              </div>
            </div>
            <button onClick={() => router.push('/?page=ai-settings')} className="text-xs text-primary hover:underline flex items-center gap-1">Configure <ArrowRight className="size-3" /></button>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/50 p-4">
            <p className="text-xs text-muted-foreground text-center">AI insights will appear here once configured.</p>
          </div>
        </GlassPanel>
      </motion.div>
    </motion.div>
  )
}