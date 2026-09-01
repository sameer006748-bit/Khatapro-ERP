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

function actionLabel(row: Row) {
  return `${row.entity.replaceAll('_', ' ')} ${row.action.replaceAll('_', ' ')}`.replace(/\b\w/g, letter => letter.toUpperCase())
}

function referenceLabel(row: Row) {
  const details = row.details ?? {}
  for (const key of ['name', 'voucher_no', 'payment_no', 'receipt_no', 'replacement_no', 'ledgerCode']) {
    if (typeof details[key] === 'string' || typeof details[key] === 'number') return String(details[key])
  }
  return row.entity.replaceAll('_', ' ')
}

function DetailSummary({ details }: { details: Record<string, unknown> | null }) {
  const items = Object.entries(details ?? {}).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)).slice(0, 4)
  if (!items.length) return null
  return <details className="mt-1 text-[10px] text-muted-foreground"><summary className="cursor-pointer hover:text-foreground">View details</summary><dl className="mt-1 grid gap-1 rounded border border-border bg-muted/25 p-2">{items.map(([key, value]) => <div key={key} className="flex justify-between gap-3"><dt className="capitalize">{key.replaceAll('_', ' ')}</dt><dd className="break-all text-right text-foreground">{String(value)}</dd></div>)}</dl></details>
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
      {q.data?.rows?.length ? <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-card p-3"><select aria-label="Filter by action" value={action} onChange={event => setAction(event.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-xs"><option value="all">All actions</option>{actions.map(item => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select><select aria-label="Filter by record type" value={entity} onChange={event => setEntity(event.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-xs"><option value="all">All records</option>{entities.map(item => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></div> : null}

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
                          className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium ${
                            ACTION_BADGE[r.action] ?? 'bg-muted text-muted-foreground'
                          }`}
                          data-num
                        >
                          {actionLabel(r)}
                        </span>
                      </td>
                      <td className="p-3.5 text-xs text-foreground">
                        <div className="font-medium capitalize">{referenceLabel(r)}</div><DetailSummary details={r.details} />
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
                        className={`inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium ${
                          ACTION_BADGE[r.action] ?? 'bg-muted text-muted-foreground'
                        }`}
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
                  Actor: {r.actorCategory}<DetailSummary details={r.details} />
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
