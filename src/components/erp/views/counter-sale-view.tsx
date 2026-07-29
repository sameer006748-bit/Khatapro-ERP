'use client'

import { useState, useMemo, useRef, useCallback } from 'react'
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
  TrendingDown, User, Minus, Search, RotateCcw, PackageX,
} from 'lucide-react'
import { formatWholeRupees, parseMoney } from '@/lib/format'
import { motion } from 'framer-motion'
import type { MeUser } from '@/components/erp/erp-app'
import { apiFetchJson } from '@/lib/api-client'
import { AiFieldHelp } from '@/components/erp/ai-actions'
import {
  normalizeSaleLine,
  computeSaleTotals,
  validateSaleTotals,
  SaleLineError,
  type NormalizedSaleLine,
  type SellerRole,
} from '@/lib/sales/sale-engine'

type Product = {
  id: string
  name: string
  currentStock: number
  salePrice: number
  unit: string
  categoryId: string | null
  categoryName: string | null
  lowStockThreshold: number
  commissionRatePaisas: string | null
}
type Salesman = { id: string; name: string; commissionPct: number; isActive?: boolean }
type Account = { id: string; code: string; name: string; isBusinessAccount: boolean }
type Customer = { id: string; name: string; phone: string | null }

/** One editable bill row: sold, returned and everything derived from them. */
type BillRow = {
  key: string
  productId: string
  productName: string
  soldQty: number
  returnedQty: number
  unitPrice: string
  isTemporary: boolean
  commissionRatePaisas: string | null
}

type PaymentMode = 'full' | 'partial' | 'change'

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

export function CounterSaleView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [sellerRole, setSellerRole] = useState<SellerRole>('SALESMAN')
  const [salesmanId, setSalesmanId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [invoiceDate] = useState(bizDateString(new Date()))
  const [rows, setRows] = useState<BillRow[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('__all__')
  const [highlight, setHighlight] = useState(0)
  const [showTempItem, setShowTempItem] = useState(false)
  const [tempItemName, setTempItemName] = useState('')
  const [tempItemPrice, setTempItemPrice] = useState('')

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
  const [result, setResult] = useState<{ ok: boolean; invoiceNo?: string; invoiceId?: string; error?: string; setupRequired?: boolean } | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  const searchRef = useRef<HTMLInputElement>(null)
  const postingRef = useRef(false)

  const canAttributeAnySeller = useMemo(
    () => Boolean(user.permissions?.includes?.('can_view_sales')),
    [user.permissions],
  )

  const coaQ = useQuery({
    queryKey: ['coa'],
    queryFn: ({ signal }) => apiFetchJson<any>('/api/setup/coa', { signal }),
    staleTime: 300_000,
  })
  const productsQ = useQuery<{ rows: Product[] }>({
    queryKey: ['products'],
    queryFn: ({ signal }) => apiFetchJson('/api/products', { signal }),
    staleTime: 30_000,
  })
  const salesmenQ = useQuery<{ rows: Salesman[] }>({
    queryKey: ['salesmen'],
    queryFn: ({ signal }) => apiFetchJson('/api/salesmen', { signal }),
    staleTime: 300_000,
  })
  const customersQ = useQuery<{ rows: Customer[] }>({
    queryKey: ['customers'],
    queryFn: ({ signal }) => apiFetchJson('/api/customers', { signal }),
    staleTime: 300_000,
  })

  const businessAccounts: Account[] = useMemo(() => {
    if (!coaQ.data?.categories) return []
    return coaQ.data.categories
      .flatMap((c: any) => c.accounts)
      .filter((a: any) => a.isBusinessAccount && a.isActive)
      .map((a: any) => ({ id: a.id, code: a.code, name: a.name, isBusinessAccount: a.isBusinessAccount }))
  }, [coaQ.data])

  const activeSalesmen = useMemo(
    () => (salesmenQ.data?.rows ?? []).filter(s => s.isActive !== false),
    [salesmenQ.data],
  )

  // Never auto-pick a salesman when several exist: an unattended default would
  // credit commission to someone who did not make the sale.
  const effectiveSalesmanId = useMemo(() => {
    if (sellerRole === 'OWNER') return ''
    return salesmanId || (activeSalesmen.length === 1 ? activeSalesmen[0].id : '')
  }, [sellerRole, salesmanId, activeSalesmen])

  const effectivePaymentAccountId = useMemo(() => {
    if (paymentAccountId) return paymentAccountId
    if (businessAccounts.length > 0) {
      const cash = businessAccounts.find(a => a.name === 'Cash' || a.code === '1010')
      return cash?.id ?? businessAccounts[0].id
    }
    return ''
  }, [paymentAccountId, businessAccounts])

  const categories = useMemo(() => {
    const seen = new Map<string, string>()
    for (const p of productsQ.data?.rows ?? []) {
      if (p.categoryId && p.categoryName) seen.set(p.categoryId, p.categoryName)
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }))
  }, [productsQ.data])

  const filteredProducts = useMemo(() => {
    const all = productsQ.data?.rows ?? []
    const byCategory = categoryFilter === '__all__' ? all : all.filter(p => p.categoryId === categoryFilter)
    const q = searchQuery.trim().toLowerCase()
    const matched = q
      ? byCategory.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
      : byCategory
    return matched.slice(0, 40)
  }, [productsQ.data, searchQuery, categoryFilter])

  // Keep the keyboard highlight inside the current result set without an
  // effect: narrowing the list can otherwise leave it pointing past the end.
  const safeHighlight = highlight < filteredProducts.length ? highlight : 0

  // ── Shared engine: every displayed figure comes from the same rules the
  //    server applies when it posts the bill. ──
  const normalized = useMemo(() => {
    const out: Array<{ row: BillRow; line: NormalizedSaleLine | null; error: string | null }> = []
    for (const row of rows) {
      try {
        const line = normalizeSaleLine({
          productId: row.productId || null,
          productName: row.productName,
          soldQty: row.soldQty,
          returnedQty: row.returnedQty,
          unitPricePaisas: parseMoney(row.unitPrice) ?? 0n,
          commissionRatePaisas: row.commissionRatePaisas === null ? 0n : BigInt(row.commissionRatePaisas),
          isTemporary: row.isTemporary,
        })
        out.push({ row, line, error: null })
      } catch (e) {
        out.push({ row, line: null, error: e instanceof SaleLineError ? e.message : (e as Error).message })
      }
    }
    return out
  }, [rows])

  const validLines = useMemo(
    () => normalized.map(n => n.line).filter((l): l is NormalizedSaleLine => l !== null),
    [normalized],
  )
  const lineErrors = normalized.map(n => n.error).filter((e): e is string => e !== null)

  const discountPaisas = useMemo(() => parseMoney(discountRupees) ?? 0n, [discountRupees])

  const previewTotals = useMemo(
    () => computeSaleTotals(validLines, { invoiceDiscountPaisas: discountPaisas }),
    [validLines, discountPaisas],
  )
  const netTotal = previewTotals.netSalePaisas

  const cashReceived = parseMoney(cashReceivedAmount) ?? 0n
  const changeAmount = cashReceived > netTotal ? cashReceived - netTotal : 0n
  const changeNeeded = changeAmount > 0n
  const partialPaid = parseMoney(partialAmount) ?? 0n

  const payments = useMemo(() => {
    if (showAdvanced) {
      return advPayments.filter(p => p.accountId && p.amount).map(p => ({
        accountId: p.accountId, amount: parseMoney(p.amount) ?? 0n, isChange: p.isChange,
      }))
    }
    if (paymentMode === 'full') return [{ accountId: effectivePaymentAccountId, amount: netTotal, isChange: false }]
    if (paymentMode === 'partial') return [{ accountId: effectivePaymentAccountId, amount: partialPaid, isChange: false }]
    const ps: Array<{ accountId: string; amount: bigint; isChange: boolean }> = [
      { accountId: effectivePaymentAccountId, amount: cashReceived, isChange: false },
    ]
    if (changeNeeded && changeAccountId) ps.push({ accountId: changeAccountId, amount: changeAmount, isChange: true })
    return ps
  }, [showAdvanced, advPayments, paymentMode, effectivePaymentAccountId, netTotal, partialPaid, cashReceived, changeNeeded, changeAccountId, changeAmount])

  const totals = useMemo(
    () => computeSaleTotals(validLines, {
      invoiceDiscountPaisas: discountPaisas,
      paidPaisas: payments.filter(p => !p.isChange).reduce((a, p) => a + p.amount, 0n),
      changePaisas: payments.filter(p => p.isChange).reduce((a, p) => a + p.amount, 0n),
    }),
    [validLines, discountPaisas, payments],
  )

  const totalsError = validLines.length > 0 ? validateSaleTotals(totals) : null
  const stockWarnings = validLines.filter(line => {
    if (!line.productId) return false
    const p = productsQ.data?.rows.find(x => x.id === line.productId)
    return p !== undefined && p.currentStock + line.stockEffect < 0
  })

  const sellerReady = sellerRole === 'OWNER' || Boolean(effectiveSalesmanId)
  const allAccountsValid = payments.every(p => isUuid(p.accountId))
  const canPost = Boolean(
    sellerReady &&
    validLines.length === rows.length &&
    rows.length > 0 &&
    payments.length > 0 &&
    payments.every(p => p.amount > 0n) &&
    allAccountsValid &&
    !totalsError &&
    lineErrors.length === 0,
  )

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
          items: rows.map(row => ({
            productId: row.productId || null,
            productName: row.productName,
            qty: row.soldQty,
            returnedQty: row.returnedQty,
            unitPrice: row.unitPrice,
            isTemporary: row.isTemporary,
          })),
          payments: payments.map(p => ({
            accountId: p.accountId,
            amount: p.amount.toString(),
            isChange: p.isChange,
          })),
          sellerRole,
          salesmanId: sellerRole === 'SALESMAN' ? effectiveSalesmanId : null,
          customerId: customerId || undefined,
          customerName: customerName || undefined,
          discountPaisas: discountPaisas.toString(),
          idempotencyKey,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw Object.assign(new Error(j?.error ?? 'POST_FAILED'), { setupRequired: j?.setupRequired })
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
    onError: (e: Error & { setupRequired?: boolean }) => {
      postingRef.current = false
      setResult({ ok: false, error: e.message, setupRequired: e.setupRequired })
      toast.error(`Sale failed: ${e.message}`)
    },
  })

  const resetBill = useCallback(() => {
    setRows([])
    setCustomerName('')
    setCustomerId('')
    setDiscountRupees('')
    setPartialAmount('')
    setCashReceivedAmount('')
    setPaymentMode('full')
    setResult(null)
    setIdempotencyKey(crypto.randomUUID())
  }, [])

  const addProduct = useCallback((productId: string) => {
    const p = productsQ.data?.rows.find(x => x.id === productId)
    if (!p) return
    setRows(ls => {
      const existing = ls.find(c => c.productId === productId)
      if (existing) return ls.map(c => c.key === existing.key ? { ...c, soldQty: c.soldQty + 1 } : c)
      return [...ls, {
        key: crypto.randomUUID(),
        productId,
        productName: p.name,
        soldQty: 1,
        returnedQty: 0,
        unitPrice: String(p.salePrice),
        isTemporary: false,
        commissionRatePaisas: p.commissionRatePaisas,
      }]
    })
    setSearchQuery('')
    searchRef.current?.focus()
  }, [productsQ.data])

  function addTempItem() {
    if (!tempItemName || !tempItemPrice) return
    setRows(ls => [...ls, {
      key: crypto.randomUUID(), productId: '', productName: tempItemName,
      soldQty: 1, returnedQty: 0, unitPrice: tempItemPrice, isTemporary: true,
      commissionRatePaisas: null,
    }])
    setTempItemName(''); setTempItemPrice(''); setShowTempItem(false)
  }

  function patchRow(key: string, patch: Partial<BillRow>) {
    setRows(ls => ls.map(c => c.key === key ? { ...c, ...patch } : c))
  }

  function removeRow(key: string) {
    setRows(ls => ls.filter(c => c.key !== key))
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(Math.min(safeHighlight + 1, Math.max(filteredProducts.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(Math.max(safeHighlight - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const p = filteredProducts[safeHighlight]
      if (p) addProduct(p.id)
    } else if (e.key === 'Escape') {
      setSearchQuery('')
    }
  }

  if (result?.ok) {
    return (
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="card-3d border-primary/40 p-8 text-center max-w-md mx-auto">
          <div className="grid place-items-center size-16 rounded-2xl icon-3d mx-auto mb-4"><CheckCircle2 className="size-8 text-primary-foreground" /></div>
          <h2 className="text-xl font-semibold text-foreground">Sale Posted</h2>
          <p className="text-3xl font-bold text-primary mt-1" data-num>{result.invoiceNo}</p>
          <div className="mt-6 flex flex-col gap-2">
            <Button className="press-md shadow-sm" onClick={() => window.open(`/?invoice=${result.invoiceId}`, '_self')}><FileText className="size-4" /> View Invoice</Button>
            <PrintInvoiceButton invoiceId={result.invoiceId} label="Print Invoice" size="default" className="w-full justify-center" icon={Printer} />
            <Button variant="ghost" className="press-sm" onClick={resetBill}><ShoppingCart className="size-4" /> New Sale</Button>
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* ── Workspace header ── */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Counter Sale</h1>
          <p className="text-xs text-muted-foreground mt-0.5" data-num>
            {invoiceDate} · net billed = sold − returned
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-8 text-xs press-sm" onClick={resetBill} disabled={rows.length === 0}>
          <RotateCcw className="size-3.5" /> Clear bill
        </Button>
      </div>

      <div className="grid lg:grid-cols-5 gap-3 items-start">
        {/* ═══ LEFT: PRODUCT FINDER ═══ */}
        <div className="lg:col-span-2 space-y-3">
          <div className="card-3d p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Search products — ↑↓ to move, Enter to add"
                aria-label="Search products"
                className="h-9 bg-background pl-8 press-sm"
              />
            </div>

            {categories.length > 0 && (
              <div className="mt-2">
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="h-8 bg-background press-sm text-xs" aria-label="Filter by category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All categories</SelectItem>
                    {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="mt-2 space-y-1 max-h-[420px] overflow-y-auto" role="listbox" aria-label="Products">
              {filteredProducts.map((p, i) => {
                const out = p.currentStock <= 0
                const low = !out && p.currentStock <= (p.lowStockThreshold ?? 5)
                return (
                  <button
                    key={p.id}
                    role="option"
                    aria-selected={i === safeHighlight}
                    onClick={() => addProduct(p.id)}
                    onMouseEnter={() => setHighlight(i)}
                    className={`w-full flex items-center justify-between gap-2 p-2 rounded-md press-sm text-left border ${i === safeHighlight ? 'border-primary/50 bg-accent/40' : 'border-transparent hover:bg-accent/25'}`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{p.name}</div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 flex-wrap" data-num>
                        <span>Rs {p.salePrice}</span>
                        <span className="opacity-50">·</span>
                        <span className={out ? 'text-destructive font-medium' : low ? 'text-amber-600 font-medium' : ''}>
                          {out ? 'Out of stock' : `${p.currentStock} ${p.unit}`}
                        </span>
                        {p.commissionRatePaisas && BigInt(p.commissionRatePaisas) > 0n && (
                          <>
                            <span className="opacity-50">·</span>
                            <span>{formatWholeRupees(BigInt(p.commissionRatePaisas), false)}/pc comm</span>
                          </>
                        )}
                      </div>
                    </div>
                    {out
                      ? <PackageX className="size-4 text-destructive shrink-0" aria-hidden />
                      : <Plus className="size-4 text-primary shrink-0" aria-hidden />}
                  </button>
                )
              })}
              {filteredProducts.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-6">No products match this search</div>
              )}
            </div>

            <div className="mt-2 pt-2 border-t border-border/60">
              <button onClick={() => setShowTempItem(v => !v)} className="text-[11px] text-muted-foreground hover:text-foreground press-sm w-full text-left">
                {showTempItem ? '− Cancel temporary item' : '+ Temporary item (not in catalogue, no stock or commission)'}
              </button>
              {showTempItem && (
                <div className="mt-2 space-y-1.5 rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 p-2">
                  <Input value={tempItemName} onChange={e => setTempItemName(e.target.value)} placeholder="Item name" aria-label="Temporary item name" className="h-8 bg-background press-sm text-sm" />
                  <div className="flex gap-1">
                    <Input value={tempItemPrice} onChange={e => setTempItemPrice(e.target.value)} placeholder="Rate (Rs)" aria-label="Temporary item rate" className="h-8 bg-background press-sm text-sm" data-num />
                    <Button size="sm" className="press-sm h-8" onClick={addTempItem}><Plus className="size-3" /> Add</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ═══ RIGHT: ACTIVE BILL ═══ */}
        <div className="lg:col-span-3 space-y-3">
          <BillHeader
            user={user}
            canAttributeAnySeller={canAttributeAnySeller}
            sellerRole={sellerRole}
            onSellerRole={(role) => { setSellerRole(role); if (role === 'OWNER') setSalesmanId('') }}
            salesmanId={salesmanId}
            onSalesman={setSalesmanId}
            salesmen={activeSalesmen}
            effectiveSalesmanId={effectiveSalesmanId}
            customers={customersQ.data?.rows ?? []}
            customerId={customerId}
            onCustomer={(id, name) => { setCustomerId(id); setCustomerName(name) }}
            customerName={customerName}
            onCustomerName={setCustomerName}
            invoiceDate={invoiceDate}
          />

          <BillRows
            rows={rows}
            normalized={normalized}
            products={productsQ.data?.rows ?? []}
            onPatch={patchRow}
            onRemove={removeRow}
          />

          {rows.length > 0 && (
            <div className="card-3d p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-sm font-semibold text-foreground">Payment</span>
                <AiFieldHelp fieldName="paymentAccountId" fieldLabel="Payment account and paid amount" currentScreen="counter-sale" role={user.roleName} valueCategory="money allocation" accountingContext="cash versus customer balance" />
                <button onClick={() => setShowAdvanced(v => !v)} className="ml-auto text-[10px] text-muted-foreground hover:text-foreground press-sm">
                  {showAdvanced ? '← Simple' : 'Split →'}
                </button>
              </div>

              {/* Migration-dependent status stays beside the feature it affects.
                  The POS workspace itself keeps working, so a workspace-wide
                  banner would be noise on every sale. */}
              {coaQ.data?.availability?.accounting === false && (
                <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
                  {coaQ.data.availability.message}
                </div>
              )}

              {!showAdvanced ? (
                <>
                  <div className="grid grid-cols-4 gap-1 mb-2">
                    <PayBtn icon={Banknote} label="Cash" active={paymentMode === 'full'} onClick={() => { setPaymentMode('full'); const c = businessAccounts.find(a => a.name === 'Cash' || a.code === '1010'); if (c) setPaymentAccountId(c.id) }} />
                    <PayBtn icon={Smartphone} label="JazzCash" active={paymentMode === 'full'} onClick={() => { setPaymentMode('full'); const jc = businessAccounts.find(a => a.name === 'JazzCash' || a.code === '1050'); if (jc) setPaymentAccountId(jc.id) }} />
                    <PayBtn icon={Split} label="Partial" active={paymentMode === 'partial'} onClick={() => setPaymentMode('partial')} />
                    <PayBtn icon={Wallet} label="Change" active={paymentMode === 'change'} onClick={() => setPaymentMode('change')} />
                  </div>

                  <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
                    <SelectTrigger className="h-8 bg-background press-sm text-sm" aria-label="Payment account"><SelectValue placeholder="Payment account…" /></SelectTrigger>
                    <SelectContent>
                      {businessAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.code})</SelectItem>)}
                    </SelectContent>
                  </Select>

                  <div className="mt-2 grid sm:grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="counter-discount" className="text-[10px] uppercase tracking-wide text-muted-foreground">Bill discount (Rs)</label>
                      <Input id="counter-discount" value={discountRupees} onChange={e => setDiscountRupees(e.target.value)} placeholder="0" className="h-9 bg-background press-sm text-sm" data-num />
                    </div>
                    {paymentMode === 'partial' && (
                      <div>
                        <label htmlFor="counter-partial" className="text-[10px] uppercase tracking-wide text-muted-foreground">Amount received (Rs)</label>
                        <Input id="counter-partial" value={partialAmount} onChange={e => setPartialAmount(e.target.value)} placeholder="0" className="h-9 bg-background press-sm text-sm" data-num />
                      </div>
                    )}
                    {paymentMode === 'change' && (
                      <div>
                        <label htmlFor="counter-cash" className="text-[10px] uppercase tracking-wide text-muted-foreground">Cash received (Rs)</label>
                        <Input id="counter-cash" value={cashReceivedAmount} onChange={e => setCashReceivedAmount(e.target.value)} placeholder="0" className="h-9 bg-background press-sm text-sm" data-num />
                      </div>
                    )}
                  </div>

                  {paymentMode === 'change' && changeNeeded && (
                    <div className="mt-2">
                      <Select value={changeAccountId} onValueChange={setChangeAccountId}>
                        <SelectTrigger className="h-8 bg-background press-sm text-sm" aria-label="Change return account"><SelectValue placeholder="Change return account…" /></SelectTrigger>
                        <SelectContent>
                          {businessAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.code})</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-1.5">
                  {advPayments.map(p => (
                    <div key={p.key} className="grid grid-cols-2 gap-1 items-end">
                      <Select value={p.accountId} onValueChange={v => setAdvPayments(ls => ls.map(x => x.key === p.key ? { ...x, accountId: v } : x))}>
                        <SelectTrigger className="h-8 bg-background press-sm text-sm" aria-label="Split payment account"><SelectValue placeholder="Account…" /></SelectTrigger>
                        <SelectContent>{businessAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <div className="flex gap-1">
                        <Input value={p.amount} onChange={e => setAdvPayments(ls => ls.map(x => x.key === p.key ? { ...x, amount: e.target.value } : x))} placeholder="Rs" aria-label="Split payment amount" className="h-8 bg-background press-sm text-sm" data-num />
                        <button onClick={() => setAdvPayments(ls => ls.length <= 1 ? ls : ls.filter(x => x.key !== p.key))} className="text-muted-foreground press-sm" aria-label="Remove split row"><Trash2 className="size-3.5" /></button>
                      </div>
                      <label className="col-span-2 flex items-center gap-1 text-[10px] cursor-pointer">
                        <input type="checkbox" checked={p.isChange} onChange={e => setAdvPayments(ls => ls.map(x => x.key === p.key ? { ...x, isChange: e.target.checked } : x))} className="size-3 rounded border-border" />
                        <span className="text-muted-foreground">Change/refund</span>
                      </label>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="w-full press-sm" onClick={() => setAdvPayments(ls => [...ls, { key: crypto.randomUUID(), accountId: '', amount: '', isChange: false }])}><Plus className="size-3" /> Row</Button>
                </div>
              )}
            </div>
          )}

          <BillSummary
            totals={totals}
            paymentAccountName={businessAccounts.find(a => a.id === effectivePaymentAccountId)?.name ?? null}
            sellerRole={sellerRole}
            sellerName={sellerRole === 'OWNER' ? 'Owner' : (activeSalesmen.find(s => s.id === effectiveSalesmanId)?.name ?? null)}
            lineErrors={lineErrors}
            totalsError={totalsError}
            stockWarningCount={stockWarnings.length}
            postError={result && !result.ok ? result : null}
            canPost={canPost}
            isPending={postMut.isPending}
            onPost={() => postMut.mutate()}
            hasRows={rows.length > 0}
          />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Bill header — identity, seller, customer
// ─────────────────────────────────────────────────────────────

function BillHeader({
  user, canAttributeAnySeller, sellerRole, onSellerRole, salesmanId, onSalesman,
  salesmen, effectiveSalesmanId, customers, customerId, onCustomer, customerName,
  onCustomerName, invoiceDate,
}: {
  user: MeUser
  canAttributeAnySeller: boolean
  sellerRole: SellerRole
  onSellerRole: (role: SellerRole) => void
  salesmanId: string
  onSalesman: (id: string) => void
  salesmen: Salesman[]
  effectiveSalesmanId: string
  customers: Customer[]
  customerId: string
  onCustomer: (id: string, name: string) => void
  customerName: string
  onCustomerName: (name: string) => void
  invoiceDate: string
}) {
  return (
    <div className="card-3d p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-sm font-semibold text-foreground">Active bill</div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground" data-num>
          Counter · {invoiceDate}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        {/* Seller — explicit Owner vs Salesman, never an implicit default. */}
        <div>
          <div className="flex items-center gap-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Sold by</label>
            <AiFieldHelp fieldName="salesmanId" fieldLabel="Seller" currentScreen="counter-sale" role={user.roleName} valueCategory="staff reference" accountingContext="sales attribution and commission" />
          </div>
          {canAttributeAnySeller ? (
            <div className="mt-0.5 space-y-1">
              <div className="grid grid-cols-2 gap-1">
                <button
                  onClick={() => onSellerRole('OWNER')}
                  aria-pressed={sellerRole === 'OWNER'}
                  className={`px-2 py-1.5 rounded-md border text-xs font-medium press-sm ${sellerRole === 'OWNER' ? 'border-primary bg-accent/60 text-foreground' : 'border-border bg-background text-muted-foreground'}`}
                >
                  Owner
                </button>
                <button
                  onClick={() => onSellerRole('SALESMAN')}
                  aria-pressed={sellerRole === 'SALESMAN'}
                  className={`px-2 py-1.5 rounded-md border text-xs font-medium press-sm ${sellerRole === 'SALESMAN' ? 'border-primary bg-accent/60 text-foreground' : 'border-border bg-background text-muted-foreground'}`}
                >
                  Salesman
                </button>
              </div>
              {sellerRole === 'SALESMAN' && (
                <Select value={salesmanId} onValueChange={onSalesman}>
                  <SelectTrigger className="h-8 bg-background press-sm text-xs" aria-label="Salesman"><SelectValue placeholder="Select salesman…" /></SelectTrigger>
                  <SelectContent>{salesmen.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
              <p className="text-[10px] text-muted-foreground">
                {sellerRole === 'OWNER'
                  ? 'Commission is credited to the Owner.'
                  : effectiveSalesmanId
                    ? `Commission is credited to ${salesmen.find(s => s.id === effectiveSalesmanId)?.name ?? 'the selected salesman'}.`
                    : 'Select the salesman who made this sale.'}
              </p>
            </div>
          ) : (
            <div className="mt-0.5 rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs text-foreground">
              {user.displayName || 'You'} <span className="text-muted-foreground">· your own sale</span>
            </div>
          )}
        </div>

        {/* Customer */}
        <div>
          <div className="flex items-center gap-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Customer (optional)</label>
            <AiFieldHelp fieldName="customerName" fieldLabel="Customer" currentScreen="counter-sale" role={user.roleName} valueCategory="party reference" accountingContext="receivable balance" />
          </div>
          <div className="mt-0.5 space-y-1">
            {customers.length > 0 && (
              <Select
                value={customerId || '__walkin__'}
                onValueChange={(v) => {
                  if (v === '__walkin__') { onCustomer('', ''); return }
                  onCustomer(v, customers.find(c => c.id === v)?.name ?? '')
                }}
              >
                <SelectTrigger className="h-8 bg-background press-sm text-xs" aria-label="Customer"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__walkin__">Walk-in customer</SelectItem>
                  {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {!customerId && (
              <Input
                value={customerName}
                onChange={e => onCustomerName(e.target.value)}
                placeholder="Or type a name for this bill"
                aria-label="Customer name"
                className="h-8 bg-background press-sm text-xs"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Bill rows — sold, returned, net, rate, commission, stock effect
// ─────────────────────────────────────────────────────────────

function BillRows({
  rows, normalized, products, onPatch, onRemove,
}: {
  rows: BillRow[]
  normalized: Array<{ row: BillRow; line: NormalizedSaleLine | null; error: string | null }>
  products: Product[]
  onPatch: (key: string, patch: Partial<BillRow>) => void
  onRemove: (key: string) => void
}) {
  if (rows.length === 0) {
    return (
      <div className="card-3d p-6 text-center">
        <ShoppingCart className="size-6 text-muted-foreground mx-auto mb-2" aria-hidden />
        <p className="text-sm text-muted-foreground">Search a product and press Enter to start the bill.</p>
        <p className="text-[11px] text-muted-foreground mt-1">
          Sell and take back on the same bill: enter Sold 10 and Returned 2 to bill a net 8.
        </p>
      </div>
    )
  }

  return (
    <div className="card-3d overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">Items ({rows.length})</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">net = sold − returned</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">Bill items with sold, returned and net quantities, rate, discount, line total, commission and stock effect</caption>
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="text-left p-2 font-medium">Product</th>
              <th scope="col" className="text-right p-2 font-medium">Sold</th>
              <th scope="col" className="text-right p-2 font-medium">Ret.</th>
              <th scope="col" className="text-right p-2 font-medium">Net</th>
              <th scope="col" className="text-right p-2 font-medium">Rate</th>
              <th scope="col" className="text-right p-2 font-medium">Total</th>
              <th scope="col" className="text-right p-2 font-medium">Comm/pc</th>
              <th scope="col" className="text-right p-2 font-medium">Comm</th>
              <th scope="col" className="text-right p-2 font-medium">Stock</th>
              <th scope="col" className="p-2"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {normalized.map(({ row, line, error }) => {
              const product = products.find(p => p.id === row.productId)
              const projected = product && line ? product.currentStock + line.stockEffect : null
              return (
                <tr key={row.key} className={`border-b border-border/50 last:border-0 ${error ? 'bg-destructive/5' : ''}`}>
                  <td className="p-2 min-w-[140px]">
                    <div className="font-medium text-foreground truncate max-w-[180px]">{row.productName}</div>
                    {row.isTemporary && <span className="text-[9px] uppercase bg-amber-100 text-amber-700 px-1 rounded">Temp</span>}
                    {error && <div className="text-[10px] text-destructive mt-0.5">{error}</div>}
                  </td>
                  <td className="p-2 text-right">
                    <div className="inline-flex items-center gap-0.5">
                      <button onClick={() => onPatch(row.key, { soldQty: Math.max(1, row.soldQty - 1) })} aria-label={`Decrease sold quantity of ${row.productName}`} className="grid place-items-center size-5 rounded border border-border text-muted-foreground press-sm"><Minus className="size-2.5" /></button>
                      <input
                        type="number" min={1} value={row.soldQty}
                        onChange={e => onPatch(row.key, { soldQty: Math.max(1, Number.parseInt(e.target.value || '1', 10) || 1) })}
                        aria-label={`Sold quantity of ${row.productName}`}
                        className="w-11 bg-background border border-border rounded px-1 py-0.5 text-right" data-num
                      />
                      <button onClick={() => onPatch(row.key, { soldQty: row.soldQty + 1 })} aria-label={`Increase sold quantity of ${row.productName}`} className="grid place-items-center size-5 rounded border border-border text-muted-foreground press-sm"><Plus className="size-2.5" /></button>
                    </div>
                  </td>
                  <td className="p-2 text-right">
                    <input
                      type="number" min={0} max={row.soldQty} value={row.returnedQty}
                      onChange={e => onPatch(row.key, { returnedQty: Math.max(0, Number.parseInt(e.target.value || '0', 10) || 0) })}
                      aria-label={`Returned quantity of ${row.productName}`}
                      className={`w-12 bg-background border rounded px-1 py-0.5 text-right ${row.returnedQty > 0 ? 'border-amber-500/60 text-amber-700' : 'border-border'}`} data-num
                    />
                  </td>
                  <td className="p-2 text-right font-semibold text-foreground" data-num>{line ? line.netQty : '—'}</td>
                  <td className="p-2 text-right">
                    <input
                      value={row.unitPrice}
                      onChange={e => onPatch(row.key, { unitPrice: e.target.value })}
                      aria-label={`Rate of ${row.productName}`}
                      className="w-16 bg-background border border-border rounded px-1 py-0.5 text-right" data-num
                    />
                  </td>
                  <td className="p-2 text-right font-medium text-foreground" data-num>
                    {line ? formatWholeRupees(line.lineTotalPaisas, false) : '—'}
                  </td>
                  <td className="p-2 text-right text-muted-foreground" data-num>
                    {row.commissionRatePaisas === null
                      ? <span title="Per-piece commission is not configured for this product">n/a</span>
                      : formatWholeRupees(BigInt(row.commissionRatePaisas), false)}
                  </td>
                  <td className="p-2 text-right font-medium text-foreground" data-num>
                    {line ? formatWholeRupees(line.commissionAmountPaisas, false) : '—'}
                  </td>
                  <td className="p-2 text-right" data-num>
                    {line === null || !row.productId ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={projected !== null && projected < 0 ? 'text-destructive font-medium' : 'text-muted-foreground'}>
                        {line.stockEffect > 0 ? `+${line.stockEffect}` : line.stockEffect}
                        {projected !== null && <span className="opacity-60"> → {projected}</span>}
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-right">
                    <button onClick={() => onRemove(row.key)} aria-label={`Remove ${row.productName}`} className="text-muted-foreground hover:text-destructive press-sm"><Trash2 className="size-3.5" /></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Summary — always visible, with the primary Post action
// ─────────────────────────────────────────────────────────────

function BillSummary({
  totals, paymentAccountName, sellerRole, sellerName, lineErrors, totalsError,
  stockWarningCount, postError, canPost, isPending, onPost, hasRows,
}: {
  totals: ReturnType<typeof computeSaleTotals>
  paymentAccountName: string | null
  sellerRole: SellerRole
  sellerName: string | null
  lineErrors: string[]
  totalsError: string | null
  stockWarningCount: number
  postError: { error?: string; setupRequired?: boolean } | null
  canPost: boolean
  isPending: boolean
  onPost: () => void
  hasRows: boolean
}) {
  if (!hasRows) return null

  return (
    <div className="card-3d border-primary/30 p-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2 mb-3">
        <Figure label="Gross sales" value={formatWholeRupees(totals.grossSalesPaisas, false)} />
        <Figure label="Returns" value={totals.returnsDeductionPaisas > 0n ? `− ${formatWholeRupees(totals.returnsDeductionPaisas, false)}` : formatWholeRupees(0n, false)} tone={totals.returnsDeductionPaisas > 0n ? 'amber' : undefined} />
        <Figure label="Discount" value={totals.totalDiscountPaisas > 0n ? `− ${formatWholeRupees(totals.totalDiscountPaisas, false)}` : formatWholeRupees(0n, false)} />
        <Figure label="Net sale" value={formatWholeRupees(totals.netSalePaisas, false)} tone="strong" />
        <Figure label="Paid" value={formatWholeRupees(totals.paidPaisas, false)} tone="primary" />
        {totals.changePaisas > 0n && <Figure label="Change" value={formatWholeRupees(totals.changePaisas, false)} tone="amber" />}
        <Figure label="Receivable" value={formatWholeRupees(totals.receivablePaisas, false)} tone={totals.receivablePaisas > 0n ? 'destructive' : undefined} />
        <Figure label="Commission" value={formatWholeRupees(totals.totalCommissionPaisas, false)} />
        <Figure label="Stock impact" value={`${totals.netStockEffect > 0 ? '+' : ''}${totals.netStockEffect} pc`} />
      </div>

      <div className="text-[10px] text-muted-foreground mb-2 flex flex-wrap gap-x-3 gap-y-0.5" data-num>
        <span>Sold {totals.totalSoldQty} · Returned {totals.totalReturnedQty} · <span className="font-medium text-foreground">Net billed {totals.totalNetQty}</span></span>
        <span>Commission units {totals.totalNetQty}</span>
        <span>Seller: {sellerRole === 'OWNER' ? 'Owner' : (sellerName ?? 'not selected')}</span>
        {paymentAccountName && <span>Into: {paymentAccountName}</span>}
      </div>

      {lineErrors.length > 0 && (
        <div className="mb-2 rounded-md bg-destructive/10 p-2 text-[11px] text-destructive">
          {lineErrors.slice(0, 3).map((e, i) => <div key={i} className="flex items-start gap-1"><AlertCircle className="size-3 mt-0.5 shrink-0" />{e}</div>)}
        </div>
      )}
      {totalsError && (
        <div className="mb-2 rounded-md bg-destructive/10 p-2 text-[11px] text-destructive flex items-center gap-1">
          <AlertCircle className="size-3 shrink-0" /> {totalsError}
        </div>
      )}
      {stockWarningCount > 0 && (
        <div className="mb-2 flex items-center gap-1 text-[11px] text-amber-600">
          <TrendingDown className="size-3" /> {stockWarningCount} item(s) will go negative on stock
        </div>
      )}
      {postError?.error && (
        <div className={`mb-2 rounded-md p-2 text-[11px] flex items-start gap-1 ${postError.setupRequired ? 'bg-amber-500/10 text-amber-700' : 'bg-destructive/10 text-destructive'}`}>
          <AlertCircle className="size-3 mt-0.5 shrink-0" /> {postError.error}
        </div>
      )}

      <Button className="w-full press-md shadow-sm" disabled={!canPost || isPending} onClick={onPost}>
        {isPending ? 'Posting…' : <><CheckCircle2 className="size-4" /> Post Sale — {formatWholeRupees(totals.netSalePaisas)}</>}
      </Button>
    </div>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'strong' | 'primary' | 'amber' | 'destructive' }) {
  const toneClass =
    tone === 'strong' ? 'text-foreground font-bold' :
    tone === 'primary' ? 'text-primary font-semibold' :
    tone === 'amber' ? 'text-amber-600 font-semibold' :
    tone === 'destructive' ? 'text-destructive font-semibold' :
    'text-foreground font-medium'
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm ${toneClass}`} data-num>{value}</div>
    </div>
  )
}

function PayBtn({ icon: Icon, label, active, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={active} className={`flex flex-col items-center gap-0.5 p-2 rounded-lg border press-sm ${active ? 'border-primary bg-accent/60' : 'border-border bg-background hover:bg-muted/40'}`}>
      <Icon className={`size-4 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
      <span className="text-[9px] font-medium">{label}</span>
    </button>
  )
}
