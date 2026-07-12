'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Plus, Search, Bike, Wallet, TrendingUp, Package, X, CheckCircle2, AlertCircle, User, Phone, MapPin, Printer, BookOpen } from 'lucide-react'
import { formatMoney, parseMoney } from '@/lib/format'
import { bizDate } from '@/lib/dates'
import { motion, AnimatePresence } from 'framer-motion'
import type { MeUser } from '@/components/erp/erp-app'

type DeliveryOrder = {
  id: string; invoiceId: string; invoiceNo: string | null; riderId: string | null; riderName: string | null
  status: string; productAmount: string; customerDeliveryCharge: string; riderEarningAmount: string
  companyDeliveryIncome: string; totalCodAmount: string; codCollectedAmount: string
  assignedAt: string | null; outForDeliveryAt: string | null; deliveredAt: string | null; returnedAt: string | null
  recipientName: string | null; deliveryNote: string | null; returnReason: string | null
  source: string | null; deliveryVoucherId: string | null
  customerName: string | null; customerPhone: string | null; customerAddress: string | null; customerCity: string | null
}
type Rider = { id: string; name: string; phone: string | null; zone: string | null; isActive: boolean }
type CodSubmission = {
  id: string; submissionNo: string; riderId: string; riderName: string | null
  submittedDate: string; requestedAmount: string; confirmedCashAmount: string
  riderFeeDeduction: string; settlementMode: string; status: string; notes: string | null; voucherId: string | null
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  assigned: 'bg-sky-50 text-sky-700 border-sky-200',
  out_for_delivery: 'bg-amber-50 text-amber-700 border-amber-200',
  delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  returned: 'bg-rose-50 text-rose-700 border-rose-200',
}

export function DeliveryView({ user }: { user: MeUser }) {
  const [tab, setTab] = useState<'orders' | 'riders' | 'cod'>('orders')
  const isRider = user.roleName === 'Rider'

  // For riders, show a different layout
  if (isRider) return <RiderHome user={user} />

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Delivery</h1>
        <p className="text-xs text-muted-foreground mt-0.5">COD delivery orders, riders and settlement</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        <button onClick={() => setTab('orders')} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap ${tab === 'orders' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          <Package className="size-3.5" /> Orders
        </button>
        <button onClick={() => setTab('riders')} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap ${tab === 'riders' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          <Bike className="size-3.5" /> Riders
        </button>
        <button onClick={() => setTab('cod')} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap ${tab === 'cod' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          <Wallet className="size-3.5" /> COD Settlement
        </button>
      </div>

      {tab === 'orders' && <OrdersTab user={user} />}
      {tab === 'riders' && <RidersTab user={user} />}
      {tab === 'cod' && <CodTab user={user} />}
    </div>
  )
}

// ─── Orders Tab ───
function OrdersTab({ user }: { user: MeUser }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [modal, setModal] = useState<null | { type: 'assign' | 'delivered' | 'returned' | 'label'; order: DeliveryOrder }>(null)

  const q = useQuery<{ rows: DeliveryOrder[] }>({ queryKey: ['delivery-orders'], queryFn: () => fetch('/api/delivery-orders').then(r => r.json()) })
  const orders = q.data?.rows ?? []
  const filtered = useMemo(() => {
    let r = orders
    if (search) { const s = search.toLowerCase(); r = r.filter(o => (o.invoiceNo ?? '').toLowerCase().includes(s) || (o.customerName ?? '').toLowerCase().includes(s) || (o.customerPhone ?? '').includes(s)) }
    if (statusFilter !== 'all') r = r.filter(o => o.status === statusFilter)
    return r
  }, [orders, search, statusFilter])

  const kpis = useMemo(() => ({
    pending: orders.filter(o => o.status === 'pending').length,
    assigned: orders.filter(o => o.status === 'assigned').length,
    outForDelivery: orders.filter(o => o.status === 'out_for_delivery').length,
    delivered: orders.filter(o => o.status === 'delivered').length,
    returned: orders.filter(o => o.status === 'returned').length,
    codPending: orders.filter(o => o.status === 'delivered').reduce((s, o) => s + BigInt(o.totalCodAmount) - BigInt(o.codCollectedAmount), 0n),
  }), [orders])

  const canAssign = user.permissions.includes('can_assign_rider')
  const canMarkDelivered = user.permissions.includes('can_mark_delivered')
  const canMarkReturned = user.permissions.includes('can_mark_returned')

  return (
    <div className="space-y-3">
      {/* KPIs */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <KPI label="Pending" value={String(kpis.pending)} />
        <KPI label="Assigned" value={String(kpis.assigned)} />
        <KPI label="Out" value={String(kpis.outForDelivery)} />
        <KPI label="Delivered" value={String(kpis.delivered)} />
        <KPI label="Returned" value={String(kpis.returned)} />
        <KPI label="COD Pending" value={formatMoney(kpis.codPending, false)} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoice, customer, phone…" className="h-9 bg-background pl-8 press-sm" /></div>
        <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="h-9 w-32 bg-background text-sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="assigned">Assigned</SelectItem><SelectItem value="out_for_delivery">Out for Delivery</SelectItem><SelectItem value="delivered">Delivered</SelectItem><SelectItem value="returned">Returned</SelectItem></SelectContent></Select>
      </div>

      {/* List */}
      {q.isLoading ? <div className="text-center py-8 text-sm text-muted-foreground">Loading…</div> : filtered.length === 0 ? <div className="text-center py-8"><Package className="size-8 text-muted-foreground mx-auto mb-2 opacity-50" /><p className="text-sm text-muted-foreground">No delivery orders.</p></div> : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block border border-border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm"><thead className="bg-muted/50 border-b border-border"><tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-3 py-2 font-medium">Invoice</th><th className="text-left px-3 py-2 font-medium">Customer</th><th className="text-left px-3 py-2 font-medium">Rider</th><th className="text-right px-3 py-2 font-medium">Product</th><th className="text-right px-3 py-2 font-medium">Delivery</th><th className="text-right px-3 py-2 font-medium">Total COD</th><th className="text-left px-3 py-2 font-medium">Status</th><th className="text-center px-3 py-2 font-medium">Actions</th>
            </tr></thead><tbody>
              {filtered.map(o => <tr key={o.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
                <td className="px-3 py-2 font-medium" data-num>{o.invoiceNo ?? '—'}</td>
                <td className="px-3 py-2"><div className="text-foreground">{o.customerName ?? '—'}</div><div className="text-[10px] text-muted-foreground" data-num>{o.customerPhone ?? ''}</div></td>
                <td className="px-3 py-2 text-muted-foreground">{o.riderName ?? '—'}</td>
                <td className="px-3 py-2 text-right" data-num>{formatMoney(BigInt(o.productAmount), false)}</td>
                <td className="px-3 py-2 text-right" data-num>{formatMoney(BigInt(o.customerDeliveryCharge), false)}</td>
                <td className="px-3 py-2 text-right font-medium" data-num>{formatMoney(BigInt(o.totalCodAmount), false)}</td>
                <td className="px-3 py-2"><span className={`text-[9px] uppercase px-1.5 py-0.5 rounded border font-medium ${STATUS_BADGE[o.status] ?? 'bg-muted'}`}>{o.status.replace(/_/g, ' ')}</span></td>
                <td className="px-3 py-2"><div className="flex items-center justify-center gap-1">
                  {canAssign && (o.status === 'pending' || o.status === 'assigned') && <button onClick={() => setModal({ type: 'assign', order: o })} className="text-xs text-primary hover:underline">Assign</button>}
                  {canMarkDelivered && o.status === 'out_for_delivery' && <button onClick={() => setModal({ type: 'delivered', order: o })} className="text-xs text-emerald-600 hover:underline">Deliver</button>}
                  {canMarkReturned && o.status === 'out_for_delivery' && <button onClick={() => setModal({ type: 'returned', order: o })} className="text-xs text-rose-600 hover:underline">Return</button>}
                  <button onClick={() => setModal({ type: 'label', order: o })} className="text-xs text-muted-foreground hover:underline"><Printer className="size-3 inline" /></button>
                </div></td>
              </tr>)}
            </tbody></table>
          </div>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2">{filtered.map(o => (
            <div key={o.id} className="border border-border rounded-lg bg-card p-3">
              <div className="flex items-start justify-between gap-2 mb-1"><div><div className="font-medium text-foreground text-sm" data-num>{o.invoiceNo ?? '—'}</div><div className="text-[10px] text-muted-foreground">{o.customerName ?? '—'} · {o.customerPhone ?? ''}</div></div><span className={`text-[9px] uppercase px-1.5 py-0.5 rounded border font-medium ${STATUS_BADGE[o.status] ?? 'bg-muted'}`}>{o.status.replace(/_/g, ' ')}</span></div>
              <div className="flex items-end justify-between"><div className="text-[10px] text-muted-foreground">COD: <span data-num>{formatMoney(BigInt(o.totalCodAmount))}</span>{o.riderName ? ` · ${o.riderName}` : ''}</div><div className="flex gap-1">
                {canAssign && (o.status === 'pending' || o.status === 'assigned') && <button onClick={() => setModal({ type: 'assign', order: o })} className="text-xs text-primary">Assign</button>}
                {canMarkDelivered && o.status === 'out_for_delivery' && <button onClick={() => setModal({ type: 'delivered', order: o })} className="text-xs text-emerald-600">Deliver</button>}
                {canMarkReturned && o.status === 'out_for_delivery' && <button onClick={() => setModal({ type: 'returned', order: o })} className="text-xs text-rose-600">Return</button>}
                <button onClick={() => setModal({ type: 'label', order: o })} className="text-xs text-muted-foreground"><Printer className="size-3" /></button>
              </div></div>
            </div>
          ))}</div>
        </>
      )}

      <AnimatePresence>
        {modal?.type === 'assign' && <AssignModal order={modal.order} onClose={() => setModal(null)} />}
        {modal?.type === 'delivered' && <DeliveredModal order={modal.order} onClose={() => setModal(null)} />}
        {modal?.type === 'returned' && <ReturnedModal order={modal.order} onClose={() => setModal(null)} />}
        {modal?.type === 'label' && <LabelModal order={modal.order} onClose={() => setModal(null)} />}
      </AnimatePresence>
    </div>
  )
}

function KPI({ label, value }: { label: string; value: string }) {
  return <div className="border border-border rounded-lg bg-card p-2"><div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div><div className="text-sm font-bold text-foreground" data-num>{value}</div></div>
}

function Shell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}><motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className={`border border-border rounded-xl bg-card shadow-xl p-5 w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[85vh] overflow-y-auto`} onClick={e => e.stopPropagation()}><div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-foreground">{title}</h3><button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button></div>{children}</motion.div></div>
}

function AssignModal({ order, onClose }: { order: DeliveryOrder; onClose: () => void }) {
  const qc = useQueryClient()
  const [riderId, setRiderId] = useState('')
  const ridersQ = useQuery<{ rows: Rider[] }>({ queryKey: ['riders'], queryFn: () => fetch('/api/riders').then(r => r.json()) })
  const activeRiders = (ridersQ.data?.rows ?? []).filter(r => r.isActive)
  const mut = useMutation({
    mutationFn: async () => { const r = await fetch(`/api/delivery-orders/${order.id}/assign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ riderId }) }); const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j },
    onSuccess: () => { toast.success('Rider assigned.'); void qc.invalidateQueries({ queryKey: ['delivery-orders'] }); onClose() },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })
  return <Shell title="Assign Rider" onClose={onClose}><div className="space-y-3">
    <div className="text-sm"><span className="text-muted-foreground">Order:</span> <span className="font-medium" data-num>{order.invoiceNo}</span></div>
    <div className="text-sm"><span className="text-muted-foreground">Customer:</span> {order.customerName} · {order.customerPhone}</div>
    <div className="text-sm"><span className="text-muted-foreground">COD:</span> <span className="font-medium" data-num>{formatMoney(BigInt(order.totalCodAmount))}</span></div>
    {order.riderName && <div className="text-xs text-amber-600">Current rider: {order.riderName}</div>}
    <div><Label className="text-xs text-muted-foreground">Select Rider</Label><Select value={riderId} onValueChange={setRiderId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select…" /></SelectTrigger><SelectContent>{activeRiders.map(r => <SelectItem key={r.id} value={r.id}>{r.name}{r.zone ? ` · ${r.zone}` : ''}{r.phone ? ` · ${r.phone}` : ''}</SelectItem>)}</SelectContent></Select></div>
    <Button className="w-full" disabled={!riderId || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Assigning…' : 'Assign Rider'}</Button>
  </div></Shell>
}

function DeliveredModal({ order, onClose }: { order: DeliveryOrder; onClose: () => void }) {
  const qc = useQueryClient()
  const [collectedAmount, setCollectedAmount] = useState(formatMoney(BigInt(order.totalCodAmount), false))
  const [recipientName, setRecipientName] = useState('')
  const [deliveryNote, setDeliveryNote] = useState('')
  const amt = parseMoney(collectedAmount) ?? 0n
  const expected = BigInt(order.totalCodAmount)
  const mismatch = amt !== expected
  const mut = useMutation({
    mutationFn: async () => { const r = await fetch(`/api/delivery-orders/${order.id}/delivered`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ collectedAmount, recipientName: recipientName || undefined, deliveryNote: deliveryNote || undefined }) }); const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j },
    onSuccess: () => { toast.success('Order delivered.'); void qc.invalidateQueries({ queryKey: ['delivery-orders'] }); void qc.invalidateQueries({ queryKey: ['trial-balance'] }); onClose() },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })
  return <Shell title="Mark Delivered" onClose={onClose}><div className="space-y-3">
    <div className="text-sm"><span className="text-muted-foreground">Order:</span> <span className="font-medium" data-num>{order.invoiceNo}</span></div>
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div><span className="text-muted-foreground">Product:</span> <span data-num>{formatMoney(BigInt(order.productAmount), false)}</span></div>
      <div><span className="text-muted-foreground">Delivery:</span> <span data-num>{formatMoney(BigInt(order.customerDeliveryCharge), false)}</span></div>
      <div><span className="text-muted-foreground">Rider Earn:</span> <span data-num>{formatMoney(BigInt(order.riderEarningAmount), false)}</span></div>
      <div><span className="text-muted-foreground">Expected COD:</span> <span data-num>{formatMoney(expected, false)}</span></div>
    </div>
    <div><Label className="text-xs text-muted-foreground">Collected Amount (Rs)</Label><Input type="text" value={collectedAmount} onChange={e => setCollectedAmount(e.target.value)} className="h-9 bg-background" data-num /></div>
    {mismatch && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> Collected amount must match expected COD</div>}
    <div><Label className="text-xs text-muted-foreground">Recipient Name (optional)</Label><Input value={recipientName} onChange={e => setRecipientName(e.target.value)} className="h-9 bg-background" /></div>
    <div><Label className="text-xs text-muted-foreground">Delivery Note (optional)</Label><Input value={deliveryNote} onChange={e => setDeliveryNote(e.target.value)} className="h-9 bg-background" /></div>
    <Button className="w-full" disabled={mismatch || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Posting…' : 'Confirm Delivery'}</Button>
  </div></Shell>
}

function ReturnedModal({ order, onClose }: { order: DeliveryOrder; onClose: () => void }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const mut = useMutation({
    mutationFn: async () => { const r = await fetch(`/api/delivery-orders/${order.id}/returned`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnReason: reason || undefined }) }); const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j },
    onSuccess: () => { toast.success('Order returned. Stock restored.'); void qc.invalidateQueries({ queryKey: ['delivery-orders'] }); void qc.invalidateQueries({ queryKey: ['products'] }); void qc.invalidateQueries({ queryKey: ['trial-balance'] }); onClose() },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })
  return <Shell title="Mark Returned" onClose={onClose}><div className="space-y-3">
    <div className="text-sm"><span className="text-muted-foreground">Order:</span> <span className="font-medium" data-num>{order.invoiceNo}</span></div>
    <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">This will post a sales return, restore stock, and reverse the original sale. No rider COD or earning will be posted.</div>
    <div><Label className="text-xs text-muted-foreground">Return Reason</Label><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why was it returned?" className="h-9 bg-background" /></div>
    <Button className="w-full" disabled={mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Posting…' : 'Confirm Return'}</Button>
  </div></Shell>
}

function LabelModal({ order, onClose }: { order: DeliveryOrder; onClose: () => void }) {
  return <Shell title="Parcel Label" onClose={onClose} wide>
    <div className="print-purchase" style={{ position: 'relative', left: 0, top: 0, width: '100%' }}>
      <div style={{ fontFamily: 'Arial, sans-serif', color: '#000', padding: '8mm', maxWidth: '140mm', margin: '0 auto', border: '2px solid #000' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000', paddingBottom: '6px', marginBottom: '8px' }}>
          <div><div style={{ fontSize: '16px', fontWeight: 'bold' }}>KhataPro ERP</div><div style={{ fontSize: '8px', color: '#666' }}>Parcel Label</div></div>
          <div style={{ textAlign: 'right' }}><div style={{ fontSize: '12px', fontWeight: 'bold' }}>{order.invoiceNo ?? ''}</div><div style={{ fontSize: '9px', color: '#666' }}>{order.source ?? ''}</div></div>
        </div>
        <div style={{ marginBottom: '8px' }}>
          <div style={{ fontSize: '8px', textTransform: 'uppercase', color: '#666', fontWeight: 'bold' }}>Ship To</div>
          <div style={{ fontSize: '14px', fontWeight: 'bold', marginTop: '2px' }}>{order.customerName ?? '—'}</div>
          <div style={{ fontSize: '10px' }} data-num>{order.customerPhone ?? ''}</div>
          <div style={{ fontSize: '10px' }}>{order.customerAddress ?? '—'}{order.customerCity ? `, ${order.customerCity}` : ''}</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000', paddingTop: '6px', fontSize: '10px' }}>
          <div><strong>Product Amount:</strong> <span style={{ fontFamily: 'monospace' }}>{formatMoney(BigInt(order.productAmount), false)}</span></div>
          <div><strong>Delivery:</strong> <span style={{ fontFamily: 'monospace' }}>{formatMoney(BigInt(order.customerDeliveryCharge), false)}</span></div>
          <div><strong>Total COD:</strong> <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{formatMoney(BigInt(order.totalCodAmount))}</span></div>
        </div>
        {order.riderName && <div style={{ fontSize: '9px', marginTop: '4px', color: '#666' }}>Rider: {order.riderName}</div>}
        <div style={{ textAlign: 'center', fontSize: '7px', color: '#999', borderTop: '1px solid #ccc', paddingTop: '4px', marginTop: '8px' }}>KhataPro ERP · COD Parcel · Asia/Karachi</div>
      </div>
    </div>
    <Button className="w-full mt-3" onClick={() => window.print()}><Printer className="size-4" /> Print Label</Button>
  </Shell>
}

// ─── Riders Tab ───
function RidersTab({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [ledgerRider, setLedgerRider] = useState<Rider | null>(null)
  const [f, setF] = useState({ name: '', phone: '', zone: '', vehicleType: '', userId: '' })
  const ridersQ = useQuery<{ rows: Rider[] }>({ queryKey: ['riders'], queryFn: () => fetch('/api/riders').then(r => r.json()) })
  const riders = ridersQ.data?.rows ?? []
  const usersQ = useQuery<{ rows: Array<{ id: string; email: string; displayName: string; alreadyLinked: boolean }> }>({ queryKey: ['rider-available-users'], queryFn: () => fetch('/api/riders/available-users').then(r => r.json()) })
  const availableUsers = (usersQ.data?.rows ?? []).filter(u => !u.alreadyLinked)
  const mut = useMutation({
    mutationFn: async () => { const r = await fetch('/api/riders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) }); const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j },
    onSuccess: () => { toast.success('Rider created.'); void qc.invalidateQueries({ queryKey: ['riders'] }); void qc.invalidateQueries({ queryKey: ['rider-available-users'] }); setShowAdd(false); setF({ name: '', phone: '', zone: '', vehicleType: '', userId: '' }) },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-foreground">Riders ({riders.length})</h2>{user.permissions.includes('can_manage_riders') && <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}><Plus className="size-3.5" /> Add Rider</Button>}</div>
      {riders.length === 0 ? <div className="text-center py-8"><Bike className="size-8 text-muted-foreground mx-auto mb-2 opacity-50" /><p className="text-sm text-muted-foreground">No riders yet.</p></div> : (
        <div className="grid md:grid-cols-2 gap-2">{riders.map(r => (
          <div key={r.id} className="border border-border rounded-lg bg-card p-3">
            <div className="flex items-start justify-between mb-2"><div><div className="font-medium text-foreground">{r.name}</div><div className="text-[10px] text-muted-foreground" data-num>{r.phone ?? '—'} · {r.zone ?? 'No zone'}</div></div><span className={`text-[9px] uppercase px-1.5 py-0.5 rounded ${r.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{r.isActive ? 'Active' : 'Inactive'}</span></div>
            <div className="flex gap-1">{user.permissions.includes('can_view_rider_ledger') && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setLedgerRider(r)}>View Ledger</Button>}</div>
          </div>
        ))}</div>
      )}
      <AnimatePresence>
        {showAdd && <Shell title="Add Rider" onClose={() => setShowAdd(false)}><form onSubmit={e => { e.preventDefault(); mut.mutate() }} className="space-y-3">
          <div><Label className="text-xs text-muted-foreground">Name *</Label><Input value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} required className="h-9 bg-background" /></div>
          <div><Label className="text-xs text-muted-foreground">Phone</Label><Input value={f.phone} onChange={e => setF(s => ({ ...s, phone: e.target.value }))} className="h-9 bg-background" data-num /></div>
          <div><Label className="text-xs text-muted-foreground">Zone / Area</Label><Input value={f.zone} onChange={e => setF(s => ({ ...s, zone: e.target.value }))} className="h-9 bg-background" /></div>
          <div><Label className="text-xs text-muted-foreground">Vehicle Type</Label><Input value={f.vehicleType} onChange={e => setF(s => ({ ...s, vehicleType: e.target.value }))} placeholder="Bike, Van…" className="h-9 bg-background" /></div>
          <div>
            <Label className="text-xs text-muted-foreground">Linked Rider User</Label>
            <Select value={f.userId || '__none__'} onValueChange={v => setF(s => ({ ...s, userId: v === '__none__' ? '' : v }))}>
              <SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Not linked yet" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Not linked yet</SelectItem>
                {availableUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.displayName} ({u.email})</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">Only active Rider-role users not already linked to another rider are shown.</p>
          </div>
          <Button type="submit" size="sm" disabled={mut.isPending || !f.name}>{mut.isPending ? 'Creating…' : 'Create Rider'}</Button>
        </form></Shell>}
        {ledgerRider && <RiderLedgerModal rider={ledgerRider} onClose={() => setLedgerRider(null)} />}
      </AnimatePresence>
    </div>
  )
}

function RiderLedgerModal({ rider, onClose }: { rider: Rider; onClose: () => void }) {
  const q = useQuery<{ rows: any[] }>({ queryKey: ['rider-ledger', rider.id], queryFn: () => fetch(`/api/rider-ledger/${rider.id}`).then(r => r.json()), enabled: !!rider.id, retry: 1, retryDelay: 500 })
  const rows = q.data?.rows ?? []
  const finalCod = rows.length > 0 ? BigInt(rows[rows.length - 1].runningCodBalance) : 0n
  const finalEarning = rows.length > 0 ? BigInt(rows[rows.length - 1].runningEarningBalance) : 0n
  return <Shell title={`${rider.name} — Ledger`} onClose={onClose} wide>
    <div className="mb-3 grid grid-cols-2 gap-2">
      <div className="border border-border rounded-lg p-2 bg-muted/30"><div className="text-[9px] uppercase text-muted-foreground">COD Pending</div><div className={`text-sm font-bold ${finalCod > 0n ? 'text-amber-600' : 'text-foreground'}`} data-num>{formatMoney(finalCod)}</div></div>
      <div className="border border-border rounded-lg p-2 bg-muted/30"><div className="text-[9px] uppercase text-muted-foreground">Earnings Payable</div><div className={`text-sm font-bold ${finalEarning > 0n ? 'text-emerald-600' : 'text-foreground'}`} data-num>{formatMoney(finalEarning)}</div></div>
    </div>
    {q.isLoading ? <div className="text-center py-4 text-sm text-muted-foreground animate-pulse">Loading…</div> : rows.length === 0 ? <div className="text-center py-4 text-sm text-muted-foreground">No entries yet.</div> : (
      <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-muted/50 border-b border-border"><tr className="text-[9px] uppercase text-muted-foreground">
        <th className="text-left px-2 py-1.5">Date</th><th className="text-left px-2 py-1.5">Type</th><th className="text-left px-2 py-1.5">Ref</th><th className="text-right px-2 py-1.5">COD Del</th><th className="text-right px-2 py-1.5">COD Sub</th><th className="text-right px-2 py-1.5">Earn</th><th className="text-right px-2 py-1.5">COD Bal</th><th className="text-right px-2 py-1.5">Earn Bal</th>
      </tr></thead><tbody>{rows.map((r, i) => (
        <tr key={i} className="border-b border-border/30"><td className="px-2 py-1 text-muted-foreground" data-num>{bizDate(r.eventDate)}</td><td className="px-2 py-1"><span className="text-[8px] uppercase px-1 py-0.5 rounded bg-muted text-muted-foreground">{r.eventType}</span></td><td className="px-2 py-1 font-medium" data-num>{r.reference?.slice(0, 12) ?? '—'}</td><td className="text-right px-2 py-1" data-num>{BigInt(r.codDelivered) > 0n ? formatMoney(BigInt(r.codDelivered), false) : '—'}</td><td className="text-right px-2 py-1" data-num>{BigInt(r.codSubmitted) > 0n ? formatMoney(BigInt(r.codSubmitted), false) : '—'}</td><td className="text-right px-2 py-1" data-num>{BigInt(r.deliveryEarning) > 0n ? formatMoney(BigInt(r.deliveryEarning), false) : '—'}</td><td className="text-right px-2 py-1 font-medium" data-num>{formatMoney(BigInt(r.runningCodBalance), false)}</td><td className="text-right px-2 py-1 font-medium" data-num>{formatMoney(BigInt(r.runningEarningBalance), false)}</td></tr>
      ))}</tbody></table></div>
    )}
  </Shell>
}

// ─── COD Settlement Tab ───
function CodTab({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [selectedRider, setSelectedRider] = useState('')
  const [confirmSub, setConfirmSub] = useState<CodSubmission | null>(null)
  const ridersQ = useQuery<{ rows: Rider[] }>({ queryKey: ['riders'], queryFn: () => fetch('/api/riders').then(r => r.json()) })
  const subsQ = useQuery<{ rows: CodSubmission[] }>({ queryKey: ['cod-submissions'], queryFn: () => fetch('/api/cod-submissions').then(r => r.json()) })
  const subs = subsQ.data?.rows ?? []
  const pendingSubs = subs.filter(s => s.status === 'submitted')
  const canConfirm = user.permissions.includes('can_confirm_cod_submission')
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">COD Submissions ({subs.length})</h2>
      {pendingSubs.length > 0 && <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">{pendingSubs.length} submission(s) pending confirmation</div>}
      {subs.length === 0 ? <div className="text-center py-8"><Wallet className="size-8 text-muted-foreground mx-auto mb-2 opacity-50" /><p className="text-sm text-muted-foreground">No COD submissions yet.</p></div> : (
        <div className="space-y-2">{subs.map(s => (
          <div key={s.id} className="border border-border rounded-lg bg-card p-3">
            <div className="flex items-start justify-between gap-2 mb-1"><div><div className="font-medium text-foreground text-sm" data-num>{s.submissionNo}</div><div className="text-[10px] text-muted-foreground">{s.riderName ?? '—'} · {bizDate(s.submittedDate)}</div></div><span className={`text-[9px] uppercase px-1.5 py-0.5 rounded ${s.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700' : s.status === 'submitted' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{s.status}</span></div>
            <div className="flex items-end justify-between"><div className="text-[10px] text-muted-foreground">Amount: <span data-num>{formatMoney(BigInt(s.requestedAmount))}</span> · Mode: {s.settlementMode}</div>{canConfirm && s.status === 'submitted' && <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setConfirmSub(s)}>Confirm</Button>}</div>
          </div>
        ))}</div>
      )}
      <AnimatePresence>{confirmSub && <ConfirmModal sub={confirmSub} onClose={() => setConfirmSub(null)} />}</AnimatePresence>
    </div>
  )
}

function ConfirmModal({ sub, onClose }: { sub: CodSubmission; onClose: () => void }) {
  const qc = useQueryClient()
  const [cashAmount, setCashAmount] = useState(formatMoney(BigInt(sub.requestedAmount), false))
  const [accountId, setAccountId] = useState('')
  const [feeDeduction, setFeeDeduction] = useState(formatMoney(BigInt(sub.riderFeeDeduction), false))
  const coaQ = useQuery({ queryKey: ['coa'], queryFn: () => fetch('/api/setup/coa').then(r => r.json()) })
  const accounts = (coaQ.data?.categories ?? []).flatMap((c: any) => c.accounts.filter((a: any) => a.isActive && c.type === 'Asset' && a.isBusinessAccount).map((a: any) => ({ id: a.id, code: a.code, name: a.name })))
  const mut = useMutation({
    mutationFn: async () => { const r = await fetch(`/api/cod-submissions/${sub.id}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmedCashAmount: cashAmount, receivedIntoAccountId: accountId, riderFeeDeduction: feeDeduction }) }); const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j },
    onSuccess: () => { toast.success('COD submission confirmed.'); void qc.invalidateQueries({ queryKey: ['cod-submissions'] }); void qc.invalidateQueries({ queryKey: ['trial-balance'] }); onClose() },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })
  return <Shell title={`Confirm ${sub.submissionNo}`} onClose={onClose}><div className="space-y-3">
    <div className="text-sm"><span className="text-muted-foreground">Rider:</span> {sub.riderName} · <span className="text-muted-foreground">Mode:</span> {sub.settlementMode}</div>
    <div className="text-sm"><span className="text-muted-foreground">Requested:</span> <span data-num>{formatMoney(BigInt(sub.requestedAmount))}</span></div>
    <div><Label className="text-xs text-muted-foreground">Cash Received (Rs)</Label><Input type="text" value={cashAmount} onChange={e => setCashAmount(e.target.value)} className="h-9 bg-background" data-num /></div>
    {sub.settlementMode === 'net' && <div><Label className="text-xs text-muted-foreground">Rider Fee Deduction (Rs)</Label><Input type="text" value={feeDeduction} onChange={e => setFeeDeduction(e.target.value)} className="h-9 bg-background" data-num /></div>}
    <div><Label className="text-xs text-muted-foreground">Received Into</Label><Select value={accountId} onValueChange={setAccountId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{accounts.map((a: any) => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select></div>
    <Button className="w-full" disabled={!accountId || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Confirming…' : 'Confirm & Post'}</Button>
  </div></Shell>
}

// ─── Rider Home (mobile-first for Rider role) ───
function RiderHome({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [modal, setModal] = useState<null | { type: 'delivered' | 'returned' | 'cod-submit'; order: DeliveryOrder }>(null)
  const [showDelivered, setShowDelivered] = useState(false)
  const [showLedger, setShowLedger] = useState(false)
  const dashQ = useQuery({ queryKey: ['rider-dashboard'], queryFn: () => fetch('/api/rider-dashboard').then(r => r.json()) })
  const ordersQ = useQuery<{ rows: DeliveryOrder[] }>({ queryKey: ['delivery-orders'], queryFn: () => fetch('/api/delivery-orders').then(r => r.json()) })
  const summary = dashQ.data?.summary
  const riderId = dashQ.data?.riderId
  const orders = ordersQ.data?.rows ?? []
  const activeOrders = orders.filter(o => o.status === 'assigned' || o.status === 'out_for_delivery')
  const deliveredOrders = orders.filter(o => o.status === 'delivered')

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-semibold tracking-tight text-foreground">My Deliveries</h1><p className="text-xs text-muted-foreground mt-0.5">{user.displayName}</p></div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {summary && <>
          <KPI label="Assigned" value={String(summary.assigned)} />
          <KPI label="Out for Delivery" value={String(summary.outForDelivery)} />
          <KPI label="Delivered Today" value={String(summary.deliveredToday)} />
          <KPI label="COD Pending" value={formatMoney(BigInt(summary.codPending), false)} />
        </>}
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => { setShowDelivered(!showDelivered); setShowLedger(false) }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium press-sm ${showDelivered ? 'bg-accent text-foreground' : 'bg-card text-muted-foreground'}`}><CheckCircle2 className="size-3.5" /> Delivered ({deliveredOrders.length})</button>
        {riderId && <button onClick={() => { setShowLedger(!showLedger); setShowDelivered(false) }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium press-sm ${showLedger ? 'bg-accent text-foreground' : 'bg-card text-muted-foreground'}`}><BookOpen className="size-3.5" /> My Ledger</button>}
      </div>

      {/* Active orders */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-2">Active Orders ({activeOrders.length})</h2>
        {activeOrders.length === 0 ? <div className="text-center py-8"><Package className="size-8 text-muted-foreground mx-auto mb-2 opacity-50" /><p className="text-sm text-muted-foreground">No active orders.</p></div> : (
          <div className="space-y-2">{activeOrders.map(o => (
            <div key={o.id} className="border border-border rounded-lg bg-card p-3">
              <div className="flex items-start justify-between gap-2 mb-2"><div><div className="font-medium text-foreground" data-num>{o.invoiceNo ?? '—'}</div><div className="text-[10px] text-muted-foreground">{o.customerName} · {o.customerPhone}</div></div><span className={`text-[9px] uppercase px-1.5 py-0.5 rounded border font-medium ${STATUS_BADGE[o.status] ?? 'bg-muted'}`}>{o.status.replace(/_/g, ' ')}</span></div>
              <div className="text-xs text-muted-foreground mb-2">{o.customerAddress}{o.customerCity ? `, ${o.customerCity}` : ''}</div>
              <div className="flex items-center justify-between mb-2"><div className="text-xs">COD: <span className="font-medium" data-num>{formatMoney(BigInt(o.totalCodAmount))}</span></div><div className="flex gap-1">
                {o.customerPhone && <a href={`tel:${o.customerPhone}`} className="text-xs text-primary flex items-center gap-1"><Phone className="size-3" /> Call</a>}
                {o.customerAddress && <a href={`https://maps.google.com/?q=${encodeURIComponent(o.customerAddress + ' ' + (o.customerCity ?? ''))}`} target="_blank" rel="noreferrer" className="text-xs text-primary flex items-center gap-1"><MapPin className="size-3" /> Map</a>}
              </div></div>
              <div className="flex gap-2">
                {o.status === 'assigned' && <Button size="sm" className="h-8 flex-1" onClick={async () => { try { const r = await fetch(`/api/delivery-orders/${o.id}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newStatus: 'out_for_delivery' }) }); if (!r.ok) throw new Error('Failed'); toast.success('Started delivery'); void qc.invalidateQueries({ queryKey: ['delivery-orders'] }); void qc.invalidateQueries({ queryKey: ['rider-dashboard'] }) } catch (e) { toast.error('Failed') } }}>Start Delivery</Button>}
                {o.status === 'out_for_delivery' && <><Button size="sm" className="h-8 flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => setModal({ type: 'delivered', order: o })}><CheckCircle2 className="size-3.5" /> Delivered</Button><Button size="sm" variant="outline" className="h-8 flex-1 text-rose-600" onClick={() => setModal({ type: 'returned', order: o })}><X className="size-3.5" /> Return</Button></>}
              </div>
            </div>
          ))}</div>
        )}
      </div>

      {/* Delivered orders with COD Submit */}
      {showDelivered && (
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-2">Delivered Orders ({deliveredOrders.length})</h2>
          <div className="space-y-2">{deliveredOrders.map(o => (
            <div key={o.id} className="border border-border rounded-lg bg-card p-3">
              <div className="flex items-start justify-between gap-2 mb-2"><div><div className="font-medium text-foreground" data-num>{o.invoiceNo ?? '—'}</div><div className="text-[10px] text-muted-foreground">{o.customerName}</div></div><span className="text-[9px] uppercase px-1.5 py-0.5 rounded border font-medium bg-emerald-50 text-emerald-700 border-emerald-200">Delivered</span></div>
              <div className="flex items-center justify-between"><div className="text-xs">COD: <span className="font-medium" data-num>{formatMoney(BigInt(o.totalCodAmount))}</span></div><Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setModal({ type: 'cod-submit', order: o })}><Wallet className="size-3" /> Submit COD</Button></div>
            </div>
          ))}</div>
        </div>
      )}

      {/* Rider Ledger */}
      {showLedger && riderId && <RiderLedgerInline riderId={riderId} riderName={user.displayName} />}

      <AnimatePresence>
        {modal?.type === 'delivered' && <DeliveredModal order={modal.order} onClose={() => setModal(null)} />}
        {modal?.type === 'returned' && <ReturnedModal order={modal.order} onClose={() => setModal(null)} />}
        {modal?.type === 'cod-submit' && <RiderCodSubmitModal order={modal.order} riderId={riderId ?? ''} onClose={() => setModal(null)} />}
      </AnimatePresence>
    </div>
  )
}

function RiderCodSubmitModal({ order, riderId, onClose }: { order: DeliveryOrder; riderId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [settlementMode, setSettlementMode] = useState('full')
  const [amount, setAmount] = useState(formatMoney(BigInt(order.totalCodAmount), false))
  const [feeDeduction, setFeeDeduction] = useState(formatMoney(BigInt(order.riderEarningAmount), false))
  const [result, setResult] = useState<{ ok: boolean; submissionNo?: string; error?: string } | null>(null)
  const mut = useMutation({
    mutationFn: async () => {
      const reqAmount = settlementMode === 'net' ? ((parseMoney(amount) ?? 0n) - (parseMoney(feeDeduction) ?? 0n)).toString() : amount
      const r = await fetch('/api/cod-submissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        riderId, items: [{ deliveryOrderId: order.id, amountAllocated: amount, riderFeeDeducted: settlementMode === 'net' ? feeDeduction : '0' }],
        settlementMode, requestedAmount: reqAmount,
      }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j
    },
    onSuccess: (j) => { toast.success(`COD submission created: ${j.submissionNo}`); setResult({ ok: true, submissionNo: j.submissionNo }); void qc.invalidateQueries({ queryKey: ['cod-submissions'] }); void qc.invalidateQueries({ queryKey: ['rider-dashboard'] }) },
    onError: (e: Error) => { setResult({ ok: false, error: e.message }); toast.error(`Failed: ${e.message}`) },
  })
  const amt = parseMoney(amount) ?? 0n
  const canPost = amt > 0n

  if (result?.ok) return <Shell title="COD Submission Created" onClose={onClose}><div className="text-center py-4"><CheckCircle2 className="size-12 text-primary mx-auto mb-3" /><p className="text-xs text-muted-foreground mb-1">Submission created</p><p className="text-2xl font-bold text-primary" data-num>{result.submissionNo}</p><p className="text-xs text-muted-foreground mt-2">An Owner or Accountant will confirm this submission.</p><Button variant="ghost" size="sm" className="mt-4" onClick={onClose}>Close</Button></div></Shell>

  return <Shell title="Submit COD" onClose={onClose}><div className="space-y-3">
    <div className="text-sm"><span className="text-muted-foreground">Order:</span> <span className="font-medium" data-num>{order.invoiceNo}</span></div>
    <div className="text-sm"><span className="text-muted-foreground">Total COD:</span> <span className="font-medium" data-num>{formatMoney(BigInt(order.totalCodAmount))}</span></div>
    <div><Label className="text-xs text-muted-foreground">Settlement Mode</Label><Select value={settlementMode} onValueChange={setSettlementMode}><SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="full">Submit Full COD</SelectItem><SelectItem value="net">Deduct Rider Delivery Fees</SelectItem></SelectContent></Select></div>
    <div><Label className="text-xs text-muted-foreground">Amount (Rs)</Label><Input type="text" value={amount} onChange={e => setAmount(e.target.value)} className="h-9 bg-background" data-num /></div>
    {settlementMode === 'net' && <div><Label className="text-xs text-muted-foreground">Rider Fee Deduction (Rs)</Label><Input type="text" value={feeDeduction} onChange={e => setFeeDeduction(e.target.value)} className="h-9 bg-background" data-num /></div>}
    {result && !result.ok && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> {result.error}</div>}
    <Button className="w-full" disabled={!canPost || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Submitting…' : 'Submit COD'}</Button>
  </div></Shell>
}

function RiderLedgerInline({ riderId, riderName }: { riderId: string; riderName: string }) {
  const q = useQuery<{ rows: any[] }>({ queryKey: ['rider-ledger', riderId], queryFn: () => fetch(`/api/rider-ledger/${riderId}`).then(r => r.json()), enabled: !!riderId, retry: 1, retryDelay: 500 })
  const rows = q.data?.rows ?? []
  const finalCod = rows.length > 0 ? BigInt(rows[rows.length - 1].runningCodBalance) : 0n
  const finalEarning = rows.length > 0 ? BigInt(rows[rows.length - 1].runningEarningBalance) : 0n
  return (
    <div>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <div className="border border-border rounded-lg p-2 bg-muted/30"><div className="text-[9px] uppercase text-muted-foreground">COD Pending</div><div className={`text-sm font-bold ${finalCod > 0n ? 'text-amber-600' : 'text-foreground'}`} data-num>{formatMoney(finalCod)}</div></div>
        <div className="border border-border rounded-lg p-2 bg-muted/30"><div className="text-[9px] uppercase text-muted-foreground">Earnings Payable</div><div className={`text-sm font-bold ${finalEarning > 0n ? 'text-emerald-600' : 'text-foreground'}`} data-num>{formatMoney(finalEarning)}</div></div>
      </div>
      {q.isLoading ? <div className="text-center py-4 text-sm text-muted-foreground animate-pulse">Loading…</div> : rows.length === 0 ? <div className="text-center py-4 text-sm text-muted-foreground">No entries yet.</div> : (
        <div className="space-y-1">{rows.slice(-5).map((r, i) => (
          <div key={i} className="flex items-center justify-between text-xs border-b border-border/30 py-1.5">
            <div><span className="text-[8px] uppercase px-1 py-0.5 rounded bg-muted text-muted-foreground mr-1">{r.eventType}</span><span className="text-muted-foreground" data-num>{r.reference?.slice(0, 12) ?? '—'}</span></div>
            <div className="text-right"><span className="font-medium" data-num>{formatMoney(BigInt(r.runningCodBalance), false)}</span></div>
          </div>
        ))}</div>
      )}
    </div>
  )
}
