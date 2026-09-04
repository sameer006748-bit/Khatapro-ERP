'use client'

/**
 * Account Categories — the setup screen for the categories a business keeps
 * under the five fixed accounting types.
 *
 * One level, and one decision: pick the accounting type, name the category
 * ("Expense → Lunch Expense"). The ledger account behind a category is created
 * and kept in step by the server, so it is never asked for here; ledger detail
 * belongs to the Chart of Accounts.
 *
 * Every rule (the five types are fixed, a category already used cannot be
 * deleted) is enforced by the server. This screen only offers the actions that
 * make sense and shows the reason when one is refused.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { AlertCircle, Check, Pencil, Plus, Power, Trash2, X } from 'lucide-react'
import type { MeUser } from '@/components/erp/erp-app'
import { ApiRequestError } from '@/lib/api-client'
import { PageHeader } from '@/components/erp/page-header'
import {
  CLASSIFICATION_LOAD_ERROR,
  CLASSIFICATION_QUERY_KEY,
  CLASSIFICATION_STALE_TIME_MS,
  NO_CATEGORIES_MESSAGE,
  type ClassificationNodeDto,
  categoriesForRoot,
  fetchClassificationTree,
} from '@/lib/accounting/classification-client'

type CategoryAction = 'create' | 'rename' | 'deactivate' | 'reactivate' | 'delete'

/** The category half of the POST contract of /api/account-classification. */
type CategoryMutation = {
  scope: 'category'
  action: CategoryAction
  categoryId?: string
  rootId?: string
  name?: string
}

/** Readable confirmation for each action — no schema or RPC wording. */
const SUCCESS_MESSAGES: Record<CategoryAction, string> = {
  create: 'Category created.',
  rename: 'Category renamed.',
  deactivate: 'Category deactivated.',
  reactivate: 'Category reactivated.',
  delete: 'Category deleted.',
}
/** An example per accounting type, so a new category is never a blank guess. */
const NAME_HINTS: Record<string, string> = {
  Asset: 'e.g. Office Equipment',
  Liability: 'e.g. Short Term Loan',
  Equity: 'e.g. Owner Capital',
  Income: 'e.g. Service Income',
  Expense: 'e.g. Lunch Expense',
}

/** Shown only on a category that is switched off, where it explains itself. */
function InactiveBadge() {
  return (
    <span className="inline-flex rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
      Inactive
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
  const [edit, setEdit] = useState<{ id: string; value: string } | null>(null)
  const [draft, setDraft] = useState<{ rootId: string; value: string } | null>(null)

  const q = useQuery({
    queryKey: CLASSIFICATION_QUERY_KEY,
    queryFn: ({ signal }) => fetchClassificationTree(signal),
    staleTime: CLASSIFICATION_STALE_TIME_MS,
  })
  const tree = q.data ?? null
  const canManage = tree?.canManage === true

  const mut = useMutation({
    mutationFn: async (input: CategoryMutation) => {
      const r = await fetch('/api/account-classification', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const j = await r.json().catch(() => ({}))
      // The API already translates every database guard into user-facing copy;
      // anything without a message falls back to neutral wording.
      if (!r.ok) throw new Error(typeof j?.message === 'string' ? j.message : 'This category change could not be saved.')
      return j
    },
    onSuccess: (_j, input) => {
      toast.success(SUCCESS_MESSAGES[input.action] ?? 'Change saved.')
      setEdit(null)
      setDraft(null)
      // Both keys back the pickers on the posting screens, so a new category is
      // ready to use as soon as it exists.
      void qc.invalidateQueries({ queryKey: CLASSIFICATION_QUERY_KEY })
      void qc.invalidateQueries({ queryKey: ['coa'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const roots = tree?.roots ?? []

  function askDelete(category: ClassificationNodeDto) {
    if (!window.confirm(`Delete the category "${category.name}"? A category that has already been used cannot be deleted — deactivate it instead.`)) return
    mut.mutate({ scope: 'category', action: 'delete', categoryId: category.id })
  }

  if (q.isLoading) {
    return <StatePanel><span role="status">Loading account categories…</span></StatePanel>
  }

  if (q.isError) {
    const denied = q.error instanceof ApiRequestError && q.error.status === 403
    return (
      <StatePanel>
        <AlertCircle className="size-8 mx-auto mb-3 text-amber-500" />
        <p>{denied ? 'You do not have permission to manage account categories.' : CLASSIFICATION_LOAD_ERROR}</p>
        {!denied && <Button variant="outline" size="sm" className="mt-4" onClick={() => q.refetch()}>Retry</Button>}
      </StatePanel>
    )
  }

  if (!tree || roots.length === 0) {
    return (
      <StatePanel>
        <AlertCircle className="size-8 mx-auto mb-3 text-amber-500" />
        <p>Account categories are currently unavailable.</p>
      </StatePanel>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Account Categories"
        description="Name the categories your business uses under each accounting type. The five accounting types are fixed."
      />
      {!canManage && (
        <p className="text-xs text-muted-foreground">You can see the categories here; changing them needs setup permission.</p>
      )}

      {/* One section per fixed accounting type, in the order the server keeps. */}
      <div className="space-y-4">
        {roots.map((root) => {
          const categories = categoriesForRoot(tree, root.id)
          const adding = draft?.rootId === root.id ? draft : null
          return (
            <section key={root.id} className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">{root.displayType}</h2>
                {canManage && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0"
                    onClick={() => setDraft(adding ? null : { rootId: root.id, value: '' })}
                  >
                    {adding ? <X className="size-3" /> : <Plus className="size-3" />}
                    {adding ? 'Cancel' : 'Add category'}
                  </Button>
                )}
              </div>

              {adding && canManage && (
                <NameForm
                  placeholder={NAME_HINTS[root.type] ?? 'Category name'}
                  value={adding.value}
                  submitting={mut.isPending}
                  onChange={(value) => setDraft({ rootId: root.id, value })}
                  onCancel={() => setDraft(null)}
                  onSubmit={() => mut.mutate({ scope: 'category', action: 'create', rootId: root.id, name: adding.value.trim() })}
                />
              )}

              {categories.length === 0 ? (
                <p className="px-4 py-5 text-center text-sm text-muted-foreground">{NO_CATEGORIES_MESSAGE}</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {categories.map((category) => (
                    <CategoryRow
                      key={category.id}
                      category={category}
                      canManage={canManage}
                      submitting={mut.isPending}
                      editing={edit?.id === category.id ? edit.value : null}
                      onEditStart={() => setEdit({ id: category.id, value: category.name })}
                      onEditChange={(value) => setEdit({ id: category.id, value })}
                      onEditCancel={() => setEdit(null)}
                      onRename={(name) => mut.mutate({ scope: 'category', action: 'rename', categoryId: category.id, name })}
                      onToggle={() => mut.mutate({ scope: 'category', action: category.isActive ? 'deactivate' : 'reactivate', categoryId: category.id })}
                      onDelete={() => askDelete(category)}
                    />
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

/**
 * One category: its name, whether it is switched off, and the four things that
 * may be done to it. The ledger account behind it is the server's business, so
 * it is never shown here.
 */
function CategoryRow({ category, canManage, submitting, editing, onEditStart, onEditChange, onEditCancel, onRename, onToggle, onDelete }: {
  category: ClassificationNodeDto
  canManage: boolean
  submitting: boolean
  editing: string | null
  onEditStart: () => void
  onEditChange: (value: string) => void
  onEditCancel: () => void
  onRename: (name: string) => void
  onToggle: () => void
  onDelete: () => void
}) {
  if (editing !== null) {
    return (
      <li className="flex items-center gap-2 px-4 py-2">
        <InlineName
          value={editing}
          submitting={submitting}
          onChange={onEditChange}
          onCancel={onEditCancel}
          onSubmit={() => onRename(editing.trim())}
        />
      </li>
    )
  }
  return (
    <li className="flex items-center gap-2 px-4 py-2.5">
      <span className={`flex-1 truncate text-sm ${category.isActive ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{category.name}</span>
      {!category.isActive && <InactiveBadge />}
      {canManage && (
        <div className="flex items-center gap-0.5">
          <IconAction label="Rename category" onClick={onEditStart} disabled={submitting}><Pencil className="size-3.5" /></IconAction>
          <IconAction label={category.isActive ? 'Deactivate category' : 'Reactivate category'} onClick={onToggle} disabled={submitting}><Power className="size-3.5" /></IconAction>
          <IconAction label="Delete category" onClick={onDelete} disabled={submitting}><Trash2 className="size-3.5" /></IconAction>
        </div>
      )}
    </li>
  )
}

/** Shared frame for the loading / permission / unavailable states. */
function StatePanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-semibold tracking-tight text-foreground">Account Categories</h1></div>
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">{children}</div>
    </div>
  )
}

/** The whole of adding a category: one name under the type it belongs to. */
function NameForm({ placeholder, value, submitting, onChange, onCancel, onSubmit }: {
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
        <Label className="text-[11px] text-muted-foreground">Category name</Label>
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
      <IconAction label="Save" onClick={() => { if (!blocked) onSubmit() }} disabled={blocked}><Check className="size-4" /></IconAction>
      <IconAction label="Cancel" onClick={onCancel}><X className="size-4" /></IconAction>
    </div>
  )
}
