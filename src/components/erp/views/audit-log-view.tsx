'use client'

import { useQuery } from '@tanstack/react-query'
import { bizFormat } from '@/lib/dates'
import { ScrollText } from 'lucide-react'

type Row = {
  id: string
  timestamp: string
  action: string
  entity: string
  entityId: string | null
  actorCategory: string
}

const ACTION_BADGE: Record<string, string> = {
  BOOTSTRAP_OWNER: 'bg-primary/10 text-primary',
  CREATE: 'bg-emerald-100 text-emerald-700',
  INVITE_USER: 'bg-sky-100 text-sky-700',
  UPDATE: 'bg-amber-100 text-amber-700',
  DELETE: 'bg-rose-100 text-rose-700',
  CANCEL: 'bg-rose-100 text-rose-700',
}

export function AuditLogView() {
  const q = useQuery<{ rows: Row[] }>({
    queryKey: ['audit'],
    queryFn: () => fetch('/api/audit-logs').then((r) => r.json()),
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          Audit Log
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
          Most recent 200 entries. Every mutating API call writes one row.
        </p>
      </div>

      {q.isLoading ? (
        <div className="card-3d p-8 text-sm text-muted-foreground">Loading…</div>
      ) : q.data?.rows.length ? (
        <>
          {/* Desktop table */}
          <div className="hidden md:block card-3d overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Entries</h2>
              <span className="text-xs text-muted-foreground" data-num>
                {q.data.rows.length}
              </span>
            </div>
            <div className="overflow-y-auto max-h-[70vh]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                    <th className="text-left p-3.5 font-medium">When (KHI)</th>
                    <th className="text-left p-3.5 font-medium">Action</th>
                    <th className="text-left p-3.5 font-medium">Entity</th>
                    <th className="text-left p-3.5 font-medium">Entity ID</th>
                    <th className="text-left p-3.5 font-medium">Actor</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.rows.map((r) => (
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
                          {r.action}
                        </span>
                      </td>
                      <td className="p-3.5 text-xs text-foreground" data-num>
                        {r.entity}
                      </td>
                      <td className="p-3.5 text-xs text-muted-foreground font-mono" data-num>
                        {r.entityId ?? '—'}
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
            {q.data.rows.map((r) => (
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
                        {r.action}
                      </span>
                      <div className="text-xs text-muted-foreground mt-1" data-num>
                        {bizFormat(r.timestamp, 'datetimes')}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground" data-num>
                    {r.entity}
                  </span>
                </div>
                <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
                  Actor: {r.actorCategory}
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
