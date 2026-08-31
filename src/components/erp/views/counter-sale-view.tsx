'use client'

import { Fragment, useState, useMemo, useRef, useCallback } from 'react'
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
  Printer, FileText, TrendingDown, Minus, Search, RotateCcw, PackageX,
  WalletCards, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react'
import { formatWholeRupees, parseMoney } from '@/lib/format'
import { motion } from 'framer-motion'
import type { MeUser } from '@/components/erp/erp-app'
import { apiFetchJson } from '@/lib/api-client'
import { AiFieldHelp } from '@/components/erp/ai-actions'
import { PaymentPanel } from '@/components/erp/sales/payment-panel'
import { usePaymentDraft } from '@/components/erp/sales/use-payment-draft'
import { usePaymentAccounts } from '@/components/erp/sales/use-payment-accounts'
import { resolvePaymentAccountGate } from '@/lib/sales/payment-accounts'
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

  const [discountRupees, setDiscountRupees] = useState('')
  const [result, setResult] = useState<{ ok: boolean; invoiceNo?: string; invoiceId?: string; error?: string; setupRequired?: boolean } | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  const searchRef = useRef<HTMLInputElement>(null)
  const postingRef = useRef(false)

  const canAttributeAnySeller = useMemo(
    () => Boolean(user.permissions?.includes?.('can_view_sales')),
    [user.permissions],
  )

  const paymentAccountsQ = usePaymentAccounts()
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

  const businessAccounts = paymentAccountsQ.accounts
  const paymentAccountGate = resolvePaymentAccountGate({
    isPending: paymentAccountsQ.isPending,
    isError: paymentAccountsQ.isError,
    isSuccess: paymentAccountsQ.isSuccess,
    accountCount: businessAccounts.length,
  })

  // Active account ids as offered by this screen. Account ids are Supabase
  // UUIDs in production and Prisma cuids locally, so correctness is checked by
  // membership in the live list, never by a fixed id format.
  const activeAccountIdSet = useMemo(() => new Set(businessAccounts.map(a => a.id)), [businessAccounts])

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
    return matched
      .map((product, index) => ({ product, index }))
      .sort((a, b) => Number(b.product.currentStock > 0) - Number(a.product.currentStock > 0) || a.index - b.index)
      .map(({ product }) => product)
      .slice(0, 40)
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

  // ── Payment: one shared implementation for every sale channel. Counter Sale
  //    refuses a fully unpaid bill, so `requirePayment` is on here. ──
  const payment = usePaymentDraft({
    accounts: businessAccounts,
    netPayablePaisas: netTotal,
    requirePayment: true,
  })
  const payments = useMemo(
    () => payment.allocations.map(a => ({
      accountId: a.accountId,
      amount: a.amountPaisas,
      isChange: a.isChange,
    })),
    [payment.allocations],
  )

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
  const allAccountsValid = payments.every(p => activeAccountIdSet.has(p.accountId))
  const canPost = Boolean(
    sellerReady &&
    validLines.length === rows.length &&
    rows.length > 0 &&
    payments.length > 0 &&
    payments.every(p => p.amount > 0n) &&
    allAccountsValid &&
    payment.isValid &&
    !totalsError &&
    lineErrors.length === 0,
  )
  const postDisabledReason = rows.length === 0
    ? 'Add at least one product.'
    : !sellerReady
      ? 'Choose who made this sale.'
      : lineErrors[0]
        ? lineErrors[0]
        : totalsError
          ? totalsError
          : payment.error
            ? payment.error
            : payments.length === 0
              ? 'Enter a valid payment.'
              : null

  const postMut = useMutation({
    mutationFn: async () => {
      if (postingRef.current) throw new Error('Submission already in progress')
      postingRef.current = true
      for (const p of payments) {
        if (!activeAccountIdSet.has(p.accountId)) throw new Error('Invalid payment account. Please refresh the page and choose an active account.')
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
          payments: payment.serializedPayments,
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
    payment.reset()
    setResult(null)
    setIdempotencyKey(crypto.randomUUID())
    requestAnimationFrame(() => searchRef.current?.focus())
  }, [payment.reset])

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
            <Button className="press-md shadow-sm" onClick={resetBill}><ShoppingCart className="size-4" /> New Sale</Button>
            <Button variant="outline" className="press-sm" onClick={() => window.open(`/?invoice=${result.invoiceId}`, '_self')}><FileText className="size-4" /> View Invoice</Button>
            <PrintInvoiceButton invoiceId={result.invoiceId} label="Print Invoice" size="default" className="w-full justify-center" icon={Printer} />
          </div>
        </motion.div>
      </div>
    )
  }

  if (paymentAccountGate !== 'ready') {
    const canManagePaymentAccounts = user.permissions.includes('can_manage_setup')
    return (
      <PaymentAccountWorkspaceState
        gate={paymentAccountGate}
        canManage={canManagePaymentAccounts}
        onRetry={() => void paymentAccountsQ.refetch()}
        onSetup={() => {
          window.history.pushState({}, '', '/?page=business-accounts')
          window.dispatchEvent(new PopStateEvent('popstate'))
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-2 lg:h-[calc(100dvh-9.5rem)] lg:min-h-[520px]">
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

      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-rows-[minmax(0,1fr)]">
        {/* ═══ LEFT: PRODUCT FINDER ═══ */}
        <div className="min-h-0 lg:h-full">
          <div className="card-3d flex h-full min-h-0 flex-col p-3">
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

            <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1" role="listbox" aria-label="Products">
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
        <div className="card-3d flex min-h-0 flex-col overflow-hidden lg:h-full">
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
            <div className="shrink-0">
            <PaymentPanel
              accounts={businessAccounts}
              {...payment.panelProps}
              error={payment.error}
              paidPlaceholder={formatWholeRupees(netTotal, false)}
              idPrefix="counter-payment"
              embedded
              onPayFull={() => payment.setPaidAmount(formatWholeRupees(netTotal, false).replace(/,/g, ''))}
              headerSlot={
                <AiFieldHelp fieldName="paymentAccountId" fieldLabel="Payment account and paid amount" currentScreen="counter-sale" role={user.roleName} valueCategory="money allocation" accountingContext="cash versus customer balance" />
              }
            >
              <div className="mt-2">
                <label htmlFor="counter-discount" className="text-[10px] uppercase tracking-wide text-muted-foreground">Bill discount (Rs)</label>
                <Input id="counter-discount" value={discountRupees} onChange={e => setDiscountRupees(e.target.value)} placeholder="0" className="h-9 bg-background press-sm text-sm" data-num />
              </div>
            </PaymentPanel>
            </div>
          )}

          <BillSummary
            totals={totals}
            paymentAccountName={payment.mode === 'split' ? `${payment.splitRows.length} accounts (split)` : (businessAccounts.find(a => a.id === payment.accountId)?.name ?? null)}
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
            disabledReason={postDisabledReason}
          />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Bill header — identity, seller, customer
// ─────────────────────────────────────────────────────────────

function PaymentAccountWorkspaceState({
  gate,
  canManage,
  onRetry,
  onSetup,
}: {
  gate: ReturnType<typeof resolvePaymentAccountGate>
  canManage: boolean
  onRetry: () => void
  onSetup: () => void
}) {
  if (gate === 'loading') {
    return (
      <div className="card-3d grid min-h-[360px] place-items-center p-8" aria-busy="true">
        <div className="text-center">
          <Loader2 className="mx-auto size-6 animate-spin text-primary" aria-hidden />
          <p className="mt-3 text-sm font-medium text-foreground">Preparing Counter Sale</p>
          <p className="mt-1 text-xs text-muted-foreground">Loading active payment accounts...</p>
        </div>
      </div>
    )
  }

  if (gate === 'error') {
    return (
      <div className="card-3d grid min-h-[360px] place-items-center p-8">
        <div className="max-w-md text-center">
          <AlertCircle className="mx-auto size-7 text-amber-600" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold text-foreground">Payment accounts could not be loaded</h1>
          <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again before creating a Counter Sale.</p>
          <Button type="button" variant="outline" className="mt-4" onClick={onRetry}>Try again</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="card-3d grid min-h-[360px] place-items-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
          <WalletCards className="size-6" aria-hidden />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-foreground">Payment account required</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {canManage
            ? 'Add a Cash, Bank, or Wallet account before creating Counter Sales.'
            : 'No active payment account is available. Ask an Owner or authorized user to set one up.'}
        </p>
        {canManage && (
          <Button type="button" className="mt-5" onClick={onSetup}>
            <WalletCards className="size-4" /> Set up payment account
          </Button>
        )}
      </div>
    </div>
  )
}

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
    <div className="shrink-0 border-b border-border/70 px-3 py-2">
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
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set())

  function toggleExpanded(key: string) {
    setExpandedRows((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (rows.length === 0) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
        <ShoppingCart className="size-6 text-muted-foreground mx-auto mb-2" aria-hidden />
        <p className="text-sm text-muted-foreground">Search a product and press Enter to start the bill.</p>
        <p className="text-[11px] text-muted-foreground mt-1">
          Sell and take back on the same bill: enter Sold 10 and Returned 2 to bill a net 8.
        </p>
      </div>
    )
  }

  return (
    <div
      className="min-h-0 min-w-0 flex-1 basis-0 overflow-y-auto lg:min-h-[96px]"
      aria-label="Active bill items"
      data-testid="active-bill-items"
    >
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">Items ({rows.length})</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">net = sold − returned</span>
      </div>
      <div className="overflow-x-hidden">
        <table className="w-full table-fixed text-xs">
          <caption className="sr-only">Bill items with sold, returned and net quantities, rate, discount, line total, commission and stock effect</caption>
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="text-left p-2 font-medium">Product</th>
              <th scope="col" className="w-[124px] text-right p-2 font-medium">Qty</th>
              <th scope="col" className="hidden">Returned</th>
              <th scope="col" className="hidden">Net</th>
              <th scope="col" className="hidden">Rate</th>
              <th scope="col" className="w-[84px] text-right p-2 font-medium">Total</th>
              <th scope="col" className="hidden">Commission per piece</th>
              <th scope="col" className="hidden">Commission total</th>
              <th scope="col" className="hidden">Stock impact</th>
              <th scope="col" className="w-[44px] p-2"><span className="sr-only">Item details</span></th>
            </tr>
          </thead>
          <tbody>
            {normalized.map(({ row, line, error }) => {
              const product = products.find(p => p.id === row.productId)
              const projected = product && line ? product.currentStock + line.stockEffect : null
              const isExpanded = expandedRows.has(row.key)
              return (
                <Fragment key={row.key}>
                <tr data-testid="active-bill-item-row" className={`border-b border-border/50 ${error ? 'bg-destructive/5' : ''}`}>
                  <td className="min-w-0 p-2">
                    <div className="break-words font-medium leading-tight text-foreground">{row.productName}</div>
                    {row.isTemporary && <span className="text-[9px] uppercase bg-amber-100 text-amber-700 px-1 rounded">Temp</span>}
                    {row.returnedQty > 0 && line && (
                      <div className="mt-0.5 text-[10px] font-medium text-amber-700" data-num>
                        Sold {row.soldQty} / Returned {row.returnedQty} / Net {line.netQty}
                      </div>
                    )}
                    {error && <div className="text-[10px] text-destructive mt-0.5">{error}</div>}
                  </td>
                  <td className="p-2 text-right">
                    <div className="inline-flex items-center gap-0.5">
                      <button type="button" onClick={() => onPatch(row.key, { soldQty: Math.max(1, row.soldQty - 1) })} aria-label={`Decrease quantity of ${row.productName}`} className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground press-sm"><Minus className="size-3" /></button>
                      <input
                        type="number" min={1} value={row.soldQty}
                        onChange={e => onPatch(row.key, { soldQty: Math.max(1, Number.parseInt(e.target.value || '1', 10) || 1) })}
                        aria-label={`Quantity of ${row.productName}`}
                        className="h-8 w-10 rounded-md border border-border bg-background px-1 text-center font-semibold" data-num
                      />
                      <button type="button" onClick={() => onPatch(row.key, { soldQty: row.soldQty + 1 })} aria-label={`Increase quantity of ${row.productName}`} className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground press-sm"><Plus className="size-3" /></button>
                    </div>
                  </td>
                  <td className="hidden">
                    <input
                      type="number" min={0} max={row.soldQty} value={row.returnedQty}
                      onChange={e => onPatch(row.key, { returnedQty: Math.max(0, Number.parseInt(e.target.value || '0', 10) || 0) })}
                      aria-label={`Returned quantity of ${row.productName}`}
                      className={`w-12 bg-background border rounded px-1 py-0.5 text-right ${row.returnedQty > 0 ? 'border-amber-500/60 text-amber-700' : 'border-border'}`} data-num
                    />
                  </td>
                  <td className="hidden" data-num>{line ? line.netQty : '--'}</td>
                  <td className="hidden">
                    <input
                      value={row.unitPrice}
                      onChange={e => onPatch(row.key, { unitPrice: e.target.value })}
                      aria-label={`Rate of ${row.productName}`}
                      className="w-16 bg-background border border-border rounded px-1 py-0.5 text-right" data-num
                    />
                  </td>
                  <td className="min-w-[80px] p-2 text-right font-bold text-foreground" data-num>
                    {line ? formatWholeRupees(line.lineTotalPaisas) : '--'}
                  </td>
                  <td className="hidden" data-num>
                    {row.commissionRatePaisas === null
                      ? <span title="Per-piece commission is not configured for this product">n/a</span>
                      : formatWholeRupees(BigInt(row.commissionRatePaisas), false)}
                  </td>
                  <td className="hidden" data-num>
                    {line ? formatWholeRupees(line.commissionAmountPaisas, false) : '--'}
                  </td>
                  <td className="hidden" data-num>
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
                    <button type="button" onClick={() => toggleExpanded(row.key)} aria-expanded={isExpanded} aria-label={`${isExpanded ? 'Hide' : 'Show'} details for ${row.productName}`} className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-muted press-sm">
                      {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    </button>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-b border-border/50 bg-muted/20">
                    <td colSpan={10} className="px-3 py-2">
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Returned quantity
                          <input type="number" min={0} max={row.soldQty} value={row.returnedQty} onChange={(event) => onPatch(row.key, { returnedQty: Math.max(0, Number.parseInt(event.target.value || '0', 10) || 0) })} aria-label={`Returned quantity of ${row.productName}`} className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-sm" data-num />
                        </label>
                        <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Rate override (Rs)
                          <input value={row.unitPrice} onChange={(event) => onPatch(row.key, { unitPrice: event.target.value })} aria-label={`Rate of ${row.productName}`} className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-sm" data-num />
                        </label>
                        <Detail label="Net quantity" value={line ? String(line.netQty) : '--'} />
                        <Detail label="Commission per piece" value={row.commissionRatePaisas === null ? 'Not configured' : formatWholeRupees(BigInt(row.commissionRatePaisas))} />
                        <Detail label="Commission total" value={line ? formatWholeRupees(line.commissionAmountPaisas) : '--'} />
                        <Detail label="Stock impact" value={line && row.productId ? `${line.stockEffect > 0 ? '+' : ''}${line.stockEffect}${projected !== null ? ` / ${projected} after sale` : ''}` : 'No stock movement'} tone={projected !== null && projected < 0 ? 'warning' : undefined} />
                        <div className="flex items-end sm:col-span-2">
                          <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive" onClick={() => onRemove(row.key)}>
                            <Trash2 className="size-3.5" /> Remove item
                          </Button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
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

function Detail({ label, value, tone }: { label: string; value: string; tone?: 'warning' }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-sm font-medium ${tone === 'warning' ? 'text-amber-700' : 'text-foreground'}`} data-num>{value}</div>
    </div>
  )
}

function BillSummary({
  totals, paymentAccountName, sellerRole, sellerName, lineErrors, totalsError,
  stockWarningCount, postError, canPost, isPending, onPost, hasRows, disabledReason,
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
  disabledReason: string | null
}) {
  return (
    <div className="shrink-0 border-t border-primary/25 bg-background/95 px-3 py-2 backdrop-blur">
      {lineErrors.length > 0 && (
        <div className="mb-1 text-[11px] text-destructive">
          {lineErrors[0]}
        </div>
      )}
      {totalsError && (
        <div className="mb-1 text-[11px] text-destructive">{totalsError}</div>
      )}
      {stockWarningCount > 0 && (
        <div className="mb-1 flex items-center gap-1 text-[11px] text-amber-600">
          <TrendingDown className="size-3" /> {stockWarningCount} item(s) will go negative on stock
        </div>
      )}
      {postError?.error && (
        <div className={`mb-1 text-[11px] flex items-start gap-1 ${postError.setupRequired ? 'text-amber-700' : 'text-destructive'}`}>
          <AlertCircle className="size-3 mt-0.5 shrink-0" /> {postError.error}
        </div>
      )}
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Net sale</div>
          <div className="text-2xl font-bold leading-none text-foreground" data-num>{formatWholeRupees(totals.netSalePaisas)}</div>
          <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-muted-foreground" data-num>
            <span>{hasRows ? `${totals.totalNetQty} item${totals.totalNetQty === 1 ? '' : 's'}` : 'Empty bill'}</span>
            <span>Paid {formatWholeRupees(totals.paidPaisas)}</span>
            <span>Balance {formatWholeRupees(totals.receivablePaisas)}</span>
            <span>{sellerRole === 'OWNER' ? 'Owner' : (sellerName ?? 'Seller not selected')}</span>
            {paymentAccountName && <span>{paymentAccountName}</span>}
          </div>
        </div>
        <div className="w-full max-w-[240px]">
          {!canPost && !isPending && disabledReason && (
            <p className="mb-1 text-right text-[10px] text-muted-foreground">{disabledReason}</p>
          )}
          <Button className="h-11 w-full press-md shadow-sm" disabled={!canPost || isPending} onClick={onPost}>
            {isPending ? 'Posting...' : <><CheckCircle2 className="size-4" /> Post Sale</>}
          </Button>
        </div>
      </div>
    </div>
  )
}
