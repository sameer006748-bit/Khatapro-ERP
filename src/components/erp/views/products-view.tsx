'use client'

import { useState } from 'react'
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
import { Plus, X, Package, Search, AlertTriangle, Ghost, Edit2 } from 'lucide-react'
import { formatMoney, formatTableDate } from '@/lib/format'
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
  createdAt: string
}

type Category = {
  id: string
  name: string
  isActive: boolean
}

export function ProductsView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const canManage = user.permissions.includes('can_create_products')
  const canEdit = user.permissions.includes('can_edit_products')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [showTemporaryOnly, setShowTemporaryOnly] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form state
  const [form, setForm] = useState({
    name: '',
    categoryId: '__none__',
    salePrice: '',
    purchasePrice: '',
    openingStock: '0',
    isTemporary: false,
  })

  // Edit form state
  const [editForm, setEditForm] = useState({
    name: '',
    salePrice: '',
    purchasePrice: '',
    isTemporary: false,
    markedForMerge: false,
  })

  const q = useQuery<{ rows: Product[] }>({
    queryKey: ['products', { temporaryOnly: showTemporaryOnly, search }],
    queryFn: () => {
      const params = new URLSearchParams()
      if (showTemporaryOnly) params.set('temporary', 'true')
      if (search) params.set('search', search)
      return fetch(`/api/products?${params}`).then((r) => r.json())
    },
  })

  const catQ = useQuery<{ rows: Category[] }>({
    queryKey: ['product-categories'],
    queryFn: () => fetch('/api/product-categories').then((r) => r.json()),
  })

  const createMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/products', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          categoryId: form.categoryId === '__none__' ? null : form.categoryId,
          salePrice: form.salePrice ? Number(form.salePrice) : 0,
          purchasePrice: form.purchasePrice ? Number(form.purchasePrice) : 0,
          openingStock: form.openingStock ? parseInt(form.openingStock, 10) : 0,
          isTemporary: form.isTemporary,
        }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j?.error ?? 'CREATE_FAILED')
      }
      return r.json()
    },
    onSuccess: () => {
      toast.success('Product created.')
      void qc.invalidateQueries({ queryKey: ['products'] })
      void qc.invalidateQueries({ queryKey: ['product-categories'] })
      void qc.invalidateQueries({ queryKey: ['negative-stock'] })
      void qc.invalidateQueries({ queryKey: ['pending-stock'] })
      setOpen(false)
      setForm({ name: '', categoryId: '__none__', salePrice: '', purchasePrice: '', openingStock: '0', isTemporary: false })
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })

  const updateMut = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, unknown> }) => {
      const r = await fetch(`/api/products/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j?.error ?? 'UPDATE_FAILED')
      }
      return r.json()
    },
    onSuccess: () => {
      toast.success('Product updated.')
      void qc.invalidateQueries({ queryKey: ['products'] })
      setEditingId(null)
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })

  function startEdit(p: Product) {
    setEditingId(p.id)
    setEditForm({
      name: p.name,
      salePrice: String(p.salePrice),
      purchasePrice: String(p.purchasePrice),
      isTemporary: p.isTemporary,
      markedForMerge: p.markedForMerge,
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">Products</h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
            Manage your garments inventory. Unit is fixed as piece. Negative stock is allowed — sales are never blocked.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setOpen((v) => !v)} className="press-md shadow-sm">
            {open ? <X className="size-4" /> : <Plus className="size-4" />}
            {open ? 'Close' : 'New product'}
          </Button>
        )}
      </div>

      {/* Search + filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            aria-label="Search products"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="h-10 bg-background pl-9 press-sm"
          />
        </div>
        <Button
          variant={showTemporaryOnly ? 'default' : 'outline'}
          size="sm"
          className="h-10 press-sm"
          onClick={() => setShowTemporaryOnly((v) => !v)}
        >
          <Ghost className="size-4" /> Temporary only
        </Button>
      </div>

      {/* Create form */}
      {open && canManage && (
        <div className="card-3d p-5 sm:p-6 fade-in">
          <h2 className="text-base font-semibold text-foreground mb-4">Create product</h2>
          <form
            className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3.5"
            onSubmit={(e) => {
              e.preventDefault()
              createMut.mutate()
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="product-name" className="text-xs font-medium text-muted-foreground">Item name</Label>
              <Input id="product-name" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} required className="h-10 bg-background press-sm" placeholder="e.g. Black Cotton Shirt" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-category" className="text-xs font-medium text-muted-foreground">Category</Label>
              <Select value={form.categoryId} onValueChange={(v) => setForm((s) => ({ ...s, categoryId: v }))}>
                <SelectTrigger id="product-category" className="h-10 bg-background press-sm">
                  <SelectValue placeholder="Select category…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— No category —</SelectItem>
                  {catQ.data?.rows.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-unit" className="text-xs font-medium text-muted-foreground">Unit</Label>
              <Input id="product-unit" value="piece" disabled className="h-10 bg-muted" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-sale-price" className="text-xs font-medium text-muted-foreground">Sale price (PKR)</Label>
              <Input id="product-sale-price" type="number" step="0.01" value={form.salePrice} onChange={(e) => setForm((s) => ({ ...s, salePrice: e.target.value }))} className="h-10 bg-background press-sm" data-num />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-purchase-price" className="text-xs font-medium text-muted-foreground">Purchase price (PKR)</Label>
              <Input id="product-purchase-price" type="number" step="0.01" value={form.purchasePrice} onChange={(e) => setForm((s) => ({ ...s, purchasePrice: e.target.value }))} className="h-10 bg-background press-sm" data-num />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-opening-stock" className="text-xs font-medium text-muted-foreground">Opening stock (pieces)</Label>
              <Input id="product-opening-stock" type="number" value={form.openingStock} onChange={(e) => setForm((s) => ({ ...s, openingStock: e.target.value }))} className="h-10 bg-background press-sm" data-num />
            </div>
            <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isTemporary}
                  onChange={(e) => setForm((s) => ({ ...s, isTemporary: e.target.checked }))}
                  className="size-4 rounded border-border"
                />
                <span className="text-foreground">Temporary item (fast sale entry — can be merged later)</span>
              </label>
            </div>
            <div className="sm:col-span-2 lg:col-span-3 flex justify-end pt-1">
              <Button type="submit" disabled={createMut.isPending} className="press-md shadow-sm">
                {createMut.isPending ? 'Creating…' : 'Create product'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Product list */}
      {q.isLoading ? (
        <div className="card-3d p-8 text-sm text-muted-foreground">Loading…</div>
      ) : q.data?.rows.length ? (
        <>
          {/* Desktop table */}
          <div className="hidden md:block card-3d overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Products</h2>
              <span className="text-xs text-muted-foreground" data-num>{q.data.rows.length} shown</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                  <th className="text-left p-3.5 font-medium">Item</th>
                  <th className="text-left p-3.5 font-medium">Category</th>
                  <th className="text-right p-3.5 font-medium">Sale Price</th>
                  <th className="text-right p-3.5 font-medium">Purchase Price</th>
                  <th className="text-right p-3.5 font-medium">Stock</th>
                  <th className="text-left p-3.5 font-medium">Flags</th>
                  <th className="text-left p-3.5 font-medium">Created</th>
                  {canEdit && <th className="w-12"></th>}
                </tr>
              </thead>
              <tbody>
                {q.data.rows.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 last:border-0 hover:bg-accent/30 transition-colors">
                    <td className="p-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="grid place-items-center size-8 rounded-lg icon-3d-muted shrink-0">
                          <Package className="size-4 text-muted-foreground" />
                        </div>
                        <span className="font-medium text-foreground">{p.name}</span>
                      </div>
                    </td>
                    <td className="p-3.5 text-xs text-muted-foreground">{p.categoryName ?? '—'}</td>
                    <td className="p-3.5 text-right text-foreground" data-num>{formatMoney(p.salePrice * 100, false)}</td>
                    <td className="p-3.5 text-right text-foreground" data-num>{formatMoney(p.purchasePrice * 100, false)}</td>
                    <td className="p-3.5 text-right font-medium" data-num>
                      <span className={p.currentStock < 0 ? 'text-destructive' : 'text-foreground'}>
                        {p.currentStock}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <div className="flex flex-wrap gap-1">
                        {p.isTemporary && (
                          <span className="text-[10px] uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">Temporary</span>
                        )}
                        {p.markedForMerge && (
                          <span className="text-[10px] uppercase bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-medium">Merge</span>
                        )}
                        {!p.isActive && (
                          <span className="text-[10px] uppercase bg-destructive/10 text-destructive px-1.5 py-0.5 rounded font-medium">Inactive</span>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5 text-xs text-muted-foreground" data-num>{formatTableDate(p.createdAt)}</td>
                    {canEdit && (
                      <td className="p-3.5 text-center">
                        <button onClick={() => startEdit(p)} className="text-muted-foreground hover:text-foreground press-sm" aria-label="Edit">
                          <Edit2 className="size-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {q.data.rows.map((p) => (
              <div key={p.id} className="card-3d card-3d-hover p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="grid place-items-center size-10 rounded-xl icon-3d-muted shrink-0">
                      <Package className="size-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{p.categoryName ?? 'Uncategorized'}</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Stock</div>
                    <div className={`text-lg font-semibold ${p.currentStock < 0 ? 'text-destructive' : 'text-foreground'}`} data-num>
                      {p.currentStock}
                    </div>
                  </div>
                </div>
                {p.currentStock < 0 && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="size-3" /> Negative stock
                  </div>
                )}
                <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sale</div>
                    <div className="text-foreground" data-num>{formatMoney(p.salePrice * 100)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Purchase</div>
                    <div className="text-foreground" data-num>{formatMoney(p.purchasePrice * 100)}</div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.isTemporary && (
                    <span className="text-[9px] uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">Temporary</span>
                  )}
                  {p.markedForMerge && (
                    <span className="text-[9px] uppercase bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-medium">Merge</span>
                  )}
                </div>
                {canEdit && (
                  <Button variant="outline" size="sm" className="w-full mt-3 press-sm" onClick={() => startEdit(p)}>
                    <Edit2 className="size-3.5" /> Edit
                  </Button>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="card-3d p-8 text-center">
          <div className="grid place-items-center size-12 rounded-xl icon-3d-muted mx-auto mb-3">
            <Package className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-foreground font-medium">No products yet</p>
          <p className="text-xs text-muted-foreground mt-1">Create your first product to get started.</p>
          {canManage && (
            <Button variant="outline" className="mt-4 press-sm" onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New product
            </Button>
          )}
        </div>
      )}

      {/* Edit modal */}
      {editingId && (
        <div className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={() => setEditingId(null)}>
          <div className="card-3d p-6 w-full max-w-md sheet-enter" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground mb-4">Edit product</h3>
            <form className="space-y-3.5" onSubmit={(e) => {
              e.preventDefault()
              updateMut.mutate({
                id: editingId,
                updates: {
                  name: editForm.name,
                  salePrice: Number(editForm.salePrice) || 0,
                  purchasePrice: Number(editForm.purchasePrice) || 0,
                  isTemporary: editForm.isTemporary,
                  markedForMerge: editForm.isTemporary ? editForm.markedForMerge : false,
                },
              })
            }}>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Item name</Label>
                <Input value={editForm.name} onChange={(e) => setEditForm((s) => ({ ...s, name: e.target.value }))} className="h-10 bg-background press-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Sale price</Label>
                  <Input type="number" step="0.01" value={editForm.salePrice} onChange={(e) => setEditForm((s) => ({ ...s, salePrice: e.target.value }))} className="h-10 bg-background press-sm" data-num />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Purchase price</Label>
                  <Input type="number" step="0.01" value={editForm.purchasePrice} onChange={(e) => setEditForm((s) => ({ ...s, purchasePrice: e.target.value }))} className="h-10 bg-background press-sm" data-num />
                </div>
              </div>
              {editForm.isTemporary && (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editForm.markedForMerge}
                    onChange={(e) => setEditForm((s) => ({ ...s, markedForMerge: e.target.checked }))}
                    className="size-4 rounded border-border"
                  />
                  <span className="text-foreground">Mark for merge (temporary item ready to be merged into a permanent product)</span>
                </label>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" className="press-sm" onClick={() => setEditingId(null)}>Cancel</Button>
                <Button type="submit" disabled={updateMut.isPending} className="press-md shadow-sm">
                  {updateMut.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
