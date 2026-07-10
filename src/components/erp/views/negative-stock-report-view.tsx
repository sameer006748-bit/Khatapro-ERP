'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Package, TrendingDown } from 'lucide-react'
import { bizDate } from '@/lib/dates'

type Row = {
  productId: string
  productName: string
  categoryName: string | null
  currentStock: number
  isTemporary: boolean
  lastMovementDate: string | null
  lastMovementType: string | null
}

export function NegativeStockReportView() {
  const q = useQuery<{ rows: Row[] }>({
    queryKey: ['negative-stock'],
    queryFn: () => fetch('/api/reports/negative-stock').then((r) => r.json()),
  })

  const rows = q.data?.rows ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">Negative Stock Report</h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
          Products whose current stock is below zero. These were sold or adjusted out before purchase stock arrived.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="card-3d p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Negative items</div>
          <div className="text-2xl font-semibold mt-1 text-destructive" data-num>{rows.length}</div>
        </div>
        <div className="card-3d p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Total shortfall</div>
          <div className="text-2xl font-semibold mt-1 text-destructive" data-num>
            {rows.reduce((s, r) => s + Math.abs(r.currentStock), 0)}
          </div>
        </div>
        <div className="card-3d p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Temporary items</div>
          <div className="text-2xl font-semibold mt-1 text-amber-600" data-num>
            {rows.filter((r) => r.isTemporary).length}
          </div>
        </div>
      </div>

      {q.isLoading ? (
        <div className="card-3d p-8 text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card-3d p-8 text-center">
          <div className="grid place-items-center size-12 rounded-xl icon-3d mx-auto mb-3">
            <TrendingDown className="size-6 text-primary-foreground" />
          </div>
          <p className="text-sm text-foreground font-medium">No negative stock</p>
          <p className="text-xs text-muted-foreground mt-1">All products have stock ≥ 0.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block card-3d overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
              <AlertTriangle className="size-4 text-destructive" />
              <h2 className="text-sm font-semibold text-foreground">Negative stock items</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                  <th className="text-left p-3.5 font-medium">Item</th>
                  <th className="text-left p-3.5 font-medium">Category</th>
                  <th className="text-right p-3.5 font-medium">Current Stock</th>
                  <th className="text-left p-3.5 font-medium">Flags</th>
                  <th className="text-left p-3.5 font-medium">Last Movement</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.productId} className="border-b border-border/60 last:border-0 hover:bg-accent/30 transition-colors">
                    <td className="p-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="grid place-items-center size-8 rounded-lg bg-destructive/10 shrink-0">
                          <Package className="size-4 text-destructive" />
                        </div>
                        <span className="font-medium text-foreground">{r.productName}</span>
                      </div>
                    </td>
                    <td className="p-3.5 text-xs text-muted-foreground">{r.categoryName ?? '—'}</td>
                    <td className="p-3.5 text-right font-semibold text-destructive" data-num>{r.currentStock}</td>
                    <td className="p-3.5">
                      {r.isTemporary && (
                        <span className="text-[10px] uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">Temporary</span>
                      )}
                    </td>
                    <td className="p-3.5 text-xs text-muted-foreground">
                      {r.lastMovementDate ? (
                        <span data-num>{bizDate(r.lastMovementDate)} · {r.lastMovementType}</span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {rows.map((r) => (
              <div key={r.productId} className="card-3d p-4 border-destructive/30">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="grid place-items-center size-10 rounded-xl bg-destructive/10 shrink-0">
                      <Package className="size-5 text-destructive" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">{r.productName}</div>
                      <div className="text-xs text-muted-foreground">{r.categoryName ?? 'Uncategorized'}</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Stock</div>
                    <div className="text-xl font-bold text-destructive" data-num>{r.currentStock}</div>
                  </div>
                </div>
                {r.lastMovementDate && (
                  <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground" data-num>
                    Last: {bizDate(r.lastMovementDate)} · {r.lastMovementType}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
