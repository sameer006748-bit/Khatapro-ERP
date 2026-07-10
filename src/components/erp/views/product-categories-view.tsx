'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Plus, X, Tag, FolderTree } from 'lucide-react'
import { formatTableDate } from '@/lib/format'
import type { MeUser } from '@/components/erp/erp-app'

type Category = {
  id: string
  name: string
  description: string | null
  isActive: boolean
  createdAt: string
  productCount?: number
}

export function ProductCategoriesView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const canManage = user.permissions.includes('can_create_products')
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const q = useQuery<{ rows: Category[] }>({
    queryKey: ['product-categories'],
    queryFn: () => fetch('/api/product-categories').then((r) => r.json()),
  })

  const createMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/product-categories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, description: description || undefined }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j?.error ?? 'CREATE_FAILED')
      }
      return r.json()
    },
    onSuccess: () => {
      toast.success('Category created.')
      void qc.invalidateQueries({ queryKey: ['product-categories'] })
      setOpen(false)
      setName('')
      setDescription('')
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
            Product Categories
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
            Organize your garments inventory by category (e.g. Shirts, Pants, Fabric, Accessories).
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setOpen((v) => !v)} className="press-md shadow-sm">
            {open ? <X className="size-4" /> : <Plus className="size-4" />}
            {open ? 'Close' : 'New category'}
          </Button>
        )}
      </div>

      {open && canManage && (
        <div className="card-3d p-5 sm:p-6 fade-in">
          <h2 className="text-base font-semibold text-foreground mb-4">Create category</h2>
          <form
            className="grid sm:grid-cols-2 gap-3.5"
            onSubmit={(e) => {
              e.preventDefault()
              createMut.mutate()
            }}
          >
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required className="h-10 bg-background press-sm" placeholder="e.g. Shirts" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Description (optional)</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} className="h-10 bg-background press-sm" />
            </div>
            <div className="sm:col-span-2 flex justify-end pt-1">
              <Button type="submit" disabled={createMut.isPending} className="press-md shadow-sm">
                {createMut.isPending ? 'Creating…' : 'Create category'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {q.isLoading ? (
        <div className="card-3d p-8 text-sm text-muted-foreground">Loading…</div>
      ) : q.data?.rows.length ? (
        <>
          {/* Desktop table */}
          <div className="hidden md:block card-3d overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Categories</h2>
              <span className="text-xs text-muted-foreground" data-num>{q.data.rows.length} total</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                  <th className="text-left p-3.5 font-medium">Name</th>
                  <th className="text-left p-3.5 font-medium">Description</th>
                  <th className="text-left p-3.5 font-medium">Products</th>
                  <th className="text-left p-3.5 font-medium">Status</th>
                  <th className="text-left p-3.5 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {q.data.rows.map((c) => (
                  <tr key={c.id} className="border-b border-border/60 last:border-0 hover:bg-accent/30 transition-colors">
                    <td className="p-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="grid place-items-center size-8 rounded-lg icon-3d-muted shrink-0">
                          <Tag className="size-4 text-muted-foreground" />
                        </div>
                        <span className="font-medium text-foreground">{c.name}</span>
                      </div>
                    </td>
                    <td className="p-3.5 text-xs text-muted-foreground">{c.description ?? '—'}</td>
                    <td className="p-3.5 text-foreground" data-num>{c.productCount ?? 0}</td>
                    <td className="p-3.5 text-xs">
                      {c.isActive ? (
                        <span className="inline-flex items-center gap-1 text-primary">
                          <span className="size-1.5 rounded-full bg-primary" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <span className="size-1.5 rounded-full bg-destructive" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 text-xs text-muted-foreground" data-num>{formatTableDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {q.data.rows.map((c) => (
              <div key={c.id} className="card-3d card-3d-hover p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="grid place-items-center size-10 rounded-xl icon-3d-muted shrink-0">
                      <Tag className="size-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">{c.name}</div>
                      {c.description && <div className="text-xs text-muted-foreground mt-0.5">{c.description}</div>}
                    </div>
                  </div>
                  {c.isActive ? (
                    <span className="text-[10px] inline-flex items-center gap-1 text-primary shrink-0">
                      <span className="size-1.5 rounded-full bg-primary" /> Active
                    </span>
                  ) : (
                    <span className="text-[10px] inline-flex items-center gap-1 text-destructive shrink-0">
                      <span className="size-1.5 rounded-full bg-destructive" /> Inactive
                    </span>
                  )}
                </div>
                <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-xs">
                  <span className="text-muted-foreground" data-num>{c.productCount ?? 0} products</span>
                  <span className="text-muted-foreground" data-num>{formatTableDate(c.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="card-3d p-8 text-center">
          <div className="grid place-items-center size-12 rounded-xl icon-3d-muted mx-auto mb-3">
            <FolderTree className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-foreground font-medium">No categories yet</p>
          <p className="text-xs text-muted-foreground mt-1">Create your first product category to get started.</p>
          {canManage && (
            <Button variant="outline" className="mt-4 press-sm" onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New category
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
