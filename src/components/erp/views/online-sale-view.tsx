'use client'

import { useState, useMemo } from 'react'
import { bizDateString } from '@/lib/dates'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Plus, Trash2, Globe, CheckCircle2, AlertCircle, Printer, FileText, Send } from 'lucide-react'
import { formatWholeRupees, parseMoney } from '@/lib/format'
import { motion } from 'framer-motion'
import { PrintInvoiceButton } from '@/components/invoice/print-invoice-button'
import { CURRENT_DATABASE_CAPABILITIES } from '@/lib/supabase/rpc-compatibility'
import type { MeUser } from '@/components/erp/erp-app'

type Product = { id: string; name: string; salePrice: number }
type Account = { id: string; code: string; name: string }
type Salesman = { id: string; name: string; commissionPct: number; isActive?: boolean }
type Item = { key: string; productId: string; productName: string; qty: string; unitPrice: string }

export function OnlineSaleView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  // Owner/Admin/Accountant (can_view_sales) must pick the salesman; a
  // salesman-role user (can_view_own_sales only) is resolved server-side.
  const mustPickSalesman = user.permissions.includes('can_view_sales')
  const [salesmanId, setSalesmanId] = useState('')
  const [form, setForm] = useState({
    customerName: '', customerPhone: '', customerAddress: '', customerCity: '',
    source: 'WhatsApp', codAmount: '', deliveryFee: '', riderEarning: '',
    companyDeliveryIncome: '', advanceReceived: '', discountRupees: '',
    invoiceDate: bizDateString(new Date()),
  })
  const [items, setItems] = useState<Item[]>([{ key: '1', productId: '', productName: '', qty: '1', unitPrice: '' }])
  const [paymentAccountId, setPaymentAccountId] = useState('')
  const [result, setResult] = useState<{ ok: boolean; invoiceNo?: string; invoiceId?: string; error?: string; remainingCod?: string; customerGrandTotal?: string } | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  const coaQ = useQuery({ queryKey: ['coa'], queryFn: () => fetch('/api/setup/coa').then(r => r.json()), staleTime: 300_000 })
  const productsQ = useQuery<{ rows: Product[] }>({ queryKey: ['products'], queryFn: () => fetch('/api/products').then(r => r.json()), staleTime: 30_000 })
  const salesmenQ = useQuery<{ rows: Salesman[] }>({ queryKey: ['salesmen'], queryFn: () => fetch('/api/salesmen').then(r => r.json()), staleTime: 300_000, enabled: mustPickSalesman })

  const activeSalesmen = useMemo(() => (salesmenQ.data?.rows ?? []).filter(s => s.isActive !== false), [salesmenQ.data])
  // Same rule as Counter Sale: auto-select only when there is exactly ONE
  // active salesman (unambiguous) — never guess among several.
  const effectiveSalesmanId = useMemo(() => salesmanId || (activeSalesmen.length === 1 ? activeSalesmen[0].id : ''), [salesmanId, activeSalesmen])

  const businessAccounts: Account[] = useMemo(() => {
    if (!coaQ.data?.categories) return []
    return coaQ.data.categories.flatMap((c: any) => c.accounts).filter((a: any) => a.isBusinessAccount && a.isActive).map((a: any) => ({ id: a.id, code: a.code, name: a.name }))
  }, [coaQ.data])

  const effectivePaymentAccountId = useMemo(() => {
    if (paymentAccountId) return paymentAccountId
    if (businessAccounts.length > 0) {
      const cash = businessAccounts.find(a => a.name === 'Cash' || a.code === '1010')
      return cash?.id ?? businessAccounts[0].id
    }
    return ''
  }, [paymentAccountId, businessAccounts])

  const subtotal = items.reduce((acc, it) => acc + (parseMoney(it.unitPrice) ?? 0n) * BigInt(parseInt(it.qty) || 0), 0n)
  const discountPaisas = useMemo(() => {
    const v = parseMoney(form.discountRupees)
    if (v === null) return 0n
    return v
  }, [form.discountRupees])
  const discountError = discountPaisas < 0n ? 'Discount cannot be negative' : discountPaisas > subtotal ? 'Discount exceeds subtotal' : null
  const netProductTotal = subtotal - discountPaisas
  const deliveryFeePaisas = parseMoney(form.deliveryFee) ?? 0n
  const riderEarningPaisas = parseMoney(form.riderEarning) ?? 0n
  const companyDeliveryIncomePaisas = parseMoney(form.companyDeliveryIncome) ?? 0n
  const customerGrandTotal = netProductTotal + deliveryFeePaisas

  const advanceReceived = parseMoney(form.advanceReceived) ?? 0n
  const changeAmount = advanceReceived > customerGrandTotal ? advanceReceived - customerGrandTotal : 0n
  const netAdvance = advanceReceived - changeAmount
  const outstanding = customerGrandTotal > netAdvance ? customerGrandTotal - netAdvance : 0n
  const codExpected = outstanding

  const postMut = useMutation({
    mutationFn: async () => {
      const payments: Array<{ accountId: string; amount: string; isChange?: boolean }> = []
      if (advanceReceived > 0n) {
        payments.push({ accountId: effectivePaymentAccountId, amount: advanceReceived.toString() })
      }
      if (changeAmount > 0n) {
        payments.push({ accountId: effectivePaymentAccountId, amount: changeAmount.toString(), isChange: true })
      }

      const r = await fetch('/api/sales/online', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invoiceType: 'ONLINE', invoiceDate: form.invoiceDate,
          items: items.filter(it => it.productId || it.productName).map(it => ({
            productId: it.productId || null,
            productName: it.productName || productsQ.data?.rows.find(p => p.id === it.productId)?.name || 'Item',
            qty: parseInt(it.qty) || 1, unitPrice: it.unitPrice,
          })),
          payments,
          salesmanId: mustPickSalesman ? effectiveSalesmanId : undefined,
          customerName: form.customerName, customerPhone: form.customerPhone,
          customerAddress: form.customerAddress, customerCity: form.customerCity || undefined,
          memo: form.source ? `Source: ${form.source}${form.deliveryFee ? ` · Delivery: Rs ${form.deliveryFee}` : ''}` : undefined,
          deliveryCharge: form.deliveryFee || undefined,
          riderEarning: form.riderEarning || undefined,
          companyDeliveryIncome: form.companyDeliveryIncome || undefined,
          source: form.source || undefined,
          discountPaisas: discountPaisas.toString(),
          // Phase-9-only: the deployed Phase-8 post_sale has no idempotency
          // argument and fails closed if one is sent. Omit on Phase 8; the
          // Phase-9 branch keeps sending it for future use.
          ...(CURRENT_DATABASE_CAPABILITIES.salesIdempotency ? { idempotencyKey } : {}),
        }),
      })

      // Defensive parsing: the server may return a non-JSON body (empty
      // response, proxy timeout, HTML error page). Read text first and only
      // parse valid JSON so we never surface raw HTML, stack traces, or a
      // "Unexpected end of JSON input" from an empty error body.
      const requestId = r.headers.get('x-request-id')
      const raw = await r.text()
      let parsed: any = null
      if (raw) {
        try { parsed = JSON.parse(raw) } catch { parsed = null }
      }
      if (!r.ok) {
        const serverMsg = parsed && typeof parsed.message === 'string' ? parsed.message
          : parsed && typeof parsed.error === 'string' ? parsed.error : null
        let msg = serverMsg ?? 'Could not post online sale. Please try again.'
        if (requestId) msg += ` (Ref: ${requestId})`
        throw new Error(msg)
      }
      if (!parsed) throw new Error('Unexpected server response. Please try again.')
      // Surface a delivery-order seam failure without disguising it as success.
      if (parsed.deliveryError) {
        toast.warning(parsed.deliveryErrorMessage ?? 'Invoice posted, but the delivery order failed.')
      }
      return parsed
    },
    onSuccess: (j) => {
      toast.success(`Online sale posted: ${j.invoiceNo}`)
      setResult({ ok: true, invoiceNo: j.invoiceNo, invoiceId: j.invoiceId, remainingCod: j.remainingCod, customerGrandTotal: j.customerGrandTotal })
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
          <h2 className="text-xl font-semibold text-foreground">Online Sale Posted!</h2>
          <p className="text-3xl font-bold text-primary mt-1" data-num>{result.invoiceNo}</p>
          {result.customerGrandTotal && (
            <p className="text-sm text-muted-foreground mt-2">Grand Total: <span className="font-medium text-foreground" data-num>{formatWholeRupees(BigInt(result.customerGrandTotal))}</span></p>
          )}
          {result.remainingCod && (
            <p className="text-sm text-muted-foreground">COD Expected: <span className="font-medium text-amber-600" data-num>{formatWholeRupees(BigInt(result.remainingCod))}</span></p>
          )}
          <div className="mt-6 flex flex-col gap-2">
            <Button className="press-md shadow-sm" onClick={() => window.open(`/?invoice=${result.invoiceId}`, '_self')}><FileText className="size-4" /> View Invoice</Button>
            <PrintInvoiceButton invoiceId={result.invoiceId} label="Print Invoice" size="default" className="w-full justify-center" icon={Printer} />
            <Button variant="ghost" className="press-sm" onClick={() => {
              setResult(null)
              setItems([{ key: String(Date.now()), productId: '', productName: '', qty: '1', unitPrice: '' }])
              setForm({ customerName: '', customerPhone: '', customerAddress: '', customerCity: '', source: 'WhatsApp', codAmount: '', deliveryFee: '', riderEarning: '', companyDeliveryIncome: '', advanceReceived: '', discountRupees: '', invoiceDate: bizDateString(new Date()) })
              setIdempotencyKey(crypto.randomUUID())
            }}><Globe className="size-4" /> New Order</Button>
          </div>
        </motion.div>
      </div>
    )
  }

  const canPost = form.customerName && form.customerPhone && form.customerAddress &&
    items.some(it => it.productId || it.productName) &&
    (!mustPickSalesman || !!effectiveSalesmanId) &&
    !discountError && (form.discountRupees === '' || discountPaisas >= 0n)

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">Online Sale</h1>

      {mustPickSalesman && (
        <div className="card-3d p-4 space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Salesman *</h2>
          <Select value={salesmanId} onValueChange={setSalesmanId}>
            <SelectTrigger className="h-11 bg-background press-sm text-sm"><SelectValue placeholder="Select salesman…" /></SelectTrigger>
            <SelectContent>{activeSalesmen.map(s => <SelectItem key={s.id} value={s.id} className="min-h-11">{s.name}</SelectItem>)}</SelectContent>
          </Select>
          {salesmenQ.isSuccess && activeSalesmen.length === 0 && (
            <div className="text-[10px] text-destructive">No active salesman found. Add one before posting.</div>
          )}
        </div>
      )}

      <div className="card-3d p-4 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Customer</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          <Input value={form.customerName} onChange={e => setForm(s => ({ ...s, customerName: e.target.value }))} placeholder="Name *" className="h-9 bg-background press-sm" />
          <Input value={form.customerPhone} onChange={e => setForm(s => ({ ...s, customerPhone: e.target.value }))} placeholder="Phone *" className="h-9 bg-background press-sm" data-num />
          <Input value={form.customerAddress} onChange={e => setForm(s => ({ ...s, customerAddress: e.target.value }))} placeholder="Address *" className="h-9 bg-background press-sm" />
          <Input value={form.customerCity} onChange={e => setForm(s => ({ ...s, customerCity: e.target.value }))} placeholder="City" className="h-9 bg-background press-sm" />
        </div>
        <div>
          <div className="sm:max-w-sm">
            <Label className="text-[10px] text-muted-foreground">Source</Label>
            <Select value={form.source} onValueChange={v => setForm(s => ({ ...s, source: v }))}>
              <SelectTrigger className="h-9 bg-background press-sm text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['WhatsApp', 'Facebook', 'Instagram', 'Manual'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Discount (Rs, optional)</Label>
          <Input type="text" value={form.discountRupees} onChange={e => setForm(s => ({ ...s, discountRupees: e.target.value }))} placeholder="0" className="h-8 bg-background press-sm text-sm max-w-[200px]" data-num />
          {discountError && <div className="text-[10px] text-destructive mt-0.5">{discountError}</div>}
        </div>
      </div>

      <div className="card-3d p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-foreground">Items</h2>
          <Button variant="outline" size="sm" onClick={() => setItems(ls => [...ls, { key: String(Date.now()), productId: '', productName: '', qty: '1', unitPrice: '' }])} className="press-sm"><Plus className="size-3" /> Add</Button>
        </div>
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
      </div>

      <div className="card-3d p-4 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Delivery</h2>
        <div className="grid sm:grid-cols-3 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">Delivery Fee (Rs)</Label>
            <Input type="text" value={form.deliveryFee} onChange={e => setForm(s => ({ ...s, deliveryFee: e.target.value }))} placeholder="0" className="h-9 bg-background press-sm" data-num />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Rider Earning (Rs)</Label>
            <Input type="text" value={form.riderEarning} onChange={e => setForm(s => ({ ...s, riderEarning: e.target.value }))} placeholder="0" className="h-9 bg-background press-sm" data-num />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Company Income (Rs)</Label>
            <Input type="text" value={form.companyDeliveryIncome} onChange={e => setForm(s => ({ ...s, companyDeliveryIncome: e.target.value }))} placeholder="0" className="h-9 bg-background press-sm" data-num />
          </div>
        </div>
        {deliveryFeePaisas > 0n && (riderEarningPaisas + companyDeliveryIncomePaisas !== deliveryFeePaisas) && (
          <div className="text-[10px] text-amber-600">Warning: Rider earning + Company income must equal Delivery Fee</div>
        )}
      </div>

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

      <div className="card-3d p-4 space-y-1">
        <h2 className="text-sm font-semibold text-foreground mb-2">Reconciled Totals</h2>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Product Subtotal</span><span className="font-medium" data-num>{formatWholeRupees(subtotal, false)}</span>
        </div>
        {discountPaisas > 0n && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Discount</span><span className="font-medium text-amber-600" data-num>−{formatWholeRupees(discountPaisas, false)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Net Product Total</span><span className="font-medium" data-num>{formatWholeRupees(netProductTotal, false)}</span>
        </div>
        {deliveryFeePaisas > 0n && (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Customer Delivery Charge</span><span className="font-medium" data-num>{formatWholeRupees(deliveryFeePaisas, false)}</span>
            </div>
            <div className="flex items-center justify-between text-xs pl-4">
              <span className="text-muted-foreground">Rider Earning</span><span data-num>{formatWholeRupees(riderEarningPaisas, false)}</span>
            </div>
            <div className="flex items-center justify-between text-xs pl-4">
              <span className="text-muted-foreground">Company Delivery Income</span><span data-num>{formatWholeRupees(companyDeliveryIncomePaisas, false)}</span>
            </div>
          </>
        )}
        <div className="flex items-center justify-between text-sm pt-1 border-t border-border">
          <span className="font-semibold text-foreground">Customer Grand Total</span><span className="font-bold text-primary" data-num>{formatWholeRupees(customerGrandTotal)}</span>
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
          <span className="text-muted-foreground">Net Advance</span><span className="font-medium text-primary" data-num>{formatWholeRupees(netAdvance, false)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Outstanding</span><span className="font-medium text-destructive" data-num>{formatWholeRupees(outstanding, false)}</span>
        </div>
        <div className="flex items-center justify-between text-sm pt-1 border-t border-border">
          <span className="font-semibold text-foreground">COD Expected</span><span className="font-bold text-amber-600" data-num>{formatWholeRupees(codExpected)}</span>
        </div>
      </div>

      {result && !result.ok && <div className="card-3d p-3 border-destructive/40 flex items-center gap-2"><AlertCircle className="size-4 text-destructive" /><span className="text-xs text-destructive">{result.error}</span></div>}

      <Button className="w-full press-md shadow-sm" disabled={postMut.isPending || !canPost} onClick={() => postMut.mutate()}>
        {postMut.isPending ? 'Posting…' : <><Globe className="size-4" /> Post Online Sale</>}
      </Button>
    </div>
  )
}