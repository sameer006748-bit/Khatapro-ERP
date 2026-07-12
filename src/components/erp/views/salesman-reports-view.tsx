'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatMoney } from '@/lib/format'
import { bizDate } from '@/lib/dates'
import { TrendingUp, Wallet, Receipt, RotateCcw, BadgeIndianRupee, Download, Printer } from 'lucide-react'
import type { MeUser } from '@/components/erp/erp-app'

type TabId = 'my-sales-summary' | 'my-sales-detail' | 'my-collections' | 'my-returns' | 'my-commission'

const TABS: Array<{ id: TabId; label: string; icon: any }> = [
  { id: 'my-sales-summary',  label: 'Summary',     icon: TrendingUp },
  { id: 'my-sales-detail',   label: 'Detail',      icon: Receipt },
  { id: 'my-collections',    label: 'Collections', icon: Wallet },
  { id: 'my-returns',        label: 'Returns',     icon: RotateCcw },
  { id: 'my-commission',     label: 'Commission',  icon: BadgeIndianRupee },
]

export function SalesmanReportsView({ user }: { user: MeUser }) {
  const [tab, setTab] = useState<TabId>('my-sales-summary')
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  })
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10))

  function setPreset(preset: string) {
    const today = new Date()
    const toDateStr = today.toISOString().slice(0, 10)
    let fromStr = toDateStr
    if (preset === 'today') fromStr = toDateStr
    else if (preset === 'thisMonth') fromStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
    else if (preset === 'lastMonth') {
      const d = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      fromStr = d.toISOString().slice(0, 10)
    } else if (preset === 'thisYear') {
      fromStr = `${today.getFullYear()}-01-01`
    }
    setFromDate(fromStr)
    setToDate(toDateStr)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">My Reports</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Your own sales, collections, returns and commission.
          </p>
        </div>
        <div className="flex gap-2 no-print">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const url = new URL('/api/reports/csv', window.location.origin)
              url.searchParams.set('type', 'sales-detail')
              url.searchParams.set('fromDate', fromDate)
              url.searchParams.set('toDate', toDate)
              window.location.href = url.toString()
            }}
          >
            <Download className="size-3.5" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="size-3.5" /> Print
          </Button>
        </div>
      </div>

      {/* Date filters */}
      <div className="flex flex-wrap gap-2 items-end no-print">
        <div className="flex gap-1">
          {['today', 'thisMonth', 'lastMonth', 'thisYear'].map(p => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className="px-2.5 py-1.5 rounded-md text-xs font-medium press-sm bg-muted text-muted-foreground hover:bg-muted/70"
            >
              {p === 'today' ? 'Today' : p === 'thisMonth' ? 'This Month' : p === 'lastMonth' ? 'Last Month' : 'This Year'}
            </button>
          ))}
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">From</Label>
          <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-8 bg-background text-sm w-36" data-num />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">To</Label>
          <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="h-8 bg-background text-sm w-36" data-num />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto border-b border-border no-print">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.icon className="size-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>KhataPro ERP</h1>
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '4px 0' }}>
          {TABS.find(t => t.id === tab)?.label ?? 'My Reports'} — {user.displayName}
        </h2>
        <p style={{ margin: '2px 0' }}>Period: {fromDate} to {toDate}</p>
        <p style={{ margin: '2px 0' }}>
          Generated: {new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}
        </p>
      </div>

      <div className="no-print-break">
        <TabContent tab={tab} fromDate={fromDate} toDate={toDate} />
      </div>
    </div>
  )
}

function TabContent({ tab, fromDate, toDate }: { tab: TabId; fromDate: string; toDate: string }) {
  const q = useQuery({
    queryKey: ['salesman-report', tab, fromDate, toDate],
    queryFn: () =>
      fetch(`/api/reports/salesman?type=${tab}&fromDate=${fromDate}&toDate=${toDate}`).then(r => r.json()),
    enabled: !!tab,
    retry: 1,
    retryDelay: 500,
  })

  if (q.isLoading) {
    return <div className="card-3d p-8 text-center text-sm text-muted-foreground animate-pulse">Loading…</div>
  }
  if (q.isError || !q.data) {
    return (
      <div className="card-3d p-8 text-center">
        <p className="text-sm text-destructive mb-3">Unable to load report.</p>
        <Button variant="outline" size="sm" onClick={() => q.refetch()}>Retry</Button>
      </div>
    )
  }
  if (q.data.error === 'FORBIDDEN') {
    return (
      <div className="card-3d p-8 text-center">
        <p className="text-sm text-amber-600">
          You do not have permission, or your user account is not linked to a salesman record.
        </p>
      </div>
    )
  }

  switch (tab) {
    case 'my-sales-summary':
      return <MySalesSummary summary={q.data.summary} />
    case 'my-sales-detail':
      return <MySalesDetail rows={q.data.rows ?? []} />
    case 'my-collections':
      return <MyCollections rows={q.data.rows ?? []} />
    case 'my-returns':
      return <MyReturns rows={q.data.rows ?? []} />
    case 'my-commission':
      return <MyCommission rows={q.data.rows ?? []} />
    default:
      return null
  }
}

function KPI({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="border rounded-lg bg-card p-3 border-border">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold ${accent ?? 'text-foreground'}`} data-num>{value}</div>
    </div>
  )
}

function MySalesSummary({ summary }: { summary: any }) {
  if (!summary) return <div className="text-center py-8 text-sm text-muted-foreground">No data.</div>
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <KPI label="Invoices" value={String(summary.invoiceCount ?? 0)} />
        <KPI label="Total Sales" value={formatMoney(BigInt(summary.totalAmount ?? 0))} />
        <KPI label="Collected" value={formatMoney(BigInt(summary.paidAmount ?? 0))} accent="text-emerald-600" />
        <KPI label="Outstanding" value={formatMoney(BigInt(summary.outstandingAmount ?? 0))} accent="text-amber-600" />
        <KPI label="Returned" value={formatMoney(BigInt(summary.returnedAmount ?? 0))} accent="text-rose-600" />
      </div>
    </div>
  )
}

function MySalesDetail({ rows }: { rows: any[] }) {
  return (
    <div className="card-3d overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase text-muted-foreground bg-muted/40">
              <th className="text-left p-2 font-medium">Invoice</th>
              <th className="text-left p-2 font-medium">Date</th>
              <th className="text-left p-2 font-medium">Customer</th>
              <th className="text-left p-2 font-medium">Type</th>
              <th className="text-right p-2 font-medium">Total</th>
              <th className="text-right p-2 font-medium">Paid</th>
              <th className="text-right p-2 font-medium">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="p-4 text-center text-sm text-muted-foreground">No sales in this period.</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="border-b border-border/40">
                <td className="p-2 font-medium" data-num>{r.invoice_no}</td>
                <td className="p-2 text-xs text-muted-foreground" data-num>{bizDate(r.invoice_date)}</td>
                <td className="p-2 text-xs">{r.customer_name ?? '—'}</td>
                <td className="p-2">
                  <span className="text-[9px] uppercase px-1 py-0.5 rounded bg-muted">{r.invoice_type}</span>
                </td>
                <td className="p-2 text-right" data-num>{formatMoney(BigInt(r.total), false)}</td>
                <td className="p-2 text-right text-emerald-600" data-num>{formatMoney(BigInt(r.paid_amount), false)}</td>
                <td className="p-2 text-right text-amber-600" data-num>
                  {formatMoney(BigInt(r.total) - BigInt(r.paid_amount), false)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MyCollections({ rows }: { rows: any[] }) {
  let total = 0n
  for (const r of rows) {
    try { total += BigInt(r.amount ?? 0) } catch {}
  }
  return (
    <div className="space-y-3">
      <div className="card-3d p-3 bg-muted/30">
        <div className="flex justify-between">
          <span className="text-xs text-muted-foreground">Total Collected</span>
          <span className="text-sm font-bold text-emerald-600" data-num>{formatMoney(total)}</span>
        </div>
      </div>
      <div className="card-3d overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase text-muted-foreground bg-muted/40">
                <th className="text-left p-2 font-medium">Date</th>
                <th className="text-left p-2 font-medium">Invoice</th>
                <th className="text-left p-2 font-medium">Account</th>
                <th className="text-right p-2 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4} className="p-4 text-center text-sm text-muted-foreground">No collections in this period.</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className="border-b border-border/40">
                  <td className="p-2 text-xs text-muted-foreground" data-num>{bizDate(r.allocation_date)}</td>
                  <td className="p-2 font-medium" data-num>{r.invoices?.invoice_no ?? '—'}</td>
                  <td className="p-2 text-xs">
                    <span data-num>{r.accounts?.code}</span> · {r.accounts?.name}
                  </td>
                  <td className="p-2 text-right text-emerald-600" data-num>{formatMoney(BigInt(r.amount), false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function MyReturns({ rows }: { rows: any[] }) {
  let total = 0n
  for (const r of rows) {
    try { total += BigInt(r.total ?? 0) } catch {}
  }
  return (
    <div className="space-y-3">
      <div className="card-3d p-3 bg-muted/30">
        <div className="flex justify-between">
          <span className="text-xs text-muted-foreground">Total Returned</span>
          <span className="text-sm font-bold text-rose-600" data-num>{formatMoney(total)}</span>
        </div>
      </div>
      <div className="card-3d overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase text-muted-foreground bg-muted/40">
                <th className="text-left p-2 font-medium">Date</th>
                <th className="text-left p-2 font-medium">Original Invoice</th>
                <th className="text-right p-2 font-medium">Amount</th>
                <th className="text-left p-2 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4} className="p-4 text-center text-sm text-muted-foreground">No returns in this period.</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className="border-b border-border/40">
                  <td className="p-2 text-xs text-muted-foreground" data-num>{bizDate(r.return_date)}</td>
                  <td className="p-2 font-medium" data-num>{r.invoices?.invoice_no ?? '—'}</td>
                  <td className="p-2 text-right text-rose-600" data-num>{formatMoney(BigInt(r.total), false)}</td>
                  <td className="p-2 text-xs text-muted-foreground">{r.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function MyCommission({ rows }: { rows: any[] }) {
  let totalCommission = 0n
  let totalCollected = 0n
  for (const r of rows) {
    try {
      totalCommission += BigInt(r.commission_amount ?? 0)
      totalCollected += BigInt(r.collected_amount ?? 0)
    } catch {}
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <KPI label="Total Collected" value={formatMoney(totalCollected)} />
        <KPI label="Total Commission" value={formatMoney(totalCommission)} accent="text-emerald-600" />
        <KPI label="Entries" value={String(rows.length)} />
      </div>
      <div className="card-3d overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase text-muted-foreground bg-muted/40">
                <th className="text-left p-2 font-medium">Date</th>
                <th className="text-left p-2 font-medium">Invoice</th>
                <th className="text-right p-2 font-medium">Collected</th>
                <th className="text-right p-2 font-medium">Pct</th>
                <th className="text-right p-2 font-medium">Commission</th>
                <th className="text-left p-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="p-4 text-center text-sm text-muted-foreground">No commission entries in this period.</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className="border-b border-border/40">
                  <td className="p-2 text-xs text-muted-foreground" data-num>{bizDate(r.invoices?.invoice_date ?? r.created_at)}</td>
                  <td className="p-2 font-medium" data-num>{r.invoices?.invoice_no ?? '—'}</td>
                  <td className="p-2 text-right" data-num>{r.collected_amount !== null && r.collected_amount !== undefined ? formatMoney(BigInt(r.collected_amount), false) : '—'}</td>
                  <td className="p-2 text-right" data-num>{Number(r.commission_pct ?? 0).toFixed(2)}%</td>
                  <td className="p-2 text-right font-medium text-emerald-600" data-num>
                    {formatMoney(BigInt(r.commission_amount ?? 0), false)}
                  </td>
                  <td className="p-2">
                    <span className="text-[9px] uppercase px-1 py-0.5 rounded bg-amber-50 text-amber-700">
                      {r.status ?? 'accrued'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
