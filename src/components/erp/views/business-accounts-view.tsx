'use client'

import { useMemo, useState, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatMoney, formatTableDate } from '@/lib/format'
import type { MeUser } from '@/components/erp/erp-app'
import { toast } from 'sonner'
import { Wallet, WalletCards, Banknote, Landmark, Smartphone, Plus, X, ArrowRight, Pencil, Power, Trash2, Link2 } from 'lucide-react'
import {
  BUSINESS_ACCOUNT_TYPES,
  needsMoneyTypeReview,
  normalizeBusinessAccountType,
  type BusinessAccountType,
} from '@/lib/accounting/business-account-types'
import { PageHeader } from '@/components/erp/page-header'

type BusinessAccountRow = {
  id: string
  /**
   * False for a money account that exists only in the chart of accounts — the
   * accounts seeded with the business (Cash, Petty Cash, Bank, …). Such a row is
   * read-only until it is brought under management, which reuses its ledger
   * account and leaves its code, balance and history untouched.
   */
  linked: boolean
  /** Readable business identity: CASH, PETTY-CASH, BANK-UBL. Never a number. */
  identity: string
  name: string
  type: string
  accountHolder: string | null
  bankName: string | null
  accountNumber: string | null
  isActive: boolean
  createdAt: string | null
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

/**
 * How the business refers to this account. Readable words, never a number and
 * never an internal id, so it can be said out loud and typed by hand.
 */
function IdentityChip({ identity }: { identity: string }) {
  if (!identity) return null
  return (
    <span
      className="inline-flex rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary"
      title={`Identity: ${identity}`}
    >
      {identity}
    </span>
  )
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${isActive ? 'border-emerald-700/20 bg-emerald-700/5 text-emerald-700' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}>
      {isActive ? 'Active' : 'Inactive'}
    </span>
  )
}

/** An account that is still only a chart entry, with the one action it offers. */
function UnmanagedNote({ canManage, busy, onEnable }: {
  canManage: boolean
  busy: boolean
  onEnable: () => void
}) {
  return (
    <div className="mt-1.5 space-y-1">
      <span className="inline-flex rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-800">
        From your chart of accounts
      </span>
      {canManage && (
        <div>
          <button
            type="button"
            disabled={busy}
            onClick={onEnable}
            className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            <Link2 className="size-3" /> Enable management
          </button>
        </div>
      )}
    </div>
  )
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

/**
 * Everything a row can do, in one bag. The table and the card list are two
 * renderings of the same list, so they share one set of handlers rather than
 * each wiring its own — a row then behaves identically on desktop and mobile.
 */
type RowControls = {
  canManage: boolean
  editingId: string | null
  /** An update or delete is in flight; row actions are disabled meanwhile. */
  rowBusy: boolean
  linkBusy: boolean
  saving: boolean
  onEdit: (row: BusinessAccountRow) => void
  onToggleActive: (row: BusinessAccountRow) => void
  onDelete: (row: BusinessAccountRow) => void
  onMoveType: (row: BusinessAccountRow, type: BusinessAccountType) => void
  onEnable: (row: BusinessAccountRow) => void
  onCancelEdit: () => void
  onSubmitEdit: (row: BusinessAccountRow, patch: Record<string, unknown>) => void
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

  /**
   * Bring a chart-only money account under management. The ledger account it
   * already posts to is reused, so its code, its balance and every posted entry
   * stay as they are — only the ability to rename, move and deactivate is added.
   */
  const linkMut = useMutation({
    mutationFn: async (row: BusinessAccountRow) => {
      const r = await fetch('/api/setup/business-accounts/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ledgerAccountId: row.ledger.id,
          type: normalizeBusinessAccountType(row.type),
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.message ?? j?.error ?? 'LINK_FAILED')
      return j
    },
    onSuccess: (j) => {
      toast.success(j?.alreadyLinked
        ? 'This account was already editable.'
        : 'Account is now editable. Its ledger code, balance and history are unchanged.')
      void qc.invalidateQueries({ queryKey: ['business-accounts'] })
      void qc.invalidateQueries({ queryKey: ['coa'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function askDelete(row: BusinessAccountRow) {
    const ok = window.confirm(
      `Delete "${row.name}" (${row.identity})? This also removes its ledger account ${row.ledger.code}. An account with transaction history cannot be deleted — deactivate that one instead.`,
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

  const rows = q.data?.rows ?? []
  // Cash held and money at the bank, the two totals an owner reads first.
  // Inactive accounts are counted separately but still carry their balance.
  const summary = useMemo(() => BUSINESS_ACCOUNT_TYPES.map((type) => {
    const group = rows.filter((row) => normalizeBusinessAccountType(row.type) === type)
    return {
      type,
      accounts: group.length,
      active: group.filter((row) => row.isActive).length,
      balancePaisas: group.reduce((total, row) => total + BigInt(row.ledger.balancePaisas), 0n),
    }
  }), [rows])

  // The list is grouped by the only two money types there are. Everything a
  // business keeps money in sits under one of them, old accounts included.
  const groups = useMemo(() => BUSINESS_ACCOUNT_TYPES.map((type) => ({
    type,
    rows: rows.filter((row) => normalizeBusinessAccountType(row.type) === type),
  })).filter((group) => group.rows.length > 0), [rows])
  const unmanagedCount = rows.filter((row) => !row.linked).length

  const controls: RowControls = {
    canManage,
    editingId,
    rowBusy: updateMut.isPending || deleteMut.isPending,
    linkBusy: linkMut.isPending,
    saving: updateMut.isPending,
    onEdit: (row) => setEditingId(editingId === row.id ? null : row.id),
    onToggleActive: (row) => updateMut.mutate({ id: row.id, patch: { isActive: !row.isActive } }),
    onDelete: askDelete,
    onMoveType: askMoveType,
    onEnable: (row) => linkMut.mutate(row),
    onCancelEdit: () => setEditingId(null),
    onSubmitEdit: (row, patch) => updateMut.mutate({ id: row.id, patch }),
  }

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

      {/* One section per money type — Cash first, then Bank. */}
      {q.isLoading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-sm text-muted-foreground">Loading…</div>
      ) : groups.length ? (
        <div className="space-y-5">
          {unmanagedCount > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <span className="font-medium">
                {unmanagedCount} account{unmanagedCount === 1 ? '' : 's'} below came with your chart of
                accounts and {unmanagedCount === 1 ? 'is' : 'are'} not editable yet.
              </span>{' '}
              Choose “Enable management” to rename one, move it between Cash and Bank, or deactivate it.
              Its ledger code, its balance and its posted history stay exactly as they are.
            </div>
          )}
          {groups.map((group) => (
            <section key={group.type} className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <AccountTypeIcon type={group.type} className="size-4 text-foreground" />
                  {group.type}
                </h2>
                <span className="text-xs text-muted-foreground" data-num>
                  {group.rows.length} account{group.rows.length === 1 ? '' : 's'}
                </span>
              </div>
              <GroupTable rows={group.rows} controls={controls} />
              <GroupCards rows={group.rows} controls={controls} />
            </section>
          ))}
        </div>
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

/**
 * One money type's accounts as a table (desktop). The section header already
 * says which type these are, so there is no type column — what each row must
 * show is the name, the identity the business refers to it by, its ledger code
 * as the secondary accounting reference, its balance and its status.
 */
function GroupTable({ rows, controls }: { rows: BusinessAccountRow[]; controls: RowControls }) {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="p-3.5 text-left font-medium">Account</th>
            <th className="p-3.5 text-left font-medium">Holder / Bank / A/c#</th>
            <th className="p-3.5 text-left font-medium">Ledger</th>
            <th className="p-3.5 text-right font-medium">Balance</th>
            <th className="p-3.5 text-left font-medium">Status</th>
            {controls.canManage && <th className="p-3.5 text-right font-medium">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.id}>
              <tr className="border-b border-border/60 transition-colors last:border-0 hover:bg-accent/30">
                <td className="p-3.5">
                  <div className="font-medium text-foreground">{row.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <IdentityChip identity={row.identity} />
                  </div>
                  {row.linked ? (
                    <TypeReview
                      row={row}
                      canManage={controls.canManage}
                      busy={controls.rowBusy}
                      onMove={(type) => controls.onMoveType(row, type)}
                    />
                  ) : (
                    <UnmanagedNote
                      canManage={controls.canManage}
                      busy={controls.linkBusy}
                      onEnable={() => controls.onEnable(row)}
                    />
                  )}
                </td>
                <td className="p-3.5 text-xs text-muted-foreground">
                  <div>{row.accountHolder ?? '—'}</div>
                  <div>{row.bankName ?? ''}</div>
                  <div data-num>{row.accountNumber ?? ''}</div>
                </td>
                <td className="p-3.5 text-xs">
                  <div className="font-medium text-foreground" data-num>{row.ledger.code}</div>
                  <div className="text-muted-foreground">{row.ledger.name}</div>
                  <div className="text-muted-foreground">{row.ledger.category}</div>
                </td>
                <td className={`p-3.5 text-right font-semibold ${BigInt(row.ledger.balancePaisas) < 0n ? 'text-destructive' : 'text-foreground'}`} data-num>
                  {formatMoney(BigInt(row.ledger.balancePaisas))}
                </td>
                <td className="p-3.5">
                  <StatusBadge isActive={row.isActive} />
                </td>
                {controls.canManage && (
                  <td className="p-3.5">
                    <div className="flex items-center justify-end gap-1">
                      {row.linked && <ManagedRowActions row={row} controls={controls} />}
                    </div>
                  </td>
                )}
              </tr>
              {controls.canManage && row.linked && controls.editingId === row.id && (
                <tr className="border-b border-border/60 bg-muted/30">
                  <td colSpan={controls.canManage ? 6 : 5} className="p-3.5">
                    <AccountForm
                      initial={row}
                      submitting={controls.saving}
                      submitLabel="Save changes"
                      onCancel={controls.onCancelEdit}
                      onSubmit={(v) => controls.onSubmitEdit(row, v)}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The actions a managed row offers, bound to the shared handlers. */
function ManagedRowActions({ row, controls }: { row: BusinessAccountRow; controls: RowControls }) {
  return (
    <RowActions
      row={row}
      editing={controls.editingId === row.id}
      busy={controls.rowBusy}
      onEdit={() => controls.onEdit(row)}
      onToggleActive={() => controls.onToggleActive(row)}
      onDelete={() => controls.onDelete(row)}
    />
  )
}

/** The same accounts as stacked cards (mobile). */
function GroupCards({ rows, controls }: { rows: BusinessAccountRow[]; controls: RowControls }) {
  return (
    <div className="divide-y divide-border md:hidden">
      {rows.map((row) => (
        <div key={row.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-muted/35">
                <AccountTypeIcon type={row.type} className="size-5 text-foreground" />
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">{row.name}</div>
                <div className="mt-1"><IdentityChip identity={row.identity} /></div>
                {row.linked ? (
                  <TypeReview
                    row={row}
                    canManage={controls.canManage}
                    busy={controls.rowBusy}
                    onMove={(type) => controls.onMoveType(row, type)}
                  />
                ) : (
                  <UnmanagedNote
                    canManage={controls.canManage}
                    busy={controls.linkBusy}
                    onEnable={() => controls.onEnable(row)}
                  />
                )}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Balance</div>
              <div className={`font-semibold ${BigInt(row.ledger.balancePaisas) < 0n ? 'text-destructive' : 'text-foreground'}`} data-num>
                {formatMoney(BigInt(row.ledger.balancePaisas))}
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Ledger</div>
              <div className="font-medium text-foreground" data-num>
                {row.ledger.code} · {row.ledger.name}
              </div>
            </div>
            {row.createdAt && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Added</div>
                <div className="text-foreground" data-num>{formatTableDate(row.createdAt)}</div>
              </div>
            )}
            {row.accountNumber && (
              <div className="col-span-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">A/c #</div>
                <div className="text-foreground" data-num>{row.accountNumber}</div>
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
            <StatusBadge isActive={row.isActive} />
            {controls.canManage && row.linked && (
              <div className="flex items-center gap-1">
                <ManagedRowActions row={row} controls={controls} />
              </div>
            )}
          </div>
          {controls.canManage && row.linked && controls.editingId === row.id && (
            <div className="mt-3 border-t border-border pt-3">
              <AccountForm
                initial={row}
                submitting={controls.saving}
                submitLabel="Save changes"
                onCancel={controls.onCancelEdit}
                onSubmit={(v) => controls.onSubmitEdit(row, v)}
              />
            </div>
          )}
        </div>
      ))}
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
