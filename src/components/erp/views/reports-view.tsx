'use client'

import { useState, useMemo, Fragment, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatMoney } from '@/lib/format'
import { bizDate, bizDateString } from '@/lib/dates'
import { BarChart3, FileText, Scale, Wallet, Package, Users, Bike, ScrollText, TrendingUp, TrendingDown, Download, Printer, ChevronRight, AlertTriangle, CheckCircle2, ShieldAlert, Filter, List, ListTree, RotateCcw } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { MeUser } from '@/components/erp/erp-app'
import { apiFetchJson } from '@/lib/api-client'
import { PageHeader } from '@/components/erp/page-header'

/**
 * Reporting-side view of the custom account classification. It is a labelling
 * and navigation layer only: the fixed accounting root still decides where an
 * account appears, and no total on this screen is derived from it.
 */
type ReportClassification = {
  hasCustomClassification: boolean
  categories: Array<{ id: string; name: string; rootId: string; isActive: boolean }>
  subcategories: Array<{ id: string; name: string; rootId: string; categoryId: string; isActive: boolean }>
  accounts: Record<string, {
    categoryId: string
    categoryName: string | null
    subcategoryId: string | null
    subcategoryName: string | null
  }>
}

/** Radix has no empty option, so each report selector keeps an explicit "all" value. */
const ALL = '__all__'

type StatementRow = { account_code: string }

type ReportGroup<T> = {
  key: string
  label: string
  total: bigint
  subs: Array<{ key: string; label: string; total: bigint; rows: T[] }>
}

const lastIf = (isLast: boolean) => (isLast ? 1 : 0)

/**
 * Partition one statement section into Category → Subcategory buckets. Every
 * row lands in exactly one bucket, so the subtotals add up to the section total
 * the statement already prints — grouping never recomputes a figure.
 */
function groupByClassification<T extends StatementRow>(
  rows: T[],
  classification: ReportClassification | null,
  amountOf: (row: T) => bigint,
): Array<ReportGroup<T>> {
  const groups: Array<ReportGroup<T>> = []
  for (const row of rows) {
    const label = classification?.accounts[row.account_code] ?? null
    const amount = amountOf(row)
    const categoryKey = label?.categoryId ?? 'ungrouped'
    let group = groups.find((entry) => entry.key === categoryKey)
    if (!group) {
      group = {
        key: categoryKey,
        label: label?.categoryName ?? 'Not grouped in a category',
        total: 0n,
        subs: [],
      }
      groups.push(group)
    }
    group.total += amount
    const subKey = label?.subcategoryId ?? 'direct'
    let sub = group.subs.find((entry) => entry.key === subKey)
    if (!sub) {
      sub = { key: subKey, label: label?.subcategoryName ?? 'Direct accounts', total: 0n, rows: [] }
      group.subs.push(sub)
    }
    sub.total += amount
    sub.rows.push(row)
  }
  groups.sort((a, b) =>
    lastIf(a.key === 'ungrouped') - lastIf(b.key === 'ungrouped') || a.label.localeCompare(b.label))
  for (const group of groups) {
    group.subs.sort((a, b) =>
      lastIf(a.key === 'direct') - lastIf(b.key === 'direct') || a.label.localeCompare(b.label))
  }
  return groups
}

/** "Category › Subcategory" next to an account name; nothing when unclassified. */
function ClassPath({ code, classification }: { code: string; classification: ReportClassification | null }) {
  const label = classification?.accounts[code] ?? null
  const path = label ? [label.categoryName, label.subcategoryName].filter(Boolean).join(' › ') : ''
  return path ? <span className="ml-1.5 text-[10px] text-muted-foreground">{path}</span> : null
}

/** Compact drill-down switch, shown only when the business classifies accounts. */
function GroupToggle({ grouped, onToggle }: { grouped: boolean; onToggle: () => void }) {
  return (
    <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={onToggle}>
      {grouped
        ? <><List className="size-3.5" /> Flat list</>
        : <><ListTree className="size-3.5" /> Group by category</>}
    </Button>
  )
}

/** Compact report filter — a labelled trigger with an explicit "all" option. */
function ReportFilterSelect({ label, allLabel, value, options, onChange }: {
  label: string
  allLabel: string
  value: string
  options: Array<{ id: string; name: string; isActive: boolean }>
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-full sm:w-44 bg-background text-xs" aria-label={label}>
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.isActive ? option.name : `${option.name} (inactive)`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Account lines of one section, flat or grouped by classification. `renderRow`
 * keeps each statement's own line markup, so only the order and the added
 * subtotals differ between the two modes.
 */
function StatementLines<T extends StatementRow>({ rows, grouped, classification, amountOf, renderRow, emptyMessage }: {
  rows: T[]
  grouped: boolean
  classification: ReportClassification | null
  amountOf: (row: T) => bigint
  renderRow: (row: T) => ReactNode
  emptyMessage: string
}) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">{emptyMessage}</p>
  if (!grouped) {
    return <>{rows.map((row) => <Fragment key={row.account_code}>{renderRow(row)}</Fragment>)}</>
  }
  return (
    <>
      {groupByClassification(rows, classification, amountOf).map((group) => (
        <div key={group.key} className="mt-3 first:mt-0">
          <div className="flex justify-between text-[11px] uppercase tracking-wider font-medium text-foreground py-1 border-b border-border">
            <span>{group.label}</span>
            <span data-num>{formatMoney(group.total, false)}</span>
          </div>
          {group.subs.map((sub) => (
            <Fragment key={sub.key}>
              {(group.subs.length > 1 || sub.key !== 'direct') && (
                <div className="flex justify-between text-[11px] text-muted-foreground pt-1.5 pl-2">
                  <span>{sub.label}</span>
                  <span data-num>{formatMoney(sub.total, false)}</span>
                </div>
              )}
              <div className="pl-2">
                {sub.rows.map((row) => <Fragment key={row.account_code}>{renderRow(row)}</Fragment>)}
              </div>
            </Fragment>
          ))}
        </div>
      ))}
    </>
  )
}

type Category = 'overview' | 'financial' | 'sales' | 'purchases' | 'inventory' | 'parties' | 'delivery' | 'audit'
type ReportType = 'overview' | 'profit-loss' | 'balance-sheet' | 'trial-balance' | 'cash-flow' | 'expense' | 'sales-summary' | 'sales-detail' | 'customer-outstanding' | 'vendor-outstanding' | 'inventory-valuation' | 'stock-movements' | 'product-profitability' | 'purchase-detail' | 'delivery-summary' | 'cod-settlements' | 'exceptions'

const CATEGORIES: Array<{ id: Category; label: string; icon: any; reports: Array<{ type: ReportType; label: string; perm: string }> }> = [
  { id: 'overview', label: 'Overview', icon: BarChart3, reports: [{ type: 'overview', label: 'Dashboard', perm: 'can_view_trial_balance' }] },
  { id: 'financial', label: 'Financial', icon: Scale, reports: [
    { type: 'profit-loss', label: 'Profit & Loss', perm: 'can_view_pl' },
    { type: 'balance-sheet', label: 'Balance Sheet', perm: 'can_view_balance_sheet' },
    { type: 'trial-balance', label: 'Trial Balance', perm: 'can_view_trial_balance' },
    { type: 'cash-flow', label: 'Cash/Bank/Wallet', perm: 'can_view_ledgers' },
    { type: 'expense', label: 'Expense Report', perm: 'can_view_ledgers' },
  ] },
  { id: 'sales', label: 'Sales', icon: TrendingUp, reports: [
    { type: 'sales-summary', label: 'Sales Summary', perm: 'can_view_sales_reports' },
    { type: 'sales-detail', label: 'Sales Detail', perm: 'can_view_sales_reports' },
  ] },
  { id: 'purchases', label: 'Purchases', icon: FileText, reports: [
    { type: 'purchase-detail', label: 'Purchase Detail', perm: 'can_view_purchase_reports' },
    { type: 'vendor-outstanding', label: 'Vendor Outstanding', perm: 'can_view_vendor_ledger' },
  ] },
  { id: 'inventory', label: 'Inventory', icon: Package, reports: [
    { type: 'inventory-valuation', label: 'Inventory Valuation', perm: 'can_view_inventory_reports' },
    { type: 'stock-movements', label: 'Stock Movement', perm: 'can_view_inventory_reports' },
    { type: 'product-profitability', label: 'Product Profitability', perm: 'can_view_inventory_reports' },
  ] },
  { id: 'parties', label: 'Parties', icon: Users, reports: [
    { type: 'customer-outstanding', label: 'Customer Outstanding', perm: 'can_view_customer_ledger' },
  ] },
  { id: 'delivery', label: 'Delivery', icon: Bike, reports: [
    { type: 'delivery-summary', label: 'Delivery Summary', perm: 'can_view_delivery_reports' },
    { type: 'cod-settlements', label: 'COD Settlements', perm: 'can_view_delivery_reports' },
  ] },
  { id: 'audit', label: 'Audit', icon: ScrollText, reports: [
    { type: 'exceptions', label: 'Exceptions', perm: 'can_view_audit_reports' },
  ] },
]

export function ReportsView({ user }: { user: MeUser }) {
  const [category, setCategory] = useState<Category>('overview')
  const [reportType, setReportType] = useState<ReportType>('overview')
  const [fromDate, setFromDate] = useState(() => `${bizDateString(new Date()).slice(0, 8)}01`)
  const [toDate, setToDate] = useState(() => bizDateString(new Date()))

  const visibleCategories = CATEGORIES.filter(c => c.reports.some(r => user.permissions.includes(r.perm)) || c.id === 'overview' || c.id === 'audit')

  function setPreset(preset: string) {
    const toDateStr = bizDateString(new Date())
    const year = Number(toDateStr.slice(0, 4))
    const month = Number(toDateStr.slice(5, 7))
    let fromStr = toDateStr
    if (preset === 'today') fromStr = toDateStr
    else if (preset === 'thisMonth') fromStr = `${toDateStr.slice(0, 8)}01`
    else if (preset === 'lastMonth') {
      const previousYear = month === 1 ? year - 1 : year
      const previousMonth = month === 1 ? 12 : month - 1
      fromStr = `${previousYear}-${String(previousMonth).padStart(2, '0')}-01`
    } else if (preset === 'thisYear') fromStr = `${year}-01-01`
    setFromDate(fromStr); setToDate(toDateStr)
  }

  function selectReport(type: ReportType) { setReportType(type) }

  // Resolve the human-readable label of the currently-selected report (for print header).
  const currentReportLabel = useMemo(() => {
    for (const cat of CATEGORIES) {
      const r = cat.reports.find(x => x.type === reportType)
      if (r) return r.label
    }
    return 'Dashboard'
  }, [reportType])

  function exportCsv() {
    // Real CSV download — let the browser fetch the file.
    // For account-ledger CSV we pass the ledger drill-down accountId if any.
    const url = new URL('/api/reports/csv', window.location.origin)
    url.searchParams.set('type', reportType)
    url.searchParams.set('fromDate', fromDate)
    url.searchParams.set('toDate', toDate)
    // If we're currently viewing an account-ledger drill-down via ?ledger=, include it.
    const urlParams = new URLSearchParams(window.location.search)
    const ledgerId = urlParams.get('ledger')
    if (ledgerId) url.searchParams.set('accountId', ledgerId)
    // Trigger browser download (same-origin, no CORS issue).
    window.location.href = url.toString()
  }

  return (
    <div className="space-y-4">
      <PageHeader
        compact
        title="Reports"
        description="Financial, sales, purchase, inventory and delivery reports."
        actions={<>
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="size-3.5" /> CSV</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="size-3.5" /> Print</Button>
        </>}
      />

      {/* Date filters */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex gap-1">
          {['today', 'thisMonth', 'lastMonth', 'thisYear'].map(p => (
            <button key={p} onClick={() => setPreset(p)} className="px-2.5 py-1.5 rounded-md text-xs font-medium press-sm bg-muted text-muted-foreground hover:bg-muted/70">{p === 'today' ? 'Today' : p === 'thisMonth' ? 'This Month' : p === 'lastMonth' ? 'Last Month' : 'This Year'}</button>
          ))}
        </div>
        <div><Label className="text-[10px] text-muted-foreground">From</Label><Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-8 bg-background text-sm w-36" data-num /></div>
        <div><Label className="text-[10px] text-muted-foreground">To</Label><Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="h-8 bg-background text-sm w-36" data-num /></div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {visibleCategories.map(cat => (
          <button key={cat.id} onClick={() => { setCategory(cat.id); if (cat.reports.length > 0) selectReport(cat.reports[0].type) }} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${category === cat.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            <cat.icon className="size-3.5" /> {cat.label}
          </button>
        ))}
      </div>

      {/* Sub-report selector */}
      {category !== 'overview' && (() => {
        const cat = CATEGORIES.find(c => c.id === category)
        const reports = (cat?.reports ?? []).filter(r => user.permissions.includes(r.perm))
        if (reports.length <= 1) return null
        return (
          <div className="flex gap-1 flex-wrap">
            {reports.map(r => (
              <button key={r.type} onClick={() => selectReport(r.type)} className={`px-2.5 py-1.5 rounded-md text-xs font-medium press-sm ${reportType === r.type ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}>{r.label}</button>
            ))}
          </div>
        )
      })()}

      {/* Print-only header — hidden on screen, visible when window.print() fires. */}
      <div className="hidden print:block print-header">
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>KhataPro ERP</h1>
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '4px 0' }}>{currentReportLabel}</h2>
        <p style={{ margin: '2px 0' }}>Period: {fromDate} to {toDate}</p>
        <p style={{ margin: '2px 0' }}>Generated: {new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</p>
      </div>

      {/* Report content */}
      <div className="no-print-break">
        <ReportContent type={reportType} fromDate={fromDate} toDate={toDate} user={user} />
      </div>
    </div>
  )
}

function ReportContent({ type, fromDate, toDate, user }: { type: ReportType; fromDate: string; toDate: string; user: MeUser }) {
  const isFinancialReport = ['profit-loss', 'balance-sheet', 'trial-balance', 'cash-flow', 'expense'].includes(type)
  const q = useQuery<any>({
    queryKey: ['report', type, fromDate, toDate],
    queryFn: ({ signal }) => apiFetchJson<any>(`/api/reports?type=${type}&fromDate=${fromDate}&toDate=${toDate}`, { signal }),
    enabled: !!type,
    retry: false,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  })

  if (q.isLoading) return <div className="card-3d p-8 text-center text-sm text-muted-foreground animate-pulse">Loading report…</div>
  if (q.isError || !q.data) return <div className="card-3d p-8 text-center"><p className="text-sm text-destructive mb-3">{isFinancialReport ? 'Unable to load financial report.' : 'Unable to load report.'}</p><Button variant="outline" size="sm" onClick={() => q.refetch()}>Retry</Button></div>
  if (q.data.error === 'FORBIDDEN') return <div className="card-3d p-8 text-center"><p className="text-sm text-amber-600">You do not have permission to view this report.</p></div>
  if (q.data.availability?.accounting === false) {
    return <div className="card-3d p-8 text-center"><p className="text-sm text-amber-700">{isFinancialReport ? 'Financial report is not available for this business.' : 'This accounting feature is currently unavailable.'}</p></div>
  }

  const rows = q.data?.rows ?? []
  const kpis = q.data?.kpis
  const classification: ReportClassification | null = q.data?.classification ?? null

  switch (type) {
    case 'overview': return <OverviewReport kpis={kpis} bs={q.data} />
    case 'profit-loss': return <ProfitLossReport rows={rows} classification={classification} />
    case 'balance-sheet': return <BalanceSheetReport rows={rows} classification={classification} />
    case 'trial-balance': return <TrialBalanceReport rows={rows} />
    case 'cash-flow': return <CashFlowReport rows={rows} />
    case 'expense': return <ExpenseReport rows={rows} classification={classification} />
    case 'sales-summary': return <SalesSummaryReport rows={rows} />
    case 'sales-detail': return <SalesDetailReport rows={rows} />
    case 'customer-outstanding': return <CustomerOutstandingReport rows={rows} />
    case 'vendor-outstanding': return <VendorOutstandingReport rows={rows} />
    case 'inventory-valuation': return <InventoryValuationReport rows={rows} />
    case 'stock-movements': return <StockMovementReport rows={rows} />
    case 'purchase-detail': return <PurchaseDetailReport rows={rows} />
    case 'delivery-summary': return <DeliverySummaryReport rows={rows} />
    case 'cod-settlements': return <CodSettlementsReport rows={rows} />
    case 'product-profitability': return <ProductProfitabilityReport rows={rows} />
    case 'exceptions': return <ExceptionsReport rows={rows} />
    default: return <div className="text-center py-8 text-sm text-muted-foreground">Select a report.</div>
  }
}

function KPI({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return <div className={`border rounded-lg bg-card p-3 ${warn ? 'border-amber-200' : 'border-border'}`}><div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div><div className={`text-sm font-bold ${warn ? 'text-amber-700' : 'text-foreground'}`} data-num>{value}</div></div>
}

function OverviewReport({ kpis, bs }: { kpis: any; bs: any }) {
  if (!kpis) return <div className="text-center py-8 text-sm text-muted-foreground">No data.</div>
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
        <KPI label="Net Sales" value={formatMoney(BigInt(kpis.netSales))} />
        <KPI label="Gross Profit" value={formatMoney(BigInt(kpis.grossProfit))} />
        <KPI label="Net Profit" value={formatMoney(BigInt(kpis.netProfit))} />
        <KPI label="Total Expenses" value={formatMoney(BigInt(kpis.totalExpenses))} />
        <KPI label="Cash/Bank Balance" value={formatMoney(BigInt(kpis.cashBalance))} />
        <KPI label="Customer Receivable" value={formatMoney(BigInt(kpis.customerReceivable))} />
        <KPI label="Vendor Payable" value={formatMoney(BigInt(kpis.vendorPayable))} />
        <KPI label="Inventory Value" value={formatMoney(BigInt(kpis.inventoryValue))} />
        <KPI label="COD Pending" value={formatMoney(BigInt(kpis.codPending))} warn={BigInt(kpis.codPending) > 0n} />
      </div>
      {/* Balance check */}
      <div className={`card-3d p-4 ${bs.balanced ? 'border-emerald-200' : 'border-amber-300'}`}>
        <div className="flex items-center gap-2">
          {bs.balanced ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertTriangle className="size-4 text-amber-600" />}
          <span className="text-sm font-medium">Balance Sheet: Assets = Liabilities + Equity</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-3 text-xs">
          <div><span className="text-muted-foreground">Assets:</span> <span className="font-medium" data-num>{formatMoney(BigInt(bs.assets))}</span></div>
          <div><span className="text-muted-foreground">Liabilities:</span> <span className="font-medium" data-num>{formatMoney(BigInt(bs.liabilities))}</span></div>
          <div><span className="text-muted-foreground">Equity:</span> <span className="font-medium" data-num>{formatMoney(BigInt(bs.equity))}</span></div>
        </div>
        {!bs.balanced && <div className="mt-2 text-xs text-amber-600">Difference: {formatMoney(BigInt(bs.assets) - BigInt(bs.liabilities) - BigInt(bs.equity))}</div>}
      </div>
    </div>
  )
}

function ProfitLossReport({ rows, classification }: { rows: any[]; classification: ReportClassification | null }) {
  const [grouped, setGrouped] = useState(false)
  const canGroup = classification?.hasCustomClassification === true
  const revenue = rows.filter(r => r.section === 'REVENUE')
  const cogsRows = rows.filter(r => r.section === 'COST_OF_GOODS_SOLD')
  const expenses = rows.filter(r => r.section === 'EXPENSE')
  const totalRevenue = revenue.reduce((sum, row) => sum + BigInt(row.amount ?? 0), 0n)
  const totalCogs = cogsRows.reduce((sum, row) => sum + BigInt(row.amount ?? 0), 0n)
  const totalExpenses = expenses.reduce((sum, row) => sum + BigInt(row.amount ?? 0), 0n)
  const grossProfit = totalRevenue - totalCogs
  const netProfit = grossProfit - totalExpenses
  const amountOf = (row: any) => BigInt(row.amount ?? 0)
  /** Every section keeps its own line markup; only the ordering changes. */
  const line = (r: any) => (
    <div className="flex justify-between text-xs py-1 border-b border-border/30">
      <span>
        <span data-num>{r.account_code}</span> · {r.account_name}
        <ClassPath code={r.account_code} classification={classification} />
      </span>
      <span className="font-medium" data-num>{formatMoney(BigInt(r.amount), false)}</span>
    </div>
  )
  return (
    <div className="space-y-3">
      <div className="card-3d p-3 border-amber-200 bg-amber-50">
        <AlertTriangle className="size-4 text-amber-600 inline mr-2" />
        <span className="text-xs text-amber-700">
          Historical gross profit may be incomplete or estimated where sale-time cost was not recorded.
        </span>
      </div>
      {canGroup && (
        <div className="flex items-center justify-end">
          <GroupToggle grouped={grouped} onToggle={() => setGrouped((on) => !on)} />
        </div>
      )}
      <div className="card-3d p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Revenue</h3>
        <StatementLines
          rows={revenue} grouped={grouped} classification={classification}
          amountOf={amountOf} renderRow={line} emptyMessage="No revenue in this period."
        />
        <div className="flex justify-between text-sm font-bold mt-2 pt-2 border-t border-border">
          <span>Total Revenue</span><span data-num>{formatMoney(totalRevenue)}</span>
        </div>
      </div>
      <div className="card-3d p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Cost of Goods Sold</h3>
        <StatementLines
          rows={cogsRows} grouped={grouped} classification={classification}
          amountOf={amountOf} renderRow={line} emptyMessage="No COGS in this period."
        />
        <div className="flex justify-between text-sm font-bold mt-2 pt-2 border-t border-border"><span>Total COGS</span><span data-num>{formatMoney(totalCogs)}</span></div>
        <div className="flex justify-between text-sm font-bold mt-2 pt-2 border-t border-border"><span>Gross Profit</span><span data-num>{formatMoney(grossProfit)}</span></div>
      </div>
      <div className="card-3d p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Operating Expenses</h3>
        <StatementLines
          rows={expenses} grouped={grouped} classification={classification}
          amountOf={amountOf} renderRow={line} emptyMessage="No expenses in this period."
        />
        <div className="flex justify-between text-sm font-bold mt-2 pt-2 border-t border-border"><span>Net Profit</span><span className={netProfit >= 0n ? 'text-emerald-600' : 'text-rose-600'} data-num>{formatMoney(netProfit)}</span></div>
      </div>
    </div>
  )
}

function BalanceSheetReport({ rows, classification }: { rows: any[]; classification: ReportClassification | null }) {
  const [grouped, setGrouped] = useState(false)
  const canGroup = classification?.hasCustomClassification === true
  const assets = rows.filter(r => r.section === 'ASSET')
  const liabilities = rows.filter(r => r.section === 'LIABILITY')
  const equity = rows.filter(r => r.section === 'EQUITY')
  // Split equity into permanent (Owner Capital, Drawings, Opening Balance) and Current Earnings (calculated)
  const permanentEquity = equity.filter(r => r.is_calculated !== true)
  const currentEarnings = equity.find(r => r.is_calculated === true)
  const totalAssets = assets.reduce((sum, row) => sum + BigInt(row.balance ?? 0), 0n)
  const totalLiabilities = liabilities.reduce((sum, row) => sum + BigInt(row.balance ?? 0), 0n)
  const totalPermanentEquity = permanentEquity.reduce((sum, row) => sum + BigInt(row.balance ?? 0), 0n)
  const currentEarningsAmount = currentEarnings ? BigInt(currentEarnings.balance) : 0n
  const totalEquity = totalPermanentEquity + currentEarningsAmount
  const balanced = totalAssets === totalLiabilities + totalEquity
  return (
    <div className="space-y-3">
      <div className={`card-3d p-3 ${balanced ? 'border-emerald-200' : 'border-amber-300'}`}>
        <div className="flex items-center gap-2 text-xs">
          {balanced ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertTriangle className="size-4 text-amber-600" />}
          <span className="font-medium">
            {balanced
              ? 'Balanced — Assets = Liabilities + Equity (incl. Current Earnings)'
              : `Difference: ${formatMoney(totalAssets - totalLiabilities - totalEquity)}`}
          </span>
        </div>
      </div>
      {canGroup && (
        <div className="flex items-center justify-end">
          <GroupToggle grouped={grouped} onToggle={() => setGrouped((on) => !on)} />
        </div>
      )}
      <Section title="Assets" rows={assets} total={totalAssets} grouped={grouped} classification={classification} />
      <Section title="Liabilities" rows={liabilities} total={totalLiabilities} grouped={grouped} classification={classification} />
      <Section title="Equity" rows={permanentEquity} total={totalPermanentEquity} grouped={grouped} classification={classification} />
      {currentEarnings && (
        <div className="card-3d p-4 border-sky-200 bg-sky-50/30">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Current Earnings</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Calculated from Income − Expense vouchers up to selected date. Not a posted voucher.
              </p>
            </div>
            <span className={`text-sm font-bold ${currentEarningsAmount >= 0n ? 'text-emerald-600' : 'text-rose-600'}`} data-num>
              {formatMoney(currentEarningsAmount)}
            </span>
          </div>
        </div>
      )}
      <div className="card-3d p-4 bg-muted/30">
        <div className="flex justify-between text-sm font-bold">
          <span>Liabilities + Equity</span>
          <span data-num>{formatMoney(totalLiabilities + totalEquity)}</span>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>Assets</span>
          <span data-num>{formatMoney(totalAssets)}</span>
        </div>
        <div className={`flex justify-between text-xs font-medium mt-1 ${balanced ? 'text-emerald-600' : 'text-amber-600'}`}>
          <span>Difference</span>
          <span data-num>{formatMoney(totalAssets - totalLiabilities - totalEquity)}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * One Balance Sheet section. `total` stays the caller's own section total, so
 * the grouped view can only re-order the same lines and add subtotals — the
 * fixed accounting root still decides what belongs in this section.
 */
function Section({ title, rows, total, grouped, classification }: {
  title: string
  rows: any[]
  total: bigint
  grouped?: boolean
  classification?: ReportClassification | null
}) {
  const line = (r: any) => {
    const balance = BigInt(r.balance)
    const isAbnormal = (r.section === 'ASSET' && balance < 0n) || ((r.section === 'LIABILITY' || r.section === 'EQUITY') && balance < 0n)
    return (
      <div className="flex justify-between text-xs py-1 border-b border-border/30">
        <span>
          <span data-num>{r.account_code}</span> · {r.account_name}
          <ClassPath code={r.account_code} classification={classification ?? null} />
          {r.section === 'ASSET' && balance < 0n && <span className="ml-1 text-[9px] text-amber-600">(Credit Balance — abnormal)</span>}
          {r.section === 'LIABILITY' && balance < 0n && <span className="ml-1 text-[9px] text-amber-600">(Debit Balance — advance/drawing)</span>}
          {r.section === 'EQUITY' && balance < 0n && <span className="ml-1 text-[9px] text-amber-600">(Net Loss / Drawing)</span>}
        </span>
        <span className={`font-medium ${isAbnormal ? 'text-amber-700' : ''}`} data-num>{formatMoney(BigInt(r.balance), false)}</span>
      </div>
    )
  }
  return (
    <div className="card-3d p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>
      <StatementLines
        rows={rows} grouped={grouped === true} classification={classification ?? null}
        amountOf={(r) => BigInt(r.balance ?? 0)} renderRow={line}
        emptyMessage="No accounts with balance."
      />
      <div className="flex justify-between text-sm font-bold mt-2 pt-2 border-t border-border"><span>Total {title}</span><span data-num>{formatMoney(total)}</span></div>
    </div>
  )
}

function CashFlowReport({ rows }: { rows: any[] }) {
  return (
    <div className="card-3d overflow-hidden">
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground bg-muted/40"><th className="text-left p-3 font-medium">Account</th><th className="text-right p-3 font-medium">Opening</th><th className="text-right p-3 font-medium">Debit (In)</th><th className="text-right p-3 font-medium">Credit (Out)</th><th className="text-right p-3 font-medium">Closing</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.account_code} className="border-b border-border/40">
          <td className="p-3"><span data-num>{r.account_code}</span> · {r.account_name}</td>
          <td className="p-3 text-right" data-num>{formatMoney(BigInt(r.opening_balance), false)}</td>
          <td className="p-3 text-right text-emerald-600" data-num>{BigInt(r.total_debit) > 0n ? formatMoney(BigInt(r.total_debit), false) : '—'}</td>
          <td className="p-3 text-right text-amber-600" data-num>{BigInt(r.total_credit) > 0n ? formatMoney(BigInt(r.total_credit), false) : '—'}</td>
          <td className="p-3 text-right font-medium" data-num>{formatMoney(BigInt(r.closing_balance), false)}</td>
        </tr>)}</tbody>
      </table></div>
    </div>
  )
}

/**
 * The one financial report that can safely be filtered: it is a flat expense
 * breakdown with its own total, not a statement whose sections have to add up.
 */
function ExpenseReport({ rows, classification }: { rows: any[]; classification: ReportClassification | null }) {
  const [categoryFilter, setCategoryFilter] = useState(ALL)
  const [subcategoryFilter, setSubcategoryFilter] = useState(ALL)
  const canFilter = classification?.hasCustomClassification === true
  const total = rows.reduce((sum, r) => sum + BigInt(r.total_amount ?? 0), 0n)

  const present = new Set(rows
    .map((r) => classification?.accounts[r.account_code]?.categoryId)
    .filter((id): id is string => Boolean(id)))
  const categoryOptions = (classification?.categories ?? []).filter((c) => present.has(c.id))
  const subcategoryOptions = (classification?.subcategories ?? []).filter((s) => categoryFilter === ALL
    ? present.has(s.categoryId)
    : s.categoryId === categoryFilter)

  const filtersActive = canFilter && (categoryFilter !== ALL || subcategoryFilter !== ALL)
  const visible = !filtersActive ? rows : rows.filter((r) => {
    const label = classification?.accounts[r.account_code] ?? null
    if (categoryFilter !== ALL && label?.categoryId !== categoryFilter) return false
    if (subcategoryFilter !== ALL && label?.subcategoryId !== subcategoryFilter) return false
    return true
  })
  const visibleTotal = visible.reduce((sum, r) => sum + BigInt(r.total_amount ?? 0), 0n)

  function selectCategory(value: string) {
    setCategoryFilter(value)
    setSubcategoryFilter(ALL)
  }
  function resetFilters() {
    setCategoryFilter(ALL)
    setSubcategoryFilter(ALL)
  }

  return (
    <div className="space-y-3">
      {canFilter && (
        <div className="card-3d p-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground px-1">
            <Filter className="size-3.5" /> Filter
          </span>
          <ReportFilterSelect
            label="Category" allLabel="All categories" value={categoryFilter}
            options={categoryOptions} onChange={selectCategory}
          />
          <ReportFilterSelect
            label="Subcategory" allLabel="All subcategories" value={subcategoryFilter}
            options={subcategoryOptions} onChange={setSubcategoryFilter}
          />
          {filtersActive && (
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={resetFilters}>
              <RotateCcw className="size-3.5" /> Reset
            </Button>
          )}
        </div>
      )}
      <div className="card-3d p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Expense Breakdown</h3>
        {visible.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {filtersActive ? 'No expenses match these filters.' : 'No expenses in this period.'}
          </p>
        ) : visible.map(r => (
          <div key={r.account_code} className="flex justify-between text-xs py-2 border-b border-border/30">
            <div>
              <span data-num>{r.account_code}</span> · {r.account_name} <span className="text-muted-foreground">({r.entry_count} entries)</span>
              <ClassPath code={r.account_code} classification={classification} />
            </div>
            <span className="font-medium" data-num>{formatMoney(BigInt(r.total_amount), false)}</span>
          </div>
        ))}
        {filtersActive && (
          <div className="flex justify-between text-xs font-medium mt-2 pt-2 border-t border-border/60 text-muted-foreground">
            <span>Filtered total</span><span data-num>{formatMoney(visibleTotal)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm font-bold mt-2 pt-2 border-t border-border"><span>Total Expenses</span><span data-num>{formatMoney(total)}</span></div>
      </div>
    </div>
  )
}

function SalesSummaryReport({ rows }: { rows: any[] }) {
  return (
    <div className="card-3d overflow-hidden">
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground bg-muted/40"><th className="text-left p-3 font-medium">Type</th><th className="text-right p-3 font-medium">Count</th><th className="text-right p-3 font-medium">Subtotal</th><th className="text-right p-3 font-medium">Paid</th><th className="text-right p-3 font-medium">Outstanding</th><th className="text-right p-3 font-medium">Returns</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.invoice_type} className="border-b border-border/40">
          <td className="p-3 font-medium">{r.invoice_type}</td>
          <td className="p-3 text-right" data-num>{r.invoice_count}</td>
          <td className="p-3 text-right" data-num>{formatMoney(BigInt(r.total_subtotal), false)}</td>
          <td className="p-3 text-right text-emerald-600" data-num>{formatMoney(BigInt(r.total_paid), false)}</td>
          <td className="p-3 text-right text-amber-600" data-num>{formatMoney(BigInt(r.total_outstanding), false)}</td>
          <td className="p-3 text-right" data-num>{r.returned_count}</td>
        </tr>)}</tbody>
      </table></div>
    </div>
  )
}

function SalesDetailReport({ rows }: { rows: any[] }) {
  return (
    <div className="card-3d overflow-hidden">
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground bg-muted/40"><th className="text-left p-2 font-medium">Invoice</th><th className="text-left p-2 font-medium">Date</th><th className="text-left p-2 font-medium">Customer</th><th className="text-left p-2 font-medium">Type</th><th className="text-right p-2 font-medium">Total</th><th className="text-right p-2 font-medium">Paid</th><th className="text-right p-2 font-medium">Outstanding</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id} className="border-b border-border/40">
          <td className="p-2 font-medium" data-num>{r.invoice_no}</td>
          <td className="p-2 text-xs text-muted-foreground" data-num>{bizDate(r.invoice_date)}</td>
          <td className="p-2 text-xs">{r.customer_name ?? '—'}</td>
          <td className="p-2"><span className="text-[9px] uppercase px-1 py-0.5 rounded bg-muted">{r.invoice_type}</span></td>
          <td className="p-2 text-right" data-num>{formatMoney(BigInt(r.total), false)}</td>
          <td className="p-2 text-right text-emerald-600" data-num>{formatMoney(BigInt(r.paid_amount), false)}</td>
          <td className="p-2 text-right text-amber-600" data-num>{formatMoney(BigInt(r.total) - BigInt(r.paid_amount), false)}</td>
        </tr>)}</tbody>
      </table></div>
    </div>
  )
}

function CustomerOutstandingReport({ rows }: { rows: any[] }) {
  return (
    <div className="card-3d overflow-hidden">
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground bg-muted/40"><th className="text-left p-2 font-medium">Customer</th><th className="text-left p-2 font-medium">Phone</th><th className="text-right p-2 font-medium">Billed</th><th className="text-right p-2 font-medium">Paid</th><th className="text-right p-2 font-medium">Outstanding</th></tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={5} className="p-4 text-center text-sm text-muted-foreground">No outstanding customers.</td></tr> : rows.map((r, i) => <tr key={i} className="border-b border-border/40">
          <td className="p-2 font-medium">{r.customer_name}</td>
          <td className="p-2 text-xs text-muted-foreground" data-num>{r.customer_phone ?? '—'}</td>
          <td className="p-2 text-right" data-num>{formatMoney(BigInt(r.total_billed), false)}</td>
          <td className="p-2 text-right text-emerald-600" data-num>{formatMoney(BigInt(r.total_paid), false)}</td>
          <td className="p-2 text-right font-medium text-amber-600" data-num>{formatMoney(BigInt(r.outstanding), false)}</td>
        </tr>)}</tbody>
      </table></div>
    </div>
  )
}

function VendorOutstandingReport({ rows }: { rows: any[] }) {
  return (
    <div className="card-3d overflow-hidden">
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground bg-muted/40"><th className="text-left p-2 font-medium">Vendor</th><th className="text-right p-2 font-medium">Purchased</th><th className="text-right p-2 font-medium">Paid</th><th className="text-right p-2 font-medium">Outstanding</th></tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={4} className="p-4 text-center text-sm text-muted-foreground">No outstanding vendors.</td></tr> : rows.map(r => <tr key={r.vendor_id} className="border-b border-border/40">
          <td className="p-2 font-medium">{r.vendor_name}</td>
          <td className="p-2 text-right" data-num>{formatMoney(BigInt(r.total_purchased), false)}</td>
          <td className="p-2 text-right text-emerald-600" data-num>{formatMoney(BigInt(r.total_paid), false)}</td>
          <td className="p-2 text-right font-medium text-amber-600" data-num>{formatMoney(BigInt(r.outstanding), false)}</td>
        </tr>)}</tbody>
      </table></div>
    </div>
  )
}

function InventoryValuationReport({ rows }: { rows: any[] }) {
  const totalValue = rows.reduce((s, r) => s + Number(r.stock_value), 0)
  const negativeStock = rows.filter(r => r.current_stock < 0)
  return (
    <div className="space-y-3">
      <div className="card-3d p-3 bg-muted/30"><div className="flex justify-between"><span className="text-xs text-muted-foreground">Total Inventory Value (positive stock × WAC)</span><span className="text-sm font-bold" data-num>{formatMoney(BigInt(totalValue))}</span></div></div>
      {negativeStock.length > 0 && <div className="card-3d p-3 border-amber-200"><div className="flex items-center gap-2 mb-2"><AlertTriangle className="size-4 text-amber-600" /><span className="text-xs font-medium text-amber-700">Negative Stock Exposure ({negativeStock.length} products)</span></div>{negativeStock.map(r => <div key={r.product_id} className="text-xs text-muted-foreground">{r.product_name}: {r.current_stock} units</div>)}</div>}
      <div className="card-3d overflow-hidden">
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground bg-muted/40"><th className="text-left p-2 font-medium">Product</th><th className="text-right p-2 font-medium">Qty</th><th className="text-right p-2 font-medium">WAC</th><th className="text-right p-2 font-medium">Value</th><th className="text-left p-2 font-medium">Status</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.product_id} className="border-b border-border/40">
            <td className="p-2 font-medium">{r.product_name}</td>
            <td className="p-2 text-right" data-num>{r.current_stock}</td>
            <td className="p-2 text-right" data-num>{formatMoney(BigInt(r.weighted_average_cost), false)}</td>
            <td className="p-2 text-right font-medium" data-num>{formatMoney(BigInt(r.stock_value), false)}</td>
            <td className="p-2">{r.current_stock < 0 ? <span className="text-[9px] uppercase bg-rose-50 text-rose-700 px-1 py-0.5 rounded">Negative</span> : r.current_stock <= r.low_stock_threshold ? <span className="text-[9px] uppercase bg-amber-50 text-amber-700 px-1 py-0.5 rounded">Low</span> : <span className="text-[9px] uppercase bg-emerald-50 text-emerald-700 px-1 py-0.5 rounded">OK</span>}</td>
          </tr>)}</tbody>
        </table></div>
      </div>
    </div>
  )
}

function StockMovementReport({ rows }: { rows: any[] }) {
  return (
    <div className="card-3d overflow-hidden">
      <div className="overflow-x-auto max-h-[70vh] overflow-y-auto"><table className="w-full text-sm">
        <thead className="sticky top-0 bg-card"><tr className="border-b border-border text-[10px] uppercase text-muted-foreground bg-muted/40"><th className="text-left p-2 font-medium">Date</th><th className="text-left p-2 font-medium">Product</th><th className="text-left p-2 font-medium">Type</th><th className="text-right p-2 font-medium">Qty</th><th className="text-right p-2 font-medium">Balance</th><th className="text-left p-2 font-medium">Reason</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id} className="border-b border-border/40">
          <td className="p-2 text-xs text-muted-foreground" data-num>{bizDate(r.movement_date)}</td>
          <td className="p-2">{r.products?.name ?? '—'}</td>
          <td className="p-2"><span className="text-[9px] uppercase px-1 py-0.5 rounded bg-muted">{r.movement_type.replace(/_/g, ' ')}</span></td>
          <td className="p-2 text-right" data-num>{r.quantity}</td>
          <td className="p-2 text-right" data-num>{r.balance_after}</td>
          <td className="p-2 text-xs text-muted-foreground">{r.reason ?? '—'}</td>
        </tr>)}</tbody>
      </table></div>
    </div>
  )
}

function PurchaseDetailReport({ rows }: { rows: any[] }) {
  return (
    <div className="card-3d overflow-hidden">
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground bg-muted/40"><th className="text-left p-2 font-medium">PUR No</th><th className="text-left p-2 font-medium">Date</th><th className="text-left p-2 font-medium">Vendor</th><th className="text-right p-2 font-medium">Total</th><th className="text-right p-2 font-medium">Paid</th><th className="text-right p-2 font-medium">Outstanding</th><th className="text-left p-2 font-medium">Status</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id} className="border-b border-border/40">
          <td className="p-2 font-medium" data-num>{r.purchase_no}</td>
          <td className="p-2 text-xs text-muted-foreground" data-num>{bizDate(r.purchase_date)}</td>
          <td className="p-2">{r.vendors?.name ?? '—'}</td>
          <td className="p-2 text-right" data-num>{formatMoney(BigInt(r.total), false)}</td>
          <td className="p-2 text-right text-emerald-600" data-num>{formatMoney(BigInt(r.paid_amount), false)}</td>
          <td className="p-2 text-right text-amber-600" data-num>{formatMoney(BigInt(r.total) - BigInt(r.paid_amount), false)}</td>
          <td className="p-2"><span className="text-[9px] uppercase px-1 py-0.5 rounded bg-muted">{r.status}</span></td>
        </tr>)}</tbody>
      </table></div>
    </div>
  )
}

function DeliverySummaryReport({ rows }: { rows: any[] }) {
  const stats = { total: rows.length, pending: 0, assigned: 0, outForDelivery: 0, delivered: 0, returned: 0, codPending: 0n }
  rows.forEach(r => { if (r.status === 'pending') stats.pending++; if (r.status === 'assigned') stats.assigned++; if (r.status === 'out_for_delivery') stats.outForDelivery++; if (r.status === 'delivered') { stats.delivered++; stats.codPending += BigInt(r.total_cod_amount) - BigInt(r.cod_collected_amount) } if (r.status === 'returned') stats.returned++ })
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <KPI label="Total" value={String(stats.total)} />
        <KPI label="Pending" value={String(stats.pending)} />
        <KPI label="Assigned" value={String(stats.assigned)} />
        <KPI label="Out" value={String(stats.outForDelivery)} />
        <KPI label="Delivered" value={String(stats.delivered)} />
        <KPI label="Returned" value={String(stats.returned)} />
      </div>
      <div className="card-3d p-3"><div className="flex justify-between"><span className="text-xs text-muted-foreground">COD Pending (unsettled)</span><span className="text-sm font-bold text-amber-600" data-num>{formatMoney(stats.codPending)}</span></div></div>
    </div>
  )
}

function CodSettlementsReport({ rows }: { rows: any[] }) {
  return (
    <div className="card-3d overflow-hidden">
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground bg-muted/40"><th className="text-left p-2 font-medium">Submission</th><th className="text-left p-2 font-medium">Rider</th><th className="text-left p-2 font-medium">Date</th><th className="text-right p-2 font-medium">Amount</th><th className="text-right p-2 font-medium">Fee Ded.</th><th className="text-left p-2 font-medium">Mode</th><th className="text-left p-2 font-medium">Status</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id} className="border-b border-border/40">
          <td className="p-2 font-medium" data-num>{r.submission_no}</td>
          <td className="p-2">{r.riders?.name ?? '—'}</td>
          <td className="p-2 text-xs text-muted-foreground" data-num>{bizDate(r.submitted_date)}</td>
          <td className="p-2 text-right" data-num>{formatMoney(BigInt(r.requested_amount), false)}</td>
          <td className="p-2 text-right" data-num>{BigInt(r.rider_fee_deduction) > 0n ? formatMoney(BigInt(r.rider_fee_deduction), false) : '—'}</td>
          <td className="p-2"><span className="text-[9px] uppercase px-1 py-0.5 rounded bg-muted">{r.settlement_mode}</span></td>
          <td className="p-2"><span className={`text-[9px] uppercase px-1 py-0.5 rounded ${r.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700' : r.status === 'submitted' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>{r.status}</span></td>
        </tr>)}</tbody>
      </table></div>
    </div>
  )
}

function TrialBalanceReport({ rows }: { rows: any[] }) {
  let grandDebit = 0n
  let grandCredit = 0n
  for (const r of rows) {
    try { grandDebit += BigInt(r.total_debit ?? 0) } catch {}
    try { grandCredit += BigInt(r.total_credit ?? 0) } catch {}
  }
  const diff = grandDebit - grandCredit
  const balanced = diff === 0n
  return (
    <div className="space-y-3">
      <div className={`card-3d p-3 ${balanced ? 'border-emerald-200' : 'border-rose-300'}`}>
        <div className="flex items-center gap-2 text-xs">
          {balanced ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertTriangle className="size-4 text-rose-600" />}
          <span className="font-medium">
            {balanced ? 'Trial Balance is balanced' : `Out of balance by ${formatMoney(diff < 0n ? -diff : diff)}`}
          </span>
        </div>
      </div>
      <div className="card-3d overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase text-muted-foreground bg-muted/40">
                <th className="text-left p-2 font-medium">Code</th>
                <th className="text-left p-2 font-medium">Account Name</th>
                <th className="text-left p-2 font-medium">Category</th>
                <th className="text-right p-2 font-medium">Debit</th>
                <th className="text-right p-2 font-medium">Credit</th>
                <th className="text-right p-2 font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="p-4 text-center text-sm text-muted-foreground">No accounts with movements.</td></tr>
              ) : rows.map(r => (
                <tr key={r.account_id ?? r.account_code} className="border-b border-border/40">
                  <td className="p-2 font-medium" data-num>{r.account_code}</td>
                  <td className="p-2">{r.account_name}</td>
                  <td className="p-2 text-xs text-muted-foreground">{r.category_name} <span className="opacity-60">({r.category_type})</span></td>
                  <td className="p-2 text-right" data-num>{BigInt(r.total_debit ?? 0) > 0n ? formatMoney(BigInt(r.total_debit), false) : '—'}</td>
                  <td className="p-2 text-right" data-num>{BigInt(r.total_credit ?? 0) > 0n ? formatMoney(BigInt(r.total_credit), false) : '—'}</td>
                  <td className="p-2 text-right font-medium" data-num>{formatMoney(BigInt(r.balance ?? 0), false)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/30">
                <td colSpan={3} className="p-2 text-xs font-bold uppercase">Totals</td>
                <td className="p-2 text-right text-sm font-bold" data-num>{formatMoney(grandDebit)}</td>
                <td className="p-2 text-right text-sm font-bold" data-num>{formatMoney(grandCredit)}</td>
                <td className="p-2 text-right text-sm font-bold" data-num>{formatMoney(diff)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}

function ProductProfitabilityReport({ rows }: { rows: any[] }) {
  // Segregate rows by cost status:
  //   - "exact" rows: Final, Estimated, Negative-stock adjusted — have real cost data
  //   - "unavailable" rows: Historical cost unavailable, Missing — COGS=0 should NOT be counted as exact profit
  const exactRows = rows.filter(r => ['Final', 'Estimated', 'Negative-stock adjusted'].includes(r.cost_status))
  const unavailableRows = rows.filter(r => ['Historical cost unavailable', 'Missing'].includes(r.cost_status))

  // Honest totals — only from rows with real cost data
  const totals = exactRows.reduce((acc, r) => {
    acc.netSales += BigInt(r.net_product_sales ?? 0)
    acc.cogs += BigInt(r.cogs ?? 0)
    acc.grossProfit += BigInt(r.gross_profit ?? 0)
    acc.invValue += BigInt(r.inventory_value ?? 0)
    return acc
  }, { netSales: 0n, cogs: 0n, grossProfit: 0n, invValue: 0n })
  const totalMargin = totals.netSales > 0n
    ? Number((totals.grossProfit * 10000n) / totals.netSales) / 100
    : 0

  // Unavailable-cost rows shown separately — sales counted but no profit claimed
  const unavailableSales = unavailableRows.reduce((s, r) => s + BigInt(r.net_product_sales ?? 0), 0n)

  return (
    <div className="space-y-3">
      {/* Historical warning */}
      <div className="card-3d p-3 border-amber-200 bg-amber-50/50">
        <div className="flex items-start gap-2">
          <AlertTriangle className="size-4 text-amber-600 mt-0.5" />
          <div className="text-xs text-amber-800">
            <p className="font-medium">Historical gross profit may be incomplete or estimated where sale-time cost was not recorded.</p>
            <p className="mt-1 text-amber-700">Totals below include only products with real cost data. Products with unavailable historical cost are listed separately and excluded from margin calculations to avoid misleading margins above 100%.</p>
          </div>
        </div>
      </div>

      {/* Honest totals — exact-cost rows only */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KPI label="Net Sales (exact cost)" value={formatMoney(totals.netSales)} />
        <KPI label="COGS (exact)" value={formatMoney(totals.cogs)} />
        <KPI label="Gross Profit (exact)" value={formatMoney(totals.grossProfit)} />
        <KPI label="Margin % (exact)" value={`${totalMargin.toFixed(2)}%`} />
      </div>
      {unavailableRows.length > 0 && (
        <div className="card-3d p-3 border-zinc-200 bg-zinc-50/50">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {unavailableRows.length} product(s) with historical cost unavailable — sales of <span className="font-medium" data-num>{formatMoney(unavailableSales)}</span> excluded from margin totals
            </span>
          </div>
        </div>
      )}

      {/* Exact-cost products table */}
      <div className="card-3d overflow-hidden">
        <div className="p-3 border-b border-border bg-muted/30">
          <h3 className="text-sm font-semibold text-foreground">Products with Exact Cost Data</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">Sales with recorded sale-time cost</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase text-muted-foreground bg-muted/40">
                <th className="text-left p-2 font-medium">Product</th>
                <th className="text-left p-2 font-medium">SKU</th>
                <th className="text-right p-2 font-medium">Qty Sold</th>
                <th className="text-right p-2 font-medium">Returned</th>
                <th className="text-right p-2 font-medium">Net Qty</th>
                <th className="text-right p-2 font-medium">Net Sales</th>
                <th className="text-right p-2 font-medium">COGS</th>
                <th className="text-right p-2 font-medium">Gross Profit</th>
                <th className="text-right p-2 font-medium">Margin %</th>
                <th className="text-right p-2 font-medium">Current WAC</th>
                <th className="text-right p-2 font-medium">Stock</th>
                <th className="text-right p-2 font-medium">Inv Value</th>
                <th className="text-left p-2 font-medium">Cost Status</th>
              </tr>
            </thead>
            <tbody>
              {exactRows.length === 0 ? (
                <tr><td colSpan={13} className="p-4 text-center text-sm text-muted-foreground">No products with exact cost data in this period.</td></tr>
              ) : exactRows.map((r, i) => (
                <tr key={r.product_id ?? `exact-${i}`} className="border-b border-border/40">
                  <td className="p-2 font-medium">{r.product_name}</td>
                  <td className="p-2 text-muted-foreground" data-num>{r.sku}</td>
                  <td className="p-2 text-right" data-num>{r.quantity_sold}</td>
                  <td className="p-2 text-right text-amber-600" data-num>{r.returned_quantity > 0 ? r.returned_quantity : '—'}</td>
                  <td className="p-2 text-right font-medium" data-num>{r.net_quantity_sold}</td>
                  <td className="p-2 text-right" data-num>{formatMoney(BigInt(r.net_product_sales), false)}</td>
                  <td className="p-2 text-right" data-num>{formatMoney(BigInt(r.cogs), false)}</td>
                  <td className={`p-2 text-right font-medium ${BigInt(r.gross_profit) >= 0n ? 'text-emerald-600' : 'text-rose-600'}`} data-num>{formatMoney(BigInt(r.gross_profit), false)}</td>
                  <td className="p-2 text-right" data-num>{(r.gross_margin_pct ?? 0).toFixed(2)}%</td>
                  <td className="p-2 text-right" data-num>{formatMoney(BigInt(r.current_wac), false)}</td>
                  <td className={`p-2 text-right ${r.current_stock < 0 ? 'text-rose-600' : ''}`} data-num>{r.current_stock}</td>
                  <td className="p-2 text-right" data-num>{formatMoney(BigInt(r.inventory_value), false)}</td>
                  <td className="p-2"><CostStatusBadge status={r.cost_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Unavailable-cost products table */}
      {unavailableRows.length > 0 && (
        <div className="card-3d overflow-hidden border-zinc-200">
          <div className="p-3 border-b border-border bg-zinc-50/70">
            <h3 className="text-sm font-semibold text-foreground">Products with Historical Cost Unavailable</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Earlier sales where sale-time cost was not recorded. Sales are shown for reference; cost and gross profit are not calculated.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase text-muted-foreground bg-muted/40">
                  <th className="text-left p-2 font-medium">Product</th>
                  <th className="text-left p-2 font-medium">SKU</th>
                  <th className="text-right p-2 font-medium">Qty Sold</th>
                  <th className="text-right p-2 font-medium">Returned</th>
                  <th className="text-right p-2 font-medium">Net Qty</th>
                  <th className="text-right p-2 font-medium">Net Sales</th>
                  <th className="text-right p-2 font-medium">COGS</th>
                  <th className="text-right p-2 font-medium">Gross Profit</th>
                  <th className="text-right p-2 font-medium">Margin %</th>
                  <th className="text-left p-2 font-medium">Cost Status</th>
                </tr>
              </thead>
              <tbody>
                {unavailableRows.map((r, i) => (
                  <tr key={r.product_id ?? `unavail-${i}`} className="border-b border-border/40 bg-zinc-50/30">
                    <td className="p-2 font-medium">{r.product_name}</td>
                    <td className="p-2 text-muted-foreground" data-num>{r.sku}</td>
                    <td className="p-2 text-right" data-num>{r.quantity_sold}</td>
                    <td className="p-2 text-right text-amber-600" data-num>{r.returned_quantity > 0 ? r.returned_quantity : '—'}</td>
                    <td className="p-2 text-right font-medium" data-num>{r.net_quantity_sold}</td>
                    <td className="p-2 text-right" data-num>{formatMoney(BigInt(r.net_product_sales), false)}</td>
                    <td className="p-2 text-right text-muted-foreground" data-num>—</td>
                    <td className="p-2 text-right text-muted-foreground" data-num>—</td>
                    <td className="p-2 text-right text-muted-foreground" data-num>—</td>
                    <td className="p-2"><CostStatusBadge status={r.cost_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function CostStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    'Final': 'bg-emerald-50 text-emerald-700',
    'Estimated': 'bg-amber-50 text-amber-700',
    'Historical cost unavailable': 'bg-zinc-100 text-zinc-600',
    'Missing': 'bg-rose-50 text-rose-700',
    'Negative-stock adjusted': 'bg-sky-50 text-sky-700',
  }
  return <span className={`text-[9px] uppercase px-1 py-0.5 rounded ${styles[status] ?? 'bg-muted text-muted-foreground'}`}>{status}</span>
}

function ExceptionsReport({ rows }: { rows: any[] }) {
  const counts = rows.reduce((acc, r) => {
    acc[r.severity] = (acc[r.severity] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
  const total = rows.length
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <KPI label="Total Issues" value={String(total)} />
        <KPI label="Critical" value={String(counts['CRITICAL'] ?? 0)} warn={(counts['CRITICAL'] ?? 0) > 0} />
        <KPI label="High" value={String(counts['HIGH'] ?? 0)} />
        <KPI label="Medium" value={String(counts['MEDIUM'] ?? 0)} />
        <KPI label="Low" value={String(counts['LOW'] ?? 0)} />
      </div>
      {total === 0 ? (
        <div className="card-3d p-8 text-center">
          <CheckCircle2 className="size-8 text-emerald-600 mx-auto mb-2" />
          <p className="text-sm font-medium text-foreground">No exceptions detected</p>
          <p className="text-xs text-muted-foreground mt-1">All reconciliations balance. Ledger integrity verified.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => <ExceptionRow key={i} row={r} />)}
        </div>
      )}
    </div>
  )
}

function ExceptionRow({ row }: { row: any }) {
  const styles: Record<string, { bg: string; text: string; border: string }> = {
    CRITICAL: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
    HIGH:     { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    MEDIUM:   { bg: 'bg-sky-50',   text: 'text-sky-700',   border: 'border-sky-200' },
    LOW:      { bg: 'bg-zinc-100', text: 'text-zinc-700',  border: 'border-zinc-200' },
  }
  const s = styles[row.severity] ?? styles.MEDIUM
  return (
    <div className={`card-3d p-3 ${s.border}`}>
      <div className="flex items-start gap-3">
        <ShieldAlert className={`size-4 ${s.text} shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-semibold ${s.bg} ${s.text}`}>{row.severity}</span>
            <span className="text-sm font-medium text-foreground">{row.issue}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <span>Ref: <span data-num>{row.reference ?? '—'}</span></span>
            {row.amount && <span>Amount: <span data-num>{formatMoney(BigInt(row.amount), false)}</span></span>}
            {row.date && <span>Date: <span data-num>{row.date}</span></span>}
          </div>
          <div className="text-xs text-foreground mt-1.5">
            <span className="text-muted-foreground">Action: </span>{row.recommended_action}
          </div>
          {row.drill_down && (
            <a href={row.drill_down} className="text-xs text-primary mt-1 inline-flex items-center gap-1 hover:underline">
              Drill down <ChevronRight className="size-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
