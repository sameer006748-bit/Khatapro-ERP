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
  Plus, Trash2, ShoppingCart, AlertCircle, CheckCircle2,
  Package, Printer, FileText, Wallet, Banknote, Smartphone, Split,
  TrendingDown, User, Minus, ChevronDown,
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
  unitPrice: string  // in RUPEES (not paisas) — converted by parseMoney when posting
  isTemporary: boolean
}

type PaymentMode = 'full' | 'partial' | 'change'

export function CounterSaleView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [salesmanId, setSalesmanId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [items, setItems] = useState<Item[]>([])

  // Payment state
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('full')
  const [fullPaymentAccountId, setFullPaymentAccountId] = useState('')
  const [partialAccountId, setPartialAccountId] = useState('')
  const [partialAmount, setPartialAmount] = useState('')  // in rupees
  const [cashReceivedAccountId, setCashReceivedAccountId] = useState('')
  const [cashReceivedAmount, setCashReceivedAmount] = useState('')  // in rupees
  const [changeAccountId, setChangeAccountId] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [advPayments, setAdvPayments] = useState<Array<{ key: string; accountId: string; amount: string; isChange: boolean }>>([
    { key: '1', accountId: '', amount: '', isChange: false },
  ])
  const [showCustomerField, setShowCustomerField] = useState(false)

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
    if (salesmenQ.data && salesmenQ.data.rows && salesmenQ.data.rows.length === 1 && !salesmanId) {
      setSalesmanId(salesmenQ.data.rows[0].id)
    }
  }, [salesmenQ.data, salesmanId])

  // Auto-select first Cash account for full payment
  useEffect(() => {
    if (accountsQ.data && accountsQ.data.rows && accountsQ.data.rows.length > 0 && !fullPaymentAccountId) {
      const cashAcct = accountsQ.data.rows.find(a => a.type === 'Cash') ?? accountsQ.data.rows[0]
      setFullPaymentAccountId(cashAcct.id)
      setCashReceivedAccountId(cashAcct.id)
      setPartialAccountId(cashAcct.id)
    }
  }, [accountsQ.data, fullPaymentAccountId])

  // Compute subtotal (parseMoney converts rupees → paisas)
  const subtotal = useMemo(() => {
    return items.reduce((acc, it) => {
      const up = parseMoney(it.unitPrice) ?? 0n  // rupees → paisas
      const q = parseInt(it.qty) || 0
      return acc + up * BigInt(q)
    }, 0n)
  }, [items])

  const salesman = salesmenQ.data?.rows.find(s => s.id === salesmanId)

  // Change calculation
  const cashReceived = parseMoney(cashReceivedAmount) ?? 0n
  const changeAmount = cashReceived > subtotal ? cashReceived - subtotal : 0n
  const changeNeeded = changeAmount > 0n

  // Partial outstanding
  const partialPaid = parseMoney(partialAmount) ?? 0n
  const partialOutstanding = subtotal - partialPaid

  // Build payments for posting
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

  const canPost = salesmanId && items.length > 0 && items.every(it => (it.productId || it.productName) && it.qty && it.unitPrice) && payments.length > 0 && payments.every(p => p.accountId && p.amount > 0n)

  const postMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/sales/counter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invoiceType: 'COUNTER',
          invoiceDate,
          items: items.map(it => ({
            productId: it.productId || null,
            productName: it.productName || productsQ.data?.rows.find(p => p.id === it.productId)?.name || 'Item',
            qty: parseInt(it.qty) || 1,
            unitPrice: it.unitPrice,  // rupees string — parseMoney in API converts to paisas
            isTemporary: it.isTemporary,
          })),
          payments: payments.map(p => ({
            accountId: p.accountId,
            amount: p.amount.toString(),  // paisas string
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
            <Button className="press-md shadow-sm" onClick={() => window.open(`/?invoice=${result.invoiceId}`, '_self')}>
              <FileText className="size-4" /> View Invoice
            </Button>
            <Button variant="outline" className="press-sm" onClick={() => window.print()}>
              <Printer className="size-4" /> Print Invoice
            </Button>
            <Button variant="ghost" className="press-sm" onClick={() => {
              setResult(null)
              setItems([])
              setCustomerName('')
              setCashReceivedAmount('')
              setPartialAmount('')
              setShowCustomerField(false)
            }}>
              <ShoppingCart className="size-4" /> New Sale
            </Button>
          </div>
        </motion.div>
      </div>
    )
  }

  function addItem() {
    setItems(ls => [...ls, { key: String(Date.now()), productId: '', productName: '', qty: '1', unitPrice: '', isTemporary: false }])
  }

  function onProductSelect(key: string, productId: string) {
    const p = productsQ.data?.rows.find(x => x.id === productId)
    setItems(ls => ls.map(i => i.key === key ? {
      ...i, productId, productName: p?.name ?? '',
      unitPrice: p ? String(p.salePrice) : '',  // RUPEES directly — no *100
    } : i))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Counter Sale</h1>
        <span className="text-xs text-muted-foreground">Cashier Mode</span>
      </div>

      {/* ─── TOP COMPACT BAR ─── */}
      <div className="card-3d p-3 sm:p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <Label className="text-[10px] text-muted-foreground">Salesman *</Label>
            <Select value={salesmanId} onValueChange={setSalesmanId}>
              <SelectTrigger className="h-9 bg-background press-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {salesmenQ.data?.rows.map(s => <SelectItem key={s.id} value={s.id}>{s.name} ({s.commissionPct}%)</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-32">
            <Label className="text-[10px] text-muted-foreground">Date</Label>
            <Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className="h-9 bg-background press-sm" data-num />
          </div>
          <Button variant="ghost" size="sm" className="press-sm h-9 text-xs" onClick={() => setShowCustomerField(v => !v)}>
            <User className="size-3" /> {showCustomerField ? 'Hide' : 'Customer'}
          </Button>
        </div>
        {showCustomerField && (
          <div className="mt-2">
            <Input value={customerName} onChange={e => setCustomerName(e.target.value)} className="h-9 bg-background press-sm" placeholder="Customer name (optional)" />
          </div>
        )}
      </div>

      {/* ─── ITEM ENTRY + CURRENT ITEMS ─── */}
      <div className="card-3d p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">Items</h2>
          <Button variant="outline" size="sm" onClick={addItem} className="press-sm"><Plus className="size-3.5" /> Add</Button>
        </div>

        {items.length === 0 && (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No items yet. Click "Add" to start a sale.
          </div>
        )}

        {/* Item rows */}
        <div className="space-y-2">
          <AnimatePresence>
            {items.map((it, idx) => {
              const p = productsQ.data?.rows.find(x => x.id === it.productId)
              const lineTotal = (parseMoney(it.unitPrice) ?? 0n) * BigInt(parseInt(it.qty) || 0)
              return (
                <motion.div
                  key={it.key}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="border border-border rounded-lg p-3 bg-background"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-[10px] uppercase text-muted-foreground">#{idx + 1}</span>
                    <button onClick={() => setItems(ls => ls.filter(i => i.key !== it.key))} className="text-muted-foreground hover:text-destructive press-sm">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  {it.isTemporary ? (
                    <Input value={it.productName} onChange={e => setItems(ls => ls.map(i => i.key === it.key ? { ...i, productName: e.target.value } : i))} placeholder="Item name" className="h-9 bg-background press-sm mb-2 text-sm" />
                  ) : (
                    <Select value={it.productId} onValueChange={v => onProductSelect(it.key, v)}>
                      <SelectTrigger className="h-9 bg-background press-sm mb-2 text-sm"><SelectValue placeholder="Select product…" /></SelectTrigger>
                      <SelectContent>
                        {productsQ.data?.rows.map(p => <SelectItem key={p.id} value={p.id}>{p.name} (stock: {p.currentStock})</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  <div className="grid grid-cols-3 gap-2 items-center">
                    {/* Qty with +/- buttons */}
                    <div className="flex items-center gap-1">
                      <button onClick={() => setItems(ls => ls.map(i => i.key === it.key ? { ...i, qty: String(Math.max(1, (parseInt(i.qty) || 1) - 1)) } : i))} className="grid place-items-center size-8 rounded-md border border-border press-sm text-muted-foreground hover:text-foreground">
                        <Minus className="size-3" />
                      </button>
                      <Input type="number" value={it.qty} onChange={e => setItems(ls => ls.map(i => i.key === it.key ? { ...i, qty: e.target.value } : i))} className="h-8 bg-background press-sm text-center text-sm w-full" data-num />
                      <button onClick={() => setItems(ls => ls.map(i => i.key === it.key ? { ...i, qty: String((parseInt(i.qty) || 1) + 1) } : i))} className="grid place-items-center size-8 rounded-md border border-border press-sm text-muted-foreground hover:text-foreground">
                        <Plus className="size-3" />
                      </button>
                    </div>
                    {/* Unit price in RUPEES */}
                    <div>
                      <Input type="text" value={it.unitPrice} onChange={e => setItems(ls => ls.map(i => i.key === it.key ? { ...i, unitPrice: e.target.value } : i))} placeholder="0" className="h-8 bg-background press-sm text-right text-sm" data-num />
                    </div>
                    {/* Line total */}
                    <div className="text-right font-medium text-foreground text-sm" data-num>{formatMoney(lineTotal, false)}</div>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <label className="flex items-center gap-1 text-xs cursor-pointer">
                      <input type="checkbox" checked={it.isTemporary} onChange={e => setItems(ls => ls.map(i => i.key === it.key ? { ...i, isTemporary: e.target.checked, productId: e.target.checked ? '' : i.productId } : i))} className="size-3 rounded border-border" />
                      <span className="text-muted-foreground">Temp</span>
                    </label>
                    {p && p.currentStock < (parseInt(it.qty) || 0) && (
                      <span className="flex items-center gap-1 text-[10px] text-amber-600"><TrendingDown className="size-2.5" /> Stock: {p.currentStock}</span>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>

        {items.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Bill Total</span>
            <span className="text-xl font-bold text-primary" data-num>{formatMoney(subtotal)}</span>
          </div>
        )}
      </div>

      {/* ─── PAYMENT (same screen) ─── */}
      {items.length > 0 && (
        <div className="card-3d p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3">Payment</h2>

          {/* Payment mode buttons */}
          {!showAdvanced && (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-3">
              <PayBtn icon={Banknote} label="Cash" active={paymentMode === 'full' && fullPaymentAccountId === accountsQ.data?.rows.find(a => a.type === 'Cash')?.id} onClick={() => { setPaymentMode('full'); const c = accountsQ.data?.rows.find(a => a.type === 'Cash'); if (c) setFullPaymentAccountId(c.id) }} />
              <PayBtn icon={Smartphone} label="JazzCash" active={paymentMode === 'full' && fullPaymentAccountId === accountsQ.data?.rows.find(a => a.type === 'JazzCash')?.id} onClick={() => { setPaymentMode('full'); const jc = accountsQ.data?.rows.find(a => a.type === 'JazzCash'); if (jc) setFullPaymentAccountId(jc.id) }} />
              <PayBtn icon={Split} label="Partial" active={paymentMode === 'partial'} onClick={() => setPaymentMode('partial')} />
              <PayBtn icon={Wallet} label="Cash+Change" active={paymentMode === 'change'} onClick={() => setPaymentMode('change')} />
              <PayBtn icon={ChevronDown} label="Advanced" active={showAdvanced} onClick={() => setShowAdvanced(true)} />
            </div>
          )}

          {/* Full payment */}
          {!showAdvanced && paymentMode === 'full' && (
            <div className="space-y-2">
              <Select value={fullPaymentAccountId} onValueChange={setFullPaymentAccountId}>
                <SelectTrigger className="h-9 bg-background press-sm text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {accountsQ.data?.rows.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold text-foreground" data-num>{formatMoney(subtotal)}</span>
              </div>
            </div>
          )}

          {/* Cash + Change */}
          {!showAdvanced && paymentMode === 'change' && (
            <div className="space-y-3">
              <div>
                <Label className="text-[10px] text-muted-foreground">Cash received into</Label>
                <Select value={cashReceivedAccountId} onValueChange={setCashReceivedAccountId}>
                  <SelectTrigger className="h-9 bg-background press-sm text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {accountsQ.data?.rows.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Cash received (Rs)</Label>
                <Input type="text" value={cashReceivedAmount} onChange={e => setCashReceivedAmount(e.target.value)} placeholder={String(Number(subtotal) / 100)} className="h-10 bg-background press-sm text-lg" data-num />
              </div>
              {changeNeeded && (
                <div>
                  <Label className="text-[10px] text-muted-foreground">Return change via</Label>
                  <Select value={changeAccountId} onValueChange={setChangeAccountId}>
                    <SelectTrigger className="h-9 bg-background press-sm text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      {accountsQ.data?.rows.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border text-sm">
                <div><div className="text-[9px] uppercase text-muted-foreground">Bill</div><div className="font-medium" data-num>{formatMoney(subtotal, false)}</div></div>
                <div><div className="text-[9px] uppercase text-muted-foreground">Received</div><div className="font-medium" data-num>{formatMoney(cashReceived, false)}</div></div>
                {changeNeeded && <div><div className="text-[9px] uppercase text-muted-foreground">Change</div><div className="font-semibold text-amber-600" data-num>{formatMoney(changeAmount, false)}</div></div>}
              </div>
            </div>
          )}

          {/* Partial */}
          {!showAdvanced && paymentMode === 'partial' && (
            <div className="space-y-3">
              <div>
                <Label className="text-[10px] text-muted-foreground">Receive into</Label>
                <Select value={partialAccountId} onValueChange={setPartialAccountId}>
                  <SelectTrigger className="h-9 bg-background press-sm text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {accountsQ.data?.rows.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Amount received (Rs)</Label>
                <Input type="text" value={partialAmount} onChange={e => setPartialAmount(e.target.value)} placeholder="0" className="h-10 bg-background press-sm text-lg" data-num />
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border text-sm">
                <div><div className="text-[9px] uppercase text-muted-foreground">Paid</div><div className="font-medium text-primary" data-num>{formatMoney(partialPaid, false)}</div></div>
                <div><div className="text-[9px] uppercase text-muted-foreground">Outstanding</div><div className="font-semibold text-amber-600" data-num>{formatMoney(partialOutstanding, false)}</div></div>
              </div>
            </div>
          )}

          {/* Advanced split */}
          {showAdvanced && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Manual Split</h3>
                <button onClick={() => setShowAdvanced(false)} className="text-xs text-muted-foreground hover:text-foreground">← Simple</button>
              </div>
              {advPayments.map((p) => (
                <div key={p.key} className="grid grid-cols-2 gap-2 items-end">
                  <Select value={p.accountId} onValueChange={v => setAdvPayments(ls => ls.map(x => x.key === p.key ? { ...x, accountId: v } : x))}>
                    <SelectTrigger className="h-9 bg-background press-sm text-sm"><SelectValue placeholder="Account…" /></SelectTrigger>
                    <SelectContent>
                      {accountsQ.data?.rows.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-1">
                    <Input type="text" value={p.amount} onChange={e => setAdvPayments(ls => ls.map(x => x.key === p.key ? { ...x, amount: e.target.value } : x))} placeholder="Rs" className="h-9 bg-background press-sm text-sm" data-num />
                    <button onClick={() => setAdvPayments(ls => ls.length <= 1 ? ls : ls.filter(x => x.key !== p.key))} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button>
                  </div>
                  <label className="col-span-2 flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" checked={p.isChange} onChange={e => setAdvPayments(ls => ls.map(x => x.key === p.key ? { ...x, isChange: e.target.checked } : x))} className="size-3 rounded border-border" />
                    <span className="text-muted-foreground">This is change/refund</span>
                  </label>
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-full press-sm" onClick={() => setAdvPayments(ls => [...ls, { key: String(Date.now()), accountId: '', amount: '', isChange: false }])}><Plus className="size-3" /> Add row</Button>
            </div>
          )}
        </div>
      )}

      {/* ─── STICKY SUMMARY + POST ─── */}
      {items.length > 0 && (
        <div className="sticky bottom-20 md:bottom-4 z-20">
          <div className="card-3d border-primary/30 p-4 bg-card/95 backdrop-blur-md">
            {/* Summary row */}
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex gap-4 text-sm">
                <div>
                  <div className="text-[9px] uppercase text-muted-foreground">Total</div>
                  <div className="font-bold text-foreground" data-num>{formatMoney(subtotal, false)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-muted-foreground">Paid</div>
                  <div className="font-semibold text-primary" data-num>{formatMoney(totalPaid, false)}</div>
                </div>
                {totalChange > 0n && (
                  <div>
                    <div className="text-[9px] uppercase text-muted-foreground">Change</div>
                    <div className="font-semibold text-amber-600" data-num>{formatMoney(totalChange, false)}</div>
                  </div>
                )}
                {outstanding > 0n && (
                  <div>
                    <div className="text-[9px] uppercase text-muted-foreground">Outstanding</div>
                    <div className="font-semibold text-destructive" data-num>{formatMoney(outstanding, false)}</div>
                  </div>
                )}
              </div>
              {salesman && totalPaid > 0n && (
                <div className="text-right text-xs text-muted-foreground hidden sm:block">
                  Commission ≈ <span className="font-medium text-foreground" data-num>{formatMoney(estimatedCommission, false)}</span>
                </div>
              )}
            </div>

            {stockWarnings.length > 0 && (
              <div className="mb-2 flex items-center gap-1.5 text-xs text-amber-600">
                <TrendingDown className="size-3" /> {stockWarnings.length} item(s) will go negative — allowed
              </div>
            )}

            {result && !result.ok && (
              <div className="mb-2 p-2 bg-destructive/10 rounded-md flex items-start gap-2">
                <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">{result.error}</p>
              </div>
            )}

            <Button
              className="w-full press-md shadow-sm"
              disabled={!canPost || postMut.isPending}
              onClick={() => postMut.mutate()}
            >
              {postMut.isPending ? 'Posting…' : <><CheckCircle2 className="size-4" /> Post Sale — {formatMoney(subtotal)}</>}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function PayBtn({ icon: Icon, label, active, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border press-sm transition-colors ${
        active ? 'border-primary bg-accent/60 text-foreground' : 'border-border bg-background text-muted-foreground hover:bg-muted/40'
      }`}
    >
      <Icon className={`size-4 ${active ? 'text-primary' : ''}`} />
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  )
}
