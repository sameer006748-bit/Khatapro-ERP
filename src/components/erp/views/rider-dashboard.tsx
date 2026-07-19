 'use client'

import { motion } from 'framer-motion'
import { format } from 'date-fns'
import {
  Package,
  CheckCircle2,
  RotateCcw,
  Wallet,
  Clock,
  FileText,
  ArrowRight,
  RefreshCw,
  Bike,
} from 'lucide-react'
import { useRiderDashboard } from '@/hooks/use-rider-dashboard'
import { GlassPanel, KpiCard, QuickActionButton, SectionHeader, EmptyState } from '@/components/erp/dashboard-components'
import { formatWholeRupees } from '@/lib/format'
import { useRouter } from 'next/navigation'


const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  assigned: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  out_for_delivery: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  delivered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  returned: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

function statusLabel(s: string): string {
  return s.replace(/_/g, ' ')
}

export function RiderDashboard({ user }: { user: any }) {
  const router = useRouter()
  const { data, isLoading, error, refetch } = useRiderDashboard()
  const notLinked = error instanceof Error && error.message === 'NotLinked'

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
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
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

  if (notLinked) {
    return (
      <div className="space-y-6">
        <GlassPanel padding="p-8">
          <h1 className="text-2xl font-semibold mb-2">Welcome, {user.displayName.split(' ')[0]}.</h1>
          <p className="text-muted-foreground">
            Your account isn’t linked to a rider profile yet. Ask an Owner/Admin to link
            your account under Delivery / Riders, then reload.
          </p>
          <button onClick={() => refetch()} className="mt-4 flex items-center gap-2 text-sm text-primary hover:underline">
            <RefreshCw className="size-4" /> Reload
          </button>
        </GlassPanel>
      </div>
    )
  }

  if (error || !data || !data.summary) {
    return (
      <div className="space-y-6">
        <GlassPanel padding="p-8">
          <h1 className="text-2xl font-semibold mb-2">Welcome, {user.displayName.split(' ')[0]}.</h1>
          <p className="text-muted-foreground">
            {error ? 'Unable to load dashboard data.' : 'No delivery data available.'}
          </p>
          <button onClick={() => refetch()} className="mt-4 flex items-center gap-2 text-sm text-primary hover:underline">
            <RefreshCw className="size-4" /> Retry
          </button>
        </GlassPanel>
      </div>
    )
  }

  const { summary, recentOrders = [] } = data

  const quickActions = [
    { label: 'My Orders', icon: Package, action: () => router.push('/?page=delivery') },
    { label: 'Delivered', icon: CheckCircle2, action: () => router.push('/?page=delivery') },
    { label: 'Returned', icon: RotateCcw, action: () => router.push('/?page=delivery') },
    { label: 'COD Submit', icon: Wallet, action: () => router.push('/?page=delivery') },
  ]

  const kpis = [
    {
      label: 'Assigned', value: summary.assigned ?? 0,
      sub: 'Orders assigned to you',
      icon: Bike, accent: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    },
    {
      label: 'Out for Delivery', value: summary.outForDelivery ?? 0,
      sub: 'Currently in transit',
      icon: Clock, accent: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
    },
    {
      label: 'Delivered Today', value: summary.deliveredToday ?? 0,
      sub: 'Completed deliveries',
      icon: CheckCircle2, accent: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    },
    {
      label: 'COD Pending', value: formatWholeRupees(Number(summary.codPending), true).replace('Rs ', 'PKR '),
      sub: 'Cash to collect',
      icon: Wallet, accent: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    },
    {
      label: 'Earnings Payable', value: formatWholeRupees(Number(summary.earningsPayable), true).replace('Rs ', 'PKR '),
      sub: 'Delivery earnings owed',
      icon: Package, accent: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
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
                <span className="text-[11px] text-muted-foreground/60">{'\u00B7'}</span>
                <span className="text-[11px] text-muted-foreground/60" data-num>{karachiTime} PKT</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground mb-2">
                Welcome, {user.displayName.split(' ')[0]}.
              </h1>
              <p className="text-sm text-muted-foreground max-w-2xl">
                Your assigned delivery orders, COD submissions, and rider performance.
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
          <SectionHeader title="Quick Actions" subtitle="Manage your deliveries" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {quickActions.map(action => (
              <QuickActionButton key={action.label} label={action.label} icon={action.icon} onClick={action.action} />
            ))}
          </div>
        </GlassPanel>
      </motion.div>

      <motion.div variants={item}>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {kpis.map((kpi, idx) => (
            <KpiCard key={kpi.label} label={kpi.label} value={kpi.value} sub={kpi.sub} icon={kpi.icon} accent={kpi.accent} delay={idx * 0.05} />
          ))}
        </div>
      </motion.div>

      <motion.div variants={item}>
        <GlassPanel padding="p-5 sm:p-6">
          <SectionHeader title="Your Assigned Orders" subtitle="Recent delivery assignments"
            action={<button onClick={() => router.push('/?page=delivery')} className="text-xs text-primary hover:underline flex items-center gap-1">View all <ArrowRight className="size-3" /></button>} />
          {recentOrders.length === 0 ? (
            <EmptyState message="No orders assigned yet." />
          ) : (
            <div className="space-y-2">
              {recentOrders.map(order => (
                <div key={order.id} className="flex items-center justify-between p-3 rounded-xl bg-white/50 border border-white/10 hover:bg-white/70 transition-colors">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <FileText className="size-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">
                          {order.invoiceNo || `Order ${order.id.slice(0, 8)}`}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize shrink-0 ${STATUS_COLORS[order.status] ?? 'bg-muted text-muted-foreground'}`}>
                          {statusLabel(order.status)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {order.customerName || 'Customer'} {order.customerAddress ? `\u00B7 ${order.customerAddress}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <div className="text-sm font-semibold text-foreground">{formatWholeRupees(Number(order.totalCodAmount), true).replace('Rs ', 'PKR ')}</div>
                    <div className="text-[11px] text-muted-foreground">COD</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassPanel>
      </motion.div>
    </motion.div>
  )
}