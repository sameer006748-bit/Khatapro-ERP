'use client'

import { useState, useMemo } from 'react'
import { bizDateString } from '@/lib/dates'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Plus, Trash2, ArrowRight, AlertCircle, CheckCircle2 } from 'lucide-react'
import { formatMoney, parseMoney } from '@/lib/format'
import type { MeUser } from '@/components/erp/erp-app'
import { AiFieldHelp } from '@/components/erp/ai-actions'

type Account = { id: string; code: string; name: string }
type Category = { id: string; code: string; name: string; type: string; accounts: Account[] }
type Line = { key: string; accountId: string; debit: string; credit: string; memo: string }

export function JournalVoucherView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [jvDate, setJvDate] = useState(bizDateString(new Date()))
  const [memo, setMemo] = useState('')
  const [lines, setLines] = useState<Line[]>([
    { key: '1', accountId: '', debit: '', credit: '', memo: '' },
    { key: '2', accountId: '', debit: '', credit: '', memo: '' },
  ])
  const [result, setResult] = useState<{ ok: boolean; voucherNo?: string; error?: string } | null>(null)

  const coaQ = useQuery<{ categories: Category[] }>({ queryKey: ['coa'], queryFn: () => fetch('/api/setup/coa').then(r => r.json()) })

  const totals = lines.reduce((acc, l) => {
    const d = parseMoney(l.debit) ?? 0n
    const c = parseMoney(l.credit) ?? 0n
    return { debit: acc.debit + d, credit: acc.credit + c }
  }, { debit: 0n, credit: 0n })
  const isBalanced = totals.debit === totals.credit && totals.debit > 0n
  const diff = totals.debit - totals.credit

  function addLine() { setLines(ls => [...ls, { key: String(Date.now()), accountId: '', debit: '', credit: '', memo: '' }]) }
  function removeLine(key: string) { setLines(ls => ls.length <= 2 ? ls : ls.filter(l => l.key !== key)) }
  function updateLine(key: string, field: keyof Line, value: string) { setLines(ls => ls.map(l => l.key === key ? { ...l, [field]: value } : l)) }

  const mut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/journal-voucher', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jvDate, memo, lines: lines.map(l => ({ accountId: l.accountId, debit: l.debit || undefined, credit: l.credit || undefined, memo: l.memo || undefined })) }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j
    },
    onSuccess: (j) => { toast.success(`Journal Voucher posted: ${j.voucherNo}`); setResult({ ok: true, voucherNo: j.voucherNo }); void qc.invalidateQueries({ queryKey: ['day-book'] }); void qc.invalidateQueries({ queryKey: ['trial-balance'] }); void qc.invalidateQueries({ queryKey: ['vouchers'] }) },
    onError: (e: Error) => { setResult({ ok: false, error: e.message }); toast.error(`Voucher rejected: ${e.message}`) },
  })

  const canPost = isBalanced && lines.every(l => l.accountId) && lines.length >= 2

  if (result?.ok) return (
    <div className="card-3d p-6 max-w-md mx-auto text-center">
      <CheckCircle2 className="size-12 text-primary mx-auto mb-3" />
      <p className="text-xs text-muted-foreground mb-1">Journal Voucher Posted</p>
      <p className="text-2xl font-bold text-primary" data-num>{result.voucherNo}</p>
      <Button variant="ghost" size="sm" className="mt-4" onClick={() => { setResult(null); setLines([{ key: '1', accountId: '', debit: '', credit: '', memo: '' }, { key: '2', accountId: '', debit: '', credit: '', memo: '' }]); setMemo('') }}>New JV</Button>
    </div>
  )

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-semibold tracking-tight text-foreground">Journal Voucher</h1><p className="text-xs text-muted-foreground mt-0.5">Manual double-entry voucher — total debit must equal total credit</p></div>

      <div className="card-3d p-5">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label className="text-xs text-muted-foreground">Date (Asia/Karachi)</Label><Input type="date" value={jvDate} onChange={e => setJvDate(e.target.value)} className="h-9 bg-background" data-num /></div>
          <div><div className="flex items-center"><Label className="text-xs text-muted-foreground">Narration</Label><AiFieldHelp fieldName="memo" fieldLabel="Narration" currentScreen="journal-voucher" role={user.roleName} valueCategory="short text" accountingContext="voucher audit explanation" /></div><Input value={memo} onChange={e => setMemo(e.target.value)} placeholder="Optional" className="h-9 bg-background" /></div>
        </div>
      </div>

      <div className="card-3d overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Lines</h2>
          <Button variant="outline" size="sm" onClick={addLine} className="press-sm h-7"><Plus className="size-3" /> Add line</Button>
        </div>
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40"><th className="text-left p-3 font-medium w-2/5">Account</th><th className="text-right p-3 font-medium">Debit (Rs)</th><th className="text-right p-3 font-medium">Credit (Rs)</th><th className="text-left p-3 font-medium">Memo</th><th className="w-10"></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key} className="border-b border-border/60 last:border-0">
                  <td className="p-3"><Select value={l.accountId} onValueChange={v => updateLine(l.key, 'accountId', v)}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{(coaQ.data?.categories ?? []).flatMap(c => c.accounts.filter((a: any) => a.isActive).map((a: any) => ({ id: a.id, code: a.code, name: a.name }))).map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select></td>
                  <td className="p-3"><Input type="text" value={l.debit} onChange={e => updateLine(l.key, 'debit', e.target.value)} placeholder="0" className="h-9 bg-background text-right" data-num /></td>
                  <td className="p-3"><Input type="text" value={l.credit} onChange={e => updateLine(l.key, 'credit', e.target.value)} placeholder="0" className="h-9 bg-background text-right" data-num /></td>
                  <td className="p-3"><Input value={l.memo} onChange={e => updateLine(l.key, 'memo', e.target.value)} placeholder="Optional" className="h-9 bg-background" /></td>
                  <td className="p-3 text-center"><button onClick={() => removeLine(l.key)} disabled={lines.length <= 2} className="text-muted-foreground hover:text-destructive disabled:opacity-30"><Trash2 className="size-4" /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-border bg-muted/30"><td className="p-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Totals</td><td className="p-3 text-right font-semibold" data-num>{formatMoney(totals.debit, false)}</td><td className="p-3 text-right font-semibold" data-num>{formatMoney(totals.credit, false)}</td><td colSpan={2} className="p-3">{(totals.debit > 0n || totals.credit > 0n) && <span className={`text-xs font-medium px-2 py-1 rounded-md inline-flex items-center gap-1.5 ${isBalanced ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>{isBalanced ? <><CheckCircle2 className="size-3" /> Balanced</> : <><AlertCircle className="size-3" /> Diff: {formatMoney(diff)}</>}</span>}</td></tr></tfoot>
          </table>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border/60">
          {lines.map((l, i) => (
            <div key={l.key} className="p-4 space-y-2">
              <div className="flex items-center justify-between"><span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Line {i + 1}</span><button onClick={() => removeLine(l.key)} disabled={lines.length <= 2} className="text-muted-foreground hover:text-destructive disabled:opacity-30"><Trash2 className="size-4" /></button></div>
              <Select value={l.accountId} onValueChange={v => updateLine(l.key, 'accountId', v)}><SelectTrigger className="h-10 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{(coaQ.data?.categories ?? []).flatMap(c => c.accounts.filter((a: any) => a.isActive).map((a: any) => ({ id: a.id, code: a.code, name: a.name }))).map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select>
              <div className="grid grid-cols-2 gap-2"><div><Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Debit</Label><Input type="text" value={l.debit} onChange={e => updateLine(l.key, 'debit', e.target.value)} placeholder="0" className="h-9 bg-background text-right" data-num /></div><div><Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Credit</Label><Input type="text" value={l.credit} onChange={e => updateLine(l.key, 'credit', e.target.value)} placeholder="0" className="h-9 bg-background text-right" data-num /></div></div>
              <Input value={l.memo} onChange={e => updateLine(l.key, 'memo', e.target.value)} placeholder="Memo (optional)" className="h-9 bg-background" />
            </div>
          ))}
          <div className="p-4 bg-muted/30 grid grid-cols-2 gap-3"><div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Debit</div><div className="font-semibold" data-num>{formatMoney(totals.debit)}</div></div><div className="text-right"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Credit</div><div className="font-semibold" data-num>{formatMoney(totals.credit)}</div></div><div className="col-span-2">{(totals.debit > 0n || totals.credit > 0n) && <span className={`text-xs font-medium px-2 py-1 rounded-md inline-flex items-center gap-1.5 ${isBalanced ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>{isBalanced ? <><CheckCircle2 className="size-3" /> Balanced</> : <><AlertCircle className="size-3" /> Difference: {formatMoney(diff)}</>}</span>}</div></div>
        </div>
      </div>

      {result && !result.ok && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> {result.error}</div>}
      <div className="flex justify-end"><Button disabled={!canPost || mut.isPending} onClick={() => mut.mutate()} className="press-md shadow-sm">{mut.isPending ? 'Posting…' : <><ArrowRight className="size-4" /> Post Journal Voucher</>}</Button></div>
    </div>
  )
}
