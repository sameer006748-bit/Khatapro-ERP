'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { formatMoney } from '@/lib/format'
import { bizDate } from '@/lib/dates'
import { ArrowLeft, BookOpen, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEffect } from 'react'
import { motion } from 'framer-motion'

type Line = {
  lineId: string
  voucherId: string
  voucherType: string
  voucherDate: string
  memo: string | null
  debit: string
  credit: string
  runningBalance: string
}

const VOUCHER_BADGE: Record<string, string> = {
  JV: 'bg-sky-100 text-sky-700',
  OP: 'bg-violet-100 text-violet-700',
  RC: 'bg-emerald-100 text-emerald-700',
  PM: 'bg-amber-100 text-amber-700',
  CT: 'bg-slate-100 text-slate-700',
  PC: 'bg-rose-100 text-rose-700',
}

export function LedgerDrilldownView({ accountId }: { accountId: string }) {
  const router = useRouter()
  const params = useSearchParams()

  const q = useQuery<{
    account: {
      id: string
      code: string
      name: string
      category: { code: string; name: string; type: string }
      balanceCache: string
    }
    lines: Line[]
  }>({
    queryKey: ['ledger', accountId],
    queryFn: () => fetch(`/api/ledger/${accountId}`).then((r) => r.json()),
    enabled: !!accountId,
  })

  // When the user navigates back, strip ?ledger= from the URL.
  function back() {
    router.push('/')
  }

  if (!accountId) {
    return (
      <div className="card-3d p-8 text-center">
        <div className="grid place-items-center size-12 rounded-xl icon-3d-muted mx-auto mb-3">
          <BookOpen className="size-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-foreground font-medium">No account selected</p>
        <p className="text-xs text-muted-foreground mt-1">
          Open the Trial Balance and click an account to drill into its ledger.
        </p>
        <Button variant="outline" className="mt-4 press-sm" onClick={() => router.push('/')}>
          Go to Trial Balance
        </Button>
      </div>
    )
  }

  if (q.isLoading) {
    return <div className="card-3d p-8 text-sm text-muted-foreground">Loading ledger…</div>
  }

  if (q.isError || !q.data) {
    return (
      <div className="card-3d p-8 text-center">
        <p className="text-sm text-destructive">Failed to load ledger.</p>
        <Button variant="outline" className="mt-4 press-sm" onClick={back}>
          Back
        </Button>
      </div>
    )
  }

  const { account, lines } = q.data

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-6"
    >
      {/* Header */}
      <div>
        <button
          onClick={back}
          className="flex items-center text-xs text-muted-foreground hover:text-foreground mb-3 press-sm"
        >
          <ArrowLeft className="size-3.5 mr-1.5" /> Back
        </button>
        <div className="flex items-center gap-3">
          <span className="text-2xl font-semibold text-foreground tracking-tight" data-num>
            {account.code}
          </span>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
            {account.name}
          </h1>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs px-2 py-0.5 bg-muted text-foreground rounded-md">
            {account.category.name} · {account.category.type}
          </span>
          <span className="text-xs text-muted-foreground">Current cached balance:</span>
          <span className="text-xs font-medium text-foreground" data-num>
            {formatMoney(BigInt(account.balanceCache))}
          </span>
        </div>
      </div>

      {/* Lines */}
      {lines.length === 0 ? (
        <div className="card-3d p-8 text-center">
          <div className="grid place-items-center size-12 rounded-xl icon-3d-muted mx-auto mb-3">
            <FileText className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-foreground font-medium">No ledger entries yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Post a Journal Voucher affecting this account to see entries here.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block card-3d overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Entries</h2>
              <span className="text-xs text-muted-foreground" data-num>
                {lines.length} lines
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                    <th className="text-left p-3.5 font-medium">Date</th>
                    <th className="text-left p-3.5 font-medium">Type</th>
                    <th className="text-left p-3.5 font-medium">Memo</th>
                    <th className="text-right p-3.5 font-medium">Debit</th>
                    <th className="text-right p-3.5 font-medium">Credit</th>
                    <th className="text-right p-3.5 font-medium">Running Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr
                      key={l.lineId}
                      className="border-b border-border/60 last:border-0 hover:bg-accent/30 transition-colors"
                    >
                      <td className="p-3.5 text-xs text-foreground" data-num>
                        {bizDate(l.voucherDate)}
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium ${
                            VOUCHER_BADGE[l.voucherType] ?? 'bg-muted text-muted-foreground'
                          }`}
                          data-num
                        >
                          {l.voucherType}
                        </span>
                      </td>
                      <td className="p-3.5 text-xs text-muted-foreground">
                        {l.memo ?? '—'}
                      </td>
                      <td className="p-3.5 text-right text-foreground" data-num>
                        {BigInt(l.debit) > 0n ? formatMoney(BigInt(l.debit), false) : '—'}
                      </td>
                      <td className="p-3.5 text-right text-foreground" data-num>
                        {BigInt(l.credit) > 0n ? formatMoney(BigInt(l.credit), false) : '—'}
                      </td>
                      <td className="p-3.5 text-right font-medium text-foreground" data-num>
                        {formatMoney(BigInt(l.runningBalance), false)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {lines.map((l) => (
              <div key={l.lineId} className="card-3d p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium ${
                        VOUCHER_BADGE[l.voucherType] ?? 'bg-muted text-muted-foreground'
                      }`}
                      data-num
                    >
                      {l.voucherType}
                    </span>
                    <span className="text-xs text-muted-foreground" data-num>
                      {bizDate(l.voucherDate)}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Running
                    </div>
                    <div className="text-xs font-medium text-foreground" data-num>
                      {formatMoney(BigInt(l.runningBalance))}
                    </div>
                  </div>
                </div>
                {l.memo && (
                  <p className="text-xs text-muted-foreground mb-3">{l.memo}</p>
                )}
                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Debit</div>
                    <div className="text-sm text-foreground" data-num>
                      {BigInt(l.debit) > 0n ? formatMoney(BigInt(l.debit)) : '—'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Credit</div>
                    <div className="text-sm text-foreground" data-num>
                      {BigInt(l.credit) > 0n ? formatMoney(BigInt(l.credit)) : '—'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </motion.div>
  )
}
