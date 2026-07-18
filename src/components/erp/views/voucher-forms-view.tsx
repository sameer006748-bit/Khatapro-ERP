'use client'

import { useState, useMemo } from 'react'
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
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10))
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
          <Label className="text-xs text-muted-foreground">Pay To</Label>
          <Select value={debitAccountId} onValueChange={setDebitAccountId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Paid From</Label>
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
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10))
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
          <Label className="text-xs text-muted-foreground">Received From</Label>
          <Select value={creditAccountId} onValueChange={setCreditAccountId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Deposit Into</Label>
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

export function ContraEntryView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [contraDate, setContraDate] = useState(new Date().toISOString().slice(0, 10))
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
            <Label className="text-xs text-muted-foreground">Transfer From (credit)</Label>
            <Select value={fromAccountId} onValueChange={setFromAccountId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select…" /></SelectTrigger><SelectContent>{businessAccounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Transfer To (debit)</Label>
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
