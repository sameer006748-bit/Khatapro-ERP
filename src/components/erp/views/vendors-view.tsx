'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Plus, Search, Users, X, BookOpen, Wallet, TrendingDown } from 'lucide-react'
import { formatMoney } from '@/lib/format'
import { bizDate } from '@/lib/dates'
import { motion, AnimatePresence } from 'framer-motion'
import type { MeUser } from '@/components/erp/erp-app'

type Vendor = { id: string; name: string; phone: string | null; email: string | null; city: string | null; isActive: boolean }
type LedgerRow = { date: string; ref: string; description: string; debit: string; credit: string; runningBalance: string }

export function VendorsView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const canCreate = user.permissions.includes('can_create_purchases')
  const canPay = user.permissions.includes('can_pay_vendors')
  const canViewLedger = user.permissions.includes('can_view_vendor_ledger')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<'add' | 'ledger' | 'advance' | null>(null)
  const [ledgerVendor, setLedgerVendor] = useState<Vendor | null>(null)
  const [advanceVendor, setAdvanceVendor] = useState<Vendor | null>(null)

  const vendorsQ = useQuery<{ rows: Vendor[] }>({ queryKey: ['vendors'], queryFn: () => fetch('/api/vendors').then(r => r.json()) })
  const vendors = vendorsQ.data?.rows ?? []
  const filtered = useMemo(() => { if (!search) return vendors; const q = search.toLowerCase(); return vendors.filter(v => v.name.toLowerCase().includes(q) || (v.phone ?? '').includes(q)) }, [vendors, search])

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div><h1 className="text-xl font-semibold tracking-tight text-foreground">Vendors</h1><p className="text-xs text-muted-foreground mt-0.5">Vendor management, ledger and advances</p></div>
        {canCreate && <Button size="sm" className="h-8 press-sm shadow-sm" onClick={() => setModal('add')}><Plus className="size-3.5" /> Add Vendor</Button>}
      </div>
      {/* Search */}
      <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendors…" className="h-9 bg-background pl-8 press-sm" /></div>
      {/* List */}
      {vendorsQ.isLoading ? <div className="text-center py-8 text-sm text-muted-foreground">Loading…</div> : filtered.length === 0 ? <div className="text-center py-8"><Users className="size-8 text-muted-foreground mx-auto mb-2 opacity-50" /><p className="text-sm text-muted-foreground">No vendors yet.</p></div> : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block border border-border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm"><thead className="bg-muted/50 border-b border-border"><tr className="text-[10px] uppercase tracking-wider text-muted-foreground"><th className="text-left px-3 py-2 font-medium">Vendor</th><th className="text-left px-3 py-2 font-medium">Phone</th><th className="text-left px-3 py-2 font-medium">City</th><th className="text-center px-3 py-2 font-medium">Actions</th></tr></thead><tbody>
              {filtered.map(v => <tr key={v.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20"><td className="px-3 py-2 font-medium text-foreground">{v.name}</td><td className="px-3 py-2 text-xs text-muted-foreground" data-num>{v.phone ?? '—'}</td><td className="px-3 py-2 text-xs text-muted-foreground">{v.city ?? '—'}</td><td className="px-3 py-2 text-center"><div className="flex items-center justify-center gap-1">{canViewLedger && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setLedgerVendor(v); setModal('ledger') }}><BookOpen className="size-3" /> Ledger</Button>}{canPay && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setAdvanceVendor(v); setModal('advance') }}><Wallet className="size-3" /> Advance</Button>}</div></td></tr>)}
            </tbody></table>
          </div>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2">{filtered.map(v => <div key={v.id} className="border border-border rounded-lg bg-card p-3"><div className="flex items-start justify-between mb-2"><div><div className="font-medium text-foreground text-sm">{v.name}</div><div className="text-[10px] text-muted-foreground">{v.phone ?? '—'} · {v.city ?? '—'}</div></div></div><div className="flex gap-1">{canViewLedger && <Button variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={() => { setLedgerVendor(v); setModal('ledger') }}>Ledger</Button>}{canPay && <Button variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={() => { setAdvanceVendor(v); setModal('advance') }}>Advance</Button>}</div></div>)}</div>
        </>
      )}
      {/* Modals */}
      <AnimatePresence>
        {modal === 'add' && <AddVendorModal onClose={() => setModal(null)} />}
        {modal === 'ledger' && ledgerVendor && <LedgerModal vendor={ledgerVendor} onClose={() => { setModal(null); setLedgerVendor(null) }} />}
        {modal === 'advance' && advanceVendor && <AdvanceModal vendor={advanceVendor} onClose={() => { setModal(null); setAdvanceVendor(null) }} />}
      </AnimatePresence>
    </div>
  )
}

function Shell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}><motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className={`border border-border rounded-xl bg-card shadow-xl p-5 w-full ${wide ? 'max-w-lg' : 'max-w-md'} max-h-[85vh] overflow-y-auto`} onClick={e => e.stopPropagation()}><div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-foreground">{title}</h3><button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button></div>{children}</motion.div></div>
}

function AddVendorModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ name: '', phone: '', email: '', address: '', city: '' })
  const mut = useMutation({
    mutationFn: async () => { const r = await fetch('/api/vendors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) }); const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j },
    onSuccess: () => { toast.success('Vendor created.'); void qc.invalidateQueries({ queryKey: ['vendors'] }); onClose() },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })
  return <Shell title="Add Vendor" onClose={onClose}><form onSubmit={e => { e.preventDefault(); mut.mutate() }} className="space-y-3">
    <div><Label className="text-xs text-muted-foreground">Name *</Label><Input value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} required className="h-9 bg-background" /></div>
    <div><Label className="text-xs text-muted-foreground">Phone</Label><Input value={f.phone} onChange={e => setF(s => ({ ...s, phone: e.target.value }))} className="h-9 bg-background" /></div>
    <div><Label className="text-xs text-muted-foreground">City</Label><Input value={f.city} onChange={e => setF(s => ({ ...s, city: e.target.value }))} className="h-9 bg-background" /></div>
    <div><Label className="text-xs text-muted-foreground">Address</Label><Input value={f.address} onChange={e => setF(s => ({ ...s, address: e.target.value }))} className="h-9 bg-background" /></div>
    <Button type="submit" size="sm" disabled={mut.isPending || !f.name}>{mut.isPending ? 'Creating…' : 'Create Vendor'}</Button>
  </form></Shell>
}

function LedgerModal({ vendor, onClose }: { vendor: Vendor; onClose: () => void }) {
  const q = useQuery<{ rows: LedgerRow[] }>({ queryKey: ['vendor-ledger', vendor.id], queryFn: () => fetch(`/api/vendor-ledger/${vendor.id}`).then(r => r.json()), enabled: !!vendor.id, retry: 1, retryDelay: 500 })
  return <Shell title={`${vendor.name} — Ledger`} onClose={onClose} wide>
    {q.isLoading ? <div className="text-center py-4 text-sm text-muted-foreground animate-pulse">Loading ledger…</div> : q.isError || !q.data ? <div className="text-center py-4"><p className="text-sm text-destructive mb-2">Unable to load.</p><Button variant="outline" size="sm" onClick={() => q.refetch()}>Retry</Button></div> : q.data.rows.length === 0 ? <div className="text-center py-4 text-sm text-muted-foreground">No transactions yet.</div> : (
      <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-muted/50 border-b border-border"><tr className="text-[9px] uppercase text-muted-foreground"><th className="text-left px-2 py-1.5">Date</th><th className="text-left px-2 py-1.5">Description</th><th className="text-right px-2 py-1.5">Debit</th><th className="text-right px-2 py-1.5">Credit</th><th className="text-right px-2 py-1.5">Balance</th></tr></thead><tbody>{q.data.rows.map((r, i) => <tr key={i} className="border-b border-border/30"><td className="px-2 py-1" data-num>{bizDate(r.date)}</td><td className="px-2 py-1">{r.description}</td><td className="text-right px-2 py-1" data-num>{BigInt(r.debit) > 0n ? formatMoney(BigInt(r.debit), false) : '—'}</td><td className="text-right px-2 py-1" data-num>{BigInt(r.credit) > 0n ? formatMoney(BigInt(r.credit), false) : '—'}</td><td className="text-right px-2 py-1 font-medium" data-num>{formatMoney(BigInt(r.runningBalance), false)}</td></tr>)}</tbody></table></div>
    )}
  </Shell>
}

function AdvanceModal({ vendor, onClose }: { vendor: Vendor; onClose: () => void }) {
  const qc = useQueryClient()
  const [accountId, setAccountId] = useState('')
  const [amountPaisas, setAmountPaisas] = useState('')
  const [notes, setNotes] = useState('')
  const coaQ = useQuery({ queryKey: ['coa'], queryFn: () => fetch('/api/setup/coa').then(r => r.json()) })
  const accounts = coaQ.data?.categories?.flatMap((c: any) => c.accounts).filter((a: any) => a.isBusinessAccount && a.isActive) ?? []
  const mut = useMutation({
    mutationFn: async () => { const r = await fetch('/api/vendor-advance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vendorId: vendor.id, accountId, amountPaisas, notes: notes || undefined }) }); const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j },
    onSuccess: () => { toast.success('Vendor advance posted.'); void qc.invalidateQueries({ queryKey: ['vendor-ledger', vendor.id] }); onClose() },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })
  return <Shell title={`Advance — ${vendor.name}`} onClose={onClose}><form onSubmit={e => { e.preventDefault(); mut.mutate() }} className="space-y-3">
    <div><Label className="text-xs text-muted-foreground">Pay From</Label><Select value={accountId} onValueChange={setAccountId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{accounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></div>
    <div><Label className="text-xs text-muted-foreground">Amount (paisas)</Label><Input type="text" value={amountPaisas} onChange={e => setAmountPaisas(e.target.value)} required className="h-9 bg-background" data-num /></div>
    <div><Label className="text-xs text-muted-foreground">Note</Label><Input value={notes} onChange={e => setNotes(e.target.value)} className="h-9 bg-background" /></div>
    <Button type="submit" size="sm" disabled={!accountId || !amountPaisas || mut.isPending}>{mut.isPending ? 'Posting…' : 'Post Advance'}</Button>
  </form></Shell>
}
