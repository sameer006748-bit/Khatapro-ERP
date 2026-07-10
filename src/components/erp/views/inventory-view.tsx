'use client'

import { useState, useMemo } from 'react'
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
  Plus, Search, Package, TrendingDown, AlertCircle, CheckCircle2,
  PackagePlus, PackageMinus, Edit2, History, X, ChevronDown, Minus,
  Tag, Boxes, Wallet, AlertTriangle,
} from 'lucide-react'
import { formatMoney, parseMoney } from '@/lib/format'
import { bizDate } from '@/lib/dates'
import { motion, AnimatePresence } from 'framer-motion'
import type { MeUser } from '@/components/erp/erp-app'

type Product = {
  id: string
  name: string
  categoryId: string | null
  categoryName: string | null
  unit: string
  salePrice: number
  purchasePrice: number
  currentStock: number
  isTemporary: boolean
  isActive: boolean
  markedForMerge: boolean
  lowStockThreshold: number
  createdAt: string
}

type Category = { id: string; name: string; isActive: boolean }
type Movement = {
  id: string
  productId: string
  productName: string
  movementType: string
  quantity: number
  balanceAfter: number
  reason: string | null
  movementDate: string
  createdAt: string
}

type FilterChip = 'all' | 'low' | 'negative' | 'temporary'

export function InventoryView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const canManage = user.permissions.includes('can_create_products')
  const canEdit = user.permissions.includes('can_edit_products')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterChip>('all')
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [showStockEntry, setShowStockEntry] = useState(false)
  const [adjustProduct, setAdjustProduct] = useState<{ product: Product; type: 'in' | 'out' } | null>(null)
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null)
  const [showCategories, setShowCategories] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')

  const productsQ = useQuery<{ rows: Product[] }>({
    queryKey: ['products'],
    queryFn: () => fetch('/api/products').then(r => r.json()),
  })
  const catQ = useQuery<{ rows: Category[] }>({
    queryKey: ['product-categories'],
    queryFn: () => fetch('/api/product-categories').then(r => r.json()),
  })
  const movementsQ = useQuery<{ rows: Movement[] }>({
    queryKey: ['stock-movements'],
    queryFn: () => fetch('/api/stock-movements').then(r => r.json()),
  })

  const products = productsQ.data?.rows ?? []
  const movements = movementsQ.data?.rows ?? []

  // KPI calculations
  const kpis = useMemo(() => {
    const active = products.filter(p => p.isActive)
    const totalItems = active.length
    const totalQty = active.reduce((s, p) => s + p.currentStock, 0)
    const totalValue = active.reduce((s, p) => s + p.currentStock * p.purchasePrice, 0)
    const lowStock = active.filter(p => p.currentStock >= 0 && p.currentStock <= p.lowStockThreshold).length
    const negStock = active.filter(p => p.currentStock < 0).length
    return { totalItems, totalQty, totalValue, lowStock, negStock }
  }, [products])

  // Filtered products
  const filtered = useMemo(() => {
    let result = products.filter(p => p.isActive)
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(p => p.name.toLowerCase().includes(q))
    }
    if (filter === 'low') result = result.filter(p => p.currentStock >= 0 && p.currentStock <= p.lowStockThreshold)
    if (filter === 'negative') result = result.filter(p => p.currentStock < 0)
    if (filter === 'temporary') result = result.filter(p => p.isTemporary)
    return result
  }, [products, search, filter])

  function getStockStatus(p: Product): { label: string; color: string } {
    if (p.currentStock < 0) return { label: 'Negative', color: 'bg-red-100 text-red-700' }
    if (p.currentStock === 0) return { label: 'Out of Stock', color: 'bg-amber-100 text-amber-700' }
    if (p.currentStock <= p.lowStockThreshold) return { label: 'Low Stock', color: 'bg-amber-100 text-amber-700' }
    return { label: 'In Stock', color: 'bg-emerald-100 text-emerald-700' }
  }

  // Stock movement mutation
  const stockMut = useMutation({
    mutationFn: async (args: { productId: string; type: 'in' | 'out'; qty: number; reason: string }) => {
      const r = await fetch('/api/stock-movements', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          productId: args.productId,
          movementType: args.type === 'in' ? 'adjustment_in' : 'adjustment_out',
          quantity: args.qty,
          reason: args.reason || undefined,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error ?? 'FAILED')
      return j
    },
    onSuccess: () => {
      toast.success('Stock adjusted.')
      void qc.invalidateQueries({ queryKey: ['products'] })
      void qc.invalidateQueries({ queryKey: ['stock-movements'] })
      setAdjustProduct(null)
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })

  // Category create mutation
  const catMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/product-categories', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newCategoryName }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error ?? 'FAILED')
      return j
    },
    onSuccess: () => {
      toast.success('Category created.')
      void qc.invalidateQueries({ queryKey: ['product-categories'] })
      setNewCategoryName('')
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Inventory</h1>
        <div className="flex gap-2">
          {canManage && (
            <>
              <Button variant="outline" size="sm" className="press-sm" onClick={() => setShowStockEntry(true)}>
                <PackagePlus className="size-3.5" /> Stock Entry
              </Button>
              <Button size="sm" className="press-sm shadow-sm" onClick={() => setShowAddProduct(true)}>
                <Plus className="size-3.5" /> Add Product
              </Button>
            </>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <KPICard icon={Boxes} label="Total Items" value={String(kpis.totalItems)} />
        <KPICard icon={Package} label="Total Qty" value={String(kpis.totalQty)} />
        <KPICard icon={Wallet} label="Stock Value" value={formatMoney(kpis.totalValue)} />
        <KPICard icon={AlertTriangle} label="Alerts" value={`${kpis.lowStock} low · ${kpis.negStock} neg`} highlight={kpis.lowStock + kpis.negStock > 0} />
      </div>

      {/* Search + Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…" className="h-9 bg-background pl-8 press-sm" />
        </div>
        <div className="flex gap-1">
          {(['all', 'low', 'negative', 'temporary'] as FilterChip[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium press-sm ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}
            >
              {f === 'all' ? 'All' : f === 'low' ? 'Low Stock' : f === 'negative' ? 'Negative' : 'Temporary'}
            </button>
          ))}
        </div>
        <button onClick={() => setShowCategories(v => !v)} className="text-xs text-muted-foreground hover:text-foreground press-sm flex items-center gap-1">
          <Tag className="size-3" /> Categories
        </button>
      </div>

      {/* Categories inline panel */}
      {showCategories && (
        <div className="card-3d p-3 fade-in">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-foreground">Product Categories</span>
            <button onClick={() => setShowCategories(false)} className="text-muted-foreground"><X className="size-3.5" /></button>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {catQ.data?.rows.map(c => (
              <span key={c.id} className="text-xs bg-muted px-2 py-1 rounded-md">{c.name}</span>
            ))}
            {catQ.data?.rows.length === 0 && <span className="text-xs text-muted-foreground">No categories yet</span>}
          </div>
          <div className="flex gap-1">
            <Input value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} placeholder="New category name" className="h-8 bg-background press-sm text-sm" />
            <Button size="sm" className="press-sm h-8" disabled={!newCategoryName || catMut.isPending} onClick={() => catMut.mutate()}><Plus className="size-3" /></Button>
          </div>
        </div>
      )}

      {/* Product List */}
      {productsQ.isLoading ? (
        <div className="card-3d p-8 text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card-3d p-8 text-center">
          <div className="grid place-items-center size-12 rounded-xl icon-3d-muted mx-auto mb-3"><Package className="size-6 text-muted-foreground" /></div>
          <p className="text-sm text-foreground font-medium">No products found</p>
          <p className="text-xs text-muted-foreground mt-1">{search || filter !== 'all' ? 'Try a different search or filter.' : 'Add your first product to get started.'}</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block card-3d overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                  <th className="text-left p-3 font-medium">Product</th>
                  <th className="text-left p-3 font-medium">Category</th>
                  <th className="text-right p-3 font-medium">Sale</th>
                  <th className="text-right p-3 font-medium">Purchase</th>
                  <th className="text-right p-3 font-medium">Qty</th>
                  <th className="text-right p-3 font-medium">Value</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-center p-3 font-medium w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const status = getStockStatus(p)
                  const value = p.currentStock * p.purchasePrice
                  return (
                    <tr key={p.id} className="border-b border-border/50 last:border-0 hover:bg-accent/20">
                      <td className="p-3">
                        <div className="font-medium text-foreground">{p.name}</div>
                        {p.isTemporary && <span className="text-[9px] uppercase bg-amber-100 text-amber-700 px-1 rounded ml-1">Temp</span>}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">{p.categoryName ?? '—'}</td>
                      <td className="p-3 text-right" data-num>{formatMoney(p.salePrice * 100, false)}</td>
                      <td className="p-3 text-right" data-num>{formatMoney(p.purchasePrice * 100, false)}</td>
                      <td className="p-3 text-right font-medium" data-num>
                        <span className={p.currentStock < 0 ? 'text-red-600' : 'text-foreground'}>{p.currentStock}</span>
                      </td>
                      <td className="p-3 text-right" data-num>{formatMoney(value * 100, false)}</td>
                      <td className="p-3"><span className={`text-[10px] uppercase px-1.5 py-0.5 rounded font-medium ${status.color}`}>{status.label}</span></td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-1">
                          {canManage && (
                            <>
                              <button onClick={() => setAdjustProduct({ product: p, type: 'in' })} className="grid place-items-center size-6 rounded border border-border text-emerald-600 hover:bg-emerald-50 press-sm" title="Add stock"><Plus className="size-3" /></button>
                              <button onClick={() => setAdjustProduct({ product: p, type: 'out' })} className="grid place-items-center size-6 rounded border border-border text-amber-600 hover:bg-amber-50 press-sm" title="Remove stock"><Minus className="size-3" /></button>
                            </>
                          )}
                          <button onClick={() => setHistoryProduct(p)} className="grid place-items-center size-6 rounded border border-border text-muted-foreground hover:bg-muted press-sm" title="History"><History className="size-3" /></button>
                          {canEdit && <button onClick={() => setEditProduct(p)} className="grid place-items-center size-6 rounded border border-border text-muted-foreground hover:bg-muted press-sm" title="Edit"><Edit2 className="size-3" /></button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filtered.map(p => {
              const status = getStockStatus(p)
              const value = p.currentStock * p.purchasePrice
              return (
                <div key={p.id} className="card-3d p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-foreground text-sm">{p.name}</div>
                      {p.isTemporary && <span className="text-[9px] uppercase bg-amber-100 text-amber-700 px-1 rounded">Temp</span>}
                      <div className="text-[10px] text-muted-foreground mt-0.5">{p.categoryName ?? 'Uncategorized'} · Sale: Rs {p.salePrice}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-lg font-bold ${p.currentStock < 0 ? 'text-red-600' : 'text-foreground'}`} data-num>{p.currentStock}</div>
                      <span className={`text-[9px] uppercase px-1 py-0.5 rounded font-medium ${status.color}`}>{status.label}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-2">
                    <span>Value: <span data-num>Rs {value.toLocaleString()}</span></span>
                    <span>Purchase: <span data-num>Rs {p.purchasePrice}</span></span>
                  </div>
                  <div className="flex gap-1">
                    {canManage && (
                      <>
                        <Button variant="outline" size="sm" className="flex-1 h-7 text-xs press-sm" onClick={() => setAdjustProduct({ product: p, type: 'in' })}><Plus className="size-3" /> Add</Button>
                        <Button variant="outline" size="sm" className="flex-1 h-7 text-xs press-sm" onClick={() => setAdjustProduct({ product: p, type: 'out' })}><Minus className="size-3" /> Remove</Button>
                      </>
                    )}
                    <Button variant="ghost" size="sm" className="h-7 text-xs press-sm" onClick={() => setHistoryProduct(p)}><History className="size-3" /></Button>
                    {canEdit && <Button variant="ghost" size="sm" className="h-7 text-xs press-sm" onClick={() => setEditProduct(p)}><Edit2 className="size-3" /></Button>}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Modals */}
      {showAddProduct && <AddProductModal categories={catQ.data?.rows ?? []} onClose={() => setShowAddProduct(false)} />}
      {showStockEntry && <StockEntryModal products={products} onClose={() => setShowStockEntry(false)} />}
      {adjustProduct && <AdjustModal product={adjustProduct.product} type={adjustProduct.type} onClose={() => setAdjustProduct(null)} onSubmit={(qty, reason) => stockMut.mutate({ productId: adjustProduct.product.id, type: adjustProduct.type, qty, reason })} pending={stockMut.isPending} />}
      {editProduct && <EditProductModal product={editProduct} categories={catQ.data?.rows ?? []} onClose={() => setEditProduct(null)} />}
      {historyProduct && <HistoryDrawer product={historyProduct} movements={movements.filter(m => m.productId === historyProduct.id)} onClose={() => setHistoryProduct(null)} />}
    </div>
  )
}

// ─── KPI Card ───
function KPICard({ icon: Icon, label, value, highlight }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`card-3d p-3 ${highlight ? 'border-amber-300' : ''}`}>
      <div className="flex items-center gap-2">
        <div className={`grid place-items-center size-7 rounded-lg ${highlight ? 'bg-amber-100' : 'icon-3d-muted'}`}>
          <Icon className={`size-3.5 ${highlight ? 'text-amber-600' : 'text-muted-foreground'}`} />
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="text-lg font-bold text-foreground mt-1" data-num>{value}</div>
    </div>
  )
}

// ─── Add Product Modal ───
function AddProductModal({ categories, onClose }: { categories: Category[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: '', categoryId: '__none__', salePrice: '', purchasePrice: '', openingStock: '0', isTemporary: false, lowStockThreshold: '5' })

  const mut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/products', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          categoryId: form.categoryId === '__none__' ? null : form.categoryId,
          salePrice: Number(form.salePrice) || 0,
          purchasePrice: Number(form.purchasePrice) || 0,
          openingStock: parseInt(form.openingStock) || 0,
          isTemporary: form.isTemporary,
          lowStockThreshold: parseInt(form.lowStockThreshold) || 5,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error ?? 'FAILED')
      return j
    },
    onSuccess: () => {
      toast.success('Product added.')
      void qc.invalidateQueries({ queryKey: ['products'] })
      onClose()
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })

  return (
    <ModalShell title="Add Product" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); mut.mutate() }} className="space-y-3">
        <div className="space-y-1"><Label className="text-xs text-muted-foreground">Name *</Label><Input value={form.name} onChange={e => setForm(s => ({ ...s, name: e.target.value }))} required className="h-9 bg-background press-sm" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Sale Price (Rs)</Label><Input type="number" step="0.01" value={form.salePrice} onChange={e => setForm(s => ({ ...s, salePrice: e.target.value }))} className="h-9 bg-background press-sm" data-num /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Purchase Price (Rs)</Label><Input type="number" step="0.01" value={form.purchasePrice} onChange={e => setForm(s => ({ ...s, purchasePrice: e.target.value }))} className="h-9 bg-background press-sm" data-num /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Opening Stock</Label><Input type="number" value={form.openingStock} onChange={e => setForm(s => ({ ...s, openingStock: e.target.value }))} className="h-9 bg-background press-sm" data-num /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Low Stock Threshold</Label><Input type="number" value={form.lowStockThreshold} onChange={e => setForm(s => ({ ...s, lowStockThreshold: e.target.value }))} className="h-9 bg-background press-sm" data-num /></div>
        </div>
        <div className="space-y-1"><Label className="text-xs text-muted-foreground">Category</Label>
          <Select value={form.categoryId} onValueChange={v => setForm(s => ({ ...s, categoryId: v }))}>
            <SelectTrigger className="h-9 bg-background press-sm text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— No category —</SelectItem>
              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={form.isTemporary} onChange={e => setForm(s => ({ ...s, isTemporary: e.target.checked }))} className="size-3.5 rounded border-border" /><span className="text-muted-foreground">Temporary item</span></label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" className="press-sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={mut.isPending} className="press-sm shadow-sm">{mut.isPending ? 'Adding…' : 'Add Product'}</Button>
        </div>
      </form>
    </ModalShell>
  )
}

// ─── Stock Entry Modal ───
function StockEntryModal({ products, onClose }: { products: Product[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [productId, setProductId] = useState('')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))

  const mut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/stock-movements', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId, movementType: 'adjustment_in', quantity: parseInt(qty), reason: reason || `Stock entry ${date}` }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error ?? 'FAILED')
      return j
    },
    onSuccess: () => {
      toast.success('Stock entry recorded.')
      void qc.invalidateQueries({ queryKey: ['products'] })
      void qc.invalidateQueries({ queryKey: ['stock-movements'] })
      onClose()
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })

  return (
    <ModalShell title="Stock Entry" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); mut.mutate() }} className="space-y-3">
        <div className="space-y-1"><Label className="text-xs text-muted-foreground">Product *</Label>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger className="h-9 bg-background press-sm text-sm"><SelectValue placeholder="Select product…" /></SelectTrigger>
            <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} (current: {p.currentStock})</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Quantity Received *</Label><Input type="number" value={qty} onChange={e => setQty(e.target.value)} required className="h-9 bg-background press-sm" data-num /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 bg-background press-sm" data-num /></div>
        </div>
        <div className="space-y-1"><Label className="text-xs text-muted-foreground">Reference / Note</Label><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Supplier invoice #1234" className="h-9 bg-background press-sm" /></div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" className="press-sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={mut.isPending || !productId || !qty} className="press-sm shadow-sm">{mut.isPending ? 'Saving…' : 'Save Stock Entry'}</Button>
        </div>
      </form>
    </ModalShell>
  )
}

// ─── Adjust Modal ───
function AdjustModal({ product, type, onClose, onSubmit, pending }: { product: Product; type: 'in' | 'out'; onClose: () => void; onSubmit: (qty: number, reason: string) => void; pending: boolean }) {
  const [qty, setQty] = useState('1')
  const [reason, setReason] = useState('')
  const projected = type === 'in' ? product.currentStock + (parseInt(qty) || 0) : product.currentStock - (parseInt(qty) || 0)

  return (
    <ModalShell title={type === 'in' ? 'Add Stock' : 'Remove Stock'} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); onSubmit(parseInt(qty) || 0, reason) }} className="space-y-3">
        <div className="text-sm text-muted-foreground">{product.name}</div>
        <div className="text-xs text-muted-foreground">Current: <span className="font-medium text-foreground" data-num>{product.currentStock}</span></div>
        <div className="space-y-1"><Label className="text-xs text-muted-foreground">Quantity *</Label><Input type="number" value={qty} onChange={e => setQty(e.target.value)} required className="h-9 bg-background press-sm" data-num /></div>
        <div className="space-y-1"><Label className="text-xs text-muted-foreground">Reason / Note</Label><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional" className="h-9 bg-background press-sm" /></div>
        <div className="text-xs">Projected: <span className={`font-medium ${projected < 0 ? 'text-red-600' : 'text-foreground'}`} data-num>{projected}</span> {projected < 0 && <span className="text-red-600 ml-1">(negative allowed)</span>}</div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" className="press-sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={pending} className="press-sm shadow-sm">{pending ? 'Saving…' : 'Confirm'}</Button>
        </div>
      </form>
    </ModalShell>
  )
}

// ─── Edit Product Modal ───
function EditProductModal({ product, categories, onClose }: { product: Product; categories: Category[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: product.name, salePrice: String(product.salePrice), purchasePrice: String(product.purchasePrice),
    categoryId: product.categoryId ?? '__none__', lowStockThreshold: String(product.lowStockThreshold),
    isTemporary: product.isTemporary, markedForMerge: product.markedForMerge,
  })

  const mut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/products/${product.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          salePrice: Number(form.salePrice) || 0,
          purchasePrice: Number(form.purchasePrice) || 0,
          categoryId: form.categoryId === '__none__' ? null : form.categoryId,
          lowStockThreshold: parseInt(form.lowStockThreshold) || 5,
          isTemporary: form.isTemporary,
          markedForMerge: form.isTemporary ? form.markedForMerge : false,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error ?? 'FAILED')
      return j
    },
    onSuccess: () => {
      toast.success('Product updated.')
      void qc.invalidateQueries({ queryKey: ['products'] })
      onClose()
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })

  return (
    <ModalShell title="Edit Product" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); mut.mutate() }} className="space-y-3">
        <div className="space-y-1"><Label className="text-xs text-muted-foreground">Name</Label><Input value={form.name} onChange={e => setForm(s => ({ ...s, name: e.target.value }))} className="h-9 bg-background press-sm" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Sale Price (Rs)</Label><Input type="number" step="0.01" value={form.salePrice} onChange={e => setForm(s => ({ ...s, salePrice: e.target.value }))} className="h-9 bg-background press-sm" data-num /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Purchase Price (Rs)</Label><Input type="number" step="0.01" value={form.purchasePrice} onChange={e => setForm(s => ({ ...s, purchasePrice: e.target.value }))} className="h-9 bg-background press-sm" data-num /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Low Stock Threshold</Label><Input type="number" value={form.lowStockThreshold} onChange={e => setForm(s => ({ ...s, lowStockThreshold: e.target.value }))} className="h-9 bg-background press-sm" data-num /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Category</Label>
            <Select value={form.categoryId} onValueChange={v => setForm(s => ({ ...s, categoryId: v }))}>
              <SelectTrigger className="h-9 bg-background press-sm text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— No category —</SelectItem>
                {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={form.isTemporary} onChange={e => setForm(s => ({ ...s, isTemporary: e.target.checked }))} className="size-3.5 rounded border-border" /><span className="text-muted-foreground">Temporary item</span></label>
        {form.isTemporary && <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={form.markedForMerge} onChange={e => setForm(s => ({ ...s, markedForMerge: e.target.checked }))} className="size-3.5 rounded border-border" /><span className="text-muted-foreground">Mark for merge</span></label>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" className="press-sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={mut.isPending} className="press-sm shadow-sm">{mut.isPending ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </ModalShell>
  )
}

// ─── History Drawer ───
function HistoryDrawer({ product, movements, onClose }: { product: Product; movements: Movement[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="card-3d p-5 w-full max-w-md max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">{product.name}</h3>
          <button onClick={onClose} className="text-muted-foreground"><X className="size-4" /></button>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs mb-4">
          <div><div className="text-[9px] text-muted-foreground">Current</div><div className="font-medium" data-num>{product.currentStock}</div></div>
          <div><div className="text-[9px] text-muted-foreground">Sale</div><div className="font-medium" data-num>Rs {product.salePrice}</div></div>
          <div><div className="text-[9px] text-muted-foreground">Purchase</div><div className="font-medium" data-num>Rs {product.purchasePrice}</div></div>
        </div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Recent Movements</div>
        {movements.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">No movements yet</div>
        ) : (
          <div className="space-y-1.5">
            {movements.slice(0, 20).map(m => (
              <div key={m.id} className="flex items-center justify-between p-2 border border-border/50 rounded-md text-xs">
                <div>
                  <div className="font-medium text-foreground">{m.movementType.replace(/_/g, ' ')}</div>
                  <div className="text-[10px] text-muted-foreground" data-num>{bizDate(m.movementDate)} · {m.reason ?? '—'}</div>
                </div>
                <div className="text-right">
                  <div className={`font-medium ${m.movementType === 'adjustment_out' ? 'text-amber-600' : 'text-emerald-600'}`} data-num>{m.movementType === 'adjustment_out' ? '-' : '+'}{m.quantity}</div>
                  <div className="text-[10px] text-muted-foreground" data-num>bal: {m.balanceAfter}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  )
}

// ─── Modal Shell ───
function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="card-3d p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground"><X className="size-4" /></button>
        </div>
        {children}
      </motion.div>
    </div>
  )
}

// Unused import workaround
void parseMoney
