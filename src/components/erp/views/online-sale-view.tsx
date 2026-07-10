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
import { Plus, Trash2, Globe, CheckCircle2, AlertCircle } from 'lucide-react'
import { formatMoney, parseMoney } from '@/lib/format'
import { motion } from 'framer-motion'
import type { MeUser } from '@/components/erp/erp-app'

type Product = { id: string; name: string; salePrice: number }
type BusinessAccount = { id: string; name: string; type: string }

type Item = { key: string; productId: string; productName: string; qty: string; unitPrice: string }

export function OnlineSaleView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    customerName: '', customerPhone: '', customerAddress: '', customerCity: '', invoiceDate: new Date().toISOString().slice(0, 10), memo: '',
  })
  const [items, setItems] = useState<Item[]>([{ key: '1', productId: '', productName: '', qty: '1', unitPrice: '' }])
  const [paymentAccountId, setPaymentAccountId] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [result, setResult] = useState<{ ok: boolean; invoiceNo?: string; error?: string } | null>(null)

  const productsQ = useQuery<{ rows: Product[] }>({ queryKey: ['products'], queryFn: () => fetch('/api/products').then(r => r.json()) })
  const accountsQ = useQuery<{ rows: BusinessAccount[] }>({ queryKey: ['business-accounts'], queryFn: () => fetch('/api/setup/business-accounts').then(r => r.json()) })

  const subtotal = items.reduce((acc, it) => acc + (parseMoney(it.unitPrice) ?? 0n) * BigInt(parseInt(it.qty) || 0), 0n)

  const postMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/sales/online', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invoiceType: 'ONLINE', invoiceDate: form.invoiceDate,
          items: items.filter(it => it.productId || it.productName).map(it => ({
            productId: it.productId || null,
            productName: it.productName || productsQ.data?.rows.find(p => p.id === it.productId)?.name || 'Item',
            qty: parseInt(it.qty) || 1, unitPrice: it.unitPrice,
          })),
          payments: [{ accountId: paymentAccountId, amount: paymentAmount }],
          customerName: form.customerName, customerPhone: form.customerPhone,
          customerAddress: form.customerAddress, customerCity: form.customerCity,
          memo: form.memo || undefined,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error ?? 'POST_FAILED')
      return j
    },
    onSuccess: (j) => {
      toast.success(`Online sale posted: ${j.invoiceNo}`)
      setResult({ ok: true, invoiceNo: j.invoiceNo })
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      void qc.invalidateQueries({ queryKey: ['trial-balance'] })
      void qc.invalidateQueries({ queryKey: ['products'] })
      setItems([{ key: String(Date.now()), productId: '', productName: '', qty: '1', unitPrice: '' }])
      setForm({ customerName: '', customerPhone: '', customerAddress: '', customerCity: '', invoiceDate: new Date().toISOString().slice(0, 10), memo: '' })
      setPaymentAccountId(''); setPaymentAmount('')
    },
    onError: (e: Error) => { setResult({ ok: false, error: e.message }); toast.error(`Failed: ${e.message}`) },
  })

  function onProductSelect(key: string, productId: string) {
    const p = productsQ.data?.rows.find(x => x.id === productId)
    setItems(ls => ls.map(i => i.key === key ? { ...i, productId, productName: p?.name ?? '', unitPrice: p ? String(Math.round(p.salePrice * 100)) : '' } : i))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">Online Sale</h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
          Online sale shell. Customer name/phone/address required. Full rider COD workflow arrives in Phase 7.
          Invoice number from shared sequence (INV-0001, INV-0002, ...).
        </p>
      </div>

      <div className="card-3d p-5 sm:p-6">
        <h2 className="text-base font-semibold text-foreground mb-4">Customer details</h2>
        <div className="grid sm:grid-cols-2 gap-3.5">
          <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Customer name *</Label><Input value={form.customerName} onChange={e => setForm(s => ({ ...s, customerName: e.target.value }))} className="h-10 bg-background press-sm" /></div>
          <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Phone *</Label><Input value={form.customerPhone} onChange={e => setForm(s => ({ ...s, customerPhone: e.target.value }))} className="h-10 bg-background press-sm" data-num /></div>
          <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Address *</Label><Input value={form.customerAddress} onChange={e => setForm(s => ({ ...s, customerAddress: e.target.value }))} className="h-10 bg-background press-sm" /></div>
          <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">City</Label><Input value={form.customerCity} onChange={e => setForm(s => ({ ...s, customerCity: e.target.value }))} className="h-10 bg-background press-sm" /></div>
          <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Date</Label><Input type="date" value={form.invoiceDate} onChange={e => setForm(s => ({ ...s, invoiceDate: e.target.value }))} className="h-10 bg-background press-sm" data-num /></div>
        </div>
      </div>

      {/* Items */}
      <div className="card-3d overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Items</h2>
          <Button variant="outline" size="sm" onClick={() => setItems(ls => [...ls, { key: String(Date.now()), productId: '', productName: '', qty: '1', unitPrice: '' }])} className="press-sm"><Plus className="size-3.5" /> Add</Button>
        </div>
        <div className="divide-y divide-border/60">
          {items.map((it) => (
            <div key={it.key} className="p-4 grid sm:grid-cols-4 gap-2 items-end">
              <div className="sm:col-span-2 space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">Product</Label>
                <Select value={it.productId} onValueChange={v => onProductSelect(it.key, v)}>
                  <SelectTrigger className="h-9 bg-background press-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>{productsQ.data?.rows.map(p => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label className="text-[10px] text-muted-foreground">Qty</Label><Input type="number" value={it.qty} onChange={e => setItems(ls => ls.map(i => i.key === it.key ? { ...i, qty: e.target.value } : i))} className="h-9 bg-background press-sm" data-num /></div>
              <div className="flex gap-2">
                <div className="flex-1 space-y-1.5"><Label className="text-[10px] text-muted-foreground">Unit Price</Label><Input type="text" value={it.unitPrice} onChange={e => setItems(ls => ls.map(i => i.key === it.key ? { ...i, unitPrice: e.target.value } : i))} placeholder="0" className="h-9 bg-background press-sm" data-num /></div>
                <button onClick={() => setItems(ls => ls.length <= 1 ? ls : ls.filter(i => i.key !== it.key))} className="text-muted-foreground hover:text-destructive mb-2"><Trash2 className="size-4" /></button>
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-border bg-muted/30 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span><span className="font-semibold text-foreground" data-num>{formatMoney(subtotal)}</span>
        </div>
      </div>

      {/* Payment */}
      <div className="card-3d p-5 sm:p-6">
        <h2 className="text-base font-semibold text-foreground mb-4">Payment</h2>
        <div className="grid sm:grid-cols-2 gap-3.5">
          <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Account</Label>
            <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
              <SelectTrigger className="h-10 bg-background press-sm"><SelectValue placeholder="Select account…" /></SelectTrigger>
              <SelectContent>{accountsQ.data?.rows.map(a => (<SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>))}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Amount (Rs)</Label><Input type="text" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} placeholder="0" className="h-10 bg-background press-sm" data-num /></div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => postMut.mutate()} disabled={postMut.isPending || !form.customerName || !form.customerPhone || !form.customerAddress || !paymentAccountId || !paymentAmount} className="press-md shadow-sm">
          {postMut.isPending ? 'Posting…' : (<><Globe className="size-4" /> Post online sale</>)}
        </Button>
      </div>

      {result && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`card-3d p-5 ${result.ok ? 'border-primary/40' : 'border-destructive/40'}`}>
          <div className="flex items-start gap-3">
            <div className={`grid place-items-center size-9 rounded-xl shrink-0 ${result.ok ? 'icon-3d' : 'bg-destructive/10'}`}>
              {result.ok ? <CheckCircle2 className="size-4 text-primary-foreground" /> : <AlertCircle className="size-4 text-destructive" />}
            </div>
            <div><div className={`text-sm font-semibold ${result.ok ? 'text-primary' : 'text-destructive'}`}>{result.ok ? 'Online sale posted' : 'Failed'}</div>{result.ok ? <p className="text-xs text-muted-foreground mt-1">Invoice: <span className="font-mono font-medium" data-num>{result.invoiceNo}</span></p> : <p className="text-xs text-muted-foreground mt-1">{result.error}</p>}</div>
          </div>
        </motion.div>
      )}
    </div>
  )
}
