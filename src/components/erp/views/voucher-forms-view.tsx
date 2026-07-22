'use client'

import { useState, useMemo } from 'react'
import { bizDateString } from '@/lib/dates'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { ArrowRight, AlertCircle, CheckCircle2, ChevronRight, BookOpen } from 'lucide-react'
import { formatMoney, parseMoney } from '@/lib/format'
import { motion } from 'framer-motion'
import type { MeUser } from '@/components/erp/erp-app'
import { AiFieldHelp } from '@/components/erp/ai-actions'

type Account = { id: string; code: string; name: string; categoryType: string }

// Collapsed-by-default section showing the exact debit/credit posting.
// Purely presentational — values are computed by the parent form.
function AccountingDetail({ drName, crName, amount }: { drName: string; crName: string; amount: bigint }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium hover:bg-muted/20 press-sm">
        <span className="flex items-center gap-1.5"><BookOpen className="size-3.5 text-primary" /> Accounting Detail</span>
        <ChevronRight className={`size-3.5 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-border p-2 text-xs text-muted-foreground bg-muted/40">
          Voucher will post: <strong>Dr {drName} {formatMoney(amount)}</strong>, <strong>Cr {crName} {formatMoney(amount)}</strong>
        </div>
      )}
    </div>
  )
}

export function PaymentVoucherView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [paymentDate, setPaymentDate] = useState(bizDateString(new Date()))
  const [paidFromAccountId, setPaidFromAccountId] = useState('')
  const [debitAccountId, setDebitAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [result, setResult] = useState<{ ok: boolean; paymentNo?: string; error?: string } | null>(null)

  const coaQ = useQuery({ queryKey: ['coa'], queryFn: () => fetch('/api/setup/coa').then(r => r.json()), staleTime: 300_000 })
  const accounts: Account[] = useMemo(() => (coaQ.data?.categories ?? []).flatMap((c: any) => c.accounts.filter((a: any) => a.isActive).map((a: any) => ({ id: a.id, code: a.code, name: a.name, categoryType: c.type }))), [coaQ.data])
  const businessAccounts = accounts.filter(a => a.categoryType === 'Asset')

  const mut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/payment-voucher', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paymentDate, paidFromAccountId, debitAccountId, amount, reference: reference || undefined }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j
    },
    onSuccess: (j) => { toast.success(`Payment Voucher posted: ${j.paymentNo}`); setResult({ ok: true, paymentNo: j.paymentNo }); void qc.invalidateQueries({ queryKey: ['day-book'] }); void qc.invalidateQueries({ queryKey: ['trial-balance'] }) },
    onError: (e: Error) => { setResult({ ok: false, error: e.message }); toast.error(`Failed: ${e.message}`) },
  })

  const amtPaisas = parseMoney(amount) ?? 0n
  const canPost = paidFromAccountId && debitAccountId && amtPaisas > 0n && paidFromAccountId !== debitAccountId

  if (result?.ok) return (
    <div className="card-3d p-6 max-w-md mx-auto text-center">
      <CheckCircle2 className="size-12 text-primary mx-auto mb-3" />
      <p className="text-xs text-muted-foreground mb-1">Payment Voucher Posted</p>
      <p className="text-2xl font-bold text-primary" data-num>{result.paymentNo}</p>
      <div className="mt-4 flex flex-col gap-2">
        <Button className="w-full" onClick={() => { setResult(null); setAmount(''); setReference('') }}>New Payment</Button>
        <Button variant="outline" className="w-full" onClick={() => window.open('/?page=day-book', '_self')}>View in Day Book</Button>
      </div>
    </div>
  )

  return (
    <div className="space-y-4 max-w-2xl">
      <div><h1 className="text-xl font-semibold tracking-tight text-foreground">Payment Voucher</h1><p className="text-xs text-muted-foreground mt-0.5">Record money paid from a business account</p></div>
      <div className="card-3d p-5 space-y-3">
        <div><Label className="text-xs text-muted-foreground">Date</Label><Input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} className="h-9 bg-background" data-num /></div>
        <div>
          <div className="flex items-center"><Label className="text-xs text-muted-foreground">Pay To</Label><AiFieldHelp fieldName="debitAccountId" fieldLabel="Debit account / Pay To" currentScreen="payment-voucher" role={user.roleName} valueCategory="account" accountingContext="debit side" /></div>
          <Select value={debitAccountId} onValueChange={setDebitAccountId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select>
        </div>
        <div>
          <div className="flex items-center"><Label className="text-xs text-muted-foreground">Paid From</Label><AiFieldHelp fieldName="paidFromAccountId" fieldLabel="Credit account / Paid From" currentScreen="payment-voucher" role={user.roleName} valueCategory="business account" accountingContext="cash or bank credit" /></div>
          <Select value={paidFromAccountId} onValueChange={setPaidFromAccountId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{businessAccounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select>
        </div>
        <div><Label className="text-xs text-muted-foreground">Amount (Rs)</Label><Input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="h-9 bg-background" data-num /></div>
        <div><Label className="text-xs text-muted-foreground">Reference / Notes <span className="text-muted-foreground/70">(optional)</span></Label><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Optional" className="h-9 bg-background" /></div>
        {amtPaisas > 0n && paidFromAccountId && debitAccountId && <AccountingDetail drName={accounts.find(a => a.id === debitAccountId)?.name ?? '—'} crName={businessAccounts.find(a => a.id === paidFromAccountId)?.name ?? '—'} amount={amtPaisas} />}
        {paidFromAccountId === debitAccountId && debitAccountId && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> Pay To and Paid From accounts must differ</div>}
        {result && !result.ok && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> {result.error}</div>}
        <Button className="w-full" disabled={!canPost || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Posting…' : <><ArrowRight className="size-4" /> Post Payment Voucher</>}</Button>
      </div>
    </div>
  )
}

export function ReceiptVoucherView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [receiptDate, setReceiptDate] = useState(bizDateString(new Date()))
  const [receivedIntoAccountId, setReceivedIntoAccountId] = useState('')
  const [creditAccountId, setCreditAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [result, setResult] = useState<{ ok: boolean; receiptNo?: string; error?: string } | null>(null)

  const coaQ = useQuery({ queryKey: ['coa'], queryFn: () => fetch('/api/setup/coa').then(r => r.json()), staleTime: 300_000 })
  const accounts: Account[] = useMemo(() => (coaQ.data?.categories ?? []).flatMap((c: any) => c.accounts.filter((a: any) => a.isActive).map((a: any) => ({ id: a.id, code: a.code, name: a.name, categoryType: c.type }))), [coaQ.data])
  const businessAccounts = accounts.filter(a => a.categoryType === 'Asset')

  const mut = useMutation({
    mutationFn: async () => {
      const body = { receiptDate, receivedIntoAccountId, creditAccountId, amount, reference: reference || undefined }
      const r = await fetch('/api/receipt-voucher', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j
    },
    onSuccess: (j) => { toast.success(`Receipt Voucher posted: ${j.receiptNo}`); setResult({ ok: true, receiptNo: j.receiptNo }); void qc.invalidateQueries({ queryKey: ['day-book'] }); void qc.invalidateQueries({ queryKey: ['trial-balance'] }) },
    onError: (e: Error) => { setResult({ ok: false, error: e.message }); toast.error(`Failed: ${e.message}`) },
  })

  const amtPaisas = parseMoney(amount) ?? 0n
  const canPost = receivedIntoAccountId && creditAccountId && amtPaisas > 0n && receivedIntoAccountId !== creditAccountId

  if (result?.ok) return (
    <div className="card-3d p-6 max-w-md mx-auto text-center">
      <CheckCircle2 className="size-12 text-primary mx-auto mb-3" />
      <p className="text-xs text-muted-foreground mb-1">Receipt Voucher Posted</p>
      <p className="text-2xl font-bold text-primary" data-num>{result.receiptNo}</p>
      <div className="mt-4 flex flex-col gap-2">
        <Button className="w-full" onClick={() => { setResult(null); setAmount(''); setReference('') }}>New Receipt</Button>
        <Button variant="outline" className="w-full" onClick={() => window.open('/?page=day-book', '_self')}>View in Day Book</Button>
      </div>
    </div>
  )

  return (
    <div className="space-y-4 max-w-2xl">
      <div><h1 className="text-xl font-semibold tracking-tight text-foreground">Receipt Voucher</h1><p className="text-xs text-muted-foreground mt-0.5">Record money received into a business account.</p></div>
      <div className="card-3d p-5 space-y-3">
        <div><Label className="text-xs text-muted-foreground">Date</Label><Input type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} className="h-9 bg-background" data-num /></div>
        <div>
          <div className="flex items-center"><Label className="text-xs text-muted-foreground">Received From</Label><AiFieldHelp fieldName="creditAccountId" fieldLabel="Credit account / Received From" currentScreen="receipt-voucher" role={user.roleName} valueCategory="account" accountingContext="credit side" /></div>
          <Select value={creditAccountId} onValueChange={setCreditAccountId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select>
        </div>
        <div>
          <div className="flex items-center"><Label className="text-xs text-muted-foreground">Deposit Into</Label><AiFieldHelp fieldName="receivedIntoAccountId" fieldLabel="Debit account / Deposit Into" currentScreen="receipt-voucher" role={user.roleName} valueCategory="business account" accountingContext="cash or bank debit" /></div>
          <Select value={receivedIntoAccountId} onValueChange={setReceivedIntoAccountId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{businessAccounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select>
        </div>
        <div><Label className="text-xs text-muted-foreground">Amount (Rs)</Label><Input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="h-9 bg-background" data-num /></div>
        <div><Label className="text-xs text-muted-foreground">Reference / Notes <span className="text-muted-foreground/70">(optional)</span></Label><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Optional" className="h-9 bg-background" /></div>
        {amtPaisas > 0n && receivedIntoAccountId && creditAccountId && <AccountingDetail drName={businessAccounts.find(a => a.id === receivedIntoAccountId)?.name ?? '—'} crName={accounts.find(a => a.id === creditAccountId)?.name ?? '—'} amount={amtPaisas} />}
        {receivedIntoAccountId === creditAccountId && creditAccountId && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> Received From and Deposit Into accounts must differ</div>}
        {result && !result.ok && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> {result.error}</div>}
        <Button className="w-full" disabled={!canPost || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Posting…' : <><ArrowRight className="size-4" /> Post Receipt Voucher</>}</Button>
      </div>
    </div>
  )
}

function LegacyContraEntryView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [contraDate, setContraDate] = useState(bizDateString(new Date()))
  const [fromAccountId, setFromAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState<{ ok: boolean; contraNo?: string; error?: string } | null>(null)

  const coaQ = useQuery({ queryKey: ['coa'], queryFn: () => fetch('/api/setup/coa').then(r => r.json()), staleTime: 300_000 })
  const businessAccounts: Account[] = useMemo(() => (coaQ.data?.categories ?? []).filter((c: any) => c.type === 'Asset').flatMap((c: any) => c.accounts.filter((a: any) => a.isActive).map((a: any) => ({ id: a.id, code: a.code, name: a.name, categoryType: 'Asset' }))), [coaQ.data])

  const mut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/contra-entry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contraDate, fromAccountId, toAccountId, amount, reference: reference || undefined, notes: notes || undefined }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j
    },
    onSuccess: (j) => { toast.success(`Contra Entry posted: ${j.contraNo}`); setResult({ ok: true, contraNo: j.contraNo }); void qc.invalidateQueries({ queryKey: ['day-book'] }); void qc.invalidateQueries({ queryKey: ['trial-balance'] }) },
    onError: (e: Error) => { setResult({ ok: false, error: e.message }); toast.error(`Failed: ${e.message}`) },
  })

  const amtPaisas = parseMoney(amount) ?? 0n
  const canPost = fromAccountId && toAccountId && amtPaisas > 0n && fromAccountId !== toAccountId

  if (result?.ok) return (
    <div className="card-3d p-6 max-w-md mx-auto text-center">
      <CheckCircle2 className="size-12 text-primary mx-auto mb-3" />
      <p className="text-xs text-muted-foreground mb-1">Contra Entry Posted</p>
      <p className="text-2xl font-bold text-primary" data-num>{result.contraNo}</p>
      <Button variant="ghost" size="sm" className="mt-4" onClick={() => { setResult(null); setAmount(''); setReference(''); setNotes('') }}>New Contra</Button>
    </div>
  )

  return (
    <div className="space-y-4 max-w-2xl">
      <div><h1 className="text-xl font-semibold tracking-tight text-foreground">Contra Entry</h1><p className="text-xs text-muted-foreground mt-0.5">Transfer between two business asset accounts</p></div>
      <div className="card-3d p-5 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label className="text-xs text-muted-foreground">Date</Label><Input type="date" value={contraDate} onChange={e => setContraDate(e.target.value)} className="h-9 bg-background" data-num /></div>
          <div><Label className="text-xs text-muted-foreground">Reference</Label><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Optional" className="h-9 bg-background" /></div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <div className="flex items-center"><Label className="text-xs text-muted-foreground">Transfer From (credit)</Label><AiFieldHelp fieldName="fromAccountId" fieldLabel="Transfer From" currentScreen="contra-entry" role={user.roleName} valueCategory="business account" accountingContext="credit source asset" /></div>
            <Select value={fromAccountId} onValueChange={setFromAccountId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select…" /></SelectTrigger><SelectContent>{businessAccounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div>
            <div className="flex items-center"><Label className="text-xs text-muted-foreground">Transfer To (debit)</Label><AiFieldHelp fieldName="toAccountId" fieldLabel="Transfer To" currentScreen="contra-entry" role={user.roleName} valueCategory="business account" accountingContext="debit destination asset" /></div>
            <Select value={toAccountId} onValueChange={setToAccountId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select…" /></SelectTrigger><SelectContent>{businessAccounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select>
          </div>
        </div>
        <div><Label className="text-xs text-muted-foreground">Amount (Rs)</Label><Input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="h-9 bg-background" data-num /></div>
        {amtPaisas > 0n && fromAccountId && toAccountId && <div className="text-xs text-muted-foreground bg-muted/40 p-2 rounded border border-border">Voucher will post: <strong>Dr {businessAccounts.find(a => a.id === toAccountId)?.name ?? '—'} {formatMoney(amtPaisas)}</strong>, <strong>Cr {businessAccounts.find(a => a.id === fromAccountId)?.name ?? '—'} {formatMoney(amtPaisas)}</strong></div>}
        <div><Label className="text-xs text-muted-foreground">Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" className="h-9 bg-background" /></div>
        {fromAccountId === toAccountId && fromAccountId && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> From and To accounts must differ</div>}
        {result && !result.ok && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> {result.error}</div>}
        <Button className="w-full" disabled={!canPost || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Posting…' : <><ArrowRight className="size-4" /> Post Contra</>}</Button>
      </div>
    </div>
  )
}

type OperationalMoneyAccount = { id: string; key: string; name: string; balancePaisas: string; isActive: boolean }
type OperationalMoneyActivity = { id: string; kind: 'contra' | 'capital' | 'drawings'; date: string; amountPaisas: string; reference: string; note: string | null; sourceName: string | null; destinationName: string | null }
type OperationalMoneyData = { accounts: OperationalMoneyAccount[]; activity: OperationalMoneyActivity[] }

function OperationalImpact({ kind, source, destination, amount }: { kind: 'contra' | 'capital' | 'drawings'; source?: string; destination?: string; amount: bigint }) {
  const [open, setOpen] = useState(false)
  const lines = kind === 'contra'
    ? [`Money moved from ${source ?? 'Source'} to ${destination ?? 'Destination'}.`, 'Profit impact: None.']
    : kind === 'capital'
    ? ['Business funds increase.', 'Owner capital increases.', 'Profit impact: None.']
    : ['Business funds decrease.', 'Owner capital decreases.', 'Profit impact: None.']
  return <div className="border border-border rounded-lg overflow-hidden">
    <button type="button" onClick={() => setOpen(v => !v)} className="w-full px-3 py-2 flex items-center justify-between text-xs font-medium hover:bg-muted/20 press-sm">
      <span>Accounting Impact</span><ChevronRight className={`size-3.5 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
    </button>
    {open && <div className="border-t border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-1"><p data-num>{formatMoney(amount)}</p>{lines.map(line => <p key={line}>{line}</p>)}</div>}
  </div>
}

function RecentOperationalMoney({ activity }: { activity: OperationalMoneyActivity[] }) {
  if (!activity.length) return <p className="text-xs text-muted-foreground">No recent transfers or owner equity activity.</p>
  return <div className="divide-y divide-border/60">
    {activity.slice(0, 6).map(item => <div key={item.id} className="py-2 flex items-center justify-between gap-3 text-xs">
      <div className="min-w-0"><p className="font-medium text-foreground capitalize">{item.kind}</p><p className="text-muted-foreground truncate">{item.sourceName ? `${item.sourceName} → ${item.destinationName ?? 'Owner'}` : `${item.destinationName ?? 'Business funds'} ← Owner`} · {item.date}</p></div>
      <div className="text-right shrink-0"><p className="font-medium" data-num>{formatMoney(BigInt(item.amountPaisas))}</p><p className="text-[10px] text-muted-foreground" data-num>{item.reference}</p></div>
    </div>)}
  </div>
}

export function ContraEntryView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [date, setDate] = useState(bizDateString(new Date()))
  const [fromAccountId, setFromAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [result, setResult] = useState<{ reference?: string; error?: string } | null>(null)
  const moneyQ = useQuery<OperationalMoneyData>({ queryKey: ['operational-money'], queryFn: async () => {
    const r = await fetch('/api/operational-money'); const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j
  } })
  const accounts = (moneyQ.data?.accounts ?? []).filter(a => a.isActive)
  const amountPaisas = parseMoney(amount) ?? 0n
  const canPost = user.permissions.includes('can_create_contra') && fromAccountId && toAccountId && fromAccountId !== toAccountId && amountPaisas > 0n
  const mut = useMutation({ mutationFn: async () => {
    const r = await fetch('/api/contra-entry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contraDate: date, fromAccountId, toAccountId, amount, notes: note || undefined, idempotencyKey }) })
    const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j
  }, onSuccess: (j) => { setResult({ reference: j.reference }); toast.success(`Transfer posted: ${j.reference}`); void qc.invalidateQueries({ queryKey: ['operational-money'] }) }, onError: (error: Error) => setResult({ error: error.message }) })
  const from = accounts.find(a => a.id === fromAccountId)
  const to = accounts.find(a => a.id === toAccountId)
  return <div className="space-y-4 max-w-2xl">
    <div><h1 className="text-xl font-semibold tracking-tight text-foreground">Transfer Money</h1><p className="text-xs text-muted-foreground mt-0.5">Move funds only between business Cash, Bank and Wallet accounts.</p></div>
    <div className="card-3d p-4 sm:p-5 space-y-3">
      <div className="grid sm:grid-cols-2 gap-3"><div><Label className="text-xs text-muted-foreground">From account</Label><Select value={fromAccountId} onValueChange={setFromAccountId}><SelectTrigger className="h-10 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} · {formatMoney(BigInt(a.balancePaisas))}</SelectItem>)}</SelectContent></Select></div><div><Label className="text-xs text-muted-foreground">To account</Label><Select value={toAccountId} onValueChange={setToAccountId}><SelectTrigger className="h-10 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} · {formatMoney(BigInt(a.balancePaisas))}</SelectItem>)}</SelectContent></Select></div></div>
      <div className="grid sm:grid-cols-2 gap-3"><div><Label className="text-xs text-muted-foreground">Amount (Rs)</Label><Input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="h-10 bg-background" data-num /></div><div><Label className="text-xs text-muted-foreground">Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-10 bg-background" data-num /></div></div>
      <div><Label className="text-xs text-muted-foreground">Note <span className="text-muted-foreground/70">(optional)</span></Label><Input value={note} onChange={e => setNote(e.target.value)} maxLength={500} className="h-10 bg-background" /></div>
      {fromAccountId === toAccountId && fromAccountId && <p className="text-xs text-destructive">Source and destination accounts must differ.</p>}
      {amountPaisas > 0n && from && to && <OperationalImpact kind="contra" source={from.name} destination={to.name} amount={amountPaisas} />}
      {result?.error && <p className="text-xs text-destructive">{result.error}</p>}
      {result?.reference && <p className="text-xs text-primary">Transfer posted: <span data-num>{result.reference}</span></p>}
      <Button className="w-full" disabled={!canPost || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Posting…' : 'Transfer Money'}</Button>
    </div>
    <div className="card-3d p-4"><h2 className="text-sm font-semibold mb-2">Recent transfers</h2><RecentOperationalMoney activity={(moneyQ.data?.activity ?? []).filter(a => a.kind === 'contra')} /></div>
  </div>
}

export function OwnerCapitalView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [action, setAction] = useState<'capital' | 'drawings'>('capital')
  const [accountId, setAccountId] = useState('')
  const [date, setDate] = useState(bizDateString(new Date()))
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [result, setResult] = useState<{ reference?: string; error?: string } | null>(null)
  const moneyQ = useQuery<OperationalMoneyData>({ queryKey: ['operational-money'], queryFn: async () => { const r = await fetch('/api/operational-money'); const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j } })
  const accounts = (moneyQ.data?.accounts ?? []).filter(a => a.isActive)
  const amountPaisas = parseMoney(amount) ?? 0n
  const mut = useMutation({ mutationFn: async () => { const r = await fetch('/api/owner-equity', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, accountId, date, amount, note: note || undefined, idempotencyKey }) }); const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j }, onSuccess: (j) => { setResult({ reference: j.reference }); setIdempotencyKey(crypto.randomUUID()); toast.success(`${action === 'capital' ? 'Capital added' : 'Drawings posted'}: ${j.reference}`); void qc.invalidateQueries({ queryKey: ['operational-money'] }) }, onError: (error: Error) => setResult({ error: error.message }) })
  const selected = accounts.find(a => a.id === accountId)
  const title = action === 'capital' ? 'Add Capital' : 'Withdraw / Drawings'
  return <div className="space-y-4 max-w-2xl">
    <div><h1 className="text-xl font-semibold tracking-tight text-foreground">Owner Capital & Drawings</h1><p className="text-xs text-muted-foreground mt-0.5">Add owner funds or record personal withdrawals. Neither affects profit.</p></div>
    <div className="card-3d p-4 sm:p-5 space-y-3"><div className="flex gap-2 overflow-x-auto"><Button type="button" size="sm" variant={action === 'capital' ? 'default' : 'outline'} onClick={() => { setAction('capital'); setResult(null); setIdempotencyKey(crypto.randomUUID()) }}>Add Capital</Button><Button type="button" size="sm" variant={action === 'drawings' ? 'default' : 'outline'} onClick={() => { setAction('drawings'); setResult(null); setIdempotencyKey(crypto.randomUUID()) }}>Withdraw / Drawings</Button></div>
      <div className="grid sm:grid-cols-2 gap-3"><div><Label className="text-xs text-muted-foreground">Account</Label><Select value={accountId} onValueChange={setAccountId}><SelectTrigger className="h-10 bg-background"><SelectValue placeholder="Select Cash, Bank or Wallet…" /></SelectTrigger><SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} · {formatMoney(BigInt(a.balancePaisas))}</SelectItem>)}</SelectContent></Select></div><div><Label className="text-xs text-muted-foreground">Amount (Rs)</Label><Input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="h-10 bg-background" data-num /></div></div>
      <div className="grid sm:grid-cols-2 gap-3"><div><Label className="text-xs text-muted-foreground">Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-10 bg-background" data-num /></div><div><Label className="text-xs text-muted-foreground">Note <span className="text-muted-foreground/70">(optional)</span></Label><Input value={note} onChange={e => setNote(e.target.value)} maxLength={500} className="h-10 bg-background" /></div></div>
      {amountPaisas > 0n && selected && <OperationalImpact kind={action} source={action === 'drawings' ? selected.name : undefined} destination={action === 'capital' ? selected.name : undefined} amount={amountPaisas} />}
      {result?.error && <p className="text-xs text-destructive">{result.error}</p>}{result?.reference && <p className="text-xs text-primary">Posted: <span data-num>{result.reference}</span></p>}
      <Button className="w-full" disabled={!accountId || amountPaisas <= 0n || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Posting…' : title}</Button>
    </div>
    <div className="card-3d p-4"><h2 className="text-sm font-semibold mb-2">Recent owner capital & drawings</h2><RecentOperationalMoney activity={(moneyQ.data?.activity ?? []).filter(a => a.kind !== 'contra')} /></div>
  </div>
}
