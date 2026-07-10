'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Plus, X, Trash2, ShoppingCart, AlertCircle, CheckCircle2, ArrowRight, Package } from 'lucide-react'
import { formatMoney, parseMoney } from '@/lib/format'
import { motion } from 'framer-motion'
import type { MeUser } from '@/components/erp/erp-app'

type Product = { id: string; name: string; currentStock: number; salePrice: number; unit: string }
type Salesman = { id: string; name: string; commissionPct: number }
type BusinessAccount = { id: string; name: string; type: string; ledger: { code: string; name: string } }

type Item = {
  key: string
  productId: string
  productName: string
  qty: string
  unitPrice: string
  isTemporary: boolean
}

type Payment = {
  key: string
  accountId: string
  amount: string
  isChange: boolean
}

export function CounterSaleView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [salesmanId, setSalesmanId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [memo, setMemo] = useState('')
  const [items, setItems] = useState<Item[]>([
    { key: '1', productId: '', productName: '', qty: '1', unitPrice: '', isTemporary: false },
  ])
  const [payments, setPayments] = useState<Payment[]>([
    { key: '1', accountId: '', amount: '', isChange: false },
  ])
  const [result, setResult] = useState<{ ok: boolean; invoiceNo?: string; invoiceId?: string; error?: string } | null>(null)

  const productsQ = useQuery<{ rows: Product[] }>({
    queryKey: ['products'],
    queryFn: () => fetch('/api/products').then((r) => r.json()),
  })
  const salesmenQ = useQuery<{ rows: Salesman[] }>({
    queryKey: ['salesmen'],
    queryFn: () => fetch('/api/salesmen').then((r) => r.json()),
  })
  const accountsQ = useQuery<{ rows: BusinessAccount[] }>({
    queryKey: ['business-accounts'],
    queryFn: () => fetch('/api/setup/business-accounts').then((r) => r.json()),
  })

  // Compute totals
  const subtotal = items.reduce((acc, it) => {
    const up = parseMoney(it.unitPrice) ?? 0n
    const q = parseInt(it.qty) || 0
    return acc + up * BigInt(q)
  }, 0n)

  const totalPaid = payments.filter(p => !p.isChange).reduce((acc, p) => {
    return acc + (parseMoney(p.amount) ?? 0n)
  }, 0n)

  const totalChange = payments.filter(p => p.isChange).reduce((acc, p) => {
    return acc + (parseMoney(p.amount) ?? 0n)
  }, 0n)

  const outstanding = subtotal - totalPaid + totalChange

  const postMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/sales/counter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invoiceType: 'COUNTER',
          invoiceDate,
          items: items
            .filter(it => it.productName || it.productId)
            .map(it => ({
              productId: it.productId || null,
              productName: it.productName || productsQ.data?.rows.find(p => p.id === it.productId)?.name || 'Item',
              qty: parseInt(it.qty) || 1,
              unitPrice: it.unitPrice,
              isTemporary: it.isTemporary,
            })),
          payments: payments
            .filter(p => p.accountId && p.amount)
            .map(p => ({
              accountId: p.accountId,
              amount: p.amount,
              isChange: p.isChange,
            })),
          salesmanId,
          customerName: customerName || undefined,
          memo: memo || undefined,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error ?? 'POST_FAILED')
      return j
    },
    onSuccess: (j) => {
      toast.success(`Sale posted: ${j.invoiceNo}`)
      setResult({ ok: true, invoiceNo: j.invoiceNo, invoiceId: j.invoiceId })
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      void qc.invalidateQueries({ queryKey: ['trial-balance'] })
      void qc.invalidateQueries({ queryKey: ['products'] })
      void qc.invalidateQueries({ queryKey: ['stock-movements'] })
      // Reset
      setItems([{ key: String(Date.now()), productId: '', productName: '', qty: '1', unitPrice: '', isTemporary: false }])
      setPayments([{ key: String(Date.now() + 1), accountId: '', amount: '', isChange: false }])
      setCustomerName('')
      setMemo('')
    },
    onError: (e: Error) => {
      setResult({ ok: false, error: e.message })
      toast.error(`Sale failed: ${e.message}`)
    },
  })

  function addItem() {
    setItems(ls => [...ls, { key: String(Date.now()), productId: '', productName: '', qty: '1', unitPrice: '', isTemporary: false }])
  }
  function removeItem(key: string) {
    setItems(ls => ls.length <= 1 ? ls : ls.filter(i => i.key !== key))
  }
  function updateItem(key: string, field: keyof Item, value: string | boolean) {
    setItems(ls => ls.map(i => i.key === key ? { ...i, [field]: value } : i))
  }
  function onProductSelect(key: string, productId: string) {
    const p = productsQ.data?.rows.find(x => x.id === productId)
    setItems(ls => ls.map(i => i.key === key ? {
      ...i,
      productId,
      productName: p?.name ?? '',
      unitPrice: p ? String(Math.round(p.salePrice * 100)) : '',  // convert to paisas
    } : i))
  }

  function addPayment() {
    setPayments(ls => [...ls, { key: String(Date.now()), accountId: '', amount: '', isChange: false }])
  }
  function removePayment(key: string) {
    setPayments(ls => ls.length <= 1 ? ls : ls.filter(p => p.key !== key))
  }
  function updatePayment(key: string, field: keyof Payment, value: string | boolean) {
    setPayments(ls => ls.map(p => p.key === key ? { ...p, [field]: value } : p))
  }

  const canSubmit = salesmanId && items.every(it => (it.productId || it.productName) && it.qty && it.unitPrice) && payments.every(p => p.accountId && p.amount)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">Counter Sale</h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
          Post a counter sale. Salesman is required. Customer is optional. Negative stock is allowed.
          Multiple payment methods + change/refund through a different account supported. Invoice number is generated server-side.
        </p>
      </div>

      {/* Header fields */}
      <div className="card-3d p-5 sm:p-6">
        <div className="grid sm:grid-cols-3 gap-3.5">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Salesman (required) *</Label>
            <Select value={salesmanId} onValueChange={setSalesmanId}>
              <SelectTrigger className="h-10 bg-background press-sm"><SelectValue placeholder="Select salesman…" /></SelectTrigger>
              <SelectContent>
                {salesmenQ.data?.rows.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name} ({s.commissionPct}% commission)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Date</Label>
            <Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className="h-10 bg-background press-sm" data-num />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Customer name (optional)</Label>
            <Input value={customerName} onChange={e => setCustomerName(e.target.value)} className="h-10 bg-background press-sm" placeholder="Walk-in customer" />
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="card-3d overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Items</h2>
          <Button variant="outline" size="sm" onClick={addItem} className="press-sm"><Plus className="size-3.5" /> Add item</Button>
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                <th className="text-left p-3 font-medium">Product</th>
                <th className="text-right p-3 font-medium w-20">Qty</th>
                <th className="text-right p-3 font-medium w-32">Unit Price (Rs)</th>
                <th className="text-right p-3 font-medium w-32">Line Total</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.key} className="border-b border-border/60 last:border-0">
                  <td className="p-3">
                    {it.isTemporary ? (
                      <Input value={it.productName} onChange={e => updateItem(it.key, 'productName', e.target.value)} placeholder="Temporary item name" className="h-9 bg-background press-sm" />
                    ) : (
                      <Select value={it.productId} onValueChange={v => onProductSelect(it.key, v)}>
                        <SelectTrigger className="h-9 bg-background press-sm"><SelectValue placeholder="Select product…" /></SelectTrigger>
                        <SelectContent>
                          {productsQ.data?.rows.map(p => (
                            <SelectItem key={p.id} value={p.id}>{p.name} (stock: {p.currentStock})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <label className="flex items-center gap-1.5 mt-1.5 text-xs cursor-pointer">
                      <input type="checkbox" checked={it.isTemporary} onChange={e => updateItem(it.key, 'isTemporary', e.target.checked)} className="size-3.5 rounded border-border" />
                      <span className="text-muted-foreground">Temporary item</span>
                    </label>
                  </td>
                  <td className="p-3"><Input type="number" value={it.qty} onChange={e => updateItem(it.key, 'qty', e.target.value)} className="h-9 bg-background text-right press-sm w-full" data-num /></td>
                  <td className="p-3"><Input type="text" value={it.unitPrice} onChange={e => updateItem(it.key, 'unitPrice', e.target.value)} placeholder="0" className="h-9 bg-background text-right press-sm w-full" data-num /></td>
                  <td className="p-3 text-right font-medium text-foreground" data-num>
                    {formatMoney((parseMoney(it.unitPrice) ?? 0n) * BigInt(parseInt(it.qty) || 0), false)}
                  </td>
                  <td className="p-3 text-center"><button onClick={() => removeItem(it.key)} disabled={items.length <= 1} className="text-muted-foreground hover:text-destructive disabled:opacity-30 press-sm"><Trash2 className="size-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border/60">
          {items.map((it) => (
            <div key={it.key} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase text-muted-foreground">Item</span>
                <button onClick={() => removeItem(it.key)} disabled={items.length <= 1} className="text-muted-foreground hover:text-destructive disabled:opacity-30"><Trash2 className="size-4" /></button>
              </div>
              {it.isTemporary ? (
                <Input value={it.productName} onChange={e => updateItem(it.key, 'productName', e.target.value)} placeholder="Temporary item name" className="h-9 bg-background press-sm" />
              ) : (
                <Select value={it.productId} onValueChange={v => onProductSelect(it.key, v)}>
                  <SelectTrigger className="h-9 bg-background press-sm"><SelectValue placeholder="Select product…" /></SelectTrigger>
                  <SelectContent>
                    {productsQ.data?.rows.map(p => (<SelectItem key={p.id} value={p.id}>{p.name} (stock: {p.currentStock})</SelectItem>))}
                  </SelectContent>
                </Select>
              )}
              <div className="grid grid-cols-3 gap-2">
                <div><Label className="text-[10px] text-muted-foreground">Qty</Label><Input type="number" value={it.qty} onChange={e => updateItem(it.key, 'qty', e.target.value)} className="h-9 bg-background press-sm" data-num /></div>
                <div className="col-span-2"><Label className="text-[10px] text-muted-foreground">Unit Price</Label><Input type="text" value={it.unitPrice} onChange={e => updateItem(it.key, 'unitPrice', e.target.value)} placeholder="0" className="h-9 bg-background press-sm" data-num /></div>
              </div>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={it.isTemporary} onChange={e => updateItem(it.key, 'isTemporary', e.target.checked)} className="size-3.5 rounded border-border" />
                <span className="text-muted-foreground">Temporary item</span>
              </label>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-border bg-muted/30 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-semibold text-foreground" data-num>{formatMoney(subtotal)}</span>
        </div>
      </div>

      {/* Payments */}
      <div className="card-3d overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Payments</h2>
          <Button variant="outline" size="sm" onClick={addPayment} className="press-sm"><Plus className="size-3.5" /> Add payment</Button>
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                <th className="text-left p-3 font-medium">Account</th>
                <th className="text-right p-3 font-medium w-32">Amount (Rs)</th>
                <th className="text-center p-3 font-medium w-20">Change?</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.key} className="border-b border-border/60 last:border-0">
                  <td className="p-3">
                    <Select value={p.accountId} onValueChange={v => updatePayment(p.key, 'accountId', v)}>
                      <SelectTrigger className="h-9 bg-background press-sm"><SelectValue placeholder="Select account…" /></SelectTrigger>
                      <SelectContent>
                        {accountsQ.data?.rows.map(a => (<SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-3"><Input type="text" value={p.amount} onChange={e => updatePayment(p.key, 'amount', e.target.value)} placeholder="0" className="h-9 bg-background text-right press-sm w-full" data-num /></td>
                  <td className="p-3 text-center"><input type="checkbox" checked={p.isChange} onChange={e => updatePayment(p.key, 'isChange', e.target.checked)} className="size-4 rounded border-border" /></td>
                  <td className="p-3 text-center"><button onClick={() => removePayment(p.key)} disabled={payments.length <= 1} className="text-muted-foreground hover:text-destructive disabled:opacity-30 press-sm"><Trash2 className="size-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile payment cards */}
        <div className="md:hidden divide-y divide-border/60">
          {payments.map((p) => (
            <div key={p.key} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase text-muted-foreground">Payment</span>
                <button onClick={() => removePayment(p.key)} disabled={payments.length <= 1} className="text-muted-foreground"><Trash2 className="size-4" /></button>
              </div>
              <Select value={p.accountId} onValueChange={v => updatePayment(p.key, 'accountId', v)}>
                <SelectTrigger className="h-9 bg-background press-sm"><SelectValue placeholder="Select account…" /></SelectTrigger>
                <SelectContent>
                  {accountsQ.data?.rows.map(a => (<SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>))}
                </SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-2">
                <div><Input type="text" value={p.amount} onChange={e => updatePayment(p.key, 'amount', e.target.value)} placeholder="Amount" className="h-9 bg-background press-sm" data-num /></div>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer h-9 px-3 border border-border rounded-lg">
                  <input type="checkbox" checked={p.isChange} onChange={e => updatePayment(p.key, 'isChange', e.target.checked)} className="size-3.5 rounded border-border" />
                  <span>Change</span>
                </label>
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-border bg-muted/30 grid grid-cols-3 gap-2 text-sm">
          <div><div className="text-[10px] uppercase text-muted-foreground">Paid</div><div className="font-medium text-foreground" data-num>{formatMoney(totalPaid)}</div></div>
          <div><div className="text-[10px] uppercase text-muted-foreground">Change</div><div className="font-medium text-foreground" data-num>{formatMoney(totalChange)}</div></div>
          <div className="text-right"><div className="text-[10px] uppercase text-muted-foreground">Outstanding</div><div className={`font-semibold ${outstanding > 0n ? 'text-amber-600' : outstanding < 0n ? 'text-destructive' : 'text-primary'}`} data-num>{formatMoney(outstanding)}</div></div>
        </div>
      </div>

      {/* Submit */}
      <div className="flex justify-end gap-2">
        <Button onClick={() => postMut.mutate()} disabled={postMut.isPending || !canSubmit} className="press-md shadow-sm">
          {postMut.isPending ? 'Posting…' : (<><ShoppingCart className="size-4" /> Post sale</>)}
        </Button>
      </div>

      {/* Result */}
      {result && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`card-3d p-5 ${result.ok ? 'border-primary/40' : 'border-destructive/40'}`}>
          <div className="flex items-start gap-3">
            <div className={`grid place-items-center size-9 rounded-xl shrink-0 ${result.ok ? 'icon-3d' : 'bg-destructive/10'}`}>
              {result.ok ? <CheckCircle2 className="size-4 text-primary-foreground" /> : <AlertCircle className="size-4 text-destructive" />}
            </div>
            <div className="flex-1">
              <div className={`text-sm font-semibold ${result.ok ? 'text-primary' : 'text-destructive'}`}>{result.ok ? 'Sale posted' : 'Failed'}</div>
              {result.ok ? (
                <>
                  <p className="text-xs text-muted-foreground mt-1">Invoice: <span className="font-mono font-medium text-foreground" data-num>{result.invoiceNo}</span></p>
                  <p className="text-xs text-muted-foreground mt-1">Voucher posted, stock updated, commission calculated on collected amount.</p>
                </>
              ) : (<p className="text-xs text-muted-foreground mt-1">{result.error}</p>)}
            </div>
          </div>
        </motion.div>
      )}

      {/* Test guidance */}
      <div className="card-3d border-primary/30 p-5">
        <h2 className="text-sm font-semibold text-primary mb-2">Phase 4 gate test</h2>
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">Change/refund test:</strong> Bill Rs 8,000, pay Rs 10,000 Cash, Rs 2,000 change via JazzCash.
          Add 1 item (unit price 8000, qty 1), add 2 payments: Cash 10000, JazzCash 2000 (check "Change?").
          Voucher will post: Debit Cash 10000, Credit JazzCash 2000, Credit Sales 8000 — balanced.
        </p>
      </div>
    </div>
  )
}
