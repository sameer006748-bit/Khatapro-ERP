'use client'

import { useState, useEffect, useMemo } from 'react'
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
import {
  Plus, Trash2, ShoppingCart, AlertCircle, CheckCircle2, ArrowRight, ArrowLeft,
  Package, Printer, FileText, Wallet, Banknote, Smartphone, Split,
  TrendingDown, User,
} from 'lucide-react'
import { formatMoney, parseMoney } from '@/lib/format'
import { motion, AnimatePresence } from 'framer-motion'
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

type PaymentMode = 'full' | 'partial' | 'change'

export function CounterSaleView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [salesmanId, setSalesmanId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [items, setItems] = useState<Item[]>([
    { key: '1', productId: '', productName: '', qty: '1', unitPrice: '', isTemporary: false },
  ])

  // Payment state
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('full')
  const [fullPaymentAccountId, setFullPaymentAccountId] = useState('')
  const [partialAccountId, setPartialAccountId] = useState('')
  const [partialAmount, setPartialAmount] = useState('')
  const [cashReceivedAccountId, setCashReceivedAccountId] = useState('')
  const [cashReceivedAmount, setCashReceivedAmount] = useState('')
  const [changeAccountId, setChangeAccountId] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  // Advanced: manual payment rows
  const [advPayments, setAdvPayments] = useState<Array<{ key: string; accountId: string; amount: string; isChange: boolean }>>([
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

  // Auto-select salesman if only one exists
  useEffect(() => {
    if (salesmenQ.data?.rows.length === 1 && !salesmanId) {
      setSalesmanId(salesmenQ.data.rows[0].id)
    }
  }, [salesmenQ.data, salesmanId])

  // Auto-select first account for full payment
  useEffect(() => {
    if (accountsQ.data && accountsQ.data.rows && accountsQ.data.rows.length > 0 && !fullPaymentAccountId) {
      setFullPaymentAccountId(accountsQ.data.rows[0].id)
    }
  }, [accountsQ.data, fullPaymentAccountId])

  // Compute subtotal
  const subtotal = useMemo(() => {
    return items.reduce((acc, it) => {
      const up = parseMoney(it.unitPrice) ?? 0n
      const q = parseInt(it.qty) || 0
      return acc + up * BigInt(q)
    }, 0n)
  }, [items])

  const salesman = salesmenQ.data?.rows.find(s => s.id === salesmanId)

  // Compute change for "Cash with Change" mode
  const cashReceived = parseMoney(cashReceivedAmount) ?? 0n
  const changeAmount = cashReceived > subtotal ? cashReceived - subtotal : 0n
  const changeNeeded = changeAmount > 0n

  // Compute partial outstanding
  const partialPaid = parseMoney(partialAmount) ?? 0n
  const partialOutstanding = subtotal - partialPaid

  // Build payments array based on mode
  function buildPayments(): Array<{ accountId: string; amount: bigint; isChange?: boolean }> {
    if (showAdvanced) {
      return advPayments
        .filter(p => p.accountId && p.amount)
        .map(p => ({
          accountId: p.accountId,
          amount: parseMoney(p.amount) ?? 0n,
          isChange: p.isChange,
        }))
    }
    if (paymentMode === 'full') {
      return [{ accountId: fullPaymentAccountId, amount: subtotal }]
    }
    if (paymentMode === 'partial') {
      return [{ accountId: partialAccountId, amount: partialPaid }]
    }
    if (paymentMode === 'change') {
      const payments: Array<{ accountId: string; amount: bigint; isChange?: boolean }> = [
        { accountId: cashReceivedAccountId, amount: cashReceived },
      ]
      if (changeNeeded && changeAccountId) {
        payments.push({ accountId: changeAccountId, amount: changeAmount, isChange: true })
      }
      return payments
    }
    return []
  }

  const payments = buildPayments()
  const totalPaid = payments.filter(p => !p.isChange).reduce((a, p) => a + p.amount, 0n)
  const totalChange = payments.filter(p => p.isChange).reduce((a, p) => a + p.amount, 0n)
  const outstanding = subtotal - totalPaid + totalChange

  // Estimated commission
  const estimatedCommission = salesman && totalPaid > 0n
    ? (totalPaid * BigInt(Math.round(salesman.commissionPct * 100))) / 10000n
    : 0n

  // Stock warnings
  const stockWarnings = items.filter(it => {
    if (!it.productId) return false
    const p = productsQ.data?.rows.find(x => x.id === it.productId)
    if (!p) return false
    return p.currentStock < (parseInt(it.qty) || 0)
  })

  const canProceedToPayment = salesmanId && items.every(it => (it.productId || it.productName) && it.qty && it.unitPrice) && subtotal > 0n
  const canPost = payments.length > 0 && payments.every(p => p.accountId && p.amount > 0n)

  const postMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/sales/counter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invoiceType: 'COUNTER',
          invoiceDate,
          items: items.filter(it => it.productName || it.productId).map(it => ({
            productId: it.productId || null,
            productName: it.productName || productsQ.data?.rows.find(p => p.id === it.productId)?.name || 'Item',
            qty: parseInt(it.qty) || 1,
            unitPrice: it.unitPrice,
            isTemporary: it.isTemporary,
          })),
          payments: payments.map(p => ({
            accountId: p.accountId,
            amount: p.amount.toString(),
            isChange: p.isChange,
          })),
          salesmanId,
          customerName: customerName || undefined,
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
    },
    onError: (e: Error) => {
      setResult({ ok: false, error: e.message })
      toast.error(`Sale failed: ${e.message}`)
    },
  })

  // ─── SUCCESS SCREEN ──────────────────────────────────────────────
  if (result?.ok) {
    return (
      <div className="space-y-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="card-3d border-primary/40 p-8 text-center max-w-md mx-auto"
        >
          <div className="grid place-items-center size-16 rounded-2xl icon-3d mx-auto mb-4">
            <CheckCircle2 className="size-8 text-primary-foreground" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">Sale Posted!</h2>
          <p className="text-sm text-muted-foreground mt-1">Invoice</p>
          <p className="text-3xl font-bold text-primary mt-1" data-num>{result.invoiceNo}</p>
          <div className="mt-6 flex flex-col gap-2">
            <Button
              className="press-md shadow-sm"
              onClick={() => window.open(`/?invoice=${result.invoiceId}`, '_self')}
            >
              <FileText className="size-4" /> View Invoice
            </Button>
            <Button
              variant="outline"
              className="press-sm"
              onClick={() => window.print()}
            >
              <Printer className="size-4" /> Print Invoice
            </Button>
            <Button
              variant="ghost"
              className="press-sm"
              onClick={() => {
                setResult(null)
                setStep(1)
                setItems([{ key: String(Date.now()), productId: '', productName: '', qty: '1', unitPrice: '', isTemporary: false }])
                setCustomerName('')
                setCashReceivedAmount('')
                setPartialAmount('')
              }}
            >
              <ShoppingCart className="size-4" /> New Sale
            </Button>
          </div>
        </motion.div>
      </div>
    )
  }

  // ─── STEP INDICATOR ──────────────────────────────────────────────
  const steps = [
    { num: 1, label: 'Items', icon: Package },
    { num: 2, label: 'Payment', icon: Wallet },
    { num: 3, label: 'Review', icon: CheckCircle2 },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">Counter Sale</h1>
        <p className="text-sm text-muted-foreground mt-1.5">Quick and simple. Add items, choose payment, post.</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.num} className="flex items-center gap-2 flex-1">
            <button
              onClick={() => s.num < step && setStep(s.num as 1 | 2 | 3)}
              disabled={s.num > step}
              className={`flex items-center gap-2 press-sm ${s.num === step ? '' : s.num < step ? 'cursor-pointer' : 'opacity-40'}`}
            >
              <div className={`grid place-items-center size-8 rounded-full text-xs font-semibold ${
                s.num === step ? 'bg-primary text-primary-foreground'
                : s.num < step ? 'bg-primary/20 text-primary'
                : 'bg-muted text-muted-foreground'
              }`}>
                {s.num < step ? <CheckCircle2 className="size-4" /> : s.num}
              </div>
              <span className={`text-sm font-medium ${s.num === step ? 'text-foreground' : 'text-muted-foreground'}`}>{s.label}</span>
            </button>
            {i < steps.length - 1 && <div className={`flex-1 h-0.5 ${s.num < step ? 'bg-primary/30' : 'bg-border'}`} />}
          </div>
        ))}
      </div>

      {/* Salesman + Customer (always visible at top) */}
      <div className="card-3d p-4 sm:p-5">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><User className="size-3" /> Salesman</Label>
            <Select value={salesmanId} onValueChange={setSalesmanId}>
              <SelectTrigger className="h-10 bg-background press-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {salesmenQ.data?.rows.map(s => <SelectItem key={s.id} value={s.id}>{s.name} ({s.commissionPct}%)</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Customer (optional)</Label>
            <Input value={customerName} onChange={e => setCustomerName(e.target.value)} className="h-10 bg-background press-sm" placeholder="Walk-in" />
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* ─── STEP 1: ITEMS ─── */}
        {step === 1 && (
          <motion.div key="step1" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="space-y-4">
            {/* Items list — mobile cards + desktop table */}
            <div className="space-y-3">
              {items.map((it, idx) => {
                const p = productsQ.data?.rows.find(x => x.id === it.productId)
                return (
                  <div key={it.key} className="card-3d p-4">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Item {idx + 1}</span>
                      <button onClick={() => setItems(ls => ls.length <= 1 ? ls : ls.filter(i => i.key !== it.key))} disabled={items.length <= 1} className="text-muted-foreground hover:text-destructive disabled:opacity-30 press-sm">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    {it.isTemporary ? (
                      <Input value={it.productName} onChange={e => setItems(ls => ls.map(i => i.key === it.key ? { ...i, productName: e.target.value } : i))} placeholder="Type item name…" className="h-10 bg-background press-sm mb-3" />
                    ) : (
                      <Select value={it.productId} onValueChange={v => {
                        const prod = productsQ.data?.rows.find(x => x.id === v)
                        setItems(ls => ls.map(i => i.key === it.key ? { ...i, productId: v, productName: prod?.name ?? '', unitPrice: prod ? String(Math.round(prod.salePrice * 100)) : '' } : i))
                      }}>
                        <SelectTrigger className="h-10 bg-background press-sm mb-3"><SelectValue placeholder="Search product…" /></SelectTrigger>
                        <SelectContent>
                          {productsQ.data?.rows.map(p => <SelectItem key={p.id} value={p.id}>{p.name} (stock: {p.currentStock})</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Qty</Label>
                        <Input type="number" value={it.qty} onChange={e => setItems(ls => ls.map(i => i.key === it.key ? { ...i, qty: e.target.value } : i))} className="h-10 bg-background press-sm" data-num />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Unit Price</Label>
                        <Input type="text" value={it.unitPrice} onChange={e => setItems(ls => ls.map(i => i.key === it.key ? { ...i, unitPrice: e.target.value } : i))} placeholder="0" className="h-10 bg-background press-sm" data-num />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Total</Label>
                        <div className="h-10 flex items-center justify-end font-semibold text-foreground" data-num>
                          {formatMoney((parseMoney(it.unitPrice) ?? 0n) * BigInt(parseInt(it.qty) || 0), false)}
                        </div>
                      </div>
                    </div>
                    <label className="flex items-center gap-1.5 mt-2 text-xs cursor-pointer">
                      <input type="checkbox" checked={it.isTemporary} onChange={e => setItems(ls => ls.map(i => i.key === it.key ? { ...i, isTemporary: e.target.checked, productId: e.target.checked ? '' : i.productId } : i))} className="size-3.5 rounded border-border" />
                      <span className="text-muted-foreground">Temporary item</span>
                    </label>
                    {p && p.currentStock < (parseInt(it.qty) || 0) && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-600">
                        <TrendingDown className="size-3" /> Stock will go negative (current: {p.currentStock})
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <Button variant="outline" className="w-full press-sm" onClick={() => setItems(ls => [...ls, { key: String(Date.now()), productId: '', productName: '', qty: '1', unitPrice: '', isTemporary: false }])}>
              <Plus className="size-4" /> Add item
            </Button>

            {/* Running total */}
            <div className="card-3d p-5 bg-primary/5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Bill Total</span>
                <span className="text-2xl font-bold text-primary" data-num>{formatMoney(subtotal)}</span>
              </div>
            </div>

            <Button className="w-full press-md shadow-sm" disabled={!canProceedToPayment} onClick={() => setStep(2)}>
              Continue to Payment <ArrowRight className="size-4" />
            </Button>
          </motion.div>
        )}

        {/* ─── STEP 2: PAYMENT ─── */}
        {step === 2 && (
          <motion.div key="step2" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="space-y-4">
            <div className="card-3d p-5 bg-primary/5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Bill Total</span>
                <span className="text-2xl font-bold text-primary" data-num>{formatMoney(subtotal)}</span>
              </div>
            </div>

            {!showAdvanced && (
              <>
                {/* Payment mode buttons */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <PayModeButton icon={Banknote} label="Full Cash" active={paymentMode === 'full'} onClick={() => setPaymentMode('full')} />
                  <PayModeButton icon={Smartphone} label="Full JazzCash" active={paymentMode === 'full'} onClick={() => { setPaymentMode('full'); const jc = accountsQ.data?.rows.find(a => a.type === 'JazzCash'); if (jc) setFullPaymentAccountId(jc.id) }} />
                  <PayModeButton icon={Wallet} label="Cash + Change" active={paymentMode === 'change'} onClick={() => setPaymentMode('change')} />
                  <PayModeButton icon={Split} label="Partial" active={paymentMode === 'partial'} onClick={() => setPaymentMode('partial')} />
                </div>

                {/* Full payment */}
                {paymentMode === 'full' && (
                  <div className="card-3d p-5 space-y-3">
                    <Label className="text-xs font-medium text-muted-foreground">Receive into</Label>
                    <Select value={fullPaymentAccountId} onValueChange={setFullPaymentAccountId}>
                      <SelectTrigger className="h-10 bg-background press-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {accountsQ.data?.rows.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center justify-between pt-2 border-t border-border">
                      <span className="text-sm text-muted-foreground">Payment amount</span>
                      <span className="text-lg font-semibold text-foreground" data-num>{formatMoney(subtotal)}</span>
                    </div>
                  </div>
                )}

                {/* Cash with change */}
                {paymentMode === 'change' && (
                  <div className="card-3d p-5 space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">Cash received into</Label>
                      <Select value={cashReceivedAccountId} onValueChange={setCashReceivedAccountId}>
                        <SelectTrigger className="h-10 bg-background press-sm"><SelectValue placeholder="Select cash account…" /></SelectTrigger>
                        <SelectContent>
                          {accountsQ.data?.rows.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">Cash received (Rs)</Label>
                      <Input type="text" value={cashReceivedAmount} onChange={e => setCashReceivedAmount(e.target.value)} placeholder={String(Number(subtotal) / 100)} className="h-10 bg-background press-sm text-lg" data-num />
                    </div>
                    {changeNeeded && (
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-muted-foreground">Return change via</Label>
                        <Select value={changeAccountId} onValueChange={setChangeAccountId}>
                          <SelectTrigger className="h-10 bg-background press-sm"><SelectValue placeholder="Select change account…" /></SelectTrigger>
                          <SelectContent>
                            {accountsQ.data?.rows.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">Bill</div>
                        <div className="font-medium text-foreground" data-num>{formatMoney(subtotal)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">Received</div>
                        <div className="font-medium text-foreground" data-num>{formatMoney(cashReceived)}</div>
                      </div>
                      {changeNeeded && (
                        <div>
                          <div className="text-[10px] uppercase text-muted-foreground">Change</div>
                          <div className="font-semibold text-amber-600" data-num>{formatMoney(changeAmount)}</div>
                        </div>
                      )}
                      {outstanding > 0n && (
                        <div>
                          <div className="text-[10px] uppercase text-muted-foreground">Outstanding</div>
                          <div className="font-semibold text-destructive" data-num>{formatMoney(outstanding)}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Partial payment */}
                {paymentMode === 'partial' && (
                  <div className="card-3d p-5 space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">Receive into</Label>
                      <Select value={partialAccountId} onValueChange={setPartialAccountId}>
                        <SelectTrigger className="h-10 bg-background press-sm"><SelectValue placeholder="Select account…" /></SelectTrigger>
                        <SelectContent>
                          {accountsQ.data?.rows.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">Amount received (Rs)</Label>
                      <Input type="text" value={partialAmount} onChange={e => setPartialAmount(e.target.value)} placeholder="0" className="h-10 bg-background press-sm text-lg" data-num />
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">Bill</div>
                        <div className="font-medium text-foreground" data-num>{formatMoney(subtotal)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">Paid</div>
                        <div className="font-medium text-primary" data-num>{formatMoney(partialPaid)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">Outstanding</div>
                        <div className="font-semibold text-amber-600" data-num>{formatMoney(partialOutstanding)}</div>
                      </div>
                    </div>
                  </div>
                )}

                <button onClick={() => setShowAdvanced(true)} className="text-xs text-muted-foreground hover:text-foreground press-sm">
                  Advanced payment split →
                </button>
              </>
            )}

            {/* Advanced payment split */}
            {showAdvanced && (
              <div className="card-3d p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">Manual Payment Split</h3>
                  <button onClick={() => setShowAdvanced(false)} className="text-xs text-muted-foreground hover:text-foreground">← Back to simple</button>
                </div>
                {advPayments.map((p) => (
                  <div key={p.key} className="grid grid-cols-2 gap-2 items-end">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Account</Label>
                      <Select value={p.accountId} onValueChange={v => setAdvPayments(ls => ls.map(x => x.key === p.key ? { ...x, accountId: v } : x))}>
                        <SelectTrigger className="h-9 bg-background press-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                        <SelectContent>
                          {accountsQ.data?.rows.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex gap-2">
                      <Input type="text" value={p.amount} onChange={e => setAdvPayments(ls => ls.map(x => x.key === p.key ? { ...x, amount: e.target.value } : x))} placeholder="0" className="h-9 bg-background press-sm" data-num />
                      <button onClick={() => setAdvPayments(ls => ls.length <= 1 ? ls : ls.filter(x => x.key !== p.key))} className="text-muted-foreground hover:text-destructive mb-2"><Trash2 className="size-4" /></button>
                    </div>
                    <label className="col-span-2 flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="checkbox" checked={p.isChange} onChange={e => setAdvPayments(ls => ls.map(x => x.key === p.key ? { ...x, isChange: e.target.checked } : x))} className="size-3.5 rounded border-border" />
                      <span className="text-muted-foreground">This is change/refund</span>
                    </label>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="w-full press-sm" onClick={() => setAdvPayments(ls => [...ls, { key: String(Date.now()), accountId: '', amount: '', isChange: false }])}><Plus className="size-3" /> Add payment row</Button>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="press-sm" onClick={() => setStep(1)}><ArrowLeft className="size-4" /> Back</Button>
              <Button className="flex-1 press-md shadow-sm" disabled={!canPost} onClick={() => setStep(3)}>
                Review Sale <ArrowRight className="size-4" />
              </Button>
            </div>
          </motion.div>
        )}

        {/* ─── STEP 3: REVIEW ─── */}
        {step === 3 && (
          <motion.div key="step3" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="space-y-4">
            <div className="card-3d p-5 space-y-4">
              <h2 className="text-base font-semibold text-foreground">Review Sale</h2>

              {/* Items summary */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Items ({items.filter(it => it.productId || it.productName).length})</div>
                <div className="space-y-1.5">
                  {items.filter(it => it.productId || it.productName).map((it) => (
                    <div key={it.key} className="flex items-center justify-between text-sm">
                      <span className="text-foreground">{it.productName || productsQ.data?.rows.find(p => p.id === it.productId)?.name}</span>
                      <span className="text-muted-foreground" data-num>{it.qty} × {formatMoney(parseMoney(it.unitPrice) ?? 0n, false)} = {formatMoney((parseMoney(it.unitPrice) ?? 0n) * BigInt(parseInt(it.qty) || 0), false)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="pt-3 border-t border-border space-y-1.5">
                <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Bill Total</span><span className="font-semibold text-foreground" data-num>{formatMoney(subtotal)}</span></div>
                <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Paid</span><span className="font-semibold text-primary" data-num>{formatMoney(totalPaid)}</span></div>
                {totalChange > 0n && <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Change</span><span className="font-semibold text-amber-600" data-num>{formatMoney(totalChange)}</span></div>}
                {outstanding > 0n && <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Outstanding</span><span className="font-semibold text-destructive" data-num>{formatMoney(outstanding)}</span></div>}
              </div>

              {/* Commission estimate */}
              {salesman && totalPaid > 0n && (
                <div className="pt-3 border-t border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Commission ({salesman.commissionPct}% of collected)</span>
                    <span className="text-sm font-medium text-foreground" data-num>{formatMoney(estimatedCommission)}</span>
                  </div>
                </div>
              )}

              {/* Stock warnings */}
              {stockWarnings.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 mb-1">
                    <TrendingDown className="size-3" /> Stock Warning
                  </div>
                  <p className="text-xs text-amber-600">{stockWarnings.length} item(s) will go negative. This is allowed.</p>
                </div>
              )}
            </div>

            {result && !result.ok && (
              <div className="card-3d p-4 border-destructive/40 flex items-start gap-3">
                <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-destructive">Failed</div>
                  <p className="text-xs text-muted-foreground mt-0.5">{result.error}</p>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="press-sm" onClick={() => setStep(2)}><ArrowLeft className="size-4" /> Back</Button>
              <Button className="flex-1 press-md shadow-sm" disabled={postMut.isPending} onClick={() => postMut.mutate()}>
                {postMut.isPending ? 'Posting…' : (<><CheckCircle2 className="size-4" /> Post Sale</>)}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PayModeButton({ icon: Icon, label, active, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-2 p-4 rounded-xl border press-sm transition-colors ${
        active ? 'border-primary bg-accent/60 text-foreground' : 'border-border bg-background text-muted-foreground hover:bg-muted/40'
      }`}
    >
      <Icon className={`size-5 ${active ? 'text-primary' : ''}`} />
      <span className="text-xs font-medium">{label}</span>
    </button>
  )
}
