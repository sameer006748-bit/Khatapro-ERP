'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { formatMoney } from '@/lib/format'
import { CheckCircle2, AlertCircle, ArrowRight, Scale } from 'lucide-react'

type Row = {
  accountId: string
  accountCode: string
  accountName: string
  categoryCode: string
  categoryName: string
  categoryType: string
  totalDebit: string
  totalCredit: string
  balance: string
}

const CATEGORY_COLORS: Record<string, string> = {
  ASSET: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  LIABILITY: 'bg-amber-50 text-amber-700 border-amber-200',
  EQUITY: 'bg-violet-50 text-violet-700 border-violet-200',
  INCOME: 'bg-sky-50 text-sky-700 border-sky-200',
  EXPENSE: 'bg-rose-50 text-rose-700 border-rose-200',
}

export function TrialBalanceView() {
  const router = useRouter()
  const q = useQuery<{
    rows: Row[]
    grandDebit: string
    grandCredit: string
    isBalanced: boolean
  }>({
    queryKey: ['trial-balance'],
    queryFn: () => fetch('/api/trial-balance').then((r) => r.json()),
  })

  const nonZeroRows = (q.data?.rows ?? []).filter(
    (r) => BigInt(r.totalDebit) > 0n || BigInt(r.totalCredit) > 0n,
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          Trial Balance
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
          Aggregate debit/credit per active account. Click any account to drill into its ledger.
          Grand totals must match (debit = credit) — that&apos;s the double-entry invariant.
        </p>
      </div>

      {/* Balance status banner */}
      {q.data && (
        <div
          className={`card-3d p-5 ${
            q.data.isBalanced ? 'border-primary/40' : 'border-destructive/40'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`grid place-items-center size-10 rounded-xl ${
                q.data.isBalanced ? 'icon-3d' : 'bg-destructive/10'
              }`}
            >
              {q.data.isBalanced ? (
                <CheckCircle2 className="size-5 text-primary-foreground" />
              ) : (
                <AlertCircle className="size-5 text-destructive" />
              )}
            </div>
            <div className="flex-1">
              <div
                className={`text-sm font-semibold ${
                  q.data.isBalanced ? 'text-primary' : 'text-destructive'
                }`}
              >
                {q.data.isBalanced ? 'Balanced' : 'Out of balance'}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Total Debit ={' '}
                <span className="font-medium text-foreground" data-num>
                  {formatMoney(BigInt(q.data.grandDebit))}
                </span>{' '}
                · Total Credit ={' '}
                <span className="font-medium text-foreground" data-num>
                  {formatMoney(BigInt(q.data.grandCredit))}
                </span>
              </div>
            </div>
            <Scale className="size-5 text-muted-foreground hidden sm:block" />
          </div>
        </div>
      )}

      {q.isLoading ? (
        <div className="card-3d p-8 text-sm text-muted-foreground">Loading…</div>
      ) : nonZeroRows.length === 0 ? (
        <div className="card-3d p-8 text-center">
          <div className="grid place-items-center size-12 rounded-xl icon-3d-muted mx-auto mb-3">
            <Scale className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-foreground font-medium">No postings yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Post a Journal Voucher or an Opening Balance to populate the Trial Balance.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block card-3d overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Accounts</h2>
              <span className="text-xs text-muted-foreground" data-num>
                {nonZeroRows.length} active
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                    <th className="text-left p-3.5 font-medium">Code</th>
                    <th className="text-left p-3.5 font-medium">Account</th>
                    <th className="text-left p-3.5 font-medium">Category</th>
                    <th className="text-right p-3.5 font-medium">Debit</th>
                    <th className="text-right p-3.5 font-medium">Credit</th>
                    <th className="text-right p-3.5 font-medium">Balance</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {nonZeroRows.map((r) => (
                    <tr
                      key={r.accountId}
                      onClick={() => router.push(`/?ledger=${r.accountId}`)}
                      className="border-b border-border/60 last:border-0 hover:bg-accent/30 transition-colors cursor-pointer"
                    >
                      <td className="p-3.5 font-medium text-foreground" data-num>
                        {r.accountCode}
                      </td>
                      <td className="p-3.5 text-foreground">{r.accountName}</td>
                      <td className="p-3.5 text-xs">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-md border ${
                            CATEGORY_COLORS[r.categoryCode] ?? 'bg-muted text-muted-foreground border-border'
                          }`}
                        >
                          {r.categoryName}
                        </span>
                      </td>
                      <td className="p-3.5 text-right text-foreground" data-num>
                        {BigInt(r.totalDebit) > 0n ? formatMoney(BigInt(r.totalDebit), false) : '—'}
                      </td>
                      <td className="p-3.5 text-right text-foreground" data-num>
                        {BigInt(r.totalCredit) > 0n ? formatMoney(BigInt(r.totalCredit), false) : '—'}
                      </td>
                      <td className="p-3.5 text-right font-medium text-foreground" data-num>
                        {formatMoney(BigInt(r.balance), false)}
                      </td>
                      <td className="p-3.5 text-center text-muted-foreground">
                        <ArrowRight className="size-3.5" />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30">
                    <td colSpan={3} className="p-3.5 text-xs uppercase tracking-wider text-muted-foreground font-medium">
                      Grand totals
                    </td>
                    <td className="p-3.5 text-right font-semibold text-foreground" data-num>
                      {formatMoney(BigInt(q.data?.grandDebit ?? '0'))}
                    </td>
                    <td className="p-3.5 text-right font-semibold text-foreground" data-num>
                      {formatMoney(BigInt(q.data?.grandCredit ?? '0'))}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {nonZeroRows.map((r) => (
              <button
                key={r.accountId}
                onClick={() => router.push(`/?ledger=${r.accountId}`)}
                className="card-3d card-3d-hover p-4 w-full text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border font-medium shrink-0 ${
                        CATEGORY_COLORS[r.categoryCode] ?? 'bg-muted text-muted-foreground border-border'
                      }`}
                      data-num
                    >
                      {r.accountCode}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{r.accountName}</div>
                      <div className="text-xs text-muted-foreground">{r.categoryName}</div>
                    </div>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                </div>
                <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Debit</div>
                    <div className="text-sm text-foreground" data-num>
                      {BigInt(r.totalDebit) > 0n ? formatMoney(BigInt(r.totalDebit)) : '—'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Credit</div>
                    <div className="text-sm text-foreground" data-num>
                      {BigInt(r.totalCredit) > 0n ? formatMoney(BigInt(r.totalCredit)) : '—'}
                    </div>
                  </div>
                </div>
              </button>
            ))}
            <div className="card-3d p-4 bg-muted/30 grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Debit</div>
                <div className="font-semibold text-foreground" data-num>
                  {formatMoney(BigInt(q.data?.grandDebit ?? '0'))}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Credit</div>
                <div className="font-semibold text-foreground" data-num>
                  {formatMoney(BigInt(q.data?.grandCredit ?? '0'))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
