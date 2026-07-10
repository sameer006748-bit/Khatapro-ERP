'use client'

import { useQuery } from '@tanstack/react-query'
import { formatMoney } from '@/lib/format'
import { BookOpen } from 'lucide-react'

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

const CATEGORY_COLORS: Record<string, string> = {
  ASSET: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  LIABILITY: 'bg-amber-50 text-amber-700 border-amber-200',
  EQUITY: 'bg-violet-50 text-violet-700 border-violet-200',
  INCOME: 'bg-sky-50 text-sky-700 border-sky-200',
  EXPENSE: 'bg-rose-50 text-rose-700 border-rose-200',
}

export function CoaView() {
  const q = useQuery<{ categories: Category[] }>({
    queryKey: ['coa'],
    queryFn: () => fetch('/api/setup/coa').then((r) => r.json()),
  })

  const total = q.data?.categories.reduce((acc, c) => acc + c.accounts.length, 0) ?? 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          Chart of Accounts
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
          Default Pakistani garments SMB CoA. Owner can add/edit more later (full editor arrives
          with Phase 2 — Opening Voucher posting requires the voucher engine first).
        </p>
      </div>

      {/* Category summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {q.data?.categories.map((c) => (
          <div key={c.id} className="card-3d card-3d-hover p-4">
            <div className="flex items-center justify-between">
              <span
                className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border font-medium ${
                  CATEGORY_COLORS[c.code] ?? 'bg-muted text-muted-foreground border-border'
                }`}
                data-num
              >
                {c.code}
              </span>
            </div>
            <div className="text-sm font-semibold text-foreground mt-2">{c.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5" data-num>
              {c.accounts.length} accounts
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block card-3d overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">All accounts</h2>
          <span className="text-xs text-muted-foreground" data-num>
            {total} total
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                <th className="text-left p-3.5 font-medium">Code</th>
                <th className="text-left p-3.5 font-medium">Name</th>
                <th className="text-left p-3.5 font-medium">Category</th>
                <th className="text-left p-3.5 font-medium">Flags</th>
                <th className="text-right p-3.5 font-medium">Balance (cache)</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.categories.flatMap((c) =>
                c.accounts.map((a) => (
                  <tr
                    key={a.id}
                    className="border-b border-border/60 last:border-0 hover:bg-accent/30 transition-colors"
                  >
                    <td className="p-3.5 font-medium text-foreground" data-num>
                      {a.code}
                    </td>
                    <td className="p-3.5 text-foreground">{a.name}</td>
                    <td className="p-3.5 text-xs">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-md border ${
                          CATEGORY_COLORS[c.code] ?? 'bg-muted text-muted-foreground border-border'
                        }`}
                      >
                        {c.name}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <div className="flex flex-wrap gap-1">
                        {a.isBusinessAccount && (
                          <span className="text-[10px] uppercase bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                            Business A/c
                          </span>
                        )}
                        {a.isPartyAccount && (
                          <span className="text-[10px] uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                            Party · {a.partyType}
                          </span>
                        )}
                        {!a.isActive && (
                          <span className="text-[10px] uppercase bg-destructive/10 text-destructive px-1.5 py-0.5 rounded font-medium">
                            Inactive
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5 text-right font-medium text-foreground" data-num>
                      {formatMoney(BigInt(a.balancePaisas))}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile: cards grouped by category */}
      <div className="md:hidden space-y-4">
        {q.data?.categories.map((c) => (
          <div key={c.id} className="card-3d overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border font-medium ${
                    CATEGORY_COLORS[c.code] ?? 'bg-muted text-muted-foreground border-border'
                  }`}
                  data-num
                >
                  {c.code}
                </span>
                <span className="font-semibold text-foreground text-sm">{c.name}</span>
              </div>
              <span className="text-xs text-muted-foreground" data-num>
                {c.accounts.length}
              </span>
            </div>
            <div className="divide-y divide-border/60">
              {c.accounts.map((a) => (
                <div key={a.id} className="p-3.5 flex items-center gap-3">
                  <div className="grid place-items-center size-9 rounded-lg icon-3d-muted shrink-0">
                    <BookOpen className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground" data-num>
                        {a.code}
                      </span>
                      <span className="text-sm text-foreground">{a.name}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {a.isBusinessAccount && (
                        <span className="text-[9px] uppercase bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                          Business
                        </span>
                      )}
                      {a.isPartyAccount && (
                        <span className="text-[9px] uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                          {a.partyType}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-muted-foreground" data-num>
                      {formatMoney(BigInt(a.balancePaisas))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
