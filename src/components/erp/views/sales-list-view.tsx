'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatMoney, formatWholeRupees, formatTableDate } from '@/lib/format'
import { FileText, Search, Printer, X, ShoppingCart, Plus, ArrowDownToLine, RotateCcw } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import { PrintInvoiceButton } from '@/components/invoice/print-invoice-button'

type Invoice = {
  id: string
  invoiceNo: string
  invoiceType: string
  invoiceDate: string
  customerName: string | null
  salesmanName: string | null
  subtotal: string
  total: string
  paidAmount: string
  isCancelled: boolean
  isReturned: boolean
}

const TYPE_BADGE: Record<string, string> = {
  COUNTER: 'bg-emerald-100 text-emerald-700',
  ONLINE: 'bg-sky-100 text-sky-700',
  OFC: 'bg-violet-100 text-violet-700',
}

export function SalesListView() {
  const router = useRouter()
  const [filter, setFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [selected, setSelected] = useState<string[]>([])
  const [selectMode, setSelectMode] = useState(false)

  const q = useQuery<{ rows: Invoice[] }>({
    queryKey: ['invoices', typeFilter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (typeFilter) params.set('type', typeFilter)
      return fetch(`/api/sales/counter?${params}`).then(r => r.json())
    },
  })

  const rows = (q.data?.rows ?? []).filter(r => {
    if (!filter) return true
    const f = filter.toLowerCase()
    return r.invoiceNo.toLowerCase().includes(f) ||
      (r.customerName ?? '').toLowerCase().includes(f) ||
      (r.salesmanName ?? '').toLowerCase().includes(f)
  })

  // Compute summary from loaded data
  const summary = useMemo(() => {
    const totalInvoices = rows.length
    let totalSales = 0n
    let totalOutstanding = 0n
    for (const r of rows) {
      const t = BigInt(r.total)
      const p = BigInt(r.paidAmount)
      totalSales += t
      if (!r.isCancelled && !r.isReturned) totalOutstanding += t - p
    }
    return { totalInvoices, totalSales, totalOutstanding }
  }, [rows])

  function toggleSelect(id: string) {
    setSelected(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      if (prev.length >= 2) return [prev[1], id]
      return [...prev, id]
    })
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelected([])
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">Sales</h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">Create, view and manage all sales invoices.</p>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="border border-border rounded-lg bg-card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Invoices</div>
          <div className="text-lg font-bold text-foreground" data-num>{summary.totalInvoices}</div>
        </div>
        <div className="border border-border rounded-lg bg-card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Sales</div>
          <div className="text-lg font-bold text-foreground" data-num>{formatWholeRupees(summary.totalSales)}</div>
        </div>
        <div className="border border-border rounded-lg bg-card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Outstanding</div>
          <div className={`text-lg font-bold ${summary.totalOutstanding > 0n ? 'text-amber-600' : 'text-foreground'}`} data-num>{formatWholeRupees(summary.totalOutstanding)}</div>
        </div>
      </div>

      {/* Primary action + Quick actions */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="h-10 press-sm shadow-sm" onClick={() => router.push('/?page=counter-sale')}>
          <Plus className="size-4 mr-1.5" /> New Sale
        </Button>
        <Button variant="outline" size="sm" className="h-10 press-sm" onClick={() => router.push('/?page=counter-sale')}>
          <ShoppingCart className="size-4 mr-1.5" /> Counter Sale
        </Button>
        <Button variant="outline" size="sm" className="h-10 press-sm" onClick={() => router.push('/?page=online-sale')}>
          <ShoppingCart className="size-4 mr-1.5" /> Online Sale
        </Button>
        <Button variant="outline" size="sm" className="h-10 press-sm" onClick={() => router.push('/?page=ofc-sale')}>
          <ShoppingCart className="size-4 mr-1.5" /> OFC Sale
        </Button>
        <Button variant="outline" size="sm" className="h-10 press-sm" onClick={() => router.push('/?page=receipt-voucher')}>
          <ArrowDownToLine className="size-4 mr-1.5" /> Receive Payment
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search invoice no, customer, salesman…" className="h-10 bg-background pl-9 press-sm" />
        </div>
        <Button variant={typeFilter === '' ? 'default' : 'outline'} size="sm" className="h-10 press-sm" onClick={() => setTypeFilter('')}>All</Button>
        <Button variant={typeFilter === 'COUNTER' ? 'default' : 'outline'} size="sm" className="h-10 press-sm" onClick={() => setTypeFilter('COUNTER')}>Counter</Button>
        <Button variant={typeFilter === 'ONLINE' ? 'default' : 'outline'} size="sm" className="h-10 press-sm" onClick={() => setTypeFilter('ONLINE')}>Online</Button>
        <Button variant={typeFilter === 'OFC' ? 'default' : 'outline'} size="sm" className="h-10 press-sm" onClick={() => setTypeFilter('OFC')}>OFC</Button>
        <Button
          variant={selectMode ? 'default' : 'outline'}
          size="sm"
          className="h-10 press-sm"
          onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
        >
          {selectMode ? <><X className="size-4" /> Cancel</> : <><Printer className="size-4" /> Batch Print</>}
        </Button>
      </div>

      {selectMode && (
        <div className="card-3d p-3 flex items-center justify-between gap-3 border-primary/30">
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{selected.length}</span> of 2 selected for two-up A4 printing
          </div>
          <div className="flex gap-2">
            {selected.length > 0 && (
              <Button variant="outline" size="sm" className="press-sm" onClick={() => setSelected([])}>Clear</Button>
            )}
            <PrintInvoiceButton
              invoiceIds={selected}
              label={`Print ${selected.length} Invoice${selected.length === 1 ? '' : 's'}`}
              size="sm"
              icon={Printer}
            />
          </div>
        </div>
      )}

      {q.isLoading ? (
        <div className="card-3d p-8 text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card-3d p-8 text-center">
          <div className="grid place-items-center size-12 rounded-xl icon-3d-muted mx-auto mb-3"><FileText className="size-6 text-muted-foreground" /></div>
          <p className="text-sm text-foreground font-medium">No invoices yet</p>
          <p className="text-xs text-muted-foreground mt-1">Post a Counter / Online / OFC sale to see it here.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block card-3d overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Invoices</h2>
              <span className="text-xs text-muted-foreground" data-num>{rows.length} shown</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                  {selectMode && <th className="text-center p-3.5 font-medium w-12">Pick</th>}
                  <th className="text-left p-3.5 font-medium">Invoice #</th>
                  <th className="text-left p-3.5 font-medium">Type</th>
                  <th className="text-left p-3.5 font-medium">Date</th>
                  <th className="text-left p-3.5 font-medium">Customer</th>
                  <th className="text-left p-3.5 font-medium">Salesman</th>
                  <th className="text-right p-3.5 font-medium">Total</th>
                  <th className="text-right p-3.5 font-medium">Paid</th>
                  <th className="text-left p-3.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const outstanding = BigInt(r.total) - BigInt(r.paidAmount)
                  const isSelected = selected.includes(r.id)
                  return (
                    <tr
                      key={r.id}
                      onClick={(e) => {
                        if (selectMode) {
                          e.stopPropagation()
                          toggleSelect(r.id)
                        } else {
                          router.push(`/?invoice=${r.id}`)
                        }
                      }}
                      className={`border-b border-border/60 last:border-0 hover:bg-accent/30 transition-colors cursor-pointer ${isSelected ? 'bg-primary/5' : ''}`}
                    >
                      {selectMode && (
                        <td className="p-3.5 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(r.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="size-4 accent-primary"
                          />
                        </td>
                      )}
                      <td className="p-3.5 font-medium text-foreground" data-num>{r.invoiceNo}</td>
                      <td className="p-3.5"><span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium ${TYPE_BADGE[r.invoiceType] ?? 'bg-muted text-muted-foreground'}`} data-num>{r.invoiceType}</span></td>
                      <td className="p-3.5 text-xs text-muted-foreground" data-num>{formatTableDate(r.invoiceDate)}</td>
                      <td className="p-3.5 text-foreground">{r.customerName ?? 'Walk-in'}</td>
                      <td className="p-3.5 text-xs text-muted-foreground">{r.salesmanName ?? '—'}</td>
                      <td className="p-3.5 text-right font-medium text-foreground" data-num>{formatMoney(BigInt(r.total))}</td>
                      <td className="p-3.5 text-right text-foreground" data-num>{formatMoney(BigInt(r.paidAmount))}</td>
                      <td className="p-3.5">
                        <div className="flex flex-wrap gap-1">
                          {r.isReturned && <span className="text-[10px] uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">Returned</span>}
                          {r.isCancelled && <span className="text-[10px] uppercase bg-destructive/10 text-destructive px-1.5 py-0.5 rounded font-medium">Cancelled</span>}
                          {outstanding > 0n && !r.isReturned && !r.isCancelled && <span className="text-[10px] uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">Outstanding {formatMoney(outstanding, false)}</span>}
                          {!r.isReturned && !r.isCancelled && outstanding === 0n && <span className="text-[10px] uppercase bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">Paid</span>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {rows.map((r) => {
              const outstanding = BigInt(r.total) - BigInt(r.paidAmount)
              const isSelected = selected.includes(r.id)
              return (
                <button
                  key={r.id}
                  onClick={() => {
                    if (selectMode) toggleSelect(r.id)
                    else router.push(`/?invoice=${r.id}`)
                  }}
                  className={`card-3d card-3d-hover p-4 w-full text-left ${isSelected ? 'border-primary ring-2 ring-primary/20' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {selectMode && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(r.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="size-4 accent-primary shrink-0"
                        />
                      )}
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium shrink-0 ${TYPE_BADGE[r.invoiceType] ?? 'bg-muted text-muted-foreground'}`} data-num>{r.invoiceType}</span>
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate" data-num>{r.invoiceNo}</div>
                        <div className="text-xs text-muted-foreground">{r.customerName ?? 'Walk-in'} · {formatTableDate(r.invoiceDate)}</div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold text-foreground" data-num>{formatMoney(BigInt(r.total))}</div>
                      {outstanding > 0n && !r.isReturned && <div className="text-[10px] text-amber-600" data-num>Owe {formatMoney(outstanding, false)}</div>}
                    </div>
                  </div>
                  {(r.isReturned || r.isCancelled) && (
                    <div className="mt-2 flex gap-1">
                      {r.isReturned && <span className="text-[9px] uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">Returned</span>}
                      {r.isCancelled && <span className="text-[9px] uppercase bg-destructive/10 text-destructive px-1.5 py-0.5 rounded font-medium">Cancelled</span>}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}