'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Wallet, ArrowDownToLine, ArrowUpFromLine, BookOpen, Plus, Trash2, CheckCircle2, ChevronRight, AlertCircle, CalendarDays } from 'lucide-react'
import { formatMoney, parseMoney } from '@/lib/format'
import { bizDate, bizDateString } from '@/lib/dates'
import { motion, AnimatePresence } from 'framer-motion'
import type { MeUser } from '@/components/erp/erp-app'

type Account = { id: string; code: string; name: string; categoryType: string }
type ExpenseLine = { key: string; expenseAccountId: string; description: string; amount: string }

// Petty Cash account code is 1020 (from seed-phase1.ts)
const PETTY_CASH_CODE = '1020'

export function PettyCashView({ user }: { user: MeUser }) {
  const [modal, setModal] = useState<'topup' | 'expense' | null>(null)

  const coaQ = useQuery({ queryKey: ['coa'], queryFn: () => fetch('/api/setup/coa').then(r => r.json()) })
  const accounts: Account[] = useMemo(() => (coaQ.data?.categories ?? []).flatMap((c: any) => c.accounts.filter((a: any) => a.isActive).map((a: any) => ({ id: a.id, code: a.code, name: a.name, categoryType: c.type }))), [coaQ.data])
  const pettyCashAccount = accounts.find(a => a.code === PETTY_CASH_CODE)

  // Fetch petty cash balance via trial balance
  const tbQ = useQuery({ queryKey: ['trial-balance'], queryFn: () => fetch('/api/trial-balance').then(r => r.json()) })
  const pettyCashRow = (tbQ.data?.rows ?? []).find((r: any) => r.accountCode === PETTY_CASH_CODE)
  const pettyCashBalance = pettyCashRow ? BigInt(pettyCashRow.balance) : 0n

  // Fetch expenses (used for date-wise history)
  const expensesQ = useQuery({ queryKey: ['expenses'], queryFn: () => fetch('/api/expenses').then(r => r.json()) })
  const allExpenses = expensesQ.data?.rows ?? []
  const pettyExpenses = allExpenses.filter((e: any) => e.paymentAccountId === pettyCashAccount?.id)

  const canManage = user.permissions.includes('can_manage_petty_cash')

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div><h1 className="text-xl font-semibold tracking-tight text-foreground">Petty Cash</h1><p className="text-xs text-muted-foreground mt-0.5">Petty cash workspace — balance derived from voucher_lines</p></div>
        {canManage && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setModal('topup')}><ArrowDownToLine className="size-3.5" /> Add Funds</Button><Button size="sm" onClick={() => setModal('expense')}><ArrowUpFromLine className="size-3.5" /> Record Expenses</Button></div>}
      </div>

      {/* Balance card */}
      <div className="card-3d p-5">
        <div className="flex items-center gap-3">
          <div className="icon-3d size-10 grid place-items-center"><Wallet className="size-5 text-primary-foreground" /></div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Current Petty Cash Balance</div>
            <div className={`text-2xl font-bold ${pettyCashBalance >= 0n ? 'text-foreground' : 'text-destructive'}`} data-num>{formatMoney(pettyCashBalance)}</div>
            <div className="text-[10px] text-muted-foreground">Account {PETTY_CASH_CODE} · {pettyCashAccount?.name ?? 'Petty Cash'}</div>
          </div>
        </div>
      </div>

      {/* Date-wise expense history */}
      <PettyCashHistory
        expenses={pettyExpenses}
        isLoading={expensesQ.isLoading}
        isError={expensesQ.isError}
        accounts={accounts}
        ledgerAccountId={pettyCashAccount?.id}
      />

      <AnimatePresence>
        {modal === 'topup' && pettyCashAccount && <TopupModal pettyCashAccountId={pettyCashAccount.id} accounts={accounts.filter(a => a.categoryType === 'Asset' && a.id !== pettyCashAccount.id)} onClose={() => setModal(null)} />}
        {modal === 'expense' && pettyCashAccount && <PettyExpenseBatchModal pettyCashAccountId={pettyCashAccount.id} expenseAccounts={accounts.filter(a => a.categoryType === 'Expense')} ledgerAccountId={pettyCashAccount.id} onClose={() => setModal(null)} />}
      </AnimatePresence>
    </div>
  )
}

// ── Date-wise history: groups petty-cash expenses by date, newest first ──
function PettyCashHistory({ expenses, isLoading, isError, accounts, ledgerAccountId }: { expenses: any[]; isLoading: boolean; isError: boolean; accounts: Account[]; ledgerAccountId?: string }) {
  const [openDate, setOpenDate] = useState<string | null>(null)
  const accountName = (id: string) => accounts.find(a => a.id === id)?.name ?? '—'

  const groups = useMemo(() => {
    const byDate = new Map<string, { date: string; count: number; total: bigint; lines: Array<{ category: string; description: string; amount: bigint; expenseNo?: string }> }>()
    for (const e of expenses) {
      const d = String(e.expenseDate).slice(0, 10)
      if (!byDate.has(d)) byDate.set(d, { date: d, count: 0, total: 0n, lines: [] })
      const g = byDate.get(d)!
      for (const l of e.lines ?? []) {
        const amt = BigInt(l.amount ?? '0')
        g.count += 1
        g.total += amt
        g.lines.push({ category: accountName(l.expenseAccountId), description: l.description || '—', amount: amt, expenseNo: e.expenseNo })
      }
    }
    return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [expenses, accounts])

  return (
    <div className="card-3d overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <CalendarDays className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Petty Cash Expenses by Date</h2>
        {ledgerAccountId && <a href={`/?ledger=${ledgerAccountId}`} className="ml-auto text-xs text-primary hover:underline flex items-center gap-1"><BookOpen className="size-3.5" /> Ledger</a>}
      </div>
      {isLoading ? (
        <div className="text-center py-8 text-sm text-muted-foreground">Loading expenses…</div>
      ) : isError ? (
        <div className="text-center py-8 text-sm text-destructive flex items-center justify-center gap-1"><AlertCircle className="size-4" /> Failed to load expenses.</div>
      ) : groups.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">No petty cash expenses yet.</div>
      ) : (
        <div className="divide-y divide-border/40 max-h-[28rem] overflow-y-auto">
          {groups.map(g => {
            const isOpen = openDate === g.date
            return (
              <div key={g.date}>
                <button onClick={() => setOpenDate(isOpen ? null : g.date)} className="w-full px-5 py-3 flex items-center justify-between gap-3 hover:bg-muted/20 press-sm text-left">
                  <div className="flex items-center gap-2 min-w-0">
                    <ChevronRight className={`size-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground" data-num>{bizDate(g.date)}</div>
                      <div className="text-[10px] text-muted-foreground">{g.count} expense{g.count === 1 ? '' : 's'}</div>
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-amber-600 shrink-0" data-num>−{formatMoney(g.total, false)}</div>
                </button>
                {isOpen && (
                  <div className="bg-muted/20 px-5 py-2 divide-y divide-border/30">
                    {g.lines.map((l, i) => (
                      <div key={i} className="py-2 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-foreground truncate">{l.category}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{l.description}</div>
                        </div>
                        <div className="text-xs font-medium text-foreground shrink-0" data-num>{formatMoney(l.amount, false)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}><motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="border border-border rounded-xl bg-card shadow-xl p-5 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}><div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-foreground">{title}</h3><button onClick={onClose} className="text-muted-foreground hover:text-foreground grid place-items-center size-10">✕</button></div>{children}</motion.div></div>
}

// ── Task 4: petty cash top-up with simplified wording ──
function TopupModal({ pettyCashAccountId, accounts, onClose }: { pettyCashAccountId: string; accounts: Account[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [fromAccountId, setFromAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(bizDateString(new Date()))
  const [reference, setReference] = useState('')

  const mut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/contra-entry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contraDate: date, fromAccountId, toAccountId: pettyCashAccountId, amount, reference: reference || undefined, notes: reference || `Petty cash top-up from ${accounts.find(a => a.id === fromAccountId)?.name}` }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j
    },
    onSuccess: () => { toast.success('Petty cash topped up.'); void qc.invalidateQueries({ queryKey: ['trial-balance'] }); void qc.invalidateQueries({ queryKey: ['day-book'] }); onClose() },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })
  const amtPaisas = parseMoney(amount) ?? 0n
  return <Shell title="Add Funds to Petty Cash" onClose={onClose}><div className="space-y-3">
    <div className="text-xs text-muted-foreground bg-muted/40 p-2 rounded border border-border">Move money from another account into Petty Cash.</div>
    <div><Label className="text-xs text-muted-foreground">Transfer From</Label><Select value={fromAccountId} onValueChange={setFromAccountId}><SelectTrigger className="h-10 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select></div>
    <div><Label className="text-xs text-muted-foreground">Add to Petty Cash</Label><Input value="Petty Cash" disabled className="h-10 bg-muted/40" /></div>
    <div><Label className="text-xs text-muted-foreground">Amount (Rs)</Label><Input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="h-10 bg-background" data-num /></div>
    <div><Label className="text-xs text-muted-foreground">Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-10 bg-background" data-num /></div>
    <div><Label className="text-xs text-muted-foreground">Reference / Notes <span className="text-muted-foreground/70">(optional)</span></Label><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Optional" className="h-10 bg-background" /></div>
    <Button className="w-full h-10" disabled={!fromAccountId || amtPaisas <= 0n || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Posting…' : 'Add to Petty Cash'}</Button>
  </div></Shell>
}

// ── Tasks 1 & 5: multi-row daily expense batch + success continuation ──
function PettyExpenseBatchModal({ pettyCashAccountId, expenseAccounts, ledgerAccountId, onClose }: { pettyCashAccountId: string; expenseAccounts: Account[]; ledgerAccountId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [expenseDate, setExpenseDate] = useState(bizDateString(new Date()))
  const [lines, setLines] = useState<ExpenseLine[]>([{ key: '1', expenseAccountId: '', description: '', amount: '' }])
  const [reference, setReference] = useState('')
  const [result, setResult] = useState<{ expenseNo?: string } | null>(null)

  const total = lines.reduce((s, l) => s + (parseMoney(l.amount) ?? 0n), 0n)

  function addLine() { setLines(ls => [...ls, { key: String(Date.now()), expenseAccountId: '', description: '', amount: '' }]) }
  function removeLine(key: string) { setLines(ls => ls.length <= 1 ? ls : ls.filter(l => l.key !== key)) }
  function updateLine(key: string, field: keyof ExpenseLine, value: string) { setLines(ls => ls.map(l => l.key === key ? { ...l, [field]: value } : l)) }
  function reset() { setResult(null); setLines([{ key: '1', expenseAccountId: '', description: '', amount: '' }]); setReference(''); setExpenseDate(bizDateString(new Date())) }

  const mut = useMutation({
    mutationFn: async () => {
      const validLines = lines.filter(l => l.expenseAccountId && ((parseMoney(l.amount) ?? 0n) > 0n))
      const r = await fetch('/api/expense-batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expenseDate, paymentAccountId: pettyCashAccountId, lines: validLines.map(l => ({ expenseAccountId: l.expenseAccountId, description: l.description || undefined, amount: l.amount })), reference: reference || undefined, notes: 'Petty cash daily expenses' }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j
    },
    onSuccess: (j) => {
      toast.success(`Daily expenses posted: ${j.expenseNo}`)
      setResult({ expenseNo: j.expenseNo })
      void qc.invalidateQueries({ queryKey: ['trial-balance'] })
      void qc.invalidateQueries({ queryKey: ['day-book'] })
      void qc.invalidateQueries({ queryKey: ['expenses'] })
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })

  const canPost = lines.length >= 1 && lines.every(l => l.expenseAccountId && (parseMoney(l.amount) ?? 0n) > 0n) && total > 0n

  if (result) return (
    <Shell title="Daily Expenses Saved" onClose={onClose}>
      <div className="text-center py-2">
        <CheckCircle2 className="size-12 text-primary mx-auto mb-3" />
        <p className="text-xs text-muted-foreground mb-1">Batch posted</p>
        <p className="text-2xl font-bold text-primary" data-num>{result.expenseNo}</p>
        <div className="mt-5 flex flex-col gap-2">
          <Button className="w-full h-10" onClick={onClose}>View Today’s Expenses</Button>
          <Button variant="outline" className="w-full h-10" onClick={reset}>Add Another Batch</Button>
          <Button variant="ghost" className="w-full h-10" onClick={() => window.open(`/?ledger=${ledgerAccountId}`, '_self')}>View Petty Cash Ledger</Button>
        </div>
      </div>
    </Shell>
  )

  return (
    <Shell title="Record Daily Petty Cash Expenses" onClose={onClose}>
      <div className="space-y-3">
        <div className="text-xs text-muted-foreground bg-muted/40 p-2 rounded border border-border">Enter every expense paid from Petty Cash today. Saved together as one balanced batch.</div>
        <div><Label className="text-xs text-muted-foreground">Expense Date</Label><Input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} className="h-10 bg-background" data-num /></div>

        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={l.key} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Expense {i + 1}</span>
                <button onClick={() => removeLine(l.key)} disabled={lines.length <= 1} className="grid place-items-center size-10 -mr-2 text-muted-foreground hover:text-destructive disabled:opacity-30" aria-label="Remove expense"><Trash2 className="size-4" /></button>
              </div>
              <div><Label className="text-[10px] text-muted-foreground">Expense Category</Label><Select value={l.expenseAccountId} onValueChange={v => updateLine(l.key, 'expenseAccountId', v)}><SelectTrigger className="h-10 bg-background"><SelectValue placeholder="Select category…" /></SelectTrigger><SelectContent>{expenseAccounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="text-[10px] text-muted-foreground">Description</Label><Input value={l.description} onChange={e => updateLine(l.key, 'description', e.target.value)} placeholder="Optional" className="h-10 bg-background" /></div>
              <div><Label className="text-[10px] text-muted-foreground">Amount (Rs)</Label><Input type="text" value={l.amount} onChange={e => updateLine(l.key, 'amount', e.target.value)} placeholder="0.00" className="h-10 bg-background text-right" data-num /></div>
            </div>
          ))}
        </div>

        <Button variant="outline" size="sm" onClick={addLine} className="w-full h-10 press-sm"><Plus className="size-4" /> Add Expense</Button>

        <div className="flex items-center justify-between rounded-lg bg-muted/40 border border-border px-3 py-2.5">
          <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Daily Total ({lines.length})</span>
          <span className="text-base font-semibold text-foreground" data-num>{formatMoney(total, false)}</span>
        </div>

        <div><Label className="text-xs text-muted-foreground">Reference / Notes <span className="text-muted-foreground/70">(optional)</span></Label><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Optional" className="h-10 bg-background" /></div>

        <Button className="w-full h-11" disabled={!canPost || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Saving…' : 'Save Daily Batch'}</Button>
      </div>
    </Shell>
  )
}
