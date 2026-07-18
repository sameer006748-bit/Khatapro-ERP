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

type Account = { id: string; code: string; name: string; categoryType: string }

type ExpenseLine = { key: string; expenseAccountId: string; description: string; amount: string }

export function ExpenseBatchView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [expenseDate, setExpenseDate] = useState(bizDateString(new Date()))
  const [paymentAccountId, setPaymentAccountId] = useState('')
  const [lines, setLines] = useState<ExpenseLine[]>([{ key: '1', expenseAccountId: '', description: '', amount: '' }])
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState<{ ok: boolean; expenseNo?: string; error?: string } | null>(null)

  const coaQ = useQuery({ queryKey: ['coa'], queryFn: () => fetch('/api/setup/coa').then(r => r.json()) })
  const accounts: Account[] = useMemo(() => (coaQ.data?.categories ?? []).flatMap((c: any) => c.accounts.filter((a: any) => a.isActive).map((a: any) => ({ id: a.id, code: a.code, name: a.name, categoryType: c.type }))), [coaQ.data])
  const businessAccounts = accounts.filter(a => a.categoryType === 'Asset')
  const expenseAccounts = accounts.filter(a => a.categoryType === 'Expense')

  const total = lines.reduce((s, l) => s + (parseMoney(l.amount) ?? 0n), 0n)

  function addLine() { setLines(ls => [...ls, { key: String(Date.now()), expenseAccountId: '', description: '', amount: '' }]) }
  function removeLine(key: string) { setLines(ls => ls.length <= 1 ? ls : ls.filter(l => l.key !== key)) }
  function updateLine(key: string, field: keyof ExpenseLine, value: string) { setLines(ls => ls.map(l => l.key === key ? { ...l, [field]: value } : l)) }

  const mut = useMutation({
    mutationFn: async () => {
      const validLines = lines.filter(l => l.expenseAccountId && ((parseMoney(l.amount) ?? 0n) > 0n))
      const r = await fetch('/api/expense-batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expenseDate, paymentAccountId, lines: validLines.map(l => ({ expenseAccountId: l.expenseAccountId, description: l.description || undefined, amount: l.amount })), reference: reference || undefined, notes: notes || undefined }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j
    },
    onSuccess: (j) => { toast.success(`Expense Batch posted: ${j.expenseNo}`); setResult({ ok: true, expenseNo: j.expenseNo }); void qc.invalidateQueries({ queryKey: ['day-book'] }); void qc.invalidateQueries({ queryKey: ['trial-balance'] }) },
    onError: (e: Error) => { setResult({ ok: false, error: e.message }); toast.error(`Failed: ${e.message}`) },
  })

  const canPost = paymentAccountId && lines.length >= 1 && lines.every(l => l.expenseAccountId && (parseMoney(l.amount) ?? 0n) > 0n) && total > 0n

  if (result?.ok) return (
    <div className="card-3d p-6 max-w-md mx-auto text-center">
      <CheckCircle2 className="size-12 text-primary mx-auto mb-3" />
      <p className="text-xs text-muted-foreground mb-1">Expense Batch Posted</p>
      <p className="text-2xl font-bold text-primary" data-num>{result.expenseNo}</p>
      <Button variant="ghost" size="sm" className="mt-4" onClick={() => { setResult(null); setLines([{ key: '1', expenseAccountId: '', description: '', amount: '' }]); setReference(''); setNotes('') }}>New Batch</Button>
    </div>
  )

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-semibold tracking-tight text-foreground">Expense Batch</h1><p className="text-xs text-muted-foreground mt-0.5">Multiple expense lines paid from one account — single credit to payment account</p></div>

      {/* Header */}
      <div className="card-3d p-5 space-y-3">
        <div className="grid sm:grid-cols-3 gap-3">
          <div><Label className="text-xs text-muted-foreground">Date</Label><Input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} className="h-9 bg-background" data-num /></div>
          <div className="sm:col-span-2"><Label className="text-xs text-muted-foreground">Paid From (business account)</Label>
            <Select value={paymentAccountId} onValueChange={setPaymentAccountId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{businessAccounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label className="text-xs text-muted-foreground">Reference</Label><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Optional" className="h-9 bg-background" /></div>
          <div><Label className="text-xs text-muted-foreground">Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" className="h-9 bg-background" /></div>
        </div>
      </div>

      {/* Lines */}
      <div className="card-3d overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Expense Lines <span className="text-xs text-muted-foreground ml-1">({lines.length})</span></h2>
          <Button variant="outline" size="sm" onClick={addLine} className="press-sm h-7"><Plus className="size-3" /> Add line</Button>
        </div>
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40"><th className="text-left p-3 font-medium">Expense Account</th><th className="text-left p-3 font-medium">Description</th><th className="text-right p-3 font-medium w-32">Amount (Rs)</th><th className="w-10"></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key} className="border-b border-border/60 last:border-0">
                  <td className="p-3"><Select value={l.expenseAccountId} onValueChange={v => updateLine(l.key, 'expenseAccountId', v)}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select…" /></SelectTrigger><SelectContent>{expenseAccounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select></td>
                  <td className="p-3"><Input value={l.description} onChange={e => updateLine(l.key, 'description', e.target.value)} placeholder="Optional" className="h-9 bg-background" /></td>
                  <td className="p-3"><Input type="text" value={l.amount} onChange={e => updateLine(l.key, 'amount', e.target.value)} placeholder="0.00" className="h-9 bg-background text-right" data-num /></td>
                  <td className="p-3 text-center"><button onClick={() => removeLine(l.key)} disabled={lines.length <= 1} className="text-muted-foreground hover:text-destructive disabled:opacity-30"><Trash2 className="size-4" /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-border bg-muted/30"><td className="p-3 text-xs uppercase tracking-wider text-muted-foreground font-medium" colSpan={2}>Total ({lines.length} lines)</td><td className="p-3 text-right font-semibold" data-num>{formatMoney(total, false)}</td><td></td></tr></tfoot>
          </table>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border/60">
          {lines.map((l, i) => (
            <div key={l.key} className="p-4 space-y-2">
              <div className="flex items-center justify-between"><span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Line {i + 1}</span><button onClick={() => removeLine(l.key)} disabled={lines.length <= 1} className="text-muted-foreground hover:text-destructive disabled:opacity-30"><Trash2 className="size-4" /></button></div>
              <Select value={l.expenseAccountId} onValueChange={v => updateLine(l.key, 'expenseAccountId', v)}><SelectTrigger className="h-10 bg-background"><SelectValue placeholder="Expense account…" /></SelectTrigger><SelectContent>{expenseAccounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select>
              <Input value={l.description} onChange={e => updateLine(l.key, 'description', e.target.value)} placeholder="Description (optional)" className="h-9 bg-background" />
              <Input type="text" value={l.amount} onChange={e => updateLine(l.key, 'amount', e.target.value)} placeholder="Amount (Rs)" className="h-9 bg-background text-right" data-num />
            </div>
          ))}
          <div className="p-4 bg-muted/30 flex justify-between items-center"><span className="text-xs uppercase text-muted-foreground">Total</span><span className="font-semibold" data-num>{formatMoney(total)}</span></div>
        </div>
      </div>

      {result && !result.ok && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> {result.error}</div>}
      <div className="flex justify-end">
        <Button disabled={!canPost || mut.isPending} onClick={() => mut.mutate()} className="press-md shadow-sm">{mut.isPending ? 'Posting…' : <><ArrowRight className="size-4" /> Post Expense Batch</>}</Button>
      </div>
    </div>
  )
}
