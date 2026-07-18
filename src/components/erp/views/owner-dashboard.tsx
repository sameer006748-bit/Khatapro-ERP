'use client'

import { useState } from 'react'
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
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Sparkles,
  ArrowRight,
  Banknote,
  Building2,
} from 'lucide-react'
import { useOwnerDashboard } from '@/hooks/use-owner-dashboard'
import { GlassPanel, SectionHeader, EmptyState } from '@/components/erp/dashboard-components'
import { formatWholeRupees } from '@/lib/format'
import { useRouter } from 'next/navigation'

function formatDateTime(iso: string): string {
  try { return format(new Date(iso), 'HH:mm') } catch { return iso }
}

function Chip({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-medium hover:bg-muted/30 press-sm transition-colors">
      <Icon className="size-3.5 text-primary" /> {label}
    </button>
  )
}

function PendingCard({ icon: Icon, label, value, sub, accent }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex items-center gap-2 mb-1"><Icon className={`size-4 ${accent}`} /><span className="text-sm font-medium text-foreground">{label}</span></div>
      <div className="text-lg font-bold text-foreground" data-num>{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  )
}

export function OwnerDashboard({ user }: { user: any }) {
  const router = useRouter()
  const { data, isLoading, error, refetch } = useOwnerDashboard()
  const [showAdvanced, setShowAdvanced] = useState(false)

  const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } }
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

  const karachiTime = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit' })

  // ── Metrics ──
  const todaySales = data.kpis.todaySales ?? 0
  const todayCollections = data.kpis.todayCollections
  const todayExpenses = data.kpis.todayExpenses ?? 0
  const todayPurchases = data.kpis.todayPurchases
  const totalReceivables = data.kpis.totalReceivables ?? 0
  const totalPayables = data.kpis.totalPayables ?? 0
  const cashBalance = data.kpis.cashBalance
  const bankBalance = data.kpis.bankBalance
  const approxProfit = todaySales - todayExpenses

  const primaryCards: Array<{ label: string; value: string; sub: string; icon: React.ComponentType<{ className?: string }>; accent: string; show: boolean }> = [
    { label: "Today's Sales", value: formatWholeRupees(todaySales), sub: `${data.salesByType.counter.count} counter \u00B7 ${data.salesByType.online.count} online \u00B7 ${data.salesByType.ofc.count} OFC`, icon: ShoppingCart, accent: 'bg-emerald-500/10 text-emerald-600', show: true },
    { label: 'Amount Received', value: todayCollections != null ? formatWholeRupees(todayCollections) : '—', sub: todayCollections != null ? 'Cash received today' : 'Not available', icon: ArrowDownToLine, accent: 'bg-green-500/10 text-green-600', show: true },
    { label: 'Expenses', value: formatWholeRupees(todayExpenses), sub: "Today's expenses", icon: ArrowUpFromLine, accent: 'bg-red-500/10 text-red-600', show: true },
    { label: 'Purchases', value: todayPurchases != null ? formatWholeRupees(todayPurchases) : '—', sub: todayPurchases != null ? "Today's purchases" : 'Not available', icon: Receipt, accent: 'bg-amber-500/10 text-amber-600', show: todayPurchases != null },
    { label: 'Cash Available', value: cashBalance != null ? formatWholeRupees(cashBalance) : '—', sub: 'Cash in hand', icon: Banknote, accent: 'bg-teal-500/10 text-teal-600', show: cashBalance != null },
    { label: 'Bank Available', value: bankBalance != null ? formatWholeRupees(bankBalance) : '—', sub: 'Bank balance', icon: Building2, accent: 'bg-sky-500/10 text-sky-600', show: bankBalance != null },
    { label: 'Receivables', value: formatWholeRupees(totalReceivables), sub: 'Outstanding receivables', icon: Users, accent: 'bg-violet-500/10 text-violet-600', show: true },
    { label: 'Payables', value: formatWholeRupees(totalPayables), sub: 'Outstanding payables', icon: Wallet, accent: 'bg-amber-500/10 text-amber-600', show: true },
    { label: 'Estimated Profit', value: formatWholeRupees(approxProfit), sub: 'Sales − Expenses (estimated)', icon: TrendingUp, accent: approxProfit >= 0 ? 'bg-blue-500/10 text-blue-600' : 'bg-orange-500/10 text-orange-600', show: true },
  ]

  const visibleCards = primaryCards.filter(c => c.show)

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      {/* Header */}
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
                Business Summary
              </h1>
              <p className="text-sm text-muted-foreground max-w-2xl">
                Today's sales, collections, expenses and outstanding payments overview.
              </p>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/50 border border-white/10">
              <Sparkles className="size-4 text-primary" />
              <span className="text-xs font-medium text-foreground">{user.roleName}</span>
            </div>
          </div>
        </GlassPanel>
      </motion.div>

      {/* Primary summary cards */}
      <motion.div variants={item}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {visibleCards.map(card => (
            <div key={card.label} className="rounded-2xl border border-white/10 bg-white/60 dark:bg-white/5 p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className={`size-8 rounded-lg flex items-center justify-center ${card.accent}`}><card.icon className="size-4" /></div>
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{card.label}</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-foreground mb-1" data-num>{card.value}</div>
              <div className="text-[11px] text-muted-foreground">{card.sub}</div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Sources of Funds */}
      <motion.div variants={item}>
        <GlassPanel padding="p-5 sm:p-6">
          <SectionHeader title="Sources of Funds" subtitle="Today's income sources" />
          <div className="flex flex-wrap gap-2 mb-4">
            <Chip icon={ShoppingCart} label="View Sales" onClick={() => router.push('/?page=sales-list')} />
            <Chip icon={ArrowDownToLine} label="Receive Payment" onClick={() => router.push('/?page=accounts')} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-center gap-2 mb-1"><ShoppingCart className="size-4 text-emerald-600" /><span className="text-sm font-medium text-foreground">Sales</span></div>
              <div className="text-lg font-bold text-foreground" data-num>{formatWholeRupees(todaySales)}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{data.salesByType.counter.count} counter \u00B7 {data.salesByType.online.count} online \u00B7 {data.salesByType.ofc.count} OFC</div>
            </div>
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-center gap-2 mb-1"><ArrowDownToLine className="size-4 text-green-600" /><span className="text-sm font-medium text-foreground">Customer Payments</span></div>
              <div className="text-lg font-bold text-foreground" data-num>{todayCollections != null ? formatWholeRupees(todayCollections) : '—'}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{todayCollections != null ? "Today's receipts" : 'Data not available'}</div>
            </div>
          </div>
        </GlassPanel>
      </motion.div>

      {/* Uses of Funds */}
      <motion.div variants={item}>
        <GlassPanel padding="p-5 sm:p-6">
          <SectionHeader title="Uses of Funds" subtitle="Today's outflows" />
          <div className="flex flex-wrap gap-2 mb-4">
            <Chip icon={Receipt} label="View Purchases" onClick={() => router.push('/?page=purchases')} />
            <Chip icon={ArrowUpFromLine} label="Add Expense" onClick={() => router.push('/?page=expense-batch')} />
            <Chip icon={Wallet} label="Pay Vendor" onClick={() => router.push('/?page=vendors')} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-center gap-2 mb-1"><Receipt className="size-4 text-amber-600" /><span className="text-sm font-medium text-foreground">Purchases</span></div>
              <div className="text-lg font-bold text-foreground" data-num>{todayPurchases != null ? formatWholeRupees(todayPurchases) : '—'}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{todayPurchases != null ? "Today's purchases" : 'Not available'}</div>
            </div>
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-center gap-2 mb-1"><ArrowUpFromLine className="size-4 text-red-600" /><span className="text-sm font-medium text-foreground">Expenses</span></div>
              <div className="text-lg font-bold text-foreground" data-num>{formatWholeRupees(todayExpenses)}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Today's expenses</div>
            </div>
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-center gap-2 mb-1"><Wallet className="size-4 text-amber-600" /><span className="text-sm font-medium text-foreground">Payables</span></div>
              <div className="text-lg font-bold text-foreground" data-num>{formatWholeRupees(totalPayables)}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Total payables</div>
            </div>
          </div>
        </GlassPanel>
      </motion.div>

      {/* Outstanding Obligations */}
      <motion.div variants={item}>
        <GlassPanel padding="p-5 sm:p-6">
          <SectionHeader title="Outstanding Obligations" subtitle="Receivables, payables and stock alerts" />
          <div className="flex flex-wrap gap-2 mb-4">
            <Chip icon={ArrowDownToLine} label="Receive Payment" onClick={() => router.push('/?page=accounts')} />
            <Chip icon={Wallet} label="Pay Vendor" onClick={() => router.push('/?page=vendors')} />
            <Chip icon={Package} label="View Inventory" onClick={() => router.push('/?page=inventory')} />
            <Chip icon={ShoppingCart} label="View Orders" onClick={() => router.push('/?page=sales-list')} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <PendingCard icon={Users} label="Receivables" value={formatWholeRupees(totalReceivables)} sub="Outstanding receivables" accent="text-violet-600" />
            <PendingCard icon={Wallet} label="Payables" value={formatWholeRupees(totalPayables)} sub="Outstanding payables" accent="text-amber-600" />
            <PendingCard icon={AlertTriangle} label="Low / Negative Stock" value={`${data.kpis.lowStockCount + data.kpis.negativeStockCount} items`} sub={`${data.kpis.negativeStockCount} negative`} accent={(data.kpis.lowStockCount + data.kpis.negativeStockCount) > 0 ? 'text-red-600' : 'text-green-600'} />
            <PendingCard icon={ShoppingCart} label="Pending Online Orders" value={`${data.salesByType.online.count} today`} sub="Online orders placed today" accent="text-sky-600" />
          </div>
        </GlassPanel>
      </motion.div>

      {/* Advanced Activity (collapsed) */}
      <motion.div variants={item}>
        <GlassPanel padding="p-5 sm:p-6">
          <button onClick={() => setShowAdvanced(!showAdvanced)} className="w-full flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground text-left">Advanced Activity</h3>
              <p className="text-[11px] text-muted-foreground text-left">Recent invoices, purchases, stock alerts and audit trail</p>
            </div>
            {showAdvanced ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
          </button>

          {showAdvanced && (
            <div className="mt-4 space-y-6">
              {/* Recent Invoices + Purchases */}
              <div className="grid lg:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-foreground">Recent Invoices</span>
                    <button onClick={() => router.push('/?page=sales-list')} className="text-[11px] text-primary hover:underline flex items-center gap-1">View all <ArrowRight className="size-3" /></button>
                  </div>
                  {data.recentInvoices.length === 0 ? <EmptyState message="No invoices yet" /> : (
                    <div className="space-y-1.5">
                      {data.recentInvoices.map(inv => (
                        <div key={inv.id} className="flex items-center justify-between p-2.5 rounded-lg bg-white/50 border border-white/10 text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="size-3.5 text-primary shrink-0" />
                            <span className="font-medium truncate">{inv.invoiceNo}</span>
                            <span className="text-[11px] text-muted-foreground">{inv.customerName || 'Walk-in'}</span>
                          </div>
                          <span className="font-semibold shrink-0 ml-2">{formatWholeRupees(Number(inv.total))}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-foreground">Recent Purchases</span>
                    <button onClick={() => router.push('/?page=purchases')} className="text-[11px] text-primary hover:underline flex items-center gap-1">View all <ArrowRight className="size-3" /></button>
                  </div>
                  {data.recentPurchases.length === 0 ? <EmptyState message="No purchases yet" /> : (
                    <div className="space-y-1.5">
                      {data.recentPurchases.map(pur => (
                        <div key={pur.id} className="flex items-center justify-between p-2.5 rounded-lg bg-white/50 border border-white/10 text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <Receipt className="size-3.5 text-amber-600 shrink-0" />
                            <span className="font-medium truncate">{pur.purchaseNo}</span>
                            <span className="text-[11px] text-muted-foreground">{pur.vendorName || '—'}</span>
                          </div>
                          <span className="font-semibold shrink-0 ml-2">{formatWholeRupees(Number(pur.total))}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Stock Alerts in Advanced */}
              {(data.kpis.lowStockCount + data.kpis.negativeStockCount) > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-foreground">Stock Alerts</span>
                    <button onClick={() => router.push('/?page=inventory')} className="text-[11px] text-primary hover:underline flex items-center gap-1">Manage <ArrowRight className="size-3" /></button>
                  </div>
                  <div className="space-y-1.5">
                    {data.negativeStockProducts.slice(0, 3).map(p => (
                      <div key={p.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/5 border border-red-500/10 text-sm">
                        <AlertTriangle className="size-3.5 text-red-600 shrink-0" />
                        <span className="font-medium truncate">{p.name}</span>
                        <span className="text-[11px] text-red-600 font-medium">Negative: {p.currentStock}</span>
                      </div>
                    ))}
                    {data.lowStockProducts.slice(0, 3).map(p => (
                      <div key={p.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/10 text-sm">
                        <Package className="size-3.5 text-amber-600 shrink-0" />
                        <span className="font-medium truncate">{p.name}</span>
                        <span className="text-[11px] text-amber-600 font-medium">Low: {p.currentStock}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Audit Logs in Advanced */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-foreground">Audit Trail</span>
                  <span className="text-[11px] text-muted-foreground">{data.auditLogs.length} entries</span>
                </div>
                {data.auditLogs.length === 0 ? <EmptyState message="No activity yet" /> : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {data.auditLogs.slice(0, 10).map(log => (
                      <div key={log.id} className="flex items-center justify-between p-2 rounded-lg bg-white/40 border border-white/5 text-xs">
                        <span className="text-muted-foreground capitalize">{log.action.replace(/_/g, ' ')}</span>
                        <span className="text-muted-foreground">{formatDateTime(log.timestamp)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </GlassPanel>
      </motion.div>
    </motion.div>
  )
}