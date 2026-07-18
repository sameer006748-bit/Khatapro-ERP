'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Wallet, ArrowDownToLine, ArrowUpFromLine, BookOpen } from 'lucide-react'
import { formatMoney, parseMoney } from '@/lib/format'
import { bizDate, bizDateString } from '@/lib/dates'
import { motion, AnimatePresence } from 'framer-motion'
import type { MeUser } from '@/components/erp/erp-app'

type Account = { id: string; code: string; name: string; categoryType: string }

// Petty Cash account code is 1020 (from seed-phase1.ts)
const PETTY_CASH_CODE = '1020'

export function PettyCashView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [modal, setModal] = useState<'topup' | 'expense' | null>(null)

  const coaQ = useQuery({ queryKey: ['coa'], queryFn: () => fetch('/api/setup/coa').then(r => r.json()) })
  const accounts: Account[] = useMemo(() => (coaQ.data?.categories ?? []).flatMap((c: any) => c.accounts.filter((a: any) => a.isActive).map((a: any) => ({ id: a.id, code: a.code, name: a.name, categoryType: c.type }))), [coaQ.data])
  const pettyCashAccount = accounts.find(a => a.code === PETTY_CASH_CODE)

  // Fetch petty cash balance via trial balance
  const tbQ = useQuery({ queryKey: ['trial-balance'], queryFn: () => fetch('/api/trial-balance').then(r => r.json()) })
  const pettyCashRow = (tbQ.data?.rows ?? []).find((r: any) => r.accountCode === PETTY_CASH_CODE)
  const pettyCashBalance = pettyCashRow ? BigInt(pettyCashRow.balance) : 0n

  // Fetch recent expenses
  const expensesQ = useQuery({ queryKey: ['expenses'], queryFn: () => fetch('/api/expenses').then(r => r.json()) })
  const allExpenses = expensesQ.data?.rows ?? []
  const pettyExpenses = allExpenses.filter((e: any) => e.paymentAccountId === pettyCashAccount?.id)

  // Fetch day-book entries that touch petty cash
  const dayBookQ = useQuery({ queryKey: ['day-book'], queryFn: () => fetch('/api/day-book').then(r => r.json()) })
  const pettyCashEntries = (dayBookQ.data?.rows ?? []).filter((v: any) => v.lines.some((l: any) => l.accountCode === PETTY_CASH_CODE)).slice(0, 10)

  const canManage = user.permissions.includes('can_manage_petty_cash')

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div><h1 className="text-xl font-semibold tracking-tight text-foreground">Petty Cash</h1><p className="text-xs text-muted-foreground mt-0.5">Petty cash workspace — balance derived from voucher_lines</p></div>
        {canManage && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setModal('topup')}><ArrowDownToLine className="size-3.5" /> Add Funds</Button><Button size="sm" onClick={() => setModal('expense')}><ArrowUpFromLine className="size-3.5" /> Record Expense</Button></div>}
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

      {/* Recent petty cash entries */}
      <div className="card-3d overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2"><BookOpen className="size-4 text-muted-foreground" /><h2 className="text-sm font-semibold text-foreground">Recent Petty Cash Entries</h2></div>
        {pettyCashEntries.length === 0 ? <div className="text-center py-6 text-sm text-muted-foreground">No petty cash entries yet.</div> : (
          <div className="divide-y divide-border/40">
            {pettyCashEntries.map((v: any) => {
              const pettyLine = v.lines.find((l: any) => l.accountCode === PETTY_CASH_CODE)
              const isDebit = BigInt(pettyLine?.debit ?? '0') > 0n
              const amount = BigInt(pettyLine?.debit ?? pettyLine?.credit ?? '0')
              return (
                <div key={v.voucherId} className="px-5 py-2.5 flex items-center justify-between">
                  <div><div className="text-sm font-medium" data-num>{v.voucherNo ?? '—'}</div><div className="text-[10px] text-muted-foreground" data-num>{bizDate(v.voucherDate)} · {v.sourceLabel}</div></div>
                  <div className={`text-sm font-medium ${isDebit ? 'text-emerald-600' : 'text-amber-600'}`} data-num>{isDebit ? '+' : '−'}{formatMoney(amount, false)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {modal === 'topup' && pettyCashAccount && <TopupModal pettyCashAccountId={pettyCashAccount.id} accounts={accounts.filter(a => a.categoryType === 'Asset' && a.id !== pettyCashAccount.id)} onClose={() => setModal(null)} />}
        {modal === 'expense' && pettyCashAccount && <PettyExpenseModal pettyCashAccountId={pettyCashAccount.id} expenseAccounts={accounts.filter(a => a.categoryType === 'Expense')} onClose={() => setModal(null)} />}
      </AnimatePresence>
    </div>
  )
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}><motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="border border-border rounded-xl bg-card shadow-xl p-5 w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}><div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-foreground">{title}</h3><button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button></div>{children}</motion.div></div>
}

function TopupModal({ pettyCashAccountId, accounts, onClose }: { pettyCashAccountId: string; accounts: Account[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [fromAccountId, setFromAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')

  const mut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/contra-entry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contraDate: bizDateString(new Date()), fromAccountId, toAccountId: pettyCashAccountId, amount, notes: notes || `Petty cash top-up from ${accounts.find(a => a.id === fromAccountId)?.name}` }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j
    },
    onSuccess: () => { toast.success('Petty cash topped up.'); void qc.invalidateQueries({ queryKey: ['trial-balance'] }); void qc.invalidateQueries({ queryKey: ['day-book'] }); onClose() },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })
  const amtPaisas = parseMoney(amount) ?? 0n
  return <Shell title="Add Funds to Petty Cash (Contra)" onClose={onClose}><div className="space-y-3">
    <div className="text-xs text-muted-foreground bg-muted/40 p-2 rounded border border-border">Transfers money from another asset account into Petty Cash. Uses Contra Entry.</div>
    <div><Label className="text-xs text-muted-foreground">Transfer From</Label><Select value={fromAccountId} onValueChange={setFromAccountId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select></div>
    <div><Label className="text-xs text-muted-foreground">Amount (Rs)</Label><Input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="h-9 bg-background" data-num /></div>
    <div><Label className="text-xs text-muted-foreground">Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" className="h-9 bg-background" /></div>
    <Button className="w-full" disabled={!fromAccountId || amtPaisas <= 0n || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Posting…' : 'Top Up Petty Cash'}</Button>
  </div></Shell>
}

function PettyExpenseModal({ pettyCashAccountId, expenseAccounts, onClose }: { pettyCashAccountId: string; expenseAccounts: Account[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [expenseAccountId, setExpenseAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')

  const mut = useMutation({
    mutationFn: async () => {
      // Use expense-batch with a single line
      const r = await fetch('/api/expense-batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expenseDate: bizDateString(new Date()), paymentAccountId: pettyCashAccountId, lines: [{ expenseAccountId, description: description || undefined, amount }], notes: 'Petty cash expense' }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j
    },
    onSuccess: () => { toast.success('Petty cash expense recorded.'); void qc.invalidateQueries({ queryKey: ['trial-balance'] }); void qc.invalidateQueries({ queryKey: ['day-book'] }); void qc.invalidateQueries({ queryKey: ['expenses'] }); onClose() },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })
  const amtPaisas = parseMoney(amount) ?? 0n
  return <Shell title="Record Petty Cash Expense" onClose={onClose}><div className="space-y-3">
    <div className="text-xs text-muted-foreground bg-muted/40 p-2 rounded border border-border">Credits Petty Cash, debits the selected expense account. Uses Expense Batch.</div>
    <div><Label className="text-xs text-muted-foreground">Expense Account</Label><Select value={expenseAccountId} onValueChange={setExpenseAccountId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select…" /></SelectTrigger><SelectContent>{expenseAccounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select></div>
    <div><Label className="text-xs text-muted-foreground">Description</Label><Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" className="h-9 bg-background" /></div>
    <div><Label className="text-xs text-muted-foreground">Amount (Rs)</Label><Input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="h-9 bg-background" data-num /></div>
    <Button className="w-full" disabled={!expenseAccountId || amtPaisas <= 0n || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Posting…' : 'Record Expense'}</Button>
  </div></Shell>
}
