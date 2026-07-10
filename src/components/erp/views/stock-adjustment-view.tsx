'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { toast } from 'sonner'
import { ArrowRight, AlertTriangle, PackagePlus, PackageMinus, History, CheckCircle2 } from 'lucide-react'
import { formatMoney, formatTableDate } from '@/lib/format'
import { bizDate } from '@/lib/dates'
import type { MeUser } from '@/components/erp/erp-app'

type Product = {
  id: string
  name: string
  currentStock: number
  unit: string
}

type Movement = {
  id: string
  productId: string
  productName: string
  movementType: string
  quantity: number
  balanceAfter: number
  reason: string | null
  movementDate: string
  createdAt: string
}

const MOVEMENT_BADGE: Record<string, string> = {
  opening: 'bg-sky-100 text-sky-700',
  adjustment_in: 'bg-emerald-100 text-emerald-700',
  adjustment_out: 'bg-amber-100 text-amber-700',
  temporary_item: 'bg-violet-100 text-violet-700',
  correction: 'bg-slate-100 text-slate-700',
}

export function StockAdjustmentView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const canManage = user.permissions.includes('can_create_products')
  const [productId, setProductId] = useState('')
  const [adjustmentType, setAdjustmentType] = useState<'in' | 'out'>('out')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [result, setResult] = useState<{ ok: boolean; balanceAfter?: number; error?: string } | null>(null)

  const productsQ = useQuery<{ rows: Product[] }>({
    queryKey: ['products', { all: true }],
    queryFn: () => fetch('/api/products').then((r) => r.json()),
  })

  const movementsQ = useQuery<{ rows: Movement[] }>({
    queryKey: ['stock-movements'],
    queryFn: () => fetch('/api/stock-movements').then((r) => r.json()),
  })

  const selectedProduct = productsQ.data?.rows.find((p) => p.id === productId)

  const adjustMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/stock-movements', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          productId,
          movementType: adjustmentType === 'in' ? 'adjustment_in' : 'adjustment_out',
          quantity: parseInt(quantity, 10),
          reason: reason || undefined,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error ?? 'ADJUST_FAILED')
      return j
    },
    onSuccess: (j) => {
      toast.success('Stock adjusted.')
      setResult({ ok: true, balanceAfter: j.balanceAfter })
      void qc.invalidateQueries({ queryKey: ['products'] })
      void qc.invalidateQueries({ queryKey: ['stock-movements'] })
      void qc.invalidateQueries({ queryKey: ['negative-stock'] })
      void qc.invalidateQueries({ queryKey: ['pending-stock'] })
      setQuantity('')
      setReason('')
    },
    onError: (e: Error) => {
      setResult({ ok: false, error: e.message })
      toast.error(`Failed: ${e.message}`)
    },
  })

  const qty = parseInt(quantity, 10) || 0
  const projectedBalance = selectedProduct
    ? adjustmentType === 'in'
      ? selectedProduct.currentStock + qty
      : selectedProduct.currentStock - qty
    : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">Stock Adjustment</h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
          Manually adjust stock in or out. Negative stock is allowed — adjustments are never blocked.
          Each adjustment creates a stock_movements record for full audit trail.
        </p>
      </div>

      {canManage && (
        <div className="card-3d p-5 sm:p-6">
          <h2 className="text-base font-semibold text-foreground mb-4">New adjustment</h2>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); adjustMut.mutate() }}>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Product</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger className="h-10 bg-background press-sm">
                  <SelectValue placeholder="Select product…" />
                </SelectTrigger>
                <SelectContent>
                  {productsQ.data?.rows.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} (current: {p.currentStock} {p.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Adjustment type</Label>
                <RadioGroup
                  value={adjustmentType}
                  onValueChange={(v) => setAdjustmentType(v as 'in' | 'out')}
                  className="grid grid-cols-2 gap-2 pt-1.5"
                >
                  <Label
                    htmlFor="adj-in"
                    className={`flex items-center gap-2 px-3 h-10 border rounded-lg cursor-pointer press-sm ${
                      adjustmentType === 'in' ? 'border-primary bg-accent/60 text-foreground' : 'border-border bg-background text-muted-foreground'
                    }`}
                  >
                    <RadioGroupItem id="adj-in" value="in" />
                    <PackagePlus className="size-4 text-emerald-600" />
                    <span className="text-sm font-medium">Stock In</span>
                  </Label>
                  <Label
                    htmlFor="adj-out"
                    className={`flex items-center gap-2 px-3 h-10 border rounded-lg cursor-pointer press-sm ${
                      adjustmentType === 'out' ? 'border-primary bg-accent/60 text-foreground' : 'border-border bg-background text-muted-foreground'
                    }`}
                  >
                    <RadioGroupItem id="adj-out" value="out" />
                    <PackageMinus className="size-4 text-amber-600" />
                    <span className="text-sm font-medium">Stock Out</span>
                  </Label>
                </RadioGroup>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Quantity (pieces)</Label>
                <Input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="e.g. 5"
                  className="h-10 bg-background press-sm"
                  data-num
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Reason / note (optional)</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Damaged in transit / Found in back room"
                className="bg-background press-sm min-h-[60px]"
              />
            </div>

            {/* Projection */}
            {selectedProduct && qty > 0 && (
              <div className={`card-3d p-4 ${projectedBalance !== null && projectedBalance < 0 ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/30'}`}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Projection</div>
                <div className="flex items-center gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Current:</span>{' '}
                    <span className="font-medium text-foreground" data-num>{selectedProduct.currentStock}</span>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground" />
                  <div>
                    <span className="text-muted-foreground">After:</span>{' '}
                    <span className={`font-semibold ${projectedBalance !== null && projectedBalance < 0 ? 'text-destructive' : 'text-foreground'}`} data-num>
                      {projectedBalance}
                    </span>
                  </div>
                  {projectedBalance !== null && projectedBalance < 0 && (
                    <span className="ml-auto inline-flex items-center gap-1 text-xs text-destructive font-medium">
                      <AlertTriangle className="size-3" /> Negative stock allowed
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={adjustMut.isPending || !productId || !quantity || parseInt(quantity, 10) <= 0}
                className="press-md shadow-sm"
              >
                {adjustMut.isPending ? 'Adjusting…' : (
                  <>
                    <ArrowRight className="size-4" /> Post adjustment
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`card-3d p-5 ${result.ok ? 'border-primary/40' : 'border-destructive/40'}`}>
          <div className="flex items-start gap-3">
            <div className={`grid place-items-center size-9 rounded-xl shrink-0 ${result.ok ? 'icon-3d' : 'bg-destructive/10'}`}>
              {result.ok ? <CheckCircle2 className="size-4 text-primary-foreground" /> : <AlertTriangle className="size-4 text-destructive" />}
            </div>
            <div className="flex-1">
              <div className={`text-sm font-semibold ${result.ok ? 'text-primary' : 'text-destructive'}`}>
                {result.ok ? 'Stock adjusted' : 'Failed'}
              </div>
              {result.ok ? (
                <p className="text-xs text-muted-foreground mt-1">
                  New balance: <span className="font-medium text-foreground" data-num>{result.balanceAfter}</span> pieces
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">{result.error}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recent movements */}
      <div className="card-3d overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
          <History className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Recent stock movements</h2>
          <span className="text-xs text-muted-foreground ml-auto" data-num>{movementsQ.data?.rows.length ?? 0}</span>
        </div>
        {movementsQ.isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : movementsQ.data?.rows.length ? (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                    <th className="text-left p-3.5 font-medium">Date</th>
                    <th className="text-left p-3.5 font-medium">Product</th>
                    <th className="text-left p-3.5 font-medium">Type</th>
                    <th className="text-right p-3.5 font-medium">Qty</th>
                    <th className="text-right p-3.5 font-medium">Balance After</th>
                    <th className="text-left p-3.5 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {movementsQ.data.rows.slice(0, 20).map((m) => (
                    <tr key={m.id} className="border-b border-border/60 last:border-0 hover:bg-accent/30 transition-colors">
                      <td className="p-3.5 text-xs text-foreground" data-num>{bizDate(m.movementDate)}</td>
                      <td className="p-3.5 text-foreground">{m.productName}</td>
                      <td className="p-3.5">
                        <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium ${MOVEMENT_BADGE[m.movementType] ?? 'bg-muted text-muted-foreground'}`} data-num>
                          {m.movementType}
                        </span>
                      </td>
                      <td className="p-3.5 text-right text-foreground" data-num>
                        {m.movementType === 'adjustment_out' ? '-' : '+'}{m.quantity}
                      </td>
                      <td className="p-3.5 text-right font-medium text-foreground" data-num>{m.balanceAfter}</td>
                      <td className="p-3.5 text-xs text-muted-foreground">{m.reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-border/60">
              {movementsQ.data.rows.slice(0, 20).map((m) => (
                <div key={m.id} className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium shrink-0 ${MOVEMENT_BADGE[m.movementType] ?? 'bg-muted text-muted-foreground'}`} data-num>
                        {m.movementType}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{m.productName}</div>
                        <div className="text-xs text-muted-foreground" data-num>{bizDate(m.movementDate)}</div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-foreground" data-num>
                        {m.movementType === 'adjustment_out' ? '-' : '+'}{m.quantity}
                      </div>
                      <div className="text-[10px] text-muted-foreground" data-num>bal: {m.balanceAfter}</div>
                    </div>
                  </div>
                  {m.reason && <p className="text-xs text-muted-foreground">{m.reason}</p>}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="p-6 text-sm text-muted-foreground text-center">No stock movements yet.</div>
        )}
      </div>
    </div>
  )
}

void formatMoney
void formatTableDate
