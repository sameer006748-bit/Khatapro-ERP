'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { bizFormat } from '@/lib/dates'
import { ScrollText } from 'lucide-react'
import { apiFetchJson } from '@/lib/api-client'
import { PageHeader } from '@/components/erp/page-header'

type Row = {
  id: string
  timestamp: string
  action: string
  entity: string
  entityId: string | null
  actorCategory: string
  details: Record<string, unknown> | null
}

const ACTION_BADGE: Record<string, string> = {
  BOOTSTRAP_OWNER: 'bg-primary/10 text-primary',
  CREATE: 'bg-emerald-100 text-emerald-700',
  INVITE_USER: 'bg-sky-100 text-sky-700',
  UPDATE: 'bg-amber-100 text-amber-700',
  DELETE: 'bg-rose-100 text-rose-700',
  CANCEL: 'bg-rose-100 text-rose-700',
}

/**
 * Plain-English names for the account classification entries. The recorded
 * action and record type are technical (`ACCOUNT_CATEGORY_REACTIVATE` on
 * `account_category`), so the log shows these labels instead.
 */
const ACTION_LABELS: Record<string, string> = {
  ACCOUNT_CATEGORY_CREATE: 'Category created',
  ACCOUNT_CATEGORY_RENAME: 'Category renamed',
  ACCOUNT_CATEGORY_DEACTIVATE: 'Category deactivated',
  ACCOUNT_CATEGORY_REACTIVATE: 'Category reactivated',
  ACCOUNT_CATEGORY_DELETE: 'Category deleted',
  ACCOUNT_SUBCATEGORY_CREATE: 'Subcategory created',
  ACCOUNT_SUBCATEGORY_RENAME: 'Subcategory renamed',
  ACCOUNT_SUBCATEGORY_DEACTIVATE: 'Subcategory deactivated',
  ACCOUNT_SUBCATEGORY_REACTIVATE: 'Subcategory reactivated',
  ACCOUNT_SUBCATEGORY_DELETE: 'Subcategory deleted',
  MANUAL_LEDGER_ACCOUNT_CREATE: 'Account created',
  MANUAL_LEDGER_ACCOUNT_RENAME: 'Account renamed',
  MANUAL_LEDGER_ACCOUNT_CLASSIFY: 'Account classification changed',
  MANUAL_LEDGER_ACCOUNT_ACTIVATE: 'Account reactivated',
  MANUAL_LEDGER_ACCOUNT_DEACTIVATE: 'Account deactivated',
}

const ENTITY_LABELS: Record<string, string> = {
  account_category: 'Category',
  account_subcategory: 'Subcategory',
  manual_ledger_account: 'Ledger account',
}

function actionLabel(row: Row) {
  return ACTION_LABELS[row.action]
    ?? `${row.entity.replaceAll('_', ' ')} ${row.action.replaceAll('_', ' ')}`.replace(/\b\w/g, letter => letter.toUpperCase())
}

function entityLabel(entity: string) {
  return ENTITY_LABELS[entity] ?? entity.replaceAll('_', ' ')
}

/** Create and delete keep their usual colours; the rest read as an update. */
function badgeClass(action: string) {
  if (ACTION_BADGE[action]) return ACTION_BADGE[action]
  if (action.endsWith('_CREATE')) return ACTION_BADGE.CREATE
  if (action.endsWith('_DELETE')) return ACTION_BADGE.DELETE
  if (ACTION_LABELS[action]) return ACTION_BADGE.UPDATE
  return 'bg-muted text-muted-foreground'
}

/** The before/after snapshots the classification entries record. */
function snapshots(details: Record<string, unknown> | null) {
  const pick = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null)
  return { before: pick(details?.before), after: pick(details?.after) }
}

function readableValue(value: unknown, key: string) {
  if (typeof value === 'boolean') return key === 'isActive' ? (value ? 'Active' : 'Inactive') : (value ? 'Yes' : 'No')
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return null
}

/**
 * What changed, read off the snapshots. Only fields that mean something to an
 * accountant are shown — internal identifiers and structural columns are not.
 */
function snapshotChanges(row: Row) {
  const { before, after } = snapshots(row.details)
  if (!before && !after) return []
  const fields = row.entity === 'manual_ledger_account'
    ? [{ key: 'code', label: 'Account code' }, { key: 'name', label: 'Name' }, { key: 'isActive', label: 'Status' }]
    : [{ key: 'name', label: 'Name' }, { key: 'isActive', label: 'Status' }]
  const changes: Array<{ label: string; value: string }> = []
  for (const field of fields) {
    const from = readableValue(before?.[field.key], field.key)
    const to = readableValue(after?.[field.key], field.key)
    if (from === null && to === null) continue
    if (to === null) changes.push({ label: field.label, value: from! })
    else if (from === null || from === to) changes.push({ label: field.label, value: to })
    else changes.push({ label: field.label, value: `${from} → ${to}` })
  }
  return changes
}

function referenceLabel(row: Row) {
  const details = row.details ?? {}
  for (const key of ['name', 'voucher_no', 'payment_no', 'receipt_no', 'replacement_no', 'ledgerCode']) {
    if (typeof details[key] === 'string' || typeof details[key] === 'number') return String(details[key])
  }
  const { before, after } = snapshots(row.details)
  const name = after?.name ?? before?.name
  if (typeof name === 'string' && name.trim()) return name
  return entityLabel(row.entity)
}

function DetailSummary({ row }: { row: Row }) {
  const changes = snapshotChanges(row)
  const items = changes.length ? changes : Object.entries(row.details ?? {})
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 4)
    .map(([key, value]) => ({ label: key.replaceAll('_', ' '), value: String(value) }))
  if (!items.length) return null
  return <details className="mt-1 text-[10px] text-muted-foreground"><summary className="cursor-pointer hover:text-foreground">View details</summary><dl className="mt-1 grid gap-1 rounded border border-border bg-muted/25 p-2">{items.map(item => <div key={item.label} className="flex justify-between gap-3"><dt className="capitalize">{item.label}</dt><dd className="break-all text-right text-foreground">{item.value}</dd></div>)}</dl></details>
}

export function AuditLogView() {
  const [action, setAction] = useState('all')
  const [entity, setEntity] = useState('all')
  const q = useQuery<{ rows: Row[] }>({
    queryKey: ['audit'],
    queryFn: ({ signal }) => apiFetchJson('/api/audit-logs', { signal }),
    retry: false,
  })
  const rows = useMemo(() => (q.data?.rows ?? []).filter(row => (action === 'all' || row.action === action) && (entity === 'all' || row.entity === entity)), [q.data?.rows, action, entity])
  const actions = [...new Set((q.data?.rows ?? []).map(row => row.action))]
  const entities = [...new Set((q.data?.rows ?? []).map(row => row.entity))]

  return (
    <div className="space-y-6">
      <PageHeader title="Audit Log" description="Review the most recent 200 recorded business changes and actions." />
      {q.data?.rows?.length ? <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-card p-3"><select aria-label="Filter by action" value={action} onChange={event => setAction(event.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-xs"><option value="all">All actions</option>{actions.map(item => <option key={item} value={item}>{ACTION_LABELS[item] ?? item.replaceAll('_', ' ')}</option>)}</select><select aria-label="Filter by record type" value={entity} onChange={event => setEntity(event.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-xs"><option value="all">All records</option>{entities.map(item => <option key={item} value={item}>{entityLabel(item)}</option>)}</select></div> : null}

      {q.isLoading ? (
        <div className="card-3d p-8 text-sm text-muted-foreground">Loading…</div>
      ) : q.isError ? (
        <div className="card-3d p-8 text-center">
          <p className="text-sm text-destructive mb-3">Unable to load activity history.</p>
          <button className="text-sm font-medium text-primary hover:underline" onClick={() => q.refetch()}>Retry</button>
        </div>
      ) : q.data?.rows?.length ? (
        <>
          {/* Desktop table */}
          <div className="hidden md:block card-3d overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Entries</h2>
              <span className="text-xs text-muted-foreground" data-num>
                {rows.length}
              </span>
            </div>
            <div className="overflow-y-auto max-h-[70vh]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                    <th className="text-left p-3.5 font-medium">When (KHI)</th>
                    <th className="text-left p-3.5 font-medium">Action</th>
                    <th className="text-left p-3.5 font-medium">Record</th>
                    <th className="text-left p-3.5 font-medium">Actor</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border/60 last:border-0 hover:bg-accent/30 transition-colors"
                    >
                      <td className="p-3.5 text-xs text-foreground" data-num>
                        {bizFormat(r.timestamp, 'datetimes')}
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium ${badgeClass(r.action)}`}
                          data-num
                        >
                          {actionLabel(r)}
                        </span>
                      </td>
                      <td className="p-3.5 text-xs text-foreground">
                        <div className="font-medium capitalize">{referenceLabel(r)}</div><DetailSummary row={r} />
                      </td>
                      <td className="p-3.5 text-xs text-muted-foreground">
                        {r.actorCategory}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="card-3d p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="grid place-items-center size-8 rounded-lg icon-3d-muted shrink-0">
                      <ScrollText className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <span
                        className={`inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium ${badgeClass(r.action)}`}
                        data-num
                      >
                        {actionLabel(r)}
                      </span>
                      <div className="text-xs text-muted-foreground mt-1" data-num>
                        {bizFormat(r.timestamp, 'datetimes')}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs capitalize text-muted-foreground">
                    {referenceLabel(r)}
                  </span>
                </div>
                <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
                  Actor: {r.actorCategory}<DetailSummary row={r} />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="card-3d p-8 text-center">
          <div className="grid place-items-center size-12 rounded-xl icon-3d-muted mx-auto mb-3">
            <ScrollText className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No audit entries yet.</p>
        </div>
      )}
    </div>
  )
}
