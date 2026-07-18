'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatMoney } from '@/lib/format'
import { bizDate } from '@/lib/dates'
import { Search, ChevronDown, ChevronRight, BookOpen, ArrowLeft } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { MeUser } from '@/components/erp/erp-app'

type DayBookRow = {
  voucherId: string; voucherNo: string | null; voucherType: string; voucherDate: string
  memo: string | null; totalDebit: string; totalCredit: string; isCancelled: boolean
  postedAt: string; postedBy: string | null; referenceType: string | null; referenceId: string | null
  sourceLabel: string
  lines: Array<{ lineId: string; accountId: string; accountCode: string; accountName: string; debit: string; credit: string; memo: string | null }>
}

const TYPE_BADGE: Record<string, string> = {
  JV: 'bg-violet-50 text-violet-700 border-violet-200',
  OP: 'bg-sky-50 text-sky-700 border-sky-200',
  RC: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PM: 'bg-amber-50 text-amber-700 border-amber-200',
  CT: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  PC: 'bg-orange-50 text-orange-700 border-orange-200',
  SI: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  SR: 'bg-rose-50 text-rose-700 border-rose-200',
  PU: 'bg-amber-50 text-amber-700 border-amber-200',
  PR: 'bg-rose-50 text-rose-700 border-rose-200',
  EX: 'bg-red-50 text-red-700 border-red-200',
  RP: 'bg-violet-50 text-violet-700 border-violet-200',
}

export function DayBookView({ user, onSelectVoucher }: { user: MeUser; onSelectVoucher?: (id: string) => void }) {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [voucherType, setVoucherType] = useState('all')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const params = new URLSearchParams()
  if (fromDate) params.set('fromDate', fromDate)
  if (toDate) params.set('toDate', toDate)
  if (voucherType !== 'all') params.set('voucherType', voucherType)

  const q = useQuery<{ rows: DayBookRow[] }>({
    queryKey: ['day-book', fromDate, toDate, voucherType],
    queryFn: () => fetch(`/api/day-book?${params.toString()}`).then(r => r.json()),
  })

  const rows = q.data?.rows ?? []
  const filtered = useMemo(() => {
    if (!search) return rows
    const s = search.toLowerCase()
    return rows.filter(r =>
      (r.voucherNo ?? '').toLowerCase().includes(s) ||
      (r.memo ?? '').toLowerCase().includes(s) ||
      r.sourceLabel.toLowerCase().includes(s) ||
      r.voucherType.toLowerCase().includes(s)
    )
  }, [rows, search])

  function toggleExpand(id: string) {
    setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  const totalDebit = filtered.reduce((s, r) => s + BigInt(r.totalDebit), 0n)
  const totalCredit = filtered.reduce((s, r) => s + BigInt(r.totalCredit), 0n)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Day Book</h1>
        <p className="text-xs text-muted-foreground mt-0.5">All posted vouchers — expand any row to see its lines</p>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div><Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} placeholder="From" className="h-9 bg-background text-sm" data-num /></div>
        <div><Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} placeholder="To" className="h-9 bg-background text-sm" data-num /></div>
        <Select value={voucherType} onValueChange={setVoucherType}>
          <SelectTrigger className="h-9 bg-background text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="JV">Journal Voucher</SelectItem>
            <SelectItem value="RC">Receipt Voucher</SelectItem>
            <SelectItem value="PM">Payment Voucher</SelectItem>
            <SelectItem value="CT">Contra Entry</SelectItem>
            <SelectItem value="EX">Expense Batch</SelectItem>
            <SelectItem value="SI">Sale Invoice</SelectItem>
            <SelectItem value="SR">Sales Return</SelectItem>
            <SelectItem value="PU">Purchase</SelectItem>
            <SelectItem value="PR">Purchase Return</SelectItem>
            <SelectItem value="OP">Opening Balance</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="h-9 bg-background pl-8 text-sm" /></div>
      </div>

      {/* Summary */}
      <div className="flex flex-wrap gap-3 text-xs">
        <div className="border border-border rounded-lg bg-card px-3 py-1.5"><span className="text-muted-foreground">Entries: </span><span className="font-medium" data-num>{filtered.length}</span></div>
        <div className="border border-border rounded-lg bg-card px-3 py-1.5"><span className="text-muted-foreground">Total Debit: </span><span className="font-medium" data-num>{formatMoney(totalDebit, false)}</span></div>
        <div className="border border-border rounded-lg bg-card px-3 py-1.5"><span className="text-muted-foreground">Total Credit: </span><span className="font-medium" data-num>{formatMoney(totalCredit, false)}</span></div>
      </div>

      {q.isLoading ? (
        <div className="border border-border rounded-lg bg-card divide-y divide-border/40" role="status" aria-label="Loading vouchers">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="flex items-center gap-3 px-3 py-3 animate-pulse">
              <div className="h-3 w-16 rounded bg-muted" />
              <div className="h-3 flex-1 rounded bg-muted" />
              <div className="h-3 w-20 rounded bg-muted" />
            </div>
          ))}
        </div>
      )
      : q.isError ? <div className="text-center py-8"><p className="text-sm text-destructive">Failed to load vouchers.</p><button className="mt-2 text-sm text-primary hover:underline" onClick={() => q.refetch()}>Retry</button></div>
      : filtered.length === 0 ? <div className="text-center py-8"><BookOpen className="size-8 text-muted-foreground mx-auto mb-2 opacity-50" /><p className="text-sm text-muted-foreground">No vouchers for this filter.</p></div>
      : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block border border-border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-3 py-2 font-medium w-8"></th>
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-left px-3 py-2 font-medium">Voucher No</th>
                  <th className="text-left px-3 py-2 font-medium">Source</th>
                  <th className="text-left px-3 py-2 font-medium">Narration</th>
                  <th className="text-right px-3 py-2 font-medium">Debit</th>
                  <th className="text-right px-3 py-2 font-medium">Credit</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <VoucherRow key={r.voucherId} row={r} expanded={expanded.has(r.voucherId)} onToggle={() => toggleExpand(r.voucherId)} onSelect={onSelectVoucher} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filtered.map(r => (
              <MobileVoucherCard key={r.voucherId} row={r} expanded={expanded.has(r.voucherId)} onToggle={() => toggleExpand(r.voucherId)} onSelect={onSelectVoucher} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function VoucherRow({ row, expanded, onToggle, onSelect }: { row: DayBookRow; expanded: boolean; onToggle: () => void; onSelect?: (id: string) => void }) {
  return (
    <>
      <tr className={`border-b border-border/40 last:border-0 hover:bg-muted/20 ${row.isCancelled ? 'opacity-50' : ''}`}>
        <td className="px-3 py-2 text-center">
          <button onClick={onToggle} className="text-muted-foreground hover:text-foreground press-sm">
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground" data-num>{bizDate(row.voucherDate)}</td>
        <td className="px-3 py-2 font-medium" data-num>{row.voucherNo ?? '—'}</td>
        <td className="px-3 py-2"><span className={`text-[9px] uppercase px-1.5 py-0.5 rounded border font-medium ${TYPE_BADGE[row.voucherType] ?? 'bg-muted text-muted-foreground'}`}>{row.sourceLabel}</span></td>
        <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px] truncate" title={row.memo ?? ''}>{row.memo ?? '—'}</td>
        <td className="px-3 py-2 text-right" data-num>{formatMoney(BigInt(row.totalDebit), false)}</td>
        <td className="px-3 py-2 text-right" data-num>{formatMoney(BigInt(row.totalCredit), false)}</td>
        <td className="px-3 py-2">{row.isCancelled ? <span className="text-[9px] uppercase bg-red-50 text-red-700 px-1.5 py-0.5 rounded border border-red-200">Cancelled</span> : <span className="text-[9px] uppercase bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200">Posted</span>}</td>
      </tr>
      <AnimatePresence>
        {expanded && (
          <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="bg-muted/20">
            <td colSpan={8} className="px-6 py-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Voucher Lines</span>
                  {onSelect && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onSelect(row.voucherId)}>Open Detail →</Button>}
                </div>
                <table className="w-full text-xs">
                  <thead><tr className="text-[9px] uppercase text-muted-foreground border-b border-border"><th className="text-left py-1 font-medium">Account</th><th className="text-left py-1 font-medium">Description</th><th className="text-right py-1 font-medium">Debit</th><th className="text-right py-1 font-medium">Credit</th></tr></thead>
                  <tbody>
                    {row.lines.map(l => (
                      <tr key={l.lineId} className="border-b border-border/30">
                        <td className="py-1.5"><span data-num>{l.accountCode}</span> · {l.accountName}</td>
                        <td className="py-1.5 text-muted-foreground">{l.memo ?? '—'}</td>
                        <td className="py-1.5 text-right" data-num>{BigInt(l.debit) > 0n ? formatMoney(BigInt(l.debit), false) : '—'}</td>
                        <td className="py-1.5 text-right" data-num>{BigInt(l.credit) > 0n ? formatMoney(BigInt(l.credit), false) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </td>
          </motion.tr>
        )}
      </AnimatePresence>
    </>
  )
}

function MobileVoucherCard({ row, expanded, onToggle, onSelect }: { row: DayBookRow; expanded: boolean; onToggle: () => void; onSelect?: (id: string) => void }) {
  return (
    <div className={`border border-border rounded-lg bg-card p-3 ${row.isCancelled ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-2 mb-2" onClick={onToggle}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded border font-medium ${TYPE_BADGE[row.voucherType] ?? 'bg-muted text-muted-foreground'}`}>{row.sourceLabel}</span>
            {row.isCancelled && <span className="text-[9px] uppercase bg-red-50 text-red-700 px-1.5 py-0.5 rounded border border-red-200">Cancelled</span>}
          </div>
          <div className="font-medium text-foreground text-sm" data-num>{row.voucherNo ?? '—'}</div>
          <div className="text-[10px] text-muted-foreground" data-num>{bizDate(row.voucherDate)}</div>
          {row.memo && <div className="text-xs text-muted-foreground mt-1 truncate">{row.memo}</div>}
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs font-medium" data-num>{formatMoney(BigInt(row.totalDebit), false)}</div>
          <div className="text-[9px] text-muted-foreground">Dr / Cr</div>
        </div>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-2 pt-2 border-t border-border space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Lines</div>
              {row.lines.map(l => (
                <div key={l.lineId} className="flex items-center justify-between text-xs py-0.5">
                  <div className="flex-1 min-w-0"><span data-num>{l.accountCode}</span> · <span className="text-muted-foreground">{l.accountName}</span></div>
                  <div className="text-right shrink-0 ml-2" data-num>{BigInt(l.debit) > 0n ? `Dr ${formatMoney(BigInt(l.debit), false)}` : BigInt(l.credit) > 0n ? `Cr ${formatMoney(BigInt(l.credit), false)}` : '—'}</div>
                </div>
              ))}
              {onSelect && <Button variant="ghost" size="sm" className="h-7 text-xs w-full mt-2" onClick={() => onSelect(row.voucherId)}>Open Detail →</Button>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
