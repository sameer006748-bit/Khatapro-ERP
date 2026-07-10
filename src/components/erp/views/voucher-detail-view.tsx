'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatMoney } from '@/lib/format'
import { bizDate } from '@/lib/dates'
import { ArrowLeft, RotateCcw, AlertCircle, CheckCircle2, X } from 'lucide-react'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'

type Voucher = {
  id: string; voucherNo: string | null; voucherType: string; voucherDate: string
  memo: string | null; isCancelled: boolean; postedAt: string; postedBy: string | null
  totalDebit: string; totalCredit: string
  referenceType: string | null; referenceId: string | null; cancelVoucherId: string | null
  lines: Array<{ id: string; accountId: string; accountCode: string; accountName: string; categoryCode: string; debit: string; credit: string; memo: string | null }>
}

const TYPE_LABEL: Record<string, string> = {
  JV: 'Journal Voucher', OP: 'Opening Balance', RC: 'Receipt Voucher', PM: 'Payment Voucher',
  CT: 'Contra Entry', PC: 'Petty Cash', SI: 'Sale Invoice', SR: 'Sales Return',
  PU: 'Purchase', PR: 'Purchase Return', EX: 'Expense Batch', RP: 'Replacement',
}

export function VoucherDetailView({ voucherId, onBack }: { voucherId: string; onBack?: () => void }) {
  const qc = useQueryClient()
  const [reverseOpen, setReverseOpen] = useState(false)
  const [reason, setReason] = useState('')

  const q = useQuery<{ voucher: Voucher }>({
    queryKey: ['voucher', voucherId],
    queryFn: () => fetch(`/api/vouchers/${voucherId}`).then(r => r.json()),
    enabled: !!voucherId, retry: 1, retryDelay: 500,
  })

  const reverseMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/vouchers/${voucherId}/reverse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: reason || undefined }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error === 'BLOCKED' ? j.blockReason : (j?.error ?? 'Failed'))
      return j
    },
    onSuccess: () => {
      toast.success('Voucher reversed successfully.')
      void qc.invalidateQueries({ queryKey: ['voucher', voucherId] })
      void qc.invalidateQueries({ queryKey: ['day-book'] })
      void qc.invalidateQueries({ queryKey: ['trial-balance'] })
      setReverseOpen(false); setReason('')
    },
    onError: (e: Error) => toast.error(`Reversal failed: ${e.message}`),
  })

  if (!voucherId) return null
  if (q.isLoading) return <div className="card-3d p-8 text-center"><div className="animate-pulse text-sm text-muted-foreground">Loading voucher…</div></div>
  if (q.isError || !q.data?.voucher) {
    return <div className="card-3d p-8 text-center"><p className="text-sm text-destructive mb-3">Unable to load voucher.</p><Button variant="outline" size="sm" onClick={() => q.refetch()}>Retry</Button></div>
  }

  const v = q.data.voucher
  const canReverse = !v.isCancelled && v.voucherType !== 'SI' && v.voucherType !== 'SR' && v.voucherType !== 'PU' && v.voucherType !== 'PR'

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center text-xs text-muted-foreground hover:text-foreground press-sm"><ArrowLeft className="size-3.5 mr-1.5" /> Back to Day Book</button>

      {/* Header */}
      <div className="card-3d p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium bg-primary/10 text-primary">{TYPE_LABEL[v.voucherType] ?? v.voucherType}</span>
              {v.isCancelled && <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium bg-red-50 text-red-700 border border-red-200">Cancelled</span>}
            </div>
            <div className="text-2xl font-semibold text-foreground tracking-tight" data-num>{v.voucherNo ?? '—'}</div>
            <div className="text-xs text-muted-foreground mt-1" data-num>{bizDate(v.voucherDate)}</div>
          </div>
          {canReverse && (
            <Button variant="outline" size="sm" onClick={() => setReverseOpen(true)}><RotateCcw className="size-3.5" /> Reverse / Cancel</Button>
          )}
          {!canReverse && !v.isCancelled && (
            <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded p-2 max-w-[280px]">
              <AlertCircle className="size-3 inline mr-1" />
              {v.voucherType === 'SI' || v.voucherType === 'SR' ? 'Sales vouchers must be reversed via the Sales module.' : 'Purchase vouchers must be reversed via the Purchases module (return).'}
            </div>
          )}
        </div>
        {v.memo && <div className="mt-3 text-sm text-muted-foreground">{v.memo}</div>}
      </div>

      {/* Lines */}
      <div className="card-3d overflow-hidden">
        <div className="px-5 py-3 border-b border-border"><h2 className="text-sm font-semibold text-foreground">Voucher Lines</h2></div>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40"><th className="text-left p-3.5 font-medium">Account</th><th className="text-left p-3.5 font-medium">Description</th><th className="text-right p-3.5 font-medium">Debit</th><th className="text-right p-3.5 font-medium">Credit</th></tr></thead>
          <tbody>
            {v.lines.map(l => (
              <tr key={l.id} className="border-b border-border/60 last:border-0">
                <td className="p-3.5"><span data-num>{l.accountCode}</span> · {l.accountName}</td>
                <td className="p-3.5 text-muted-foreground">{l.memo ?? '—'}</td>
                <td className="p-3.5 text-right" data-num>{BigInt(l.debit) > 0n ? formatMoney(BigInt(l.debit), false) : '—'}</td>
                <td className="p-3.5 text-right" data-num>{BigInt(l.credit) > 0n ? formatMoney(BigInt(l.credit), false) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t-2 border-border bg-muted/30"><td className="p-3.5 text-xs uppercase tracking-wider text-muted-foreground font-medium" colSpan={2}>Totals</td><td className="p-3.5 text-right font-semibold" data-num>{formatMoney(BigInt(v.totalDebit), false)}</td><td className="p-3.5 text-right font-semibold" data-num>{formatMoney(BigInt(v.totalCredit), false)}</td></tr></tfoot>
        </table>
      </div>

      {/* Metadata */}
      <div className="card-3d p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Posted At</div><div data-num>{new Date(v.postedAt).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</div></div>
        <div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Posted By</div><div data-num>{v.postedBy ? v.postedBy.slice(0, 8) + '…' : '—'}</div></div>
        <div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</div><div>{v.isCancelled ? <span className="text-red-600">Cancelled</span> : <span className="text-emerald-600">Posted</span>}</div></div>
        {v.cancelVoucherId && <div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Reversal Voucher</div><div data-num>{v.cancelVoucherId.slice(0, 8)}…</div></div>}
      </div>

      {/* Reverse modal */}
      <AnimatePresence>
        {reverseOpen && (
          <div className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={() => setReverseOpen(false)}>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="border border-border rounded-xl bg-card shadow-xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-foreground">Reverse Voucher</h3><button onClick={() => setReverseOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button></div>
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">This creates a new reversing voucher with debit/credit swapped. The original voucher remains unchanged but is marked as cancelled. This action cannot be undone.</p>
                <div><Label className="text-xs text-muted-foreground">Reason (optional)</Label><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why are you reversing this?" className="h-9 bg-background" /></div>
                <Button className="w-full" disabled={reverseMut.isPending} onClick={() => reverseMut.mutate()}>{reverseMut.isPending ? 'Reversing…' : 'Confirm Reversal'}</Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
