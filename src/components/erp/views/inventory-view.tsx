'use client'

import { useState, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import {
  Plus, Search, Package, Minus, Edit2, History, X,
  Tag, Boxes, Wallet, AlertTriangle, MoreVertical, PackagePlus,
  CheckCircle2, TrendingDown,
} from 'lucide-react'
import { formatMoney } from '@/lib/format'
import { bizDate, bizDateString } from '@/lib/dates'
import { motion, AnimatePresence } from 'framer-motion'
import type { MeUser } from '@/components/erp/erp-app'

type Product = {
  id: string; name: string; categoryId: string | null; categoryName: string | null
  unit: string; salePrice: number; purchasePrice: number; currentStock: number
  isTemporary: boolean; isActive: boolean; markedForMerge: boolean; lowStockThreshold: number
  createdAt: string
}
type Category = { id: string; name: string; isActive: boolean }
type Movement = {
  id: string; productId: string; productName: string; movementType: string
  quantity: number; balanceAfter: number; reason: string | null
  movementDate: string; createdAt: string
}
type FilterChip = 'all' | 'low' | 'negative' | 'temporary'

export function InventoryView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const canManage = user.permissions.includes('can_create_products')
  const canEdit = user.permissions.includes('can_edit_products')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterChip>('all')
  const [catFilter, setCatFilter] = useState<string>('all')
  const [modal, setModal] = useState<
    | { type: 'add' }
    | { type: 'stockEntry' }
    | { type: 'adjust'; product: Product; adjType: 'in' | 'out' }
    | { type: 'edit'; product: Product }
    | { type: 'history'; product: Product }
    | { type: 'categories' }
    | null
  >(null)

  const productsQ = useQuery<{ rows: Product[] }>({ queryKey: ['products'], queryFn: () => fetch('/api/products').then(r => r.json()) })
  const catQ = useQuery<{ rows: Category[] }>({ queryKey: ['product-categories'], queryFn: () => fetch('/api/product-categories').then(r => r.json()) })
  const movementsQ = useQuery<{ rows: Movement[] }>({ queryKey: ['stock-movements'], queryFn: () => fetch('/api/stock-movements').then(r => r.json()) })

  const products = productsQ.data?.rows ?? []
  const movements = movementsQ.data?.rows ?? []

  // KPI — prices in DB are in RUPEES (not paisas). Convert to paisas for formatMoney.
  const kpis = useMemo(() => {
    const active = products.filter(p => p.isActive)
    const totalItems = active.length
    const totalQty = active.reduce((s, p) => s + p.currentStock, 0)
    // Stock value: sum of (qty × purchasePrice) in RUPEES, then × 100 for paisas
    const totalValuePaisas = active.reduce((s, p) => s + (p.currentStock * p.purchasePrice * 100), 0)
    const lowStock = active.filter(p => p.currentStock >= 0 && p.currentStock <= p.lowStockThreshold).length
    const negStock = active.filter(p => p.currentStock < 0).length
    return { totalItems, totalQty, totalValuePaisas, lowStock, negStock }
  }, [products])

  // Filtered
  const filtered = useMemo(() => {
    let r = products.filter(p => p.isActive)
    if (search) { const q = search.toLowerCase(); r = r.filter(p => p.name.toLowerCase().includes(q)) }
    if (filter === 'low') r = r.filter(p => p.currentStock >= 0 && p.currentStock <= p.lowStockThreshold)
    if (filter === 'negative') r = r.filter(p => p.currentStock < 0)
    if (filter === 'temporary') r = r.filter(p => p.isTemporary)
    if (catFilter !== 'all') r = r.filter(p => p.categoryId === catFilter)
    return r
  }, [products, search, filter, catFilter])

  function stockStatus(p: Product) {
    if (p.currentStock < 0) return { label: 'Negative', cls: 'bg-red-50 text-red-700 border-red-200' }
    if (p.currentStock === 0) return { label: 'Out', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
    if (p.currentStock <= p.lowStockThreshold) return { label: 'Low', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
    return { label: 'In Stock', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
  }

  const stockMut = useMutation({
    mutationFn: async (a: { productId: string; type: 'in' | 'out'; qty: number; reason: string }) => {
      const r = await fetch('/api/stock-movements', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId: a.productId, movementType: a.type === 'in' ? 'adjustment_in' : 'adjustment_out', quantity: a.qty, reason: a.reason || undefined }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'FAILED'); return j
    },
    onSuccess: () => { toast.success('Stock adjusted.'); void qc.invalidateQueries({ queryKey: ['products'] }); void qc.invalidateQueries({ queryKey: ['stock-movements'] }); setModal(null) },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Inventory</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Products, stock levels and stock movements</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-8 press-sm" onClick={() => setModal({ type: 'stockEntry' })}><PackagePlus className="size-3.5" /> Stock Entry</Button>
            <Button size="sm" className="h-8 press-sm shadow-sm" onClick={() => setModal({ type: 'add' })}><Plus className="size-3.5" /> Add Product</Button>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <KPI icon={Boxes} label="Total Items" value={String(kpis.totalItems)} />
        <KPI icon={Package} label="Total Quantity" value={String(kpis.totalQty)} />
        <KPI icon={Wallet} label="Stock Value" value={formatMoney(BigInt(kpis.totalValuePaisas))} />
        <KPI icon={AlertTriangle} label="Alerts" value={`${kpis.lowStock} Low · ${kpis.negStock} Neg`} warn={kpis.lowStock + kpis.negStock > 0} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…" className="h-9 bg-background pl-8 press-sm" />
        </div>
        <div className="flex gap-1">
          {(['all', 'low', 'negative', 'temporary'] as FilterChip[]).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1.5 rounded-md text-xs font-medium press-sm ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}>
              {f === 'all' ? 'All' : f === 'low' ? 'Low' : f === 'negative' ? 'Neg' : 'Temp'}
            </button>
          ))}
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="h-9 w-auto bg-background press-sm text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {catQ.data?.rows.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <button onClick={() => setModal({ type: 'categories' })} className="text-xs text-muted-foreground hover:text-foreground press-sm flex items-center gap-1 px-2 py-1.5">
          <Tag className="size-3" /> Manage
        </button>
      </div>

      {/* Product List */}
      {productsQ.isLoading ? (
        <div className="text-center py-8 text-sm text-muted-foreground">Loading inventory…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8">
          <Package className="size-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground">{search || filter !== 'all' ? 'No products match your filters.' : 'No products yet. Click "Add Product" to get started.'}</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block border border-border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-3 py-2 font-medium">Product</th>
                  <th className="text-left px-3 py-2 font-medium">Category</th>
                  <th className="text-right px-3 py-2 font-medium">Sale</th>
                  <th className="text-right px-3 py-2 font-medium">Purchase</th>
                  <th className="text-right px-3 py-2 font-medium">Qty</th>
                  <th className="text-right px-3 py-2 font-medium">Value</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-center px-3 py-2 font-medium w-16">·</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const st = stockStatus(p)
                  // price in DB is rupees; ×100 for paisas → formatMoney
                  const valPaisas = p.currentStock * p.purchasePrice * 100
                  return (
                    <tr key={p.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{p.name}</div>
                        {p.isTemporary && <span className="text-[8px] uppercase bg-amber-100 text-amber-700 px-1 rounded">Temp</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{p.categoryName ?? '—'}</td>
                      <td className="px-3 py-2 text-right text-foreground" data-num>{formatMoney(BigInt(p.salePrice * 100), false)}</td>
                      <td className="px-3 py-2 text-right text-foreground" data-num>{formatMoney(BigInt(p.purchasePrice * 100), false)}</td>
                      <td className="px-3 py-2 text-right font-medium" data-num>
                        <span className={p.currentStock < 0 ? 'text-red-600' : p.currentStock === 0 ? 'text-muted-foreground' : p.currentStock <= p.lowStockThreshold ? 'text-amber-600' : 'text-foreground'}>
                          {p.currentStock}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground" data-num>{formatMoney(BigInt(valPaisas), false)}</td>
                      <td className="px-3 py-2"><span className={`text-[9px] uppercase px-1.5 py-0.5 rounded border font-medium ${st.cls}`}>{st.label}</span></td>
                      <td className="px-3 py-2 text-center">
                        <RowMenu product={p} canManage={canManage} canEdit={canEdit} onAction={setModal} />
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
              const st = stockStatus(p)
              const valPaisas = p.currentStock * p.purchasePrice * 100
              return (
                <div key={p.id} className="border border-border rounded-lg bg-card p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-foreground text-sm">{p.name}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{p.categoryName ?? 'Uncategorized'}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded border font-medium ${st.cls}`}>{st.label}</span>
                      <RowMenu product={p} canManage={canManage} canEdit={canEdit} onAction={setModal} />
                    </div>
                  </div>
                  <div className="flex items-end justify-between">
                    <div className="text-[10px] text-muted-foreground">
                      <div>Sale: <span data-num>Rs {p.salePrice}</span> · Purchase: <span data-num>Rs {p.purchasePrice}</span></div>
                      <div>Value: <span data-num>{formatMoney(BigInt(valPaisas))}</span></div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] uppercase text-muted-foreground">Qty</div>
                      <div className={`text-xl font-bold ${p.currentStock < 0 ? 'text-red-600' : p.currentStock === 0 ? 'text-muted-foreground' : p.currentStock <= p.lowStockThreshold ? 'text-amber-600' : 'text-foreground'}`} data-num>{p.currentStock}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Modals */}
      <AnimatePresence>
        {modal?.type === 'add' && <AddProductModal categories={catQ.data?.rows ?? []} onClose={() => setModal(null)} />}
        {modal?.type === 'stockEntry' && <StockEntryModal products={products} onClose={() => setModal(null)} />}
        {modal?.type === 'adjust' && <AdjustModal product={modal.product} adjType={modal.adjType} onClose={() => setModal(null)} onSubmit={(qty, reason) => stockMut.mutate({ productId: modal.product.id, type: modal.adjType, qty, reason })} pending={stockMut.isPending} />}
        {modal?.type === 'edit' && <EditProductModal product={modal.product} categories={catQ.data?.rows ?? []} onClose={() => setModal(null)} />}
        {modal?.type === 'history' && <HistoryDrawer product={modal.product} movements={movements.filter(m => m.productId === modal.product.id)} onClose={() => setModal(null)} />}
        {modal?.type === 'categories' && <CategoriesModal onClose={() => setModal(null)} />}
      </AnimatePresence>
    </div>
  )
}

// ─── KPI ───
function KPI({ icon: Icon, label, value, warn }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; warn?: boolean }) {
  return (
    <div className={`border rounded-lg bg-card p-3 ${warn ? 'border-amber-200' : 'border-border'}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`size-3 ${warn ? 'text-amber-500' : 'text-muted-foreground'}`} />
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className={`text-base font-bold ${warn ? 'text-amber-700' : 'text-foreground'}`} data-num>{value}</div>
    </div>
  )
}

// ─── Row Menu ───
function RowMenu({ product, canManage, canEdit, onAction }: { product: Product; canManage: boolean; canEdit: boolean; onAction: (m: any) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)} className="grid place-items-center size-7 rounded-md hover:bg-muted press-sm text-muted-foreground"><MoreVertical className="size-4" /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-50 border border-border rounded-lg bg-card shadow-lg py-1 min-w-[140px]">
            {canManage && <MenuItem icon={Plus} label="Add Stock" onClick={() => { setOpen(false); onAction({ type: 'adjust', product, adjType: 'in' }) }} />}
            {canManage && <MenuItem icon={Minus} label="Remove Stock" onClick={() => { setOpen(false); onAction({ type: 'adjust', product, adjType: 'out' }) }} />}
            <MenuItem icon={History} label="View History" onClick={() => { setOpen(false); onAction({ type: 'history', product }) }} />
            {canEdit && <MenuItem icon={Edit2} label="Edit Product" onClick={() => { setOpen(false); onAction({ type: 'edit', product }) }} />}
          </div>
        </>
      )}
    </div>
  )
}
function MenuItem({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return <button onClick={onClick} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted press-sm text-left"><Icon className="size-3" /> {label}</button>
}

// ─── Modal Shell ───
function Shell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className={`border border-border rounded-xl bg-card shadow-xl p-5 w-full ${wide ? 'max-w-lg' : 'max-w-md'}`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-foreground">{title}</h3><button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button></div>
        {children}
      </motion.div>
    </div>
  )
}

// ─── Add Product ───
function AddProductModal({ categories, onClose }: { categories: Category[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ name: '', categoryId: '__none__', salePrice: '', purchasePrice: '', openingStock: '0', isTemporary: false, lowStockThreshold: '5' })
  const mut = useMutation({
    mutationFn: async () => { const r = await fetch('/api/products', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: f.name, categoryId: f.categoryId === '__none__' ? null : f.categoryId, salePrice: Number(f.salePrice) || 0, purchasePrice: Number(f.purchasePrice) || 0, openingStock: parseInt(f.openingStock) || 0, isTemporary: f.isTemporary, lowStockThreshold: parseInt(f.lowStockThreshold) || 5 }) }); const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j },
    onSuccess: () => { toast.success('Product added.'); void qc.invalidateQueries({ queryKey: ['products'] }); onClose() },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })
  return <Shell title="Add Product" onClose={onClose}>
    <form onSubmit={e => { e.preventDefault(); mut.mutate() }} className="space-y-3">
      <div><Label className="text-xs text-muted-foreground">Name *</Label><Input value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} required className="h-9 bg-background" /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs text-muted-foreground">Sale Price (Rs)</Label><Input type="number" step="0.01" value={f.salePrice} onChange={e => setF(s => ({ ...s, salePrice: e.target.value }))} className="h-9 bg-background" data-num /></div>
        <div><Label className="text-xs text-muted-foreground">Purchase (Rs)</Label><Input type="number" step="0.01" value={f.purchasePrice} onChange={e => setF(s => ({ ...s, purchasePrice: e.target.value }))} className="h-9 bg-background" data-num /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs text-muted-foreground">Opening Stock</Label><Input type="number" value={f.openingStock} onChange={e => setF(s => ({ ...s, openingStock: e.target.value }))} className="h-9 bg-background" data-num /></div>
        <div><Label className="text-xs text-muted-foreground">Low Threshold</Label><Input type="number" value={f.lowStockThreshold} onChange={e => setF(s => ({ ...s, lowStockThreshold: e.target.value }))} className="h-9 bg-background" data-num /></div>
      </div>
      <div><Label className="text-xs text-muted-foreground">Category</Label><Select value={f.categoryId} onValueChange={v => setF(s => ({ ...s, categoryId: v }))}><SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">— None —</SelectItem>{categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
      <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={f.isTemporary} onChange={e => setF(s => ({ ...s, isTemporary: e.target.checked }))} className="size-3.5 rounded" /><span className="text-muted-foreground">Temporary item</span></label>
      <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" disabled={mut.isPending}>{mut.isPending ? 'Adding…' : 'Add Product'}</Button></div>
    </form>
  </Shell>
}

// ─── Stock Entry ───
function StockEntryModal({ products, onClose }: { products: Product[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [productId, setProductId] = useState('')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(bizDateString(new Date()))
  const postingRef = useRef(false)
  const mut = useMutation({
    mutationFn: async () => {
      if (postingRef.current) throw new Error('Submission already in progress')
      postingRef.current = true
      const r = await fetch('/api/stock-movements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId, movementType: 'adjustment_in', quantity: parseInt(qty), reason: reason || `Stock entry ${date}` }) })
      const j = await r.json().catch(() => null)
      if (!r.ok) throw new Error(j?.error ?? 'Could not save stock entry. Please try again.')
      return j
    },
    retry: 0,
    onSuccess: () => { postingRef.current = false; toast.success('Stock entry saved.'); void qc.invalidateQueries({ queryKey: ['products'] }); void qc.invalidateQueries({ queryKey: ['stock-movements'] }); onClose() },
    onError: (e: Error) => { postingRef.current = false; toast.error(`Failed: ${e.message}`) },
  })
  const sel = products.find(p => p.id === productId)
  const projected = sel ? sel.currentStock + (parseInt(qty) || 0) : null
  return <Shell title="Stock Entry" onClose={onClose}>
    <form onSubmit={e => { e.preventDefault(); mut.mutate() }} className="space-y-3">
      <div><Label className="text-xs text-muted-foreground">Product *</Label><Select value={productId} onValueChange={setProductId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select…" /></SelectTrigger><SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} (stock: {p.currentStock})</SelectItem>)}</SelectContent></Select></div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs text-muted-foreground">Qty Received *</Label><Input type="number" value={qty} onChange={e => setQty(e.target.value)} required className="h-9 bg-background" data-num /></div>
        <div><Label className="text-xs text-muted-foreground">Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 bg-background" data-num /></div>
      </div>
      <div><Label className="text-xs text-muted-foreground">Reference / Note</Label><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Supplier invoice #" className="h-9 bg-background" /></div>
      {sel && projected !== null && <div className="text-xs text-muted-foreground py-1.5 px-2 bg-muted/40 rounded">Current: <span data-num>{sel.currentStock}</span> + Entry: <span data-num>{qty || 0}</span> = New: <span className={`font-medium ${projected < 0 ? 'text-red-600' : 'text-foreground'}`} data-num>{projected}</span></div>}
      <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" disabled={mut.isPending || !productId || !qty}>{mut.isPending ? 'Saving…' : 'Save Entry'}</Button></div>
    </form>
  </Shell>
}

// ─── Adjust ───
function AdjustModal({ product, adjType, onClose, onSubmit, pending }: { product: Product; adjType: 'in' | 'out'; onClose: () => void; onSubmit: (qty: number, reason: string) => void; pending: boolean }) {
  const [qty, setQty] = useState('1')
  const [reason, setReason] = useState('')
  const projected = adjType === 'in' ? product.currentStock + (parseInt(qty) || 0) : product.currentStock - (parseInt(qty) || 0)
  return <Shell title={adjType === 'in' ? 'Add Stock' : 'Remove Stock'} onClose={onClose}>
    <form onSubmit={e => { e.preventDefault(); onSubmit(parseInt(qty) || 0, reason) }} className="space-y-3">
      <div className="text-sm font-medium text-foreground">{product.name}</div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs text-muted-foreground">Current Qty</Label><div className="h-9 flex items-center font-medium text-foreground" data-num>{product.currentStock}</div></div>
        <div><Label className="text-xs text-muted-foreground">{adjType === 'in' ? 'Add Qty' : 'Remove Qty'}</Label><Input type="number" value={qty} onChange={e => setQty(e.target.value)} required className="h-9 bg-background" data-num /></div>
      </div>
      <div><Label className="text-xs text-muted-foreground">Reason / Note</Label><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional" className="h-9 bg-background" /></div>
      <div className="text-xs text-muted-foreground py-1.5 px-2 bg-muted/40 rounded">Current: <span data-num>{product.currentStock}</span> {adjType === 'in' ? '+' : '−'} {qty || 0} = New: <span className={`font-medium ${projected < 0 ? 'text-red-600' : 'text-foreground'}`} data-num>{projected}</span>{projected < 0 && <span className="text-red-600 ml-1">(negative allowed)</span>}</div>
      <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" disabled={pending}>{pending ? 'Saving…' : 'Confirm'}</Button></div>
    </form>
  </Shell>
}

// ─── Edit ───
function EditProductModal({ product, categories, onClose }: { product: Product; categories: Category[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ name: product.name, salePrice: String(product.salePrice), purchasePrice: String(product.purchasePrice), categoryId: product.categoryId ?? '__none__', lowStockThreshold: String(product.lowStockThreshold), isTemporary: product.isTemporary, markedForMerge: product.markedForMerge })
  const mut = useMutation({
    mutationFn: async () => { const r = await fetch(`/api/products/${product.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: f.name, salePrice: Number(f.salePrice) || 0, purchasePrice: Number(f.purchasePrice) || 0, categoryId: f.categoryId === '__none__' ? null : f.categoryId, lowStockThreshold: parseInt(f.lowStockThreshold) || 5, isTemporary: f.isTemporary, markedForMerge: f.isTemporary ? f.markedForMerge : false }) }); const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j },
    onSuccess: () => { toast.success('Product updated.'); void qc.invalidateQueries({ queryKey: ['products'] }); onClose() },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })
  return <Shell title="Edit Product" onClose={onClose}>
    <form onSubmit={e => { e.preventDefault(); mut.mutate() }} className="space-y-3">
      <div><Label className="text-xs text-muted-foreground">Name</Label><Input value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} className="h-9 bg-background" /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs text-muted-foreground">Sale (Rs)</Label><Input type="number" step="0.01" value={f.salePrice} onChange={e => setF(s => ({ ...s, salePrice: e.target.value }))} className="h-9 bg-background" data-num /></div>
        <div><Label className="text-xs text-muted-foreground">Purchase (Rs)</Label><Input type="number" step="0.01" value={f.purchasePrice} onChange={e => setF(s => ({ ...s, purchasePrice: e.target.value }))} className="h-9 bg-background" data-num /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs text-muted-foreground">Low Threshold</Label><Input type="number" value={f.lowStockThreshold} onChange={e => setF(s => ({ ...s, lowStockThreshold: e.target.value }))} className="h-9 bg-background" data-num /></div>
        <div><Label className="text-xs text-muted-foreground">Category</Label><Select value={f.categoryId} onValueChange={v => setF(s => ({ ...s, categoryId: v }))}><SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">— None —</SelectItem>{categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={f.isTemporary} onChange={e => setF(s => ({ ...s, isTemporary: e.target.checked }))} className="size-3.5 rounded" /><span className="text-muted-foreground">Temporary</span></label>
      {f.isTemporary && <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={f.markedForMerge} onChange={e => setF(s => ({ ...s, markedForMerge: e.target.checked }))} className="size-3.5 rounded" /><span className="text-muted-foreground">Mark for merge</span></label>}
      <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Save'}</Button></div>
    </form>
  </Shell>
}

// ─── History ───
function HistoryDrawer({ product, movements, onClose }: { product: Product; movements: Movement[]; onClose: () => void }) {
  return <Shell title={product.name} onClose={onClose} wide>
    <div className="grid grid-cols-4 gap-2 text-xs mb-4 pb-3 border-b border-border">
      <div><div className="text-[9px] text-muted-foreground">Stock</div><div className="font-medium" data-num>{product.currentStock}</div></div>
      <div><div className="text-[9px] text-muted-foreground">Sale</div><div className="font-medium" data-num>Rs {product.salePrice}</div></div>
      <div><div className="text-[9px] text-muted-foreground">Purchase</div><div className="font-medium" data-num>Rs {product.purchasePrice}</div></div>
      <div><div className="text-[9px] text-muted-foreground">Threshold</div><div className="font-medium" data-num>{product.lowStockThreshold}</div></div>
    </div>
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Movements ({movements.length})</div>
    {movements.length === 0 ? <div className="text-xs text-muted-foreground text-center py-4">No movements yet</div> : (
      <div className="space-y-1 max-h-[40vh] overflow-y-auto">
        {movements.slice(0, 30).map(m => (
          <div key={m.id} className="flex items-center justify-between p-2 border border-border/40 rounded text-xs">
            <div><div className="font-medium text-foreground">{m.movementType.replace(/_/g, ' ')}</div><div className="text-[10px] text-muted-foreground" data-num>{bizDate(m.movementDate)}{m.reason ? ` · ${m.reason}` : ''}</div></div>
            <div className="text-right"><div className={`font-medium ${m.movementType === 'adjustment_out' ? 'text-amber-600' : 'text-emerald-600'}`} data-num>{m.movementType === 'adjustment_out' ? '−' : '+'}{m.quantity}</div><div className="text-[10px] text-muted-foreground" data-num>bal: {m.balanceAfter}</div></div>
          </div>
        ))}
      </div>
    )}
  </Shell>
}

// ─── Categories ───
function CategoriesModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const catQ = useQuery<{ rows: Category[] }>({ queryKey: ['product-categories'], queryFn: () => fetch('/api/product-categories').then(r => r.json()) })
  const mut = useMutation({
    mutationFn: async () => { const r = await fetch('/api/product-categories', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }); const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j },
    onSuccess: () => { toast.success('Category created.'); void qc.invalidateQueries({ queryKey: ['product-categories'] }); setName('') },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })
  return <Shell title="Manage Categories" onClose={onClose}>
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {catQ.data?.rows.map(c => <span key={c.id} className="text-xs bg-muted px-2 py-1 rounded">{c.name}</span>)}
        {catQ.data?.rows.length === 0 && <span className="text-xs text-muted-foreground">No categories yet</span>}
      </div>
      <div className="flex gap-1">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="New category name" className="h-8 bg-background" />
        <Button size="sm" className="h-8" disabled={!name || mut.isPending} onClick={() => mut.mutate()}><Plus className="size-3" /></Button>
      </div>
      <Button variant="outline" size="sm" className="w-full" onClick={onClose}>Done</Button>
    </div>
  </Shell>
}
