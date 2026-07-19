'use client'

import { useState, useMemo } from 'react'
import { bizDateString } from '@/lib/dates'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Plus, Trash2, Truck, CheckCircle2, AlertCircle, Printer, FileText } from 'lucide-react'
import { formatWholeRupees, parseMoney } from '@/lib/format'
import { motion } from 'framer-motion'
import { PrintInvoiceButton } from '@/components/invoice/print-invoice-button'
import { CURRENT_DATABASE_CAPABILITIES } from '@/lib/supabase/rpc-compatibility'
import type { MeUser } from '@/components/erp/erp-app'

type Product = { id: string; name: string; salePrice: number }
type Account = { id: string; code: string; name: string }
type Item = { key: string; productId: string; productName: string; qty: string; unitPrice: string }

export function OfcSaleView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    customerName: '', customerPhone: '', customerCity: '', customerAddress: '',
    courierNote: '', advanceReceived: '', discountRupees: '',
    invoiceDate: bizDateString(new Date()),
  })
  const [items, setItems] = useState<Item[]>([{ key: '1', productId: '', productName: '', qty: '1', unitPrice: '' }])
  const [paymentAccountId, setPaymentAccountId] = useState('')
  const [result, setResult] = useState<{ ok: boolean; invoiceNo?: string; invoiceId?: string; error?: string } | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  const coaQ = useQuery({ queryKey: ['coa'], queryFn: () => fetch('/api/setup/coa').then(r => r.json()), staleTime: 300_000 })
  const productsQ = useQuery<{ rows: Product[] }>({ queryKey: ['products'], queryFn: () => fetch('/api/products').then(r => r.json()), staleTime: 30_000 })

  const businessAccounts: Account[] = useMemo(() => {
    if (!coaQ.data?.categories) return []
    return coaQ.data.categories.flatMap((c: any) => c.accounts).filter((a: any) => a.isBusinessAccount && a.isActive).map((a: any) => ({ id: a.id, code: a.code, name: a.name }))
  }, [coaQ.data])

  const effectivePaymentAccountId = useMemo(() => {
    if (paymentAccountId) return paymentAccountId
    if (businessAccounts.length > 0) {
      const bank = businessAccounts.find(a => a.name === 'Bank' || a.code === '1030') ?? businessAccounts[0]
      return bank.id
    }
    return ''
  }, [paymentAccountId, businessAccounts])

  // ── Phase 9.1 totals with discount ──
  const subtotal = items.reduce((acc, it) => acc + (parseMoney(it.unitPrice) ?? 0n) * BigInt(parseInt(it.qty) || 0), 0n)
  const discountPaisas = useMemo(() => {
    const v = parseMoney(form.discountRupees)
    if (v === null) return 0n
    return v
  }, [form.discountRupees])
  const discountError = discountPaisas < 0n ? 'Discount cannot be negative' : discountPaisas > subtotal ? 'Discount exceeds subtotal' : null
  const finalTotal = subtotal - discountPaisas

  // Advance
  const advanceReceived = parseMoney(form.advanceReceived) ?? 0n
  const changeAmount = advanceReceived > finalTotal ? advanceReceived - finalTotal : 0n
  const netCollected = advanceReceived - changeAmount
  const outstanding = finalTotal > netCollected ? finalTotal - netCollected : 0n

  // OFC requires full advance: netCollected must equal finalTotal
  const ofcUnderpayment = netCollected < finalTotal
  const ofcValid = !ofcUnderpayment && finalTotal > 0n

  const postMut = useMutation({
    mutationFn: async () => {
      const payments: Array<{ accountId: string; amount: string; isChange?: boolean }> = [
        { accountId: effectivePaymentAccountId, amount: advanceReceived.toString() },
      ]
      if (changeAmount > 0n) {
        payments.push({ accountId: effectivePaymentAccountId, amount: changeAmount.toString(), isChange: true })
      }

      const r = await fetch('/api/sales/ofc', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invoiceType: 'OFC', invoiceDate: form.invoiceDate,
          items: items.filter(it => it.productId || it.productName).map(it => ({
            productId: it.productId || null,
            productName: it.productName || productsQ.data?.rows.find(p => p.id === it.productId)?.name || 'Item',
            qty: parseInt(it.qty) || 1, unitPrice: it.unitPrice,
          })),
          payments,
          customerName: form.customerName, customerPhone: form.customerPhone,
          customerAddress: form.customerAddress, customerCity: form.customerCity || undefined,
          memo: form.courierNote ? `Courier: ${form.courierNote}` : undefined,
          courierNote: form.courierNote || undefined,
          discountPaisas: discountPaisas.toString(),
          // Phase-9-only: the deployed Phase-8 post_sale has no idempotency
          // argument and fails closed if one is sent. Omit on Phase 8; the
          // Phase-9 branch keeps sending it for future use.
          ...(CURRENT_DATABASE_CAPABILITIES.salesIdempotency ? { idempotencyKey } : {}),
        }),
      })

      // Defensive parsing: the server may return a non-JSON body (HTML error
      // page, proxy timeout, empty response). Read text first and only parse
      // when it is valid JSON so we never surface raw HTML or stack traces.
      const requestId = r.headers.get('x-request-id')
      const raw = await r.text()
      let parsed: any = null
      if (raw) {
        try { parsed = JSON.parse(raw) } catch { parsed = null }
      }

      if (!r.ok) {
        const serverMsg = parsed && typeof parsed.error === 'string' ? parsed.error : null
        let msg = serverMsg ?? 'Could not post OFC sale. Please try again.'
        if (requestId) msg += ` (Ref: ${requestId})`
        throw new Error(msg)
      }
      if (!parsed) throw new Error('Unexpected server response. Please try again.')
      return parsed
    },
    onSuccess: (j) => {
      toast.success(`OFC sale posted: ${j.invoiceNo}`)
      setResult({ ok: true, invoiceNo: j.invoiceNo, invoiceId: j.invoiceId })
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      void qc.invalidateQueries({ queryKey: ['trial-balance'] })
      void qc.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (e: Error) => { setResult({ ok: false, error: e.message }); toast.error(`Failed: ${e.message}`) },
  })

  function onProductSelect(key: string, productId: string) {
    const p = productsQ.data?.rows.find(x => x.id === productId)
    setItems(ls => ls.map(i => i.key === key ? { ...i, productId, productName: p?.name ?? '', unitPrice: p ? String(p.salePrice) : '' } : i))
  }

  if (result?.ok) {
    return (
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="card-3d border-primary/40 p-8 text-center max-w-md mx-auto">
          <div className="grid place-items-center size-16 rounded-2xl icon-3d mx-auto mb-4"><CheckCircle2 className="size-8 text-primary-foreground" /></div>
          <h2 className="text-xl font-semibold text-foreground">OFC Sale Posted!</h2>
          <p className="text-3xl font-bold text-primary mt-1" data-num>{result.invoiceNo}</p>
          <div className="mt-6 flex flex-col gap-2">
            <Button className="press-md shadow-sm" onClick={() => window.open(`/?invoice=${result.invoiceId}`, '_self')}><FileText className="size-4" /> View Invoice</Button>
            <PrintInvoiceButton invoiceId={result.invoiceId} label="Print Invoice" size="default" className="w-full justify-center" icon={Printer} />
            <Button variant="ghost" className="press-sm" onClick={() => {
              setResult(null)
              setItems([{ key: String(Date.now()), productId: '', productName: '', qty: '1', unitPrice: '' }])
              setForm({ customerName: '', customerPhone: '', customerCity: '', customerAddress: '', courierNote: '', advanceReceived: '', discountRupees: '', invoiceDate: bizDateString(new Date()) })
              setIdempotencyKey(crypto.randomUUID())
            }}><Truck className="size-4" /> New Sale</Button>
          </div>
        </motion.div>
      </div>
    )
  }

  const canPost = form.customerName && form.customerPhone && form.customerAddress && form.customerCity &&
    items.some(it => it.productId || it.productName) &&
    !discountError && (form.discountRupees === '' || discountPaisas >= 0n)

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">OFC Sale</h1>

      {/* ── Customer ── */}
      <div className="card-3d p-4 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Customer</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          <Input value={form.customerName} onChange={e => setForm(s => ({ ...s, customerName: e.target.value }))} placeholder="Name *" className="h-9 bg-background press-sm" />
          <Input value={form.customerPhone} onChange={e => setForm(s => ({ ...s, customerPhone: e.target.value }))} placeholder="Phone *" className="h-9 bg-background press-sm" data-num />
          <Input value={form.customerAddress} onChange={e => setForm(s => ({ ...s, customerAddress: e.target.value }))} placeholder="Address *" className="h-9 bg-background press-sm" />
          <Input value={form.customerCity} onChange={e => setForm(s => ({ ...s, customerCity: e.target.value }))} placeholder="City *" className="h-9 bg-background press-sm" />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Courier Note (optional)</Label>
          <Input value={form.courierNote} onChange={e => setForm(s => ({ ...s, courierNote: e.target.value }))} placeholder="Courier name, tracking # etc." className="h-9 bg-background press-sm text-sm" />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Discount (Rs, optional)</Label>
          <Input type="text" value={form.discountRupees} onChange={e => setForm(s => ({ ...s, discountRupees: e.target.value }))} placeholder="0" className="h-8 bg-background press-sm text-sm max-w-[200px]" data-num />
          {discountError && <div className="text-[10px] text-destructive mt-0.5">{discountError}</div>}
        </div>
      </div>

      {/* ── Items ── */}
      <div className="card-3d p-4 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Items</h2>
        <div className="space-y-1.5">
          {items.map((it) => (
            <div key={it.key} className="grid grid-cols-4 gap-1.5 items-end">
              <div className="col-span-2">
                <Select value={it.productId} onValueChange={v => onProductSelect(it.key, v)}>
                  <SelectTrigger className="h-9 bg-background press-sm text-sm"><SelectValue placeholder="Product…" /></SelectTrigger>
                  <SelectContent>{productsQ.data?.rows.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Input type="number" value={it.qty} onChange={e => setItems(ls => ls.map(i => i.key === it.key ? { ...i, qty: e.target.value } : i))} placeholder="Qty" className="h-9 bg-background press-sm text-sm" data-num />
              <div className="flex gap-1">
                <Input type="text" value={it.unitPrice} onChange={e => setItems(ls => ls.map(i => i.key === it.key ? { ...i, unitPrice: e.target.value } : i))} placeholder="Rs" className="h-9 bg-background press-sm text-sm" data-num />
                <button onClick={() => setItems(ls => ls.length <= 1 ? ls : ls.filter(i => i.key !== it.key))} className="text-muted-foreground mb-2"><Trash2 className="size-4" /></button>
              </div>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" className="press-sm" onClick={() => setItems(ls => [...ls, { key: String(Date.now()), productId: '', productName: '', qty: '1', unitPrice: '' }])}><Plus className="size-3" /> Add</Button>
      </div>

      {/* ── Advance ── */}
      <div className="card-3d p-4 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Advance Payment</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">Advance Received (Rs)</Label>
            <Input type="text" value={form.advanceReceived} onChange={e => setForm(s => ({ ...s, advanceReceived: e.target.value }))} placeholder="0" className="h-9 bg-background press-sm" data-num />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Payment Account</Label>
            <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
              <SelectTrigger className="h-9 bg-background press-sm text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{businessAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.code})</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ── Totals ── */}
      <div className="card-3d p-4 space-y-1">
        <h2 className="text-sm font-semibold text-foreground mb-2">Totals</h2>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span><span className="font-medium" data-num>{formatWholeRupees(subtotal, false)}</span>
        </div>
        {discountPaisas > 0n && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Discount</span><span className="font-medium text-amber-600" data-num>−{formatWholeRupees(discountPaisas, false)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm pt-1 border-t border-border">
          <span className="font-semibold text-foreground">Net Total (Full Advance Required)</span><span className="font-bold text-primary" data-num>{formatWholeRupees(finalTotal)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Advance Received</span><span className="font-medium" data-num>{formatWholeRupees(advanceReceived, false)}</span>
        </div>
        {changeAmount > 0n && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Change</span><span className="font-medium text-amber-600" data-num>−{formatWholeRupees(changeAmount, false)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Net Collected</span><span className="font-medium text-primary" data-num>{formatWholeRupees(netCollected, false)}</span>
        </div>
        {ofcUnderpayment && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Underpayment</span><span className="font-medium text-destructive" data-num>{formatWholeRupees(outstanding, false)}</span>
          </div>
        )}
      </div>

      {ofcUnderpayment && <div className="card-3d p-3 border-destructive/40 flex items-center gap-2"><AlertCircle className="size-4 text-destructive" /><span className="text-xs text-destructive">OFC requires full advance. Received: {formatWholeRupees(netCollected, false)} / Needed: {formatWholeRupees(finalTotal)}</span></div>}
      {result && !result.ok && <div className="card-3d p-3 border-destructive/40 flex items-center gap-2"><AlertCircle className="size-4 text-destructive" /><span className="text-xs text-destructive">{result.error}</span></div>}

      <Button className="w-full press-md shadow-sm" disabled={postMut.isPending || !canPost || !ofcValid} onClick={() => postMut.mutate()}>
        {!ofcValid && finalTotal > 0n ? 'Full advance required' : postMut.isPending ? 'Posting…' : <><Truck className="size-4" /> Post OFC Sale — {formatWholeRupees(finalTotal)}</>}
      </Button>
    </div>
  )
}