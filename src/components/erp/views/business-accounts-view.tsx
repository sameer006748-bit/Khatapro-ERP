'use client'

import { useMemo, useState, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatMoney, formatTableDate } from '@/lib/format'
import type { MeUser } from '@/components/erp/erp-app'
import { toast } from 'sonner'
import { Wallet, WalletCards, Banknote, Landmark, Smartphone, Plus, X, ArrowRight, Pencil, Power, Trash2 } from 'lucide-react'
import {
  BUSINESS_ACCOUNT_TYPES,
  needsMoneyTypeReview,
  normalizeBusinessAccountType,
  type BusinessAccountType,
} from '@/lib/accounting/business-account-types'
import { PageHeader } from '@/components/erp/page-header'

type BusinessAccountRow = {
  id: string
  name: string
  type: string
  accountHolder: string | null
  bankName: string | null
  accountNumber: string | null
  isActive: boolean
  createdAt: string
  ledger: {
    id: string
    code: string
    name: string
    category: string
    categoryType: string
    balancePaisas: string
  }
}

/**
 * A new account is Cash or Bank — nothing else. A row saved by an earlier
 * release may hold a legacy label ('Wallet', 'JazzCash', …); the edit form keeps
 * that value selectable so saving other fields never silently reclassifies the
 * account, and the row carries a review action to move it deliberately.
 */
function typeOptions(current?: string): string[] {
  const options: string[] = [...BUSINESS_ACCOUNT_TYPES]
  if (current && !options.includes(current)) options.push(current)
  return options
}

function AccountTypeIcon({ type, className = 'size-3 text-muted-foreground' }: { type: string; className?: string }) {
  const normalized = type.toLowerCase()
  if (normalized.includes('petty')) return <WalletCards className={className} aria-hidden />
  if (normalized.includes('cash')) return <Banknote className={className} aria-hidden />
  if (normalized.includes('bank')) return <Landmark className={className} aria-hidden />
  if (/(wallet|easypaisa|jazzcash|mobile)/.test(normalized)) return <Smartphone className={className} aria-hidden />
  return <Wallet className={className} aria-hidden />
}

function AccountTypeLabel({ type }: { type: string }) {
  return <span className="inline-flex items-center gap-1.5 rounded border border-border bg-muted/30 px-2 py-1 text-[11px] text-foreground"><AccountTypeIcon type={type} />{type}</span>
}

/**
 * Type picker. Two choices, so they are shown side by side rather than hidden
 * behind a dropdown; a legacy label appears as a third choice on the account
 * that already holds it, so an edit never rewrites it by accident.
 */
function TypeChoice({ value, options, onChange }: { value: string; options: string[]; onChange: (next: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Account type" className="inline-flex flex-wrap gap-0.5 rounded-md border border-border bg-muted/30 p-0.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${value === option ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <AccountTypeIcon type={option} className={`size-3.5 ${value === option ? 'text-foreground' : 'text-muted-foreground'}`} />
          {option}
        </button>
      ))}
    </div>
  )
}

/**
 * An account still carrying a label from an earlier release. Nothing about it is
 * rewritten: it keeps its name, balance and history, appears under the money
 * type shown here, and moves only when the owner picks a side.
 */
function TypeReview({ row, canManage, busy, onMove }: {
  row: BusinessAccountRow
  canManage: boolean
  busy: boolean
  onMove: (type: BusinessAccountType) => void
}) {
  if (!needsMoneyTypeReview(row.type)) return null
  return (
    <div className="mt-1.5 space-y-1">
      <span className="inline-flex rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-800">
        Shown under {normalizeBusinessAccountType(row.type)} — needs review
      </span>
      {canManage && (
        <div className="flex flex-wrap gap-1">
          {BUSINESS_ACCOUNT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              disabled={busy}
              onClick={() => onMove(type)}
              className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-foreground hover:bg-accent disabled:opacity-50"
            >
              Move to {type}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function BusinessAccountsView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const canManage = user.permissions.includes('can_manage_setup')
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const q = useQuery<{ rows: BusinessAccountRow[]; availability?: { accounting: boolean; message?: string } }>({
    queryKey: ['business-accounts'],
    queryFn: () => fetch('/api/setup/business-accounts').then((r) => r.json()),
    retry: false,
  })

  const createMut = useMutation({
    mutationFn: async ({ payload, idempotencyKey }: {
      payload: Record<string, unknown>
      idempotencyKey: string
    }) => {
      const r = await fetch('/api/setup/business-accounts', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-idempotency-key': idempotencyKey,
        },
        body: JSON.stringify(payload),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j?.message ?? j?.error ?? 'CREATE_FAILED')
      }
      return r.json()
    },
    onSuccess: () => {
      toast.success('Business account created with linked Asset ledger.')
      void qc.invalidateQueries({ queryKey: ['business-accounts'] })
      void qc.invalidateQueries({ queryKey: ['coa'] })
      setOpen(false)
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })

  // A rename or (de)activation also rewrites the linked ledger account, so the
  // Chart of Accounts and every sale screen reading it must be refetched too.
  const updateMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const r = await fetch(`/api/setup/business-accounts/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.message ?? j?.error ?? 'UPDATE_FAILED')
      return j
    },
    onSuccess: (_j, vars) => {
      toast.success(
        vars.patch.isActive === false
          ? 'Account deactivated. It will no longer appear on new sales.'
          : vars.patch.isActive === true
            ? 'Account activated.'
            : 'Account updated.',
      )
      void qc.invalidateQueries({ queryKey: ['business-accounts'] })
      void qc.invalidateQueries({ queryKey: ['coa'] })
      setEditingId(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/setup/business-accounts/${id}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      // The server refuses to delete an account money has moved through and
      // returns the reason; show that instead of a generic failure.
      if (!r.ok) throw new Error(j?.message ?? j?.error ?? 'DELETE_FAILED')
      return j
    },
    onSuccess: () => {
      toast.success('Account deleted.')
      void qc.invalidateQueries({ queryKey: ['business-accounts'] })
      void qc.invalidateQueries({ queryKey: ['coa'] })
      setEditingId(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function askDelete(row: BusinessAccountRow) {
    const ok = window.confirm(
      `Delete "${row.name}"? This also removes its ledger account ${row.ledger.code}. Accounts used by posted transactions cannot be deleted — deactivate those instead.`,
    )
    if (ok) deleteMut.mutate(row.id)
  }

  /** Reclassifying only changes where the account is listed. */
  function askMoveType(row: BusinessAccountRow, type: BusinessAccountType) {
    const ok = window.confirm(
      `Move "${row.name}" to ${type}? Its balance, ledger account ${row.ledger.code} and posted history stay exactly as they are — only where it is listed changes.`,
    )
    if (ok) updateMut.mutate({ id: row.id, patch: { type } })
  }

  // Cash held and money at the bank, the two totals an owner reads first.
  // Inactive accounts are counted separately but still carry their balance.
  const summary = useMemo(() => {
    const rows = q.data?.rows ?? []
    return BUSINESS_ACCOUNT_TYPES.map((type) => {
      const group = rows.filter((row) => normalizeBusinessAccountType(row.type) === type)
      return {
        type,
        accounts: group.length,
        active: group.filter((row) => row.isActive).length,
        balancePaisas: group.reduce((total, row) => total + BigInt(row.ledger.balancePaisas), 0n),
      }
    })
  }, [q.data?.rows])

  return (
    <div className="space-y-5">
      {q.data?.availability?.accounting === false && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This accounting feature is currently unavailable.
        </div>
      )}
      <PageHeader
        title="Business Accounts"
        description="Your money lives in two places: Cash and Bank. Add as many accounts as you need under either one — balances update as entries are recorded."
        actions={canManage && (
          <Button onClick={() => setOpen((v) => !v)} className="shadow-sm">
            {open ? <X className="size-4" /> : <Plus className="size-4" />}
            {open ? 'Close' : 'New business account'}
          </Button>
        )}
      />

      {q.data?.rows?.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {summary.map((group) => (
            <div key={group.type} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="grid size-8 place-items-center rounded-md border border-border bg-muted/35">
                    <AccountTypeIcon type={group.type} className="size-4 text-foreground" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">{group.type}</div>
                    <div className="text-[11px] text-muted-foreground" data-num>
                      {group.accounts} account{group.accounts === 1 ? '' : 's'} · {group.active} active
                    </div>
                  </div>
                </div>
                <div className={`text-base font-semibold ${group.balancePaisas < 0n ? 'text-destructive' : 'text-foreground'}`} data-num>
                  {formatMoney(group.balancePaisas)}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {open && canManage && (
        <div className="rounded-lg border border-border bg-card p-5 sm:p-6">
          <h2 className="text-base font-semibold text-foreground mb-4">Create business account</h2>
          <AccountForm
            submitting={createMut.isPending}
            onSubmit={(payload) => createMut.mutate({ payload, idempotencyKey: crypto.randomUUID() })}
          />
        </div>
      )}

      {/* Desktop: table. Mobile: cards. */}
      {q.isLoading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-sm text-muted-foreground">Loading…</div>
      ) : q.data?.rows.length ? (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Accounts</h2>
              <span className="text-xs text-muted-foreground" data-num>
                {q.data.rows.length} total
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                    <th className="text-left p-3.5 font-medium">Name</th>
                    <th className="text-left p-3.5 font-medium">Type</th>
                    <th className="text-left p-3.5 font-medium">Holder / Bank / A/c#</th>
                    <th className="text-left p-3.5 font-medium">Ledger</th>
                    <th className="text-right p-3.5 font-medium">Balance</th>
                    <th className="text-left p-3.5 font-medium">Created</th>
                    {canManage && <th className="text-right p-3.5 font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {q.data.rows.map((r) => (
                    <Fragment key={r.id}>
                    <tr
                      className="border-b border-border/60 last:border-0 hover:bg-accent/30 transition-colors"
                    >
                      <td className="p-3.5">
                        <div className="font-medium text-foreground">{r.name}</div>
                        <span className={`mt-1 inline-flex rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${r.isActive ? 'border-emerald-700/20 bg-emerald-700/5 text-emerald-700' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}>{r.isActive ? 'Active' : 'Inactive'}</span>
                      </td>
                      <td className="p-3.5">
                        <AccountTypeLabel type={r.type} />
                        <TypeReview
                          row={r}
                          canManage={canManage}
                          busy={updateMut.isPending}
                          onMove={(type) => askMoveType(r, type)}
                        />
                      </td>
                      <td className="p-3.5 text-xs text-muted-foreground">
                        <div>{r.accountHolder ?? '—'}</div>
                        <div>{r.bankName ?? ''}</div>
                        <div data-num>{r.accountNumber ?? ''}</div>
                      </td>
                      <td className="p-3.5 text-xs">
                        <div className="font-medium text-foreground" data-num>
                          {r.ledger.code}
                        </div>
                        <div className="text-muted-foreground">{r.ledger.name}</div>
                        <div className="text-muted-foreground">{r.ledger.category}</div>
                      </td>
                      <td className={`p-3.5 text-right font-semibold ${BigInt(r.ledger.balancePaisas) < 0n ? 'text-destructive' : 'text-foreground'}`} data-num>
                        {formatMoney(BigInt(r.ledger.balancePaisas))}
                      </td>
                      <td className="p-3.5 text-xs text-muted-foreground" data-num>
                        {formatTableDate(r.createdAt)}
                      </td>
                      {canManage && (
                        <td className="p-3.5">
                          <div className="flex items-center justify-end gap-1">
                            <RowActions
                              row={r}
                              editing={editingId === r.id}
                              busy={updateMut.isPending || deleteMut.isPending}
                              onEdit={() => setEditingId(editingId === r.id ? null : r.id)}
                              onToggleActive={() =>
                                updateMut.mutate({ id: r.id, patch: { isActive: !r.isActive } })
                              }
                              onDelete={() => askDelete(r)}
                            />
                          </div>
                        </td>
                      )}
                    </tr>
                    {canManage && editingId === r.id && (
                      <tr className="border-b border-border/60 bg-muted/30">
                        <td colSpan={7} className="p-3.5">
                          <AccountForm
                            initial={r}
                            submitting={updateMut.isPending}
                            submitLabel="Save changes"
                            onCancel={() => setEditingId(null)}
                            onSubmit={(v) => updateMut.mutate({ id: r.id, patch: v })}
                          />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {q.data.rows.map((r) => (
              <div key={r.id} className={`rounded-lg border bg-card p-4 ${r.isActive ? 'border-border' : 'border-destructive/30'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-muted/35">
                      <AccountTypeIcon type={r.type} className="size-5 text-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">{r.name}</div>
                      <div className="mt-1"><AccountTypeLabel type={r.type} /></div>
                      <TypeReview
                        row={r}
                        canManage={canManage}
                        busy={updateMut.isPending}
                        onMove={(type) => askMoveType(r, type)}
                      />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Balance
                    </div>
                    <div className={`font-semibold ${BigInt(r.ledger.balancePaisas) < 0n ? 'text-destructive' : 'text-foreground'}`} data-num>
                      {formatMoney(BigInt(r.ledger.balancePaisas))}
                    </div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Ledger
                    </div>
                    <div className="text-foreground font-medium" data-num>
                      {r.ledger.code} · {r.ledger.name}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Created
                    </div>
                    <div className="text-foreground" data-num>
                      {formatTableDate(r.createdAt)}
                    </div>
                  </div>
                  {r.accountNumber && (
                    <div className="col-span-2">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        A/c #
                      </div>
                      <div className="text-foreground" data-num>
                        {r.accountNumber}
                      </div>
                    </div>
                  )}
                </div>
                {canManage && (
                  <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-2">
                    {!r.isActive ? (
                      <span className="rounded border border-destructive/30 bg-destructive/5 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-destructive">Inactive</span>
                    ) : (
                      <span className="rounded border border-emerald-700/20 bg-emerald-700/5 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-700">Active</span>
                    )}
                    <div className="flex items-center gap-1">
                      <RowActions
                        row={r}
                        editing={editingId === r.id}
                        busy={updateMut.isPending || deleteMut.isPending}
                        onEdit={() => setEditingId(editingId === r.id ? null : r.id)}
                        onToggleActive={() =>
                          updateMut.mutate({ id: r.id, patch: { isActive: !r.isActive } })
                        }
                        onDelete={() => askDelete(r)}
                      />
                    </div>
                  </div>
                )}
                {canManage && editingId === r.id && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <AccountForm
                      initial={r}
                      submitting={updateMut.isPending}
                      submitLabel="Save changes"
                      onCancel={() => setEditingId(null)}
                      onSubmit={(v) => updateMut.mutate({ id: r.id, patch: v })}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-md border border-border bg-muted/35">
            <Wallet className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No business accounts yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add your first Cash or Bank account to see the linked ledger account appear.
          </p>
          {canManage && (
            <Button
              variant="outline"
              className="mt-4 press-sm"
              onClick={() => setOpen(true)}
            >
              <Plus className="size-4" /> New business account
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function RowActions({
  row,
  editing,
  busy,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  row: BusinessAccountRow
  editing: boolean
  busy: boolean
  onEdit: () => void
  onToggleActive: () => void
  onDelete: () => void
}) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="press-sm h-8 px-2"
        title={editing ? 'Close editor' : 'Edit account'}
        onClick={onEdit}
      >
        {editing ? <X className="size-3.5" /> : <Pencil className="size-3.5" />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        className="press-sm h-8 px-2"
        title={row.isActive ? 'Deactivate (hides it from new sales)' : 'Activate'}
        onClick={onToggleActive}
      >
        <Power className={`size-3.5 ${row.isActive ? 'text-emerald-600' : 'text-muted-foreground'}`} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        className="press-sm h-8 px-2 text-destructive hover:text-destructive"
        title="Delete account"
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </>
  )
}

function AccountForm({
  submitting,
  onSubmit,
  initial,
  submitLabel,
  onCancel,
}: {
  submitting: boolean
  onSubmit: (v: Record<string, unknown>) => void
  initial?: BusinessAccountRow
  submitLabel?: string
  onCancel?: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<string>(initial?.type ?? 'Cash')
  const [accountHolder, setAccountHolder] = useState(initial?.accountHolder ?? '')
  const [bankName, setBankName] = useState(initial?.bankName ?? '')
  const [accountNumber, setAccountNumber] = useState(initial?.accountNumber ?? '')
  const isEdit = initial !== undefined
  // Holder, bank and account number belong to a bank account. A cash account
  // needs a name and nothing else — unless it already holds those details, in
  // which case they stay visible and editable rather than becoming unreachable.
  const showBankDetails = normalizeBusinessAccountType(type) === 'Bank'
    || Boolean(initial?.accountHolder || initial?.bankName || initial?.accountNumber)

  return (
    <form
      className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        // Edit sends null to clear an optional field; create simply omits it.
        onSubmit(
          isEdit
            ? {
                name,
                type,
                accountHolder: accountHolder || null,
                bankName: bankName || null,
                accountNumber: accountNumber || null,
              }
            : {
                name,
                type,
                accountHolder: accountHolder || undefined,
                bankName: bankName || undefined,
                accountNumber: accountNumber || undefined,
              },
        )
      }}
    >
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required className="h-10 bg-background press-sm" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">Type</Label>
        <div className="flex h-10 items-center">
          <TypeChoice value={type} options={typeOptions(initial?.type)} onChange={setType} />
        </div>
      </div>
      {showBankDetails && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Account holder</Label>
            <Input value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)} className="h-10 bg-background press-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Bank name</Label>
            <Input value={bankName} onChange={(e) => setBankName(e.target.value)} className="h-10 bg-background press-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Account number</Label>
            <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className="h-10 bg-background press-sm" data-num />
          </div>
        </>
      )}
      <div className="sm:col-span-2 lg:col-span-3 flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button type="button" variant="ghost" className="press-sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={submitting} className="press-md shadow-sm">
          {submitting ? 'Saving…' : (
            <>
              <ArrowRight className="size-4" /> {submitLabel ?? 'Create account'}
            </>
          )}
        </Button>
      </div>
    </form>
  )
}
