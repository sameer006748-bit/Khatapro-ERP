'use client'

import { useState, useMemo, useRef } from 'react'
import { bizDateString } from '@/lib/dates'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { PrintInvoiceButton } from '@/components/invoice/print-invoice-button'
import {
  Plus, Trash2, ShoppingCart, AlertCircle, CheckCircle2,
  Printer, FileText, Wallet, Banknote, Smartphone, Split,
  TrendingDown, User, Minus, Search, Send, Percent,
} from 'lucide-react'
import { formatWholeRupees, parseMoney } from '@/lib/format'
import { motion, AnimatePresence } from 'framer-motion'
import type { MeUser } from '@/components/erp/erp-app'
import { AiFieldHelp } from '@/components/erp/ai-actions'

type Product = { id: string; name: string; currentStock: number; salePrice: number; unit: string }
type Salesman = { id: string; name: string; commissionPct: number }
type Account = { id: string; code: string; name: string; isBusinessAccount: boolean }

type CartItem = {
  key: string
  productId: string
  productName: string
  qty: number
  unitPrice: string
  isTemporary: boolean
}

type PaymentMode = 'full' | 'partial' | 'change'

export function CounterSaleView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [salesmanId, setSalesmanId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [invoiceDate] = useState(bizDateString(new Date()))
  const [cart, setCart] = useState<CartItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showTempItem, setShowTempItem] = useState(false)
  const [tempItemName, setTempItemName] = useState('')
  const [tempItemPrice, setTempItemPrice] = useState('')
  const [showCustomer, setShowCustomer] = useState(false)

  const [paymentMode, setPaymentMode] = useState<PaymentMode>('full')
  const [paymentAccountId, setPaymentAccountId] = useState('')
  const [partialAmount, setPartialAmount] = useState('')
  const [cashReceivedAmount, setCashReceivedAmount] = useState('')
  const [changeAccountId, setChangeAccountId] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [discountRupees, setDiscountRupees] = useState('')
  const [advPayments, setAdvPayments] = useState<Array<{ key: string; accountId: string; amount: string; isChange: boolean }>>([
    { key: '1', accountId: '', amount: '', isChange: false },
  ])
  const [result, setResult] = useState<{ ok: boolean; invoiceNo?: string; invoiceId?: string; error?: string } | null>(null)
  const [sessionKey] = useState(() => crypto.randomUUID())

  // Duplicate-submit guard (ref-based, independent of React render batching)
  const postingRef = useRef(false)

  const coaQ = useQuery({
    queryKey: ['coa'],
    queryFn: () => fetch('/api/setup/coa').then(r => r.json()),
    staleTime: 300_000,
  })
  const productsQ = useQuery<{ rows: Product[] }>({
    queryKey: ['products'],
    queryFn: () => fetch('/api/products').then(r => r.json()),
    staleTime: 30_000,
  })
  const salesmenQ = useQuery<{ rows: Salesman[] }>({
    queryKey: ['salesmen'],
    queryFn: () => fetch('/api/salesmen').then(r => r.json()),
    staleTime: 300_000,
  })

  const businessAccounts: Account[] = useMemo(() => {
    if (!coaQ.data?.categories) return []
    return coaQ.data.categories
      .flatMap((c: any) => c.accounts)
      .filter((a: any) => a.isBusinessAccount && a.isActive)
      .map((a: any) => ({ id: a.id, code: a.code, name: a.name, isBusinessAccount: a.isBusinessAccount }))
  }, [coaQ.data])

  const effectiveSalesmanId = useMemo(() => salesmanId || (salesmenQ.data && salesmenQ.data.rows.length === 1 ? salesmenQ.data.rows[0].id : ''), [salesmanId, salesmenQ.data])

  const effectivePaymentAccountId = useMemo(() => {
    if (paymentAccountId) return paymentAccountId
    if (businessAccounts.length > 0) {
      const cash = businessAccounts.find(a => a.name === 'Cash' || a.code === '1010')
      return cash?.id ?? businessAccounts[0].id
    }
    return ''
  }, [paymentAccountId, businessAccounts])

  const filteredProducts = useMemo(() => {
    if (!productsQ.data?.rows) return []
    if (!searchQuery) return productsQ.data.rows.slice(0, 8)
    return productsQ.data.rows.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 8)
  }, [productsQ.data, searchQuery])

  const subtotal = useMemo(() => {
    return cart.reduce((acc, it) => {
      const up = parseMoney(it.unitPrice) ?? 0n
      return acc + up * BigInt(it.qty)
    }, 0n)
  }, [cart])

  const discountPaisas = useMemo(() => {
    const v = parseMoney(discountRupees)
    if (v === null) return 0n
    return v
  }, [discountRupees])
  const netTotal = subtotal - discountPaisas
  const discountError = discountPaisas < 0n ? 'Discount cannot be negative' : discountPaisas > subtotal ? 'Discount exceeds subtotal' : null
  const finalTotal = netTotal

  const salesman = salesmenQ.data?.rows.find(s => s.id === effectiveSalesmanId)

  const cashReceived = parseMoney(cashReceivedAmount) ?? 0n
  const changeAmount = cashReceived > finalTotal ? cashReceived - finalTotal : 0n
  const changeNeeded = changeAmount > 0n

  const partialPaid = parseMoney(partialAmount) ?? 0n
  const partialOutstanding = finalTotal - partialPaid

  function buildPayments() {
    if (showAdvanced) {
      return advPayments.filter(p => p.accountId && p.amount).map(p => ({
        accountId: p.accountId, amount: parseMoney(p.amount) ?? 0n, isChange: p.isChange,
      }))
    }
    if (paymentMode === 'full') return [{ accountId: effectivePaymentAccountId, amount: finalTotal }]
    if (paymentMode === 'partial') return [{ accountId: effectivePaymentAccountId, amount: partialPaid }]
    if (paymentMode === 'change') {
      const ps: Array<{ accountId: string; amount: bigint; isChange?: boolean }> = [{ accountId: effectivePaymentAccountId, amount: cashReceived }]
      if (changeNeeded && changeAccountId) ps.push({ accountId: changeAccountId, amount: changeAmount, isChange: true })
      return ps
    }
    return []
  }

  const payments = buildPayments()
  const totalPaid = payments.filter(p => !p.isChange).reduce((a, p) => a + p.amount, 0n)
  const totalChange = payments.filter(p => p.isChange).reduce((a, p) => a + p.amount, 0n)
  const outstanding = finalTotal - totalPaid + totalChange
  const estimatedCommission = salesman && totalPaid > 0n ? (totalPaid * BigInt(Math.round(salesman.commissionPct * 100))) / 10000n : 0n

  const stockWarnings = cart.filter(it => {
    if (!it.productId) return false
    const p = productsQ.data?.rows.find(x => x.id === it.productId)
    return p && p.currentStock < it.qty
  })

  const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  const allAccountsValid = payments.every(p => isUuid(p.accountId))
  const canPost = effectiveSalesmanId && cart.length > 0 && payments.length > 0 && payments.every(p => p.amount > 0n) && allAccountsValid && !discountError && (discountRupees === '' || discountPaisas >= 0n)

  const postMut = useMutation({
    mutationFn: async () => {
      if (postingRef.current) throw new Error('Submission already in progress')
      postingRef.current = true
      for (const p of payments) {
        if (!isUuid(p.accountId)) throw new Error(`Invalid account ID (not a UUID): ${p.accountId}. Please refresh the page.`)
      }
      const r = await fetch('/api/sales/counter', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invoiceType: 'COUNTER', invoiceDate,
          items: cart.map(it => ({
            productId: it.productId || null,
            productName: it.productName,
            qty: it.qty,
            unitPrice: it.unitPrice,
            isTemporary: it.isTemporary,
          })),
          payments: payments.map(p => ({
            accountId: p.accountId,
            amount: p.amount.toString(),
            isChange: p.isChange,
          })),
          salesmanId: effectiveSalesmanId,
          customerName: customerName || undefined,
          discountPaisas: discountPaisas.toString(),
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error ?? 'POST_FAILED')
      return j
    },
    onSuccess: (j) => {
      postingRef.current = false
      toast.success(`Sale posted: ${j.invoiceNo}`)
      setResult({ ok: true, invoiceNo: j.invoiceNo, invoiceId: j.invoiceId })
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      void qc.invalidateQueries({ queryKey: ['trial-balance'] })
      void qc.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (e: Error) => {
      postingRef.current = false
      setResult({ ok: false, error: e.message })
      toast.error(`Sale failed: ${e.message}`)
    },
  })

  if (result?.ok) {
    return (
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="card-3d border-primary/40 p-8 text-center max-w-md mx-auto">
          <div className="grid place-items-center size-16 rounded-2xl icon-3d mx-auto mb-4"><CheckCircle2 className="size-8 text-primary-foreground" /></div>
          <h2 className="text-xl font-semibold text-foreground">Sale Posted!</h2>
          <p className="text-3xl font-bold text-primary mt-1" data-num>{result.invoiceNo}</p>
          <div className="mt-6 flex flex-col gap-2">
            <Button className="press-md shadow-sm" onClick={() => window.open(`/?invoice=${result.invoiceId}`, '_self')}><FileText className="size-4" /> View Invoice</Button>
            <PrintInvoiceButton invoiceId={result.invoiceId} label="Print Invoice" size="default" className="w-full justify-center" icon={Printer} />
            <Button variant="ghost" className="press-sm" onClick={() => { setResult(null); setCart([]); setCustomerName(''); setShowCustomer(false) }}><ShoppingCart className="size-4" /> New Sale</Button>
          </div>
        </motion.div>
      </div>
    )
  }

  function addToCart(productId: string) {
    const p = productsQ.data?.rows.find(x => x.id === productId)
    if (!p) return
    const existing = cart.find(c => c.productId === productId)
    if (existing) {
      setCart(ls => ls.map(c => c.key === existing.key ? { ...c, qty: c.qty + 1 } : c))
    } else {
      setCart(ls => [...ls, { key: String(Date.now()), productId, productName: p.name, qty: 1, unitPrice: String(p.salePrice), isTemporary: false }])
    }
    setSearchQuery('')
  }

  function addTempItem() {
    if (!tempItemName || !tempItemPrice) return
    setCart(ls => [...ls, { key: String(Date.now()), productId: '', productName: tempItemName, qty: 1, unitPrice: tempItemPrice, isTemporary: true }])
    setTempItemName(''); setTempItemPrice(''); setShowTempItem(false)
  }

  function updateCartQty(key: string, delta: number) {
    setCart(ls => ls.map(c => c.key === key ? { ...c, qty: Math.max(1, c.qty + delta) } : c))
  }

  function removeFromCart(key: string) {
    setCart(ls => ls.filter(c => c.key !== key))
  }

  function updateCartPrice(key: string, price: string) {
    setCart(ls => ls.map(c => c.key === key ? { ...c, unitPrice: price } : c))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Counter Sale</h1>
        <div className="flex items-center gap-2">
          <Select value={salesmanId} onValueChange={setSalesmanId}>
            <SelectTrigger className="h-8 w-auto bg-background press-sm text-xs"><SelectValue placeholder="Salesman…" /></SelectTrigger>
            <SelectContent>{salesmenQ.data?.rows.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
          <AiFieldHelp fieldName="salesmanId" fieldLabel="Salesman" currentScreen="counter-sale" role={user.roleName} valueCategory="staff reference" accountingContext="sales attribution and commission" />
          <Button variant="ghost" size="sm" className="h-8 text-xs press-sm" onClick={() => setShowCustomer(v => !v)}><User className="size-3" /> {showCustomer ? 'Hide' : 'Customer'}</Button>
          <AiFieldHelp fieldName="customerName" fieldLabel="Customer" currentScreen="counter-sale" role={user.roleName} valueCategory="party reference" accountingContext="receivable balance" />
        </div>
      </div>

      {showCustomer && (
        <Input value={customerName} onChange={e => setCustomerName(e.target.value)} className="h-9 bg-background press-sm" placeholder="Customer name (optional)" />
      )}

      <div className="grid lg:grid-cols-5 gap-3">
        <div className="lg:col-span-2 space-y-3">
          <div className="card-3d p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search products…" className="h-9 bg-background pl-8 press-sm" />
            </div>
            <div className="mt-2 space-y-1 max-h-[300px] overflow-y-auto">
              {filteredProducts.map(p => (
                <button key={p.id} onClick={() => addToCart(p.id)} className="w-full flex items-center justify-between p-2 rounded-md hover:bg-accent/40 press-sm text-left">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{p.name}</div>
                    <div className="text-[10px] text-muted-foreground" data-num>Rs {p.salePrice} · stock: {p.currentStock}</div>
                  </div>
                  <Plus className="size-4 text-primary shrink-0" />
                </button>
              ))}
              {filteredProducts.length === 0 && <div className="text-xs text-muted-foreground text-center py-4">No products found</div>}
            </div>
            <button onClick={() => setShowTempItem(v => !v)} className="mt-2 text-[10px] text-muted-foreground hover:text-foreground press-sm w-full text-center">
              {showTempItem ? 'Cancel temp item' : '+ Add temporary item'}
            </button>
            {showTempItem && (
              <div className="mt-2 space-y-1.5">
                <Input value={tempItemName} onChange={e => setTempItemName(e.target.value)} placeholder="Item name" className="h-8 bg-background press-sm text-sm" />
                <div className="flex gap-1">
                  <Input value={tempItemPrice} onChange={e => setTempItemPrice(e.target.value)} placeholder="Rs" className="h-8 bg-background press-sm text-sm" data-num />
                  <Button size="sm" className="press-sm h-8" onClick={addTempItem}><Plus className="size-3" /></Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-3 space-y-3">
          <div className="card-3d p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-foreground">Cart ({cart.length})</span>
              {cart.length > 0 && <span className="text-lg font-bold text-primary" data-num>{formatWholeRupees(subtotal)}</span>}
            </div>
            {cart.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">Click a product to add to cart</div>
            ) : (
              <div className="space-y-1">
                {cart.map((it) => {
                  const p = productsQ.data?.rows.find(x => x.id === it.productId)
                  const lineTotal = (parseMoney(it.unitPrice) ?? 0n) * BigInt(it.qty)
                  return (
                    <div key={it.key} className="flex items-center gap-2 p-2 border border-border/60 rounded-md bg-background">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{it.productName}{it.isTemporary && <span className="text-[9px] uppercase bg-amber-100 text-amber-700 px-1 rounded ml-1">Temp</span>}</div>
                        {p && p.currentStock < it.qty && <div className="text-[9px] text-amber-600 flex items-center gap-0.5"><TrendingDown className="size-2" /> Stock: {p.currentStock}</div>}
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button onClick={() => updateCartQty(it.key, -1)} className="grid place-items-center size-6 rounded border border-border text-muted-foreground press-sm"><Minus className="size-3" /></button>
                        <span className="w-6 text-center text-sm font-medium" data-num>{it.qty}</span>
                        <button onClick={() => updateCartQty(it.key, 1)} className="grid place-items-center size-6 rounded border border-border text-muted-foreground press-sm"><Plus className="size-3" /></button>
                      </div>
                      <Input type="text" value={it.unitPrice} onChange={e => updateCartPrice(it.key, e.target.value)} className="h-7 w-16 bg-background press-sm text-right text-xs" data-num />
                      <span className="w-16 text-right text-sm font-medium text-foreground" data-num>{formatWholeRupees(lineTotal, false)}</span>
                      <button onClick={() => removeFromCart(it.key)} className="text-muted-foreground hover:text-destructive press-sm shrink-0"><Trash2 className="size-3.5" /></button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {cart.length > 0 && (
            <div className="card-3d p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-sm font-semibold text-foreground">Payment</span>
                <AiFieldHelp fieldName="paymentAccountId" fieldLabel="Payment account and paid amount" currentScreen="counter-sale" role={user.roleName} valueCategory="money allocation" accountingContext="cash versus customer balance" />
                {!showAdvanced && (
                  <button onClick={() => setShowAdvanced(true)} className="ml-auto text-[10px] text-muted-foreground hover:text-foreground">Split →</button>
                )}
                {showAdvanced && <button onClick={() => setShowAdvanced(false)} className="ml-auto text-[10px] text-muted-foreground hover:text-foreground">← Simple</button>}
              </div>

              {!showAdvanced && (
                <>
                  <div className="grid grid-cols-4 gap-1 mb-2">
                    <PayBtn icon={Banknote} label="Cash" active={paymentMode === 'full'} onClick={() => { setPaymentMode('full'); const c = businessAccounts.find(a => a.name === 'Cash' || a.code === '1010'); if (c) setPaymentAccountId(c.id) }} />
                    <PayBtn icon={Smartphone} label="JazzCash" active={paymentMode === 'full'} onClick={() => { setPaymentMode('full'); const jc = businessAccounts.find(a => a.name === 'JazzCash' || a.code === '1050'); if (jc) setPaymentAccountId(jc.id) }} />
                    <PayBtn icon={Split} label="Partial" active={paymentMode === 'partial'} onClick={() => setPaymentMode('partial')} />
                    <PayBtn icon={Wallet} label="Change" active={paymentMode === 'change'} onClick={() => setPaymentMode('change')} />
                  </div>

                  <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
                    <SelectTrigger className="h-8 bg-background press-sm text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {businessAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.code})</SelectItem>)}
                    </SelectContent>
                  </Select>

                  {paymentMode === 'partial' && (
                    <div className="mt-2 space-y-1.5">
                      <Input type="text" value={partialAmount} onChange={e => setPartialAmount(e.target.value)} placeholder="Amount received (Rs)" className="h-9 bg-background press-sm text-sm" data-num />
                      <div className="flex justify-between text-xs"><span className="text-muted-foreground">Outstanding</span><span className="font-medium text-amber-600" data-num>{formatWholeRupees(partialOutstanding, false)}</span></div>
                    </div>
                  )}

                  {paymentMode === 'change' && (
                    <div className="mt-2 space-y-1.5">
                      <Input type="text" value={cashReceivedAmount} onChange={e => setCashReceivedAmount(e.target.value)} placeholder="Cash received (Rs)" className="h-9 bg-background press-sm text-sm" data-num />
                      {changeNeeded && (
                        <>
                          <Select value={changeAccountId} onValueChange={setChangeAccountId}>
                            <SelectTrigger className="h-8 bg-background press-sm text-sm"><SelectValue placeholder="Change return account…" /></SelectTrigger>
                            <SelectContent>
                              {businessAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.code})</SelectItem>)}
                            </SelectContent>
                          </Select>
                      <div className="flex justify-between text-xs"><span className="text-muted-foreground">Change</span><span className="font-medium text-amber-600" data-num>{formatWholeRupees(changeAmount, false)}</span></div>
                        </>
                      )}
                    </div>
                  )}

                  {paymentMode === 'full' && (
                    <div className="mt-2 flex justify-between text-xs"><span className="text-muted-foreground">Amount</span><span className="font-medium text-foreground" data-num>{formatWholeRupees(subtotal, false)}</span></div>
                  )}
                </>
              )}

              {showAdvanced && (
                <div className="space-y-1.5">
                  {advPayments.map(p => (
                    <div key={p.key} className="grid grid-cols-2 gap-1 items-end">
                      <Select value={p.accountId} onValueChange={v => setAdvPayments(ls => ls.map(x => x.key === p.key ? { ...x, accountId: v } : x))}>
                        <SelectTrigger className="h-8 bg-background press-sm text-sm"><SelectValue placeholder="Account…" /></SelectTrigger>
                        <SelectContent>{businessAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <div className="flex gap-1">
                        <Input type="text" value={p.amount} onChange={e => setAdvPayments(ls => ls.map(x => x.key === p.key ? { ...x, amount: e.target.value } : x))} placeholder="Rs" className="h-8 bg-background press-sm text-sm" data-num />
                        <button onClick={() => setAdvPayments(ls => ls.length <= 1 ? ls : ls.filter(x => x.key !== p.key))} className="text-muted-foreground"><Trash2 className="size-3.5" /></button>
                      </div>
                      <label className="col-span-2 flex items-center gap-1 text-[10px] cursor-pointer">
                        <input type="checkbox" checked={p.isChange} onChange={e => setAdvPayments(ls => ls.map(x => x.key === p.key ? { ...x, isChange: e.target.checked } : x))} className="size-3 rounded border-border" />
                        <span className="text-muted-foreground">Change/refund</span>
                      </label>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="w-full press-sm" onClick={() => setAdvPayments(ls => [...ls, { key: String(Date.now()), accountId: '', amount: '', isChange: false }])}><Plus className="size-3" /> Row</Button>
                </div>
              )}
            </div>
          )}

          {cart.length > 0 && (
            <div className="sticky bottom-20 md:bottom-3 z-20">
              <div className="card-3d border-primary/30 p-3 bg-card/95 backdrop-blur-md">
                <div className="flex items-center gap-3 mb-2 text-sm">
                  <div><span className="text-[9px] uppercase text-muted-foreground">Subtotal</span><div className="font-semibold text-foreground" data-num>{formatWholeRupees(subtotal, false)}</div></div>
                  <div><span className="text-[9px] uppercase text-muted-foreground">Total</span><div className="font-bold text-foreground" data-num>{formatWholeRupees(finalTotal, false)}</div></div>
                  <div><span className="text-[9px] uppercase text-muted-foreground">Paid</span><div className="font-semibold text-primary" data-num>{formatWholeRupees(totalPaid, false)}</div></div>
                  {totalChange > 0n && <div><span className="text-[9px] uppercase text-muted-foreground">Change</span><div className="font-semibold text-amber-600" data-num>{formatWholeRupees(totalChange, false)}</div></div>}
                  {outstanding > 0n && <div><span className="text-[9px] uppercase text-muted-foreground">Outstanding</span><div className="font-semibold text-destructive" data-num>{formatWholeRupees(outstanding, false)}</div></div>}
                  {salesman && totalPaid > 0n && <div className="ml-auto hidden sm:block text-[10px] text-muted-foreground">Commission ≈ <span className="font-medium text-foreground" data-num>{formatWholeRupees(estimatedCommission, false)}</span></div>}
                </div>
                {stockWarnings.length > 0 && <div className="mb-1.5 flex items-center gap-1 text-[10px] text-amber-600"><TrendingDown className="size-2.5" /> {stockWarnings.length} item(s) will go negative</div>}
                {result && !result.ok && <div className="mb-1.5 p-1.5 bg-destructive/10 rounded text-[10px] text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> {result.error}</div>}
                <Button className="w-full press-md shadow-sm" disabled={!canPost || postMut.isPending} onClick={() => postMut.mutate()}>
                  {postMut.isPending ? 'Posting…' : <><CheckCircle2 className="size-4" /> Post Sale — {formatWholeRupees(finalTotal)}</>}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PayBtn({ icon: Icon, label, active, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-0.5 p-2 rounded-lg border press-sm ${active ? 'border-primary bg-accent/60' : 'border-border bg-background hover:bg-muted/40'}`}>
      <Icon className={`size-4 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
      <span className="text-[9px] font-medium">{label}</span>
    </button>
  )
}
