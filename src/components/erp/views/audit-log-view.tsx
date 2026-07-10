'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { bizFormat } from '@/lib/dates'

type Row = {
  id: string
  timestamp: string
  action: string
  entity: string
  entityId: string | null
  userId: string | null
  details: string | null
}

export function AuditLogView() {
  const q = useQuery<{ rows: Row[] }>({
    queryKey: ['audit'],
    queryFn: () => fetch('/api/audit-logs').then((r) => r.json()),
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Most recent 200 entries. Every mutating API call writes one row.
        </p>
      </div>
      <Card className="bg-card">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-base">
            Entries <span className="text-xs text-muted-foreground ml-2" data-num>{q.data?.rows.length ?? 0}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : q.data?.rows.length ? (
            <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="text-left p-3">When (KHI)</th>
                    <th className="text-left p-3">Action</th>
                    <th className="text-left p-3">Entity</th>
                    <th className="text-left p-3">Entity ID</th>
                    <th className="text-left p-3">User ID</th>
                    <th className="text-left p-3">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-accent/20">
                      <td className="p-3 text-xs" data-num>{bizFormat(r.timestamp, 'datetimes')}</td>
                      <td className="p-3">
                        <span className="text-xs uppercase tracking-wider bg-primary/10 text-primary px-2 py-0.5" data-num>
                          {r.action}
                        </span>
                      </td>
                      <td className="p-3 text-xs" data-num>{r.entity}</td>
                      <td className="p-3 text-xs text-muted-foreground" data-num>{r.entityId ?? '—'}</td>
                      <td className="p-3 text-xs text-muted-foreground" data-num>{r.userId ?? '—'}</td>
                      <td className="p-3 text-xs text-muted-foreground font-mono max-w-[420px] truncate">
                        {r.details ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 text-sm text-muted-foreground">No audit entries yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
