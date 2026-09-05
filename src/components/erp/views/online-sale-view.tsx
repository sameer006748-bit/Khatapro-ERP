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
import { apiFetchJson } from '@/lib/api-client'
import { PaymentPanel } from '@/components/erp/sales/payment-panel'
import { usePaymentDraft } from '@/components/erp/sales/use-payment-draft'
import { usePaymentAccounts } from '@/components/erp/sales/use-payment-accounts'
import { PageHeader } from '@/components/erp/page-header'
import { userFacingError } from '@/lib/user-facing-error'

type Product = { id: string; name: string; salePrice: number }
type Salesman = { id: string; name: string; isActive?: boolean }
type Rider = { id: string; name: string; phone: string | null; isActive: boolean }
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
    companyDeliveryIncome: '', discountRupees: '', riderId: '',
    invoiceDate: bizDateString(new Date()),
  })
  const [items, setItems] = useState<Item[]>([{ key: '1', productId: '', productName: '', qty: '1', unitPrice: '' }])
  const [result, setResult] = useState<{ ok: boolean; invoiceNo?: string; invoiceId?: string; error?: string; remainingCod?: string; customerGrandTotal?: string } | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  const paymentAccountsQ = usePaymentAccounts()
  const productsQ = useQuery<{ rows: Product[] }>({ queryKey: ['products'], queryFn: ({ signal }) => apiFetchJson('/api/products', { signal }), staleTime: 30_000 })
  const salesmenQ = useQuery<{ rows: Salesman[] }>({ queryKey: ['salesmen'], queryFn: ({ signal }) => apiFetchJson('/api/salesmen', { signal }), staleTime: 300_000, enabled: mustPickSalesman })

  const activeSalesmen = useMemo(() => (salesmenQ.data?.rows ?? []).filter(s => s.isActive !== false), [salesmenQ.data])
  const ridersQ = useQuery<{ rows: Rider[] }>({ queryKey: ['riders'], queryFn: ({ signal }) => apiFetchJson('/api/riders', { signal }), staleTime: 60_000 })
  const activeRiders = useMemo(() => (ridersQ.data?.rows ?? []).filter(r => r.isActive !== false), [ridersQ.data])
  // Same rule as Counter Sale: auto-select only when there is exactly ONE
  // active salesman (unambiguous) — never guess among several.
  const effectiveSalesmanId = useMemo(() => salesmanId || (activeSalesmen.length === 1 ? activeSalesmen[0].id : ''), [salesmanId, activeSalesmen])

  const businessAccounts = paymentAccountsQ.accounts

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

  // ── Advance payment uses the shared payment implementation: single account by
  //    default, split on request. COD, rider earning and delivery income stay
  //    channel-specific below. ──
  const advance = usePaymentDraft({
    accounts: businessAccounts,
    netPayablePaisas: customerGrandTotal,
  })

  const advanceReceived = advance.paidPaisas
  const changeAmount = advance.changePaisas
  const netAdvance = advanceReceived - changeAmount
  const outstanding = customerGrandTotal > netAdvance ? customerGrandTotal - netAdvance : 0n
  const codExpected = outstanding

  const postMut = useMutation({
    mutationFn: async () => {
      const payments = advance.serializedPayments

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
    onSuccess: async (j) => {
      toast.success(`Online sale posted: ${j.invoiceNo}`)
      setResult({ ok: true, invoiceNo: j.invoiceNo, invoiceId: j.invoiceId, remainingCod: j.remainingCod, customerGrandTotal: j.customerGrandTotal })
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      void qc.invalidateQueries({ queryKey: ['trial-balance'] })
      void qc.invalidateQueries({ queryKey: ['products'] })
      // Rider assignment happens after the sale succeeds; its failure must be
      // visible without turning a posted sale into a failed one.
      if (form.riderId && j.deliveryOrderId) {
        try {
          const assignment = await fetch(`/api/delivery-orders/${encodeURIComponent(j.deliveryOrderId)}/assign`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ riderId: form.riderId }),
          })
          if (!assignment.ok) {
            const body = await assignment.json().catch(() => null)
            throw new Error(body?.error ?? 'The rider could not be assigned.')
          }
          void qc.invalidateQueries({ queryKey: ['delivery-orders'] })
        } catch (error) {
          toast.warning(`Sale posted, but rider assignment failed: ${(error as Error).message}`)
        }
      } else if (form.riderId) {
        toast.warning('Sale posted, but no delivery order was available for rider assignment.')
      }
    },
    onError: (e: Error) => {
      const message = userFacingError(e, 'The sale could not be posted. Please review the details and try again.')
      setResult({ ok: false, error: message })
      toast.error(message)
    },
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
              setForm({ customerName: '', customerPhone: '', customerAddress: '', customerCity: '', source: 'WhatsApp', codAmount: '', deliveryFee: '', riderEarning: '', companyDeliveryIncome: '', discountRupees: '', riderId: '', invoiceDate: bizDateString(new Date()) })
              advance.reset()
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
    advance.isValid &&
    !discountError && (form.discountRupees === '' || discountPaisas >= 0n)

  return (
    <div className="space-y-3">
      <PageHeader compact title="Online Sale" description="Record a delivery sale with customer, delivery and payment details." />

      {paymentAccountsQ.isError && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-muted-foreground">
          Payment accounts could not be loaded. Try again before recording an advance.
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.65fr)_minmax(360px,1fr)] lg:items-start">
        <div className="min-w-0 space-y-3">
      {mustPickSalesman && (
        <div className="card-3d p-3 space-y-2">
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

      <div className="card-3d p-3 space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Customer</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          <div><Label className="text-xs text-muted-foreground">Customer name *</Label><Input value={form.customerName} onChange={e => setForm(s => ({ ...s, customerName: e.target.value }))} placeholder="Customer name" className="h-9 bg-background press-sm mt-1" /></div>
          <div><Label className="text-xs text-muted-foreground">Phone *</Label><Input value={form.customerPhone} onChange={e => setForm(s => ({ ...s, customerPhone: e.target.value }))} placeholder="Phone number" className="h-9 bg-background press-sm mt-1" data-num /></div>
          <div><Label className="text-xs text-muted-foreground">Address *</Label><Input value={form.customerAddress} onChange={e => setForm(s => ({ ...s, customerAddress: e.target.value }))} placeholder="Delivery address" className="h-9 bg-background press-sm mt-1" /></div>
          <div><Label className="text-xs text-muted-foreground">City</Label><Input value={form.customerCity} onChange={e => setForm(s => ({ ...s, customerCity: e.target.value }))} placeholder="City" className="h-9 bg-background press-sm mt-1" /></div>
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

      <div className="card-3d p-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-foreground">Items</h2>
          <Button variant="outline" size="sm" onClick={() => setItems(ls => [...ls, { key: String(Date.now()), productId: '', productName: '', qty: '1', unitPrice: '' }])} className="press-sm"><Plus className="size-3" /> Add</Button>
        </div>
        {/* Compact column headers */}
        <div className="grid grid-cols-[minmax(0,2fr)_0.7fr_minmax(0,1fr)_auto] gap-1.5 mb-1 px-1">
          <span className="text-[10px] text-muted-foreground font-medium">Product</span>
          <span className="text-[10px] text-muted-foreground font-medium">Qty</span>
          <span className="text-[10px] text-muted-foreground font-medium">Price (Rs)</span>
          <span className="text-[10px] text-muted-foreground font-medium">Remove</span>
        </div>
        <div className="space-y-1.5 lg:max-h-[calc(100dvh-25rem)] lg:overflow-y-auto lg:pr-1">
          {items.map((it) => (
            <div key={it.key} className="grid grid-cols-[minmax(0,2fr)_0.7fr_minmax(0,1fr)_auto] gap-1.5 items-end">
              <div>
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

        </div>
        <div className="min-w-0 space-y-3 lg:sticky lg:top-3">
      <div className="card-3d p-3 space-y-2">
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

        {/* Rider selector */}
        <div>
          <Label className="text-[10px] text-muted-foreground">Assign Rider (optional)</Label>
          <Select value={form.riderId} onValueChange={v => setForm(s => ({ ...s, riderId: v }))}>
            <SelectTrigger className="h-9 bg-background press-sm text-sm"><SelectValue placeholder="Select a rider..." /></SelectTrigger>
            <SelectContent>
              {activeRiders.map(r => <SelectItem key={r.id} value={r.id}>{r.name}{r.phone ? ` (${r.phone})` : ''}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* An empty dropdown must always say why. A failed rider load used to
              render as "no riders" with no message at all, which is how the
              production 403 stayed invisible. */}
          {ridersQ.isError ? (
            <div className="text-[10px] text-destructive mt-0.5">
              The rider list could not be loaded. Retry, or post the sale and assign a rider from Deliveries.
            </div>
          ) : ridersQ.isSuccess && activeRiders.length === 0 ? (
            <div className="text-[10px] text-destructive mt-0.5">No active rider found. Add one before assigning.</div>
          ) : null}
        </div>

      <PaymentPanel
        accounts={businessAccounts}
        {...advance.panelProps}
        error={advance.error}
        paidLabel="Advance Received (Rs)"
        paidPlaceholder={formatWholeRupees(customerGrandTotal, false)}
        onPayFull={() => advance.setPaidAmount(formatWholeRupees(customerGrandTotal, false).replace(/,/g, ''))}
        idPrefix="online-advance"
      />

      <div className="card-3d p-3 space-y-1">
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
          <div className="flex items-center justify-between rounded-md bg-amber-50 border border-amber-200 px-3 py-2 mt-1">
            <span className="text-xs font-semibold text-amber-700">Change to Return</span>
            <span className="text-sm font-bold text-amber-700" data-num>{formatWholeRupees(changeAmount, false)}</span>
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
      </div>
    </div>
  )
}
