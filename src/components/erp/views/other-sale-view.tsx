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
  Printer, User, Search, Percent,
} from 'lucide-react'
import { formatWholeRupees, parseMoney } from '@/lib/format'
import { motion, AnimatePresence } from 'framer-motion'
import type { MeUser } from '@/components/erp/erp-app'

type Product = { id: string; name: string; currentStock: number; salePrice: number; unit: string }
type Salesman = { id: string; name: string; commissionPct: number }
type Customer = { id: string; name: string; phone?: string; city?: string }
type Account = { id: string; code: string; name: string; isBusinessAccount: boolean }

type CartItem = {
  key: string
  productId: string
  productName: string
  qty: number
  unitPrice: string
  isTemporary: boolean
}

export function OtherSaleView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [salesmanId, setSalesmanId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerCity, setCustomerCity] = useState('')
  const [invoiceDate] = useState(bizDateString(new Date()))
  const [cart, setCart] = useState<CartItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showTempItem, setShowTempItem] = useState(false)
  const [tempItemName, setTempItemName] = useState('')
  const [tempItemPrice, setTempItemPrice] = useState('')
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [paymentAccountId, setPaymentAccountId] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [discountRupees, setDiscountRupees] = useState('')
  const [result, setResult] = useState<{ ok: boolean; invoiceNo?: string; invoiceId?: string; error?: string } | null>(null)
  const [sessionKey] = useState(() => crypto.randomUUID())
  const [isPosting, setIsPosting] = useState(false)
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
    staleTime: 60_000,
  })
  const customersQ = useQuery<{ rows: Customer[] }>({
    queryKey: ['customers'],
    queryFn: () => fetch('/api/customers').then(r => r.json()),
    staleTime: 60_000,
  })

  const accounts = useMemo(() => {
    const rows: Account[] = Array.isArray(coaQ.data) ? (coaQ.data as any) : (coaQ.data as any)?.rows ?? []
    return rows.filter((a) => a.isBusinessAccount)
  }, [coaQ.data])

  const filteredProducts = useMemo(() => {
    const rows = productsQ.data?.rows ?? []
    if (!searchQuery) return rows.slice(0, 20)
    return rows.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 20)
  }, [productsQ.data, searchQuery])

  const subtotal = useMemo(() => {
    return cart.reduce((s, item) => s + (parseMoney(item.unitPrice) ?? 0n) * BigInt(item.qty), 0n)
  }, [cart])

  const discount = useMemo(() => {
    const parsed = parseMoney(discountRupees)
    return parsed ?? 0n
  }, [discountRupees])

  const total = useMemo(() => {
    const t = subtotal - discount
    return t < 0n ? 0n : t
  }, [subtotal, discount])

  const isPaymentValid = useMemo(() => {
    const paid = parseMoney(paymentAmount)
    return paid !== null && paid > 0n
  }, [paymentAmount])

  function addToCart(product: Product) {
    const key = crypto.randomUUID()
    setCart((prev) => [...prev, {
      key,
      productId: product.id,
      productName: product.name,
      qty: 1,
      unitPrice: String(product.salePrice * 100), // Convert to paisas
      isTemporary: false,
    }])
  }

  function addTempItem() {
    if (!tempItemName.trim() || !tempItemPrice.trim()) return
    const price = parseMoney(tempItemPrice)
    if (price === null || price <= 0n) {
      toast.error('Invalid temporary item price')
      return
    }
    const key = crypto.randomUUID()
    setCart((prev) => [...prev, {
      key,
      productId: '',
      productName: tempItemName.trim(),
      qty: 1,
      unitPrice: tempItemPrice,
      isTemporary: true,
    }])
    setTempItemName('')
    setTempItemPrice('')
    setShowTempItem(false)
  }

  function removeFromCart(key: string) {
    setCart((prev) => prev.filter((item) => item.key !== key))
  }

  function updateCartQty(key: string, qty: number) {
    if (qty < 1) return
    setCart((prev) => prev.map((item) => item.key === key ? { ...item, qty } : item))
  }

  async function handleSubmit() {
    if (postingRef.current) return
    if (cart.length === 0) { toast.error('Add at least one item'); return }
    if (!customerId && !customerName.trim()) { toast.error('Select or create a customer'); return }
    if (!salesmanId) { toast.error('Select a salesman'); return }

    const payments: Array<{ accountId: string; amount: string; isChange: boolean }> = []
    const paid = parseMoney(paymentAmount)
    if (paid !== null && paid > 0n) {
      if (!paymentAccountId) { toast.error('Select a payment account'); return }
      payments.push({ accountId: paymentAccountId, amount: String(paid), isChange: false })
    }

    const discountPaisas = discount > 0n ? String(discount) : undefined

    const body = {
      invoiceDate,
      items: cart.map((item) => ({
        productId: item.productId || null,
        productName: item.productName,
        qty: item.qty,
        unitPrice: item.unitPrice,
        isTemporary: item.isTemporary,
      })),
      payments,
      salesmanId,
      customerId: customerId || undefined,
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone || undefined,
      customerCity: customerCity || undefined,
      discountPaisas,
      idempotencyKey: sessionKey,
    }

    postingRef.current = true
    setIsPosting(true)
    try {
      const res = await fetch('/api/sales/other', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setResult({ ok: false, error: data.error || data.message || 'Failed to post Other Sale' })
        toast.error(data.error || data.message || 'Failed to post Other Sale')
        return
      }
      setResult({ ok: true, invoiceNo: data.invoiceNo, invoiceId: data.invoiceId })
      toast.success(`Other Sale ${data.invoiceNo} posted`)
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['customers'] })
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message })
      toast.error((e as Error).message)
    } finally {
      postingRef.current = false
    }
  }

  function resetForm() {
    setCart([])
    setCustomerId('')
    setCustomerName('')
    setCustomerPhone('')
    setCustomerCity('')
    setPaymentAccountId('')
    setPaymentAmount('')
    setDiscountRupees('')
    setResult(null)
    setShowNewCustomer(false)
  }

  return (
    <div className="card-3d p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <ShoppingCart className="size-5 text-primary" />
          <h2 className="text-lg font-semibold">Other Sale</h2>
        </div>
        {result?.ok && result.invoiceId && (
          <PrintInvoiceButton invoiceId={result.invoiceId} variant="outline" size="sm" />
        )}
      </div>

      {/* Result display */}
      {result && (
        <div className={`mb-6 p-4 rounded-xl border ${result.ok ? 'border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800' : 'border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800'}`}>
          <div className="flex items-start justify-between">
            <div>
              {result.ok ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-5 text-green-600" />
                  <span className="font-medium text-green-700 dark:text-green-400">Sale posted — {result.invoiceNo}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <AlertCircle className="size-5 text-red-600" />
                  <span className="font-medium text-red-700 dark:text-red-400">{result.error}</span>
                </div>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={resetForm}>New Sale</Button>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        {/* Salesman */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Salesman *</label>
          <Select value={salesmanId} onValueChange={setSalesmanId}>
            <SelectTrigger><SelectValue placeholder="Select salesman" /></SelectTrigger>
            <SelectContent>
              {(salesmenQ.data?.rows ?? []).map((sm) => (
                <SelectItem key={sm.id} value={sm.id}>{sm.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Customer */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Customer *</label>
          {showNewCustomer ? (
            <div className="space-y-2">
              <Input placeholder="Customer name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              <div className="flex gap-2">
                <Input placeholder="Phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className="flex-1" />
                <Input placeholder="City" value={customerCity} onChange={(e) => setCustomerCity(e.target.value)} className="flex-1" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowNewCustomer(false)}>Cancel</Button>
                <span className="text-xs text-muted-foreground self-center">Name is required</span>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Select value={customerId} onValueChange={(v) => {
                setCustomerId(v)
                const c = (customersQ.data?.rows ?? []).find((c) => c.id === v)
                if (c) {
                  setCustomerName(c.name)
                  setCustomerPhone(c.phone ?? '')
                  setCustomerCity(c.city ?? '')
                }
              }}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  {(customersQ.data?.rows ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => setShowNewCustomer(true)}>
                <Plus className="size-3.5 mr-1" /> New
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Product search + add */}
      <div className="mb-4">
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Add Product</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        {searchQuery && (
          <div className="mt-2 border rounded-xl divide-y max-h-48 overflow-y-auto">
            {filteredProducts.map((p) => (
              <button
                key={p.id}
                className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/60 text-left"
                onClick={() => { addToCart(p); setSearchQuery('') }}
              >
                <span>{p.name} <span className="text-muted-foreground">({p.unit})</span></span>
                <span className="text-muted-foreground">Rs {p.salePrice.toFixed(2)} · Stock: {p.currentStock}</span>
              </button>
            ))}
          </div>
        )}
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowTempItem(!showTempItem)}>
          <Plus className="size-3.5 mr-1" /> Temporary Item
        </Button>
        {showTempItem && (
          <div className="mt-2 flex gap-2 items-end">
            <Input placeholder="Item name" value={tempItemName} onChange={(e) => setTempItemName(e.target.value)} className="flex-1" />
            <Input placeholder="Price (Rs)" value={tempItemPrice} onChange={(e) => setTempItemPrice(e.target.value)} className="w-28" />
            <Button size="sm" onClick={addTempItem}>Add</Button>
          </div>
        )}
      </div>

      {/* Cart items */}
      <div className="space-y-2 mb-4">
        {cart.map((item) => (
          <div key={item.key} className="flex items-center gap-2 p-2 border rounded-lg">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{item.productName}</p>
              <p className="text-xs text-muted-foreground">
                Rate: Rs {formatWholeRupees(parseMoney(item.unitPrice) ?? 0n)} · Line: Rs {formatWholeRupees((parseMoney(item.unitPrice) ?? 0n) * BigInt(item.qty))}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="size-8 p-0" onClick={() => updateCartQty(item.key, item.qty - 1)}>-</Button>
              <span className="w-8 text-center text-sm font-medium">{item.qty}</span>
              <Button variant="outline" size="sm" className="size-8 p-0" onClick={() => updateCartQty(item.key, item.qty + 1)}>+</Button>
            </div>
            <Button variant="ghost" size="sm" className="size-8 p-0 text-destructive" onClick={() => removeFromCart(item.key)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      {/* Payment section */}
      <div className="grid md:grid-cols-2 gap-4 mb-6 p-4 border rounded-xl bg-muted/30">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Payment Account {parseMoney(paymentAmount) !== null && parseMoney(paymentAmount)! > 0n ? '*' : '(optional)'}
          </label>
          <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
            <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.name} ({a.code})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Paid Amount (Rs)</label>
          <Input
            placeholder="0 = fully credit"
            value={paymentAmount}
            onChange={(e) => setPaymentAmount(e.target.value)}
          />
        </div>
      </div>

      {/* Discount */}
      <div className="flex items-center gap-2 mb-4">
        <Percent className="size-4 text-muted-foreground" />
        <Input
          placeholder="Discount (Rs)"
          value={discountRupees}
          onChange={(e) => setDiscountRupees(e.target.value)}
          className="w-40"
        />
      </div>

      {/* Totals */}
      <div className="border-t pt-4 mb-6 space-y-1 text-right">
        <p className="text-sm text-muted-foreground">Subtotal: Rs {formatWholeRupees(subtotal)}</p>
        {discount > 0n && <p className="text-sm text-green-600">Discount: -Rs {formatWholeRupees(discount)}</p>}
        <p className="text-lg font-bold">Total: Rs {formatWholeRupees(total)}</p>
        {parseMoney(paymentAmount) !== null && parseMoney(paymentAmount)! > 0n && (
          <>
            <p className="text-sm text-green-600">Paid: Rs {formatWholeRupees(parseMoney(paymentAmount)!)}</p>
            <p className="text-sm text-amber-600">Outstanding: Rs {formatWholeRupees(total - parseMoney(paymentAmount)!)}</p>
          </>
        )}
      </div>

      {/* Submit */}
      <div className="flex gap-3">
        <Button className="flex-1" onClick={handleSubmit} disabled={isPosting || cart.length === 0 || !salesmanId}>
          {isPosting ? 'Posting...' : 'Post Other Sale'}
        </Button>
        <Button variant="outline" onClick={resetForm}>Reset</Button>
      </div>
    </div>
  )
}
