'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useQuery } from '@tanstack/react-query'
import { formatMoney, parseMoney } from '@/lib/format'
import { toast } from 'sonner'
import { Plus, Trash2, ArrowRight, AlertCircle, CheckCircle2, FileText } from 'lucide-react'
import { motion } from 'framer-motion'

type Account = {
  id: string
  code: string
  name: string
  isBusinessAccount: boolean
  isPartyAccount: boolean
  partyType: string | null
}
type Category = {
  id: string
  code: string
  name: string
  type: string
  accounts: Account[]
}

type Line = {
  key: string
  accountId: string
  debit: string
  credit: string
  memo: string
}

const VOUCHER_TYPES: { value: string; label: string }[] = [
  { value: 'JV', label: 'Journal Voucher (JV)' },
  { value: 'OP', label: 'Opening Voucher (OP)' },
  { value: 'RC', label: 'Receipt Voucher (RC)' },
  { value: 'PM', label: 'Payment Voucher (PM)' },
  { value: 'CT', label: 'Contra Entry (CT)' },
  { value: 'PC', label: 'Petty Cash (PC)' },
]

export function JournalVoucherView() {
  const qc = useQueryClient()
  const [voucherType, setVoucherType] = useState('JV')
  const [voucherDate, setVoucherDate] = useState(new Date().toISOString().slice(0, 10))
  const [memo, setMemo] = useState('')
  const [lines, setLines] = useState<Line[]>([
    { key: '1', accountId: '', debit: '', credit: '', memo: '' },
    { key: '2', accountId: '', debit: '', credit: '', memo: '' },
  ])
  const [result, setResult] = useState<{ ok: boolean; voucherId?: string; error?: string; code?: string } | null>(null)

  const coaQ = useQuery<{ categories: Category[] }>({
    queryKey: ['coa'],
    queryFn: () => fetch('/api/setup/coa').then((r) => r.json()),
  })

  const allAccounts: Account[] = (coaQ.data?.categories ?? []).flatMap((c) => c.accounts)

  const totals = lines.reduce(
    (acc, l) => {
      const d = parseMoney(l.debit) ?? 0n
      const c = parseMoney(l.credit) ?? 0n
      return { debit: acc.debit + d, credit: acc.credit + c }
    },
    { debit: 0n, credit: 0n },
  )
  const isBalanced = totals.debit === totals.credit && totals.debit > 0n
  const diff = totals.debit - totals.credit

  function addLine() {
    setLines((ls) => [
      ...ls,
      { key: String(Date.now()), accountId: '', debit: '', credit: '', memo: '' },
    ])
  }
  function removeLine(key: string) {
    setLines((ls) => (ls.length <= 2 ? ls : ls.filter((l) => l.key !== key)))
  }
  function updateLine(key: string, field: keyof Line, value: string) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)))
  }

  const postMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/vouchers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          voucherType,
          voucherDate,
          memo,
          lines: lines.map((l) => ({
            accountId: l.accountId,
            debit: l.debit || undefined,
            credit: l.credit || undefined,
            memo: l.memo || undefined,
          })),
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error ?? 'POST_FAILED')
      return j
    },
    onSuccess: (j) => {
      toast.success('Voucher posted. Trial Balance updated.')
      setResult({ ok: true, voucherId: j.voucherId })
      void qc.invalidateQueries({ queryKey: ['trial-balance'] })
      void qc.invalidateQueries({ queryKey: ['vouchers'] })
      // Reset lines.
      setLines([
        { key: String(Date.now()), accountId: '', debit: '', credit: '', memo: '' },
        { key: String(Date.now() + 1), accountId: '', debit: '', credit: '', memo: '' },
      ])
      setMemo('')
    },
    onError: (e: Error) => {
      const msg = e.message
      setResult({ ok: false, error: msg, code: 'POST_FAILED' })
      toast.error(`Voucher rejected: ${msg}`)
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          Journal Voucher
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
          Post a manual double-entry voucher. The server validates that total debit = total
          credit. Unbalanced vouchers are rejected. Posted through the <code className="text-xs bg-muted px-1 py-0.5 rounded">post_voucher()</code>{' '}
          equivalent — direct client inserts into <code className="text-xs bg-muted px-1 py-0.5 rounded">voucher_lines</code>{' '}
          are blocked by RLS.
        </p>
      </div>

      {/* Header fields */}
      <div className="card-3d p-5 sm:p-6">
        <div className="grid sm:grid-cols-3 gap-3.5">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Voucher type</Label>
            <Select value={voucherType} onValueChange={setVoucherType}>
              <SelectTrigger className="h-10 bg-background press-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VOUCHER_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Date (Asia/Karachi)</Label>
            <Input
              type="date"
              value={voucherDate}
              onChange={(e) => setVoucherDate(e.target.value)}
              className="h-10 bg-background press-sm"
              data-num
            />
          </div>
          <div className="space-y-1.5 sm:col-span-1">
            <Label className="text-xs font-medium text-muted-foreground">Memo</Label>
            <Input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Optional"
              className="h-10 bg-background press-sm"
            />
          </div>
        </div>
      </div>

      {/* Lines */}
      <div className="card-3d overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Lines</h2>
          <Button variant="outline" size="sm" onClick={addLine} className="press-sm">
            <Plus className="size-3.5" /> Add line
          </Button>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                <th className="text-left p-3 font-medium w-1/2">Account</th>
                <th className="text-right p-3 font-medium">Debit (Rs)</th>
                <th className="text-right p-3 font-medium">Credit (Rs)</th>
                <th className="text-left p-3 font-medium">Memo</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key} className="border-b border-border/60 last:border-0">
                  <td className="p-3">
                    <Select value={l.accountId} onValueChange={(v) => updateLine(l.key, 'accountId', v)}>
                      <SelectTrigger className="h-9 bg-background press-sm">
                        <SelectValue placeholder="Select account…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(coaQ.data?.categories ?? []).flatMap((c) =>
                          c.accounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              <span data-num>{a.code}</span> · {a.name}
                            </SelectItem>
                          )),
                        )}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-3">
                    <Input
                      type="text"
                      value={l.debit}
                      onChange={(e) => updateLine(l.key, 'debit', e.target.value)}
                      placeholder="0"
                      className="h-9 bg-background text-right press-sm"
                      data-num
                    />
                  </td>
                  <td className="p-3">
                    <Input
                      type="text"
                      value={l.credit}
                      onChange={(e) => updateLine(l.key, 'credit', e.target.value)}
                      placeholder="0"
                      className="h-9 bg-background text-right press-sm"
                      data-num
                    />
                  </td>
                  <td className="p-3">
                    <Input
                      value={l.memo}
                      onChange={(e) => updateLine(l.key, 'memo', e.target.value)}
                      placeholder="Optional"
                      className="h-9 bg-background press-sm"
                    />
                  </td>
                  <td className="p-3 text-center">
                    <button
                      onClick={() => removeLine(l.key)}
                      disabled={lines.length <= 2}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-30 press-sm"
                      aria-label="Remove line"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/30">
                <td className="p-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">
                  Totals
                </td>
                <td className="p-3 text-right font-semibold text-foreground" data-num>
                  {formatMoney(totals.debit, false)}
                </td>
                <td className="p-3 text-right font-semibold text-foreground" data-num>
                  {formatMoney(totals.credit, false)}
                </td>
                <td colSpan={2} className="p-3">
                  {totals.debit > 0n || totals.credit > 0n ? (
                    <span
                      className={`text-xs font-medium px-2 py-1 rounded-md inline-flex items-center gap-1.5 ${
                        isBalanced
                          ? 'bg-primary/10 text-primary'
                          : 'bg-destructive/10 text-destructive'
                      }`}
                    >
                      {isBalanced ? (
                        <>
                          <CheckCircle2 className="size-3" /> Balanced
                        </>
                      ) : (
                        <>
                          <AlertCircle className="size-3" /> Diff: {formatMoney(diff)}
                        </>
                      )}
                    </span>
                  ) : null}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border/60">
          {lines.map((l, i) => (
            <div key={l.key} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                  Line {i + 1}
                </span>
                <button
                  onClick={() => removeLine(l.key)}
                  disabled={lines.length <= 2}
                  className="text-muted-foreground hover:text-destructive disabled:opacity-30 press-sm"
                  aria-label="Remove line"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <Select value={l.accountId} onValueChange={(v) => updateLine(l.key, 'accountId', v)}>
                <SelectTrigger className="h-10 bg-background press-sm">
                  <SelectValue placeholder="Select account…" />
                </SelectTrigger>
                <SelectContent>
                  {(coaQ.data?.categories ?? []).flatMap((c) =>
                    c.accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        <span data-num>{a.code}</span> · {a.name}
                      </SelectItem>
                    )),
                  )}
                </SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Debit</Label>
                  <Input
                    type="text"
                    value={l.debit}
                    onChange={(e) => updateLine(l.key, 'debit', e.target.value)}
                    placeholder="0"
                    className="h-9 bg-background text-right press-sm"
                    data-num
                  />
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Credit</Label>
                  <Input
                    type="text"
                    value={l.credit}
                    onChange={(e) => updateLine(l.key, 'credit', e.target.value)}
                    placeholder="0"
                    className="h-9 bg-background text-right press-sm"
                    data-num
                  />
                </div>
              </div>
              <Input
                value={l.memo}
                onChange={(e) => updateLine(l.key, 'memo', e.target.value)}
                placeholder="Memo (optional)"
                className="h-9 bg-background press-sm"
              />
            </div>
          ))}
          <div className="p-4 bg-muted/30 grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Debit</div>
              <div className="font-semibold text-foreground" data-num>
                {formatMoney(totals.debit)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Credit</div>
              <div className="font-semibold text-foreground" data-num>
                {formatMoney(totals.credit)}
              </div>
            </div>
            <div className="col-span-2">
              {totals.debit > 0n || totals.credit > 0n ? (
                <span
                  className={`text-xs font-medium px-2 py-1 rounded-md inline-flex items-center gap-1.5 ${
                    isBalanced ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'
                  }`}
                >
                  {isBalanced ? (
                    <>
                      <CheckCircle2 className="size-3" /> Balanced
                    </>
                  ) : (
                    <>
                      <AlertCircle className="size-3" /> Difference: {formatMoney(diff)}
                    </>
                  )}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Submit */}
      <div className="flex justify-end gap-2">
        <Button
          onClick={() => postMut.mutate()}
          disabled={postMut.isPending || !isBalanced || lines.some((l) => !l.accountId)}
          className="press-md shadow-sm"
        >
          {postMut.isPending ? (
            'Posting…'
          ) : (
            <>
              <ArrowRight className="size-4" /> Post voucher
            </>
          )}
        </Button>
      </div>

      {/* Result */}
      {result && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className={`card-3d p-5 ${
            result.ok ? 'border-primary/40' : 'border-destructive/40'
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`grid place-items-center size-9 rounded-xl shrink-0 ${
                result.ok ? 'icon-3d' : 'bg-destructive/10'
              }`}
            >
              {result.ok ? (
                <CheckCircle2 className="size-4 text-primary-foreground" />
              ) : (
                <AlertCircle className="size-4 text-destructive" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-semibold ${result.ok ? 'text-primary' : 'text-destructive'}`}>
                {result.ok ? 'Voucher posted' : 'Voucher rejected'}
              </div>
              {result.ok ? (
                <>
                  <p className="text-xs text-muted-foreground mt-1">
                    Voucher ID: <span className="font-mono" data-num>{result.voucherId}</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Trial Balance has been updated. Open the Trial Balance view to verify.
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">
                  Server rejected: {result.error}
                  {result.code && (
                    <span className="ml-1 font-mono" data-num>({result.code})</span>
                  )}
                </p>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Test guidance */}
      <div className="card-3d border-primary/30 p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-primary">Phase 2 gate test</h2>
        </div>
        <ol className="space-y-1.5 text-xs text-muted-foreground">
          <li>
            <strong className="text-foreground">Unbalanced test:</strong> Set line 1 debit =
            5,000 and line 2 credit = 3,000. Click Post voucher — server should reject with
            &quot;Unbalanced voucher&quot;.
          </li>
          <li>
            <strong className="text-foreground">Balanced test:</strong> Set line 1 debit =
            5,000 (Cash) and line 2 credit = 5,000 (Sales). Click Post voucher — should
            succeed. Then open Trial Balance to verify Cash and Sales moved by Rs 5,000.
          </li>
          <li>
            <strong className="text-foreground">Drill-down:</strong> In Trial Balance, click any
            account code to see the ledger drill-down with the entry you just posted.
          </li>
        </ol>
      </div>
    </div>
  )
}
