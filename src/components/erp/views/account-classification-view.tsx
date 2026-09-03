'use client'

/**
 * Account Classification — the setup screen for the categories and
 * subcategories that group ledger accounts under the five fixed accounting
 * types.
 *
 * Every rule (roots are immutable, depth stops at subcategory, system accounts
 * are untouchable, deletion only when nothing depends on the node) is enforced
 * by the server. This screen only offers the actions that make sense and shows
 * the reason when the server refuses one.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { AlertCircle, Check, ChevronDown, ChevronRight, FolderTree, Lock, Pencil, Plus, Power, Trash2, X } from 'lucide-react'
import type { MeUser } from '@/components/erp/erp-app'
import { ApiRequestError } from '@/lib/api-client'
import { PageHeader } from '@/components/erp/page-header'
import {
  CLASSIFICATION_LOAD_ERROR,
  NO_CATEGORIES_MESSAGE,
  type ClassificationNodeDto,
  type ClassificationTree,
  activeCategories,
  activeSubcategories,
  categoriesForRoot,
  classificationPath,
  fetchClassificationTree,
  subcategoriesForCategory,
} from '@/lib/accounting/classification-client'

type CategoryAction = 'create' | 'rename' | 'deactivate' | 'reactivate' | 'delete'

/** Mirrors the POST contract of /api/account-classification. */
type Mutation =
  | { scope: 'category'; action: CategoryAction; categoryId?: string; rootId?: string; name?: string }
  | { scope: 'subcategory'; action: CategoryAction; subcategoryId?: string; categoryId?: string; name?: string }
  | {
      scope: 'account'
      action: 'create' | 'rename' | 'activate' | 'deactivate' | 'classify'
      accountId?: string
      accountCode?: string
      name?: string
      categoryId?: string
    }

/** Readable confirmation for each action — no schema or RPC wording. */
const SUCCESS_MESSAGES: Record<string, string> = {
  'category:create': 'Category created.',
  'category:rename': 'Category renamed.',
  'category:deactivate': 'Category deactivated.',
  'category:reactivate': 'Category reactivated.',
  'category:delete': 'Category deleted.',
  'subcategory:create': 'Subcategory created.',
  'subcategory:rename': 'Subcategory renamed.',
  'subcategory:deactivate': 'Subcategory deactivated.',
  'subcategory:reactivate': 'Subcategory reactivated.',
  'subcategory:delete': 'Subcategory deleted.',
  'account:create': 'Ledger account created.',
  'account:rename': 'Ledger account renamed.',
  'account:activate': 'Ledger account activated.',
  'account:deactivate': 'Ledger account deactivated.',
  'account:classify': 'Ledger account moved to the selected category.',
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${isActive ? 'border-emerald-700/20 bg-emerald-700/5 text-emerald-700' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}>
      {isActive ? 'Active' : 'Inactive'}
    </span>
  )
}

function SystemBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
      <Lock className="size-2.5" aria-hidden />System
    </span>
  )
}

function IconAction({ label, onClick, disabled, children }: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  )
}

export function AccountClassificationView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [rootId, setRootId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [edit, setEdit] = useState<{ kind: 'category' | 'subcategory' | 'account'; id: string; value: string } | null>(null)
  const [draft, setDraft] = useState<{ kind: 'category' | 'subcategory'; parentId: string; value: string } | null>(null)
  const [accountForm, setAccountForm] = useState<{ code: string; name: string; categoryId: string } | null>(null)
  const [classify, setClassify] = useState<{ accountId: string; categoryId: string } | null>(null)

  const q = useQuery({
    queryKey: ['account-classification'],
    queryFn: ({ signal }) => fetchClassificationTree(signal),
  })
  const tree = q.data ?? null
  const canManage = tree?.canManage === true

  const mut = useMutation({
    mutationFn: async (input: Mutation) => {
      const r = await fetch('/api/account-classification', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const j = await r.json().catch(() => ({}))
      // The API already translates every database guard into user-facing copy;
      // anything without a message falls back to neutral wording.
      if (!r.ok) throw new Error(typeof j?.message === 'string' ? j.message : 'This classification change could not be saved.')
      return j
    },
    onSuccess: (_j, input) => {
      toast.success(SUCCESS_MESSAGES[`${input.scope}:${input.action}`] ?? 'Change saved.')
      setEdit(null)
      setDraft(null)
      setClassify(null)
      if (input.scope === 'account' && input.action === 'create') setAccountForm(null)
      void qc.invalidateQueries({ queryKey: ['account-classification'] })
      void qc.invalidateQueries({ queryKey: ['coa'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const roots = tree?.roots ?? []
  const activeRootId = rootId ?? roots[0]?.id ?? null
  const activeRoot = roots.find((root) => root.id === activeRootId) ?? null
  const categories = categoriesForRoot(tree, activeRootId)
  const rootAccounts = (tree?.accounts ?? []).filter((account) => account.rootId === activeRootId)

  function toggle(id: string) { setExpanded((prev) => ({ ...prev, [id]: !prev[id] })) }

  function askDelete(kind: 'category' | 'subcategory', node: ClassificationNodeDto) {
    const what = kind === 'category' ? 'category' : 'subcategory'
    if (!window.confirm(`Delete the ${what} "${node.name}"? A ${what} still used by accounts cannot be deleted — deactivate it instead.`)) return
    mut.mutate(kind === 'category'
      ? { scope: 'category', action: 'delete', categoryId: node.id }
      : { scope: 'subcategory', action: 'delete', subcategoryId: node.id })
  }

  if (q.isLoading) {
    return <StatePanel><span role="status">Loading account classifications…</span></StatePanel>
  }

  if (q.isError) {
    const denied = q.error instanceof ApiRequestError && q.error.status === 403
    return (
      <StatePanel>
        <AlertCircle className="size-8 mx-auto mb-3 text-amber-500" />
        <p>{denied ? 'You do not have permission to manage account classifications.' : CLASSIFICATION_LOAD_ERROR}</p>
        {!denied && <Button variant="outline" size="sm" className="mt-4" onClick={() => q.refetch()}>Retry</Button>}
      </StatePanel>
    )
  }

  if (!tree || roots.length === 0) {
    return (
      <StatePanel>
        <AlertCircle className="size-8 mx-auto mb-3 text-amber-500" />
        <p>Account classification is currently unavailable.</p>
      </StatePanel>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Account Classification"
        description="Group ledger accounts under your own categories and subcategories. The five accounting types are fixed."
      />

      {/* The five fixed accounting types. They cannot be added to or renamed. */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Accounting types">
        {roots.map((root) => (
          <button
            key={root.id}
            type="button"
            role="tab"
            aria-selected={root.id === activeRootId}
            onClick={() => setRootId(root.id)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${root.id === activeRootId ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}
          >
            {root.displayType}
          </button>
        ))}
      </div>

      {/* Categories and their subcategories */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Categories in {activeRoot?.displayType}</h2>
            <p className="text-[11px] text-muted-foreground">Category, then an optional subcategory. Two levels only.</p>
          </div>
          {canManage && activeRootId && (
            <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={() => setDraft({ kind: 'category', parentId: activeRootId, value: '' })}>
              <Plus className="size-3" /> Add category
            </Button>
          )}
        </div>

        {draft?.kind === 'category' && draft.parentId === activeRootId && (
          <NameForm
            label="Category name"
            placeholder="e.g. Utilities"
            value={draft.value}
            submitting={mut.isPending}
            onChange={(value) => setDraft({ ...draft, value })}
            onCancel={() => setDraft(null)}
            onSubmit={() => mut.mutate({ scope: 'category', action: 'create', rootId: draft.parentId, name: draft.value.trim() })}
          />
        )}

        {categories.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{NO_CATEGORIES_MESSAGE}</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {categories.map((category) => {
              const subcategories = subcategoriesForCategory(tree, category.id)
              const open = expanded[category.id] === true
              const accountCount = rootAccounts.filter((account) => account.categoryId === category.id).length
              return (
                <li key={category.id}>
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <button type="button" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => toggle(category.id)} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                      {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </button>
                    {edit?.kind === 'category' && edit.id === category.id ? (
                      <InlineName
                        value={edit.value}
                        submitting={mut.isPending}
                        onChange={(value) => setEdit({ ...edit, value })}
                        onCancel={() => setEdit(null)}
                        onSubmit={() => mut.mutate({ scope: 'category', action: 'rename', categoryId: category.id, name: edit.value.trim() })}
                      />
                    ) : (
                      <>
                        <span className="flex-1 truncate text-sm font-medium text-foreground">{category.name}</span>
                        <span className="hidden text-[11px] text-muted-foreground sm:inline" data-num>{subcategories.length} sub · {accountCount} accounts</span>
                        <StatusBadge isActive={category.isActive} />
                        {canManage && (
                          <div className="flex items-center gap-0.5">
                            <IconAction label="Add subcategory" onClick={() => { setExpanded((prev) => ({ ...prev, [category.id]: true })); setDraft({ kind: 'subcategory', parentId: category.id, value: '' }) }}><Plus className="size-3.5" /></IconAction>
                            <IconAction label="Rename category" onClick={() => setEdit({ kind: 'category', id: category.id, value: category.name })}><Pencil className="size-3.5" /></IconAction>
                            <IconAction label={category.isActive ? 'Deactivate category' : 'Reactivate category'} onClick={() => mut.mutate({ scope: 'category', action: category.isActive ? 'deactivate' : 'reactivate', categoryId: category.id })}><Power className="size-3.5" /></IconAction>
                            <IconAction label="Delete category" onClick={() => askDelete('category', category)}><Trash2 className="size-3.5" /></IconAction>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {open && (
                    <div className="border-t border-border/60 bg-muted/10 pl-8 pr-3">
                      {draft?.kind === 'subcategory' && draft.parentId === category.id && (
                        <NameForm
                          label="Subcategory name"
                          placeholder="e.g. Electricity"
                          value={draft.value}
                          submitting={mut.isPending}
                          onChange={(value) => setDraft({ ...draft, value })}
                          onCancel={() => setDraft(null)}
                          onSubmit={() => mut.mutate({ scope: 'subcategory', action: 'create', categoryId: draft.parentId, name: draft.value.trim() })}
                        />
                      )}
                      {subcategories.length === 0 ? (
                        <p className="py-3 text-xs text-muted-foreground">No subcategories yet. Accounts can sit directly in this category.</p>
                      ) : (
                        <ul className="divide-y divide-border/40">
                          {subcategories.map((subcategory) => (
                            <li key={subcategory.id} className="flex items-center gap-2 py-2">
                              {edit?.kind === 'subcategory' && edit.id === subcategory.id ? (
                                <InlineName
                                  value={edit.value}
                                  submitting={mut.isPending}
                                  onChange={(value) => setEdit({ ...edit, value })}
                                  onCancel={() => setEdit(null)}
                                  onSubmit={() => mut.mutate({ scope: 'subcategory', action: 'rename', subcategoryId: subcategory.id, name: edit.value.trim() })}
                                />
                              ) : (
                                <>
                                  <span className="flex-1 truncate text-sm text-foreground">{subcategory.name}</span>
                                  <span className="hidden text-[11px] text-muted-foreground sm:inline" data-num>
                                    {rootAccounts.filter((account) => account.subcategoryId === subcategory.id).length} accounts
                                  </span>
                                  <StatusBadge isActive={subcategory.isActive} />
                                  {canManage && (
                                    <div className="flex items-center gap-0.5">
                                      <IconAction label="Rename subcategory" onClick={() => setEdit({ kind: 'subcategory', id: subcategory.id, value: subcategory.name })}><Pencil className="size-3.5" /></IconAction>
                                      <IconAction label={subcategory.isActive ? 'Deactivate subcategory' : 'Reactivate subcategory'} onClick={() => mut.mutate({ scope: 'subcategory', action: subcategory.isActive ? 'deactivate' : 'reactivate', subcategoryId: subcategory.id })}><Power className="size-3.5" /></IconAction>
                                      <IconAction label="Delete subcategory" onClick={() => askDelete('subcategory', subcategory)}><Trash2 className="size-3.5" /></IconAction>
                                    </div>
                                  )}
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Ledger accounts of this accounting type */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Ledger accounts in {activeRoot?.displayType}</h2>
            <p className="text-[11px] text-muted-foreground">An account can sit in a category or in one of its subcategories.</p>
          </div>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0"
              onClick={() => setAccountForm(accountForm ? null : { code: '', name: '', categoryId: '' })}
            >
              {accountForm ? <X className="size-3" /> : <Plus className="size-3" />}
              {accountForm ? 'Close' : 'New account'}
            </Button>
          )}
        </div>

        {accountForm && canManage && (
          <form
            className="grid gap-3 border-b border-border bg-muted/20 px-4 py-3 sm:grid-cols-[10rem_1fr_14rem_auto]"
            onSubmit={(e) => {
              e.preventDefault()
              mut.mutate({
                scope: 'account',
                action: 'create',
                accountCode: accountForm.code.trim(),
                name: accountForm.name.trim(),
                categoryId: accountForm.categoryId,
              })
            }}
          >
            <div>
              <Label className="text-[11px] text-muted-foreground">Account code</Label>
              <Input value={accountForm.code} onChange={(e) => setAccountForm({ ...accountForm, code: e.target.value })} maxLength={32} placeholder="5040" className="h-9 bg-background" data-num />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Account name</Label>
              <Input value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} maxLength={80} placeholder="e.g. Internet" className="h-9 bg-background" />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Category</Label>
              <ClassificationPicker tree={tree} rootId={activeRootId} value={accountForm.categoryId} className="h-9 bg-background" onChange={(categoryId) => setAccountForm({ ...accountForm, categoryId })} />
            </div>
            <div className="flex items-end">
              <Button type="submit" size="sm" className="h-9" disabled={mut.isPending || accountForm.code.trim().length < 2 || accountForm.name.trim().length === 0 || !accountForm.categoryId}>Create</Button>
            </div>
          </form>
        )}

        {rootAccounts.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No ledger accounts in this accounting type yet.</p>
        ) : (
          <ul className="max-h-[30rem] divide-y divide-border/60 overflow-y-auto">
            {rootAccounts.map((account) => (
              <li key={account.id} className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-xs font-medium text-foreground" data-num>{account.code}</span>
                  {edit?.kind === 'account' && edit.id === account.id ? (
                    <InlineName
                      value={edit.value}
                      submitting={mut.isPending}
                      onChange={(value) => setEdit({ ...edit, value })}
                      onCancel={() => setEdit(null)}
                      onSubmit={() => mut.mutate({ scope: 'account', action: 'rename', accountId: account.id, name: edit.value.trim() })}
                    />
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-foreground">{account.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{classificationPath(tree, account) || 'Not grouped in a category'}</div>
                      </div>
                      {account.isSystem && <SystemBadge />}
                      {!account.isSystem && !account.isManual && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Managed elsewhere</span>}
                      <StatusBadge isActive={account.isActive} />
                      {canManage && account.isManual && (
                        <div className="flex items-center gap-0.5">
                          <IconAction label="Change category" onClick={() => setClassify({ accountId: account.id, categoryId: account.subcategoryId ?? account.categoryId ?? '' })}><FolderTree className="size-3.5" /></IconAction>
                          <IconAction label="Rename account" onClick={() => setEdit({ kind: 'account', id: account.id, value: account.name })}><Pencil className="size-3.5" /></IconAction>
                          <IconAction label={account.isActive ? 'Deactivate account' : 'Activate account'} onClick={() => mut.mutate({ scope: 'account', action: account.isActive ? 'deactivate' : 'activate', accountId: account.id })}><Power className="size-3.5" /></IconAction>
                        </div>
                      )}
                    </>
                  )}
                </div>
                {classify?.accountId === account.id && (
                  <div className="mt-2 flex flex-wrap items-end gap-2 sm:pl-16">
                    <div className="min-w-56 flex-1">
                      <Label className="text-[11px] text-muted-foreground">Move to</Label>
                      <ClassificationPicker tree={tree} rootId={activeRootId} value={classify.categoryId} className="h-9 bg-background" onChange={(categoryId) => setClassify({ ...classify, categoryId })} />
                    </div>
                    <Button size="sm" className="h-9" disabled={mut.isPending || !classify.categoryId} onClick={() => mut.mutate({ scope: 'account', action: 'classify', accountId: account.id, categoryId: classify.categoryId })}>Save</Button>
                    <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setClassify(null)}>Cancel</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Shared frame for the loading / permission / unavailable states. */
function StatePanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-semibold tracking-tight text-foreground">Account Classification</h1></div>
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">{children}</div>
    </div>
  )
}

/** One-field create form, shared by categories and subcategories. */
function NameForm({ label, placeholder, value, submitting, onChange, onCancel, onSubmit }: {
  label: string
  placeholder: string
  value: string
  submitting: boolean
  onChange: (value: string) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const blocked = submitting || value.trim().length === 0
  return (
    <form
      className="flex items-end gap-2 border-b border-border bg-muted/20 px-4 py-3"
      onSubmit={(e) => { e.preventDefault(); if (!blocked) onSubmit() }}
    >
      <div className="flex-1">
        <Label className="text-[11px] text-muted-foreground">{label}</Label>
        <Input autoFocus value={value} onChange={(e) => onChange(e.target.value)} maxLength={80} placeholder={placeholder} className="h-9 bg-background" />
      </div>
      <Button type="submit" size="sm" className="h-9" disabled={blocked}>Save</Button>
      <Button type="button" variant="ghost" size="sm" className="h-9" onClick={onCancel}>Cancel</Button>
    </form>
  )
}

/** Rename in place without changing the row's height. */
function InlineName({ value, submitting, onChange, onCancel, onSubmit }: {
  value: string
  submitting: boolean
  onChange: (value: string) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const blocked = submitting || value.trim().length === 0
  return (
    <div className="flex flex-1 items-center gap-1">
      <Input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !blocked) onSubmit(); if (e.key === 'Escape') onCancel() }}
        maxLength={80}
        className="h-8 bg-background"
      />
      <IconAction label="Save" onClick={() => { if (!blocked) onSubmit() }}><Check className="size-4" /></IconAction>
      <IconAction label="Cancel" onClick={onCancel}><X className="size-4" /></IconAction>
    </div>
  )
}

/**
 * Picks the classification an account belongs to: a category itself, or one of
 * its active subcategories. Only active nodes are offered — inactive ones stay
 * readable on existing rows but cannot be chosen again.
 */
function ClassificationPicker({ tree, rootId, value, className, onChange }: {
  tree: ClassificationTree
  rootId: string | null
  value: string
  className: string
  onChange: (value: string) => void
}) {
  const categories = activeCategories(tree, rootId)
  if (categories.length === 0) {
    return <p className="pt-2 text-[11px] text-muted-foreground">{NO_CATEGORIES_MESSAGE}</p>
  }
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}><SelectValue placeholder="Select category…" /></SelectTrigger>
      <SelectContent>
        {categories.map((category) => (
          <SelectGroup key={category.id}>
            <SelectLabel className="text-[11px] uppercase tracking-wider">{category.name}</SelectLabel>
            <SelectItem value={category.id}>Directly in {category.name}</SelectItem>
            {activeSubcategories(tree, category.id).map((subcategory) => (
              <SelectItem key={subcategory.id} value={subcategory.id}>{subcategory.name}</SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
