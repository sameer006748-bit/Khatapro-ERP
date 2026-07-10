'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoney } from '@/lib/format'

type AccountRow = {
  id: string
  code: string
  name: string
  isActive: boolean
  isBusinessAccount: boolean
  isPartyAccount: boolean
  partyType: string | null
  balancePaisas: string
}
type Category = {
  id: string
  code: string
  name: string
  type: string
  accounts: AccountRow[]
}

export function CoaView() {
  const q = useQuery<{ categories: Category[] }>({
    queryKey: ['coa'],
    queryFn: () => fetch('/api/setup/coa').then((r) => r.json()),
  })

  const total = q.data?.categories.reduce(
    (acc, c) => acc + c.accounts.length,
    0,
  ) ?? 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Chart of Accounts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Default Pakistani garments SMB CoA. Owner can add/edit more later (full editor arrives
          with Phase 2 — Opening Voucher posting requires the voucher engine first).
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {q.data?.categories.map((c) => (
          <Card key={c.id} className="bg-card">
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground" data-num>{c.code}</div>
              <div className="text-sm font-medium">{c.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5" data-num>{c.accounts.length} accounts</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-card">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-base flex items-center justify-between">
            <span>All accounts</span>
            <span className="text-xs text-muted-foreground" data-num>{total} total</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="text-left p-3">Code</th>
                    <th className="text-left p-3">Name</th>
                    <th className="text-left p-3">Category</th>
                    <th className="text-left p-3">Flags</th>
                    <th className="text-right p-3">Balance (cache)</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data?.categories.flatMap((c) =>
                    c.accounts.map((a) => (
                      <tr key={a.id} className="border-b border-border/50 hover:bg-accent/20">
                        <td className="p-3" data-num>{a.code}</td>
                        <td className="p-3">{a.name}</td>
                        <td className="p-3 text-xs">
                          <div className="font-medium">{c.name}</div>
                          <div className="text-muted-foreground" data-num>{c.code}</div>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            {a.isBusinessAccount && (
                              <span className="text-[10px] uppercase bg-primary/10 text-primary px-1.5 py-0.5">
                                Business A/c
                              </span>
                            )}
                            {a.isPartyAccount && (
                              <span className="text-[10px] uppercase bg-chart-2/20 text-chart-2 px-1.5 py-0.5">
                                Party · {a.partyType}
                              </span>
                            )}
                            {!a.isActive && (
                              <span className="text-[10px] uppercase bg-destructive/15 text-destructive px-1.5 py-0.5">
                                Inactive
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-right" data-num>
                          {formatMoney(BigInt(a.balancePaisas))}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
