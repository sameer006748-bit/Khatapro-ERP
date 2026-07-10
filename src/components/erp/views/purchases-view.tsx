'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Plus, Search, Package, Wallet, TrendingDown, X, CheckCircle2, AlertCircle, MoreVertical, History, Printer, FileText, ArrowLeft } from 'lucide-react'
import { formatMoney } from '@/lib/format'
import { bizDate } from '@/lib/dates'
import { motion, AnimatePresence } from 'framer-motion'
import type { MeUser } from '@/components/erp/erp-app'

type Purchase = { id: string; purchaseNo: string; vendorId: string; vendorName: string | null; supplierBillNo: string | null; purchaseDate: string; total: string; paidAmount: string; outstandingAmount: string; status: string }
type Vendor = { id: string; name: string; phone: string | null }
type Product = { id: string; name: string; currentStock: number; purchasePrice: number }
type Account = { id: string; code: string; name: string }
type PurchaseDetail = Purchase & { subtotal: string; discount: string; additionalCharges: string; notes: string | null; voucherId: string | null; items?: Array<{ id: string; productId: string | null; productName: string; quantity: number; unitCost: string; lineTotal: string; returnedQuantity: number }>; payments?: Array<{ id: string; accountId: string; amount: string; paymentType: string; paymentDate: string; notes: string | null }> }

type CartItem = { key: string; productId: string; productName: string; qty: string; unitCost: string }
type Payment = { accountId: string; amountPaisas: string; paymentType: string }

const STATUS_BADGE: Record<string, string> = { posted: 'bg-sky-50 text-sky-700 border-sky-200', partially_paid: 'bg-amber-50 text-amber-700 border-amber-200', paid: 'bg-emerald-50 text-emerald-700 border-emerald-200', returned: 'bg-red-50 text-red-700 border-red-200', partially_returned: 'bg-amber-50 text-amber-700 border-amber-200' }

export function PurchasesView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const canCreate = user.permissions.includes('can_create_purchases')
  const canPay = user.permissions.includes('can_pay_vendors')
  const canReturn = user.permissions.includes('can_return_purchases')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [modal, setModal] = useState<'add' | 'pay' | 'return' | 'detail' | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [payPurchase, setPayPurchase] = useState<Purchase | null>(null)
  const [returnPurchase, setReturnPurchase] = useState<PurchaseDetail | null>(null)

  const purchasesQ = useQuery<{ rows: Purchase[] }>({ queryKey: ['purchases'], queryFn: () => fetch('/api/purchases').then(r => r.json()) })

  const purchases = purchasesQ.data?.rows ?? []
  const filtered = useMemo(() => {
    let r = purchases
    if (search) { const q = search.toLowerCase(); r = r.filter(p => p.purchaseNo.toLowerCase().includes(q) || (p.vendorName ?? '').toLowerCase().includes(q) || (p.supplierBillNo ?? '').toLowerCase().includes(q)) }
    if (filter === 'unpaid') r = r.filter(p => p.status === 'posted')
    if (filter === 'partial') r = r.filter(p => p.status === 'partially_paid')
    if (filter === 'paid') r = r.filter(p => p.status === 'paid')
    if (filter === 'returned') r = r.filter(p => p.status === 'returned' || p.status === 'partially_returned')
    return r
  }, [purchases, search, filter])

  const kpis = useMemo(() => {
    const total = purchases.reduce((s, p) => s + BigInt(p.total), 0n)
    const paid = purchases.reduce((s, p) => s + BigInt(p.paidAmount), 0n)
    const payable = purchases.reduce((s, p) => s + BigInt(p.outstandingAmount), 0n)
    const now = new Date(); const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const thisMonth = purchases.filter(p => p.purchaseDate.startsWith(monthStr)).reduce((s, p) => s + BigInt(p.total), 0n)
    return { total, paid, payable, thisMonth }
  }, [purchases])

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div><h1 className="text-xl font-semibold tracking-tight text-foreground">Purchases</h1><p className="text-xs text-muted-foreground mt-0.5">Purchase bills, vendor payments and stock receipts</p></div>
        {canCreate && <Button size="sm" className="h-8 press-sm shadow-sm" onClick={() => setModal('add')}><Plus className="size-3.5" /> Add Purchase</Button>}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <KPI icon={Package} label="Total Purchases" value={formatMoney(kpis.total)} />
        <KPI icon={Wallet} label="Amount Paid" value={formatMoney(kpis.paid)} />
        <KPI icon={TrendingDown} label="Payables" value={formatMoney(kpis.payable)} warn={kpis.payable > 0n} />
        <KPI icon={Package} label="This Month" value={formatMoney(kpis.thisMonth)} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by PUR no, vendor, bill…" className="h-9 bg-background pl-8 press-sm" /></div>
        <div className="flex gap-1">{['all', 'unpaid', 'partial', 'paid', 'returned'].map(f => <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1.5 rounded-md text-xs font-medium press-sm ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}>{f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}</button>)}</div>
      </div>

      {/* List */}
      {purchasesQ.isLoading ? <div className="text-center py-8 text-sm text-muted-foreground">Loading…</div> : filtered.length === 0 ? <div className="text-center py-8"><Package className="size-8 text-muted-foreground mx-auto mb-2 opacity-50" /><p className="text-sm text-muted-foreground">{search || filter !== 'all' ? 'No purchases match.' : 'No purchases yet. Click "Add Purchase" to get started.'}</p></div> : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block border border-border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm"><thead className="bg-muted/50 border-b border-border"><tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-3 py-2 font-medium">PUR No</th><th className="text-left px-3 py-2 font-medium">Date</th><th className="text-left px-3 py-2 font-medium">Vendor</th><th className="text-left px-3 py-2 font-medium">Bill No</th><th className="text-right px-3 py-2 font-medium">Total</th><th className="text-right px-3 py-2 font-medium">Paid</th><th className="text-right px-3 py-2 font-medium">Outstanding</th><th className="text-left px-3 py-2 font-medium">Status</th><th className="text-center px-3 py-2 font-medium w-16">·</th>
            </tr></thead><tbody>
              {filtered.map(p => <tr key={p.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20 cursor-pointer" onClick={() => { setDetailId(p.id); setModal('detail') }}>
                <td className="px-3 py-2 font-medium text-foreground" data-num>{p.purchaseNo}</td><td className="px-3 py-2 text-xs text-muted-foreground" data-num>{bizDate(p.purchaseDate)}</td><td className="px-3 py-2 text-foreground">{p.vendorName ?? '—'}</td><td className="px-3 py-2 text-xs text-muted-foreground">{p.supplierBillNo ?? '—'}</td><td className="px-3 py-2 text-right font-medium" data-num>{formatMoney(BigInt(p.total), false)}</td><td className="px-3 py-2 text-right text-muted-foreground" data-num>{formatMoney(BigInt(p.paidAmount), false)}</td><td className="px-3 py-2 text-right" data-num>{BigInt(p.outstandingAmount) > 0n ? formatMoney(BigInt(p.outstandingAmount), false) : '—'}</td><td className="px-3 py-2"><span className={`text-[9px] uppercase px-1.5 py-0.5 rounded border font-medium ${STATUS_BADGE[p.status] ?? 'bg-muted text-muted-foreground'}`}>{p.status.replace(/_/g, ' ')}</span></td><td className="px-3 py-2 text-center"><button onClick={e => { e.stopPropagation(); setDetailId(p.id); setModal('detail') }} className="text-muted-foreground hover:text-foreground"><MoreVertical className="size-4" /></button></td>
              </tr>)}
            </tbody></table>
          </div>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2">{filtered.map(p => <div key={p.id} className="border border-border rounded-lg bg-card p-3" onClick={() => { setDetailId(p.id); setModal('detail') }}>
            <div className="flex items-start justify-between gap-2 mb-1"><div><div className="font-medium text-foreground text-sm" data-num>{p.purchaseNo}</div><div className="text-[10px] text-muted-foreground">{p.vendorName ?? '—'} · {bizDate(p.purchaseDate)}</div></div><span className={`text-[9px] uppercase px-1.5 py-0.5 rounded border font-medium ${STATUS_BADGE[p.status] ?? 'bg-muted'}`}>{p.status.replace(/_/g, ' ')}</span></div>
            <div className="flex items-end justify-between"><div className="text-[10px] text-muted-foreground">Total: <span data-num>{formatMoney(BigInt(p.total))}</span></div>{BigInt(p.outstandingAmount) > 0n && <div className="text-[10px] text-amber-600">Owe: <span data-num>{formatMoney(BigInt(p.outstandingAmount))}</span></div>}</div>
          </div>)}</div>
        </>
      )}

      {/* Modals */}
      <AnimatePresence>
        {modal === 'add' && <AddPurchaseModal user={user} onClose={() => setModal(null)} />}
        {modal === 'detail' && detailId && <PurchaseDetailModal purchaseId={detailId} user={user} canPay={canPay} canReturn={canReturn} onClose={() => { setModal(null); setDetailId(null) }} onPay={(p) => { setModal('pay'); setPayPurchase(p) }} onReturn={(p) => { setModal('return'); setReturnPurchase(p) }} />}
        {modal === 'pay' && payPurchase && <PayVendorModal purchase={payPurchase} user={user} onClose={() => { setModal('detail') }} />}
        {modal === 'return' && returnPurchase && <ReturnModal purchase={returnPurchase} user={user} onClose={() => { setModal('detail') }} />}
      </AnimatePresence>
    </div>
  )
}

function KPI({ icon: Icon, label, value, warn }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; warn?: boolean }) {
  return <div className={`border rounded-lg bg-card p-3 ${warn ? 'border-amber-200' : 'border-border'}`}><div className="flex items-center gap-1.5 mb-1"><Icon className={`size-3 ${warn ? 'text-amber-500' : 'text-muted-foreground'}`} /><span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span></div><div className={`text-base font-bold ${warn ? 'text-amber-700' : 'text-foreground'}`} data-num>{value}</div></div>
}

function Shell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}><motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className={`border border-border rounded-xl bg-card shadow-xl p-5 w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[85vh] overflow-y-auto`} onClick={e => e.stopPropagation()}><div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-foreground">{title}</h3><button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button></div>{children}</motion.div></div>
}

function AddPurchaseModal({ user, onClose }: { user: MeUser; onClose: () => void }) {
  const qc = useQueryClient()
  const [vendorId, setVendorId] = useState('')
  const [supplierBillNo, setSupplierBillNo] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10))
  const [cart, setCart] = useState<CartItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([{ accountId: '', amountPaisas: '', paymentType: 'purchase_payment' }])
  const [search, setSearch] = useState('')
  const [result, setResult] = useState<{ ok: boolean; purchaseNo?: string; purchaseId?: string; error?: string } | null>(null)

  const vendorsQ = useQuery<{ rows: Vendor[] }>({ queryKey: ['vendors'], queryFn: () => fetch('/api/vendors').then(r => r.json()) })
  const productsQ = useQuery<{ rows: Product[] }>({ queryKey: ['products'], queryFn: () => fetch('/api/products').then(r => r.json()) })
  const coaQ = useQuery({ queryKey: ['coa'], queryFn: () => fetch('/api/setup/coa').then(r => r.json()) })
  const accounts: Account[] = useMemo(() => coaQ.data?.categories?.flatMap((c: any) => c.accounts).filter((a: any) => a.isBusinessAccount && a.isActive).map((a: any) => ({ id: a.id, code: a.code, name: a.name })) ?? [], [coaQ.data])

  const subtotal = useMemo(() => cart.reduce((s, it) => s + (BigInt(it.unitCost || '0') * BigInt(it.qty || '0')), 0n), [cart])
  const totalPaisas = subtotal
  const filteredProducts = productsQ.data?.rows?.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8) ?? []

  const mut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/purchases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vendorId, purchaseDate, supplierBillNo: supplierBillNo || undefined, items: cart.map(it => ({ productId: it.productId || null, productName: it.productName, quantity: parseInt(it.qty) || 1, unitCostPaisas: it.unitCost })), payments: payments.map(p => ({ accountId: p.accountId, amountPaisas: p.amountPaisas, paymentType: p.paymentType })) }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j
    },
    onSuccess: (j) => { toast.success(`Purchase posted: ${j.purchaseNo}`); setResult({ ok: true, purchaseNo: j.purchaseNo, purchaseId: j.purchaseId }); void qc.invalidateQueries({ queryKey: ['purchases'] }); void qc.invalidateQueries({ queryKey: ['products'] }) },
    onError: (e: Error) => { setResult({ ok: false, error: e.message }); toast.error(`Failed: ${e.message}`) },
  })

  if (result?.ok) return <Shell title="Purchase Posted" onClose={onClose}><div className="text-center py-4"><CheckCircle2 className="size-12 text-primary mx-auto mb-3" /><p className="text-2xl font-bold text-primary" data-num>{result.purchaseNo}</p><div className="mt-4 flex flex-col gap-2"><Button size="sm" onClick={() => window.open(`/?purchase=${result.purchaseId}`, '_self')}>View Purchase</Button><Button variant="outline" size="sm" onClick={() => window.print()}>Print</Button><Button variant="ghost" size="sm" onClick={() => { setResult(null); setCart([]); setPayments([{ accountId: '', amountPaisas: '', paymentType: 'purchase_payment' }]); setVendorId(''); setSupplierBillNo('') }}>New Purchase</Button></div></div></Shell>

  function addProduct(pid: string) { const p = productsQ.data?.rows.find(x => x.id === pid); if (p) { setCart(ls => [...ls, { key: String(Date.now()), productId: pid, productName: p.name, qty: '1', unitCost: String(p.purchasePrice * 100) }]); setSearch('') } }
  const canPost = vendorId && cart.length > 0 && cart.every(it => it.qty && it.unitCost) && payments.every(p => p.paymentType === 'credit' || (p.accountId && p.amountPaisas))

  return <Shell title="Add Purchase" onClose={onClose} wide>
    <div className="grid lg:grid-cols-3 gap-4">
      {/* Left: vendor + items */}
      <div className="lg:col-span-2 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs text-muted-foreground">Vendor *</Label><Select value={vendorId} onValueChange={setVendorId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select…" /></SelectTrigger><SelectContent>{vendorsQ.data?.rows.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs text-muted-foreground">Date</Label><Input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} className="h-9 bg-background" data-num /></div>
        </div>
        <Input value={supplierBillNo} onChange={e => setSupplierBillNo(e.target.value)} placeholder="Supplier bill no (optional)" className="h-9 bg-background" />
        {/* Product search */}
        <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…" className="h-9 bg-background pl-8" /></div>
        {filteredProducts.length > 0 && <div className="border border-border rounded-lg max-h-32 overflow-y-auto">{filteredProducts.map(p => <button key={p.id} onClick={() => addProduct(p.id)} className="w-full flex items-center justify-between p-2 hover:bg-muted/40 press-sm text-left"><span className="text-sm">{p.name}</span><Plus className="size-3 text-primary" /></button>)}</div>}
        {/* Cart */}
        <div className="space-y-1">{cart.map(it => <div key={it.key} className="flex items-center gap-2 p-2 border border-border/50 rounded">
          <span className="flex-1 text-sm truncate">{it.productName}</span>
          <Input type="number" value={it.qty} onChange={e => setCart(ls => ls.map(c => c.key === it.key ? { ...c, qty: e.target.value } : c))} className="h-7 w-14 bg-background text-sm" data-num />
          <Input type="text" value={it.unitCost} onChange={e => setCart(ls => ls.map(c => c.key === it.key ? { ...c, unitCost: e.target.value } : c))} className="h-7 w-20 bg-background text-sm" data-num />
          <span className="text-xs font-medium w-16 text-right" data-num>{formatMoney(BigInt(it.unitCost || '0') * BigInt(it.qty || '0'), false)}</span>
          <button onClick={() => setCart(ls => ls.filter(c => c.key !== it.key))} className="text-muted-foreground"><X className="size-3.5" /></button>
        </div>)}</div>
      </div>
      {/* Right: summary + payment */}
      <div className="space-y-3">
        <div className="border border-border rounded-lg p-3 bg-muted/30"><div className="text-xs text-muted-foreground mb-1">Total</div><div className="text-lg font-bold text-foreground" data-num>{formatMoney(totalPaisas)}</div></div>
        {/* Payment */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Payment</Label>
          {payments.map((p, i) => <div key={i} className="space-y-1">
            <Select value={p.paymentType} onValueChange={v => setPayments(ls => ls.map((x, j) => j === i ? { ...x, paymentType: v } : x))}><SelectTrigger className="h-8 bg-background text-sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="purchase_payment">Cash/Bank Payment</SelectItem><SelectItem value="credit">Credit (No Payment)</SelectItem></SelectContent></Select>
            {p.paymentType !== 'credit' && <><Select value={p.accountId} onValueChange={v => setPayments(ls => ls.map((x, j) => j === i ? { ...x, accountId: v } : x))}><SelectTrigger className="h-8 bg-background text-sm"><SelectValue placeholder="Account…" /></SelectTrigger><SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select>
            <Input type="text" value={p.amountPaisas} onChange={e => setPayments(ls => ls.map((x, j) => j === i ? { ...x, amountPaisas: e.target.value } : x))} placeholder="Amount (paisas)" className="h-8 bg-background text-sm" data-num /></>}
          </div>)}
          <button onClick={() => setPayments(ls => [...ls, { accountId: '', amountPaisas: '', paymentType: 'purchase_payment' }])} className="text-xs text-primary">+ Add payment</button>
        </div>
        {result && !result.ok && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> {result.error}</div>}
        <Button className="w-full" disabled={!canPost || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Posting…' : 'Post Purchase'}</Button>
      </div>
    </div>
  </Shell>
}

function PurchaseDetailModal({ purchaseId, user, canPay, canReturn, onClose, onPay, onReturn }: { purchaseId: string; user: MeUser; canPay: boolean; canReturn: boolean; onClose: () => void; onPay: (p: Purchase) => void; onReturn: (p: PurchaseDetail) => void }) {
  const q = useQuery<{ purchase: PurchaseDetail }>({ queryKey: ['purchase', purchaseId], queryFn: () => fetch(`/api/purchases/${purchaseId}`).then(r => r.json()), enabled: !!purchaseId, retry: 1, retryDelay: 500 })
  if (q.isLoading) return <Shell title="Loading…" onClose={onClose}><div className="text-center py-4 text-sm text-muted-foreground animate-pulse">Loading purchase…</div></Shell>
  if (q.isError || !q.data?.purchase) return <Shell title="Error" onClose={onClose}><div className="text-center py-4"><p className="text-sm text-destructive mb-3">Unable to load purchase.</p><Button variant="outline" size="sm" onClick={() => q.refetch()}>Retry</Button></div></Shell>
  const p = q.data.purchase
  const outstanding = BigInt(p.outstandingAmount)
  return <Shell title={p.purchaseNo} onClose={onClose} wide>
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div><span className="text-muted-foreground">Vendor:</span> <span className="font-medium text-foreground">{p.vendorName ?? '—'}</span></div>
        <div><span className="text-muted-foreground">Date:</span> <span data-num>{bizDate(p.purchaseDate)}</span></div>
        <div><span className="text-muted-foreground">Bill No:</span> {p.supplierBillNo ?? '—'}</div>
        <div><span className="text-muted-foreground">Status:</span> <span className={`text-[9px] uppercase px-1 py-0.5 rounded border ${STATUS_BADGE[p.status] ?? 'bg-muted'}`}>{p.status.replace(/_/g, ' ')}</span></div>
      </div>
      {/* Items */}
      <div className="border border-border rounded-lg overflow-hidden"><table className="w-full text-sm"><thead className="bg-muted/50"><tr className="text-[10px] uppercase text-muted-foreground"><th className="text-left px-2 py-1.5">Item</th><th className="text-right px-2 py-1.5">Qty</th><th className="text-right px-2 py-1.5">Cost</th><th className="text-right px-2 py-1.5">Total</th></tr></thead><tbody>{p.items?.map(it => <tr key={it.id} className="border-t border-border/40"><td className="px-2 py-1.5">{it.productName}{it.returnedQuantity > 0 && <span className="text-[9px] text-red-600 ml-1">(-{it.returnedQuantity} ret)</span>}</td><td className="text-right px-2 py-1.5" data-num>{it.quantity}</td><td className="text-right px-2 py-1.5" data-num>{formatMoney(BigInt(it.unitCost), false)}</td><td className="text-right px-2 py-1.5 font-medium" data-num>{formatMoney(BigInt(it.lineTotal), false)}</td></tr>)}</tbody></table></div>
      {/* Totals */}
      <div className="flex justify-end"><div className="text-xs space-y-0.5 min-w-[160px]"><div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span data-num>{formatMoney(BigInt(p.subtotal), false)}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-bold" data-num>{formatMoney(BigInt(p.total))}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="text-primary" data-num>{formatMoney(BigInt(p.paidAmount))}</span></div>{outstanding > 0n && <div className="flex justify-between"><span className="text-muted-foreground">Outstanding</span><span className="text-amber-600 font-medium" data-num>{formatMoney(outstanding)}</span></div>}</div></div>
      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t border-border">
        <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="size-3.5" /> Print</Button>
        {canPay && outstanding > 0n && <Button size="sm" onClick={() => onPay(p)}><Wallet className="size-3.5" /> Pay Vendor</Button>}
        {canReturn && <Button variant="outline" size="sm" onClick={() => onReturn(p)}><TrendingDown className="size-3.5" /> Return Items</Button>}
      </div>
    </div>
  </Shell>
}

function PayVendorModal({ purchase, user, onClose }: { purchase: Purchase; user: MeUser; onClose: () => void }) {
  const qc = useQueryClient()
  const [accountId, setAccountId] = useState('')
  const [amountPaisas, setAmountPaisas] = useState(purchase.outstandingAmount)
  const [notes, setNotes] = useState('')
  const coaQ = useQuery({ queryKey: ['coa'], queryFn: () => fetch('/api/setup/coa').then(r => r.json()) })
  const accounts: Account[] = useMemo(() => coaQ.data?.categories?.flatMap((c: any) => c.accounts).filter((a: any) => a.isBusinessAccount && a.isActive).map((a: any) => ({ id: a.id, code: a.code, name: a.name })) ?? [], [coaQ.data])
  const mut = useMutation({
    mutationFn: async () => { const r = await fetch(`/api/purchases/${purchase.id}/payment`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vendorId: purchase.vendorId, accountId, amountPaisas, notes: notes || undefined }) }); const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j },
    onSuccess: () => { toast.success('Vendor payment posted.'); void qc.invalidateQueries({ queryKey: ['purchases'] }); void qc.invalidateQueries({ queryKey: ['purchase', purchase.id] }); onClose() },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })
  return <Shell title="Pay Vendor" onClose={onClose}>
    <div className="space-y-3">
      <div className="text-sm"><span className="text-muted-foreground">Purchase:</span> <span className="font-medium" data-num>{purchase.purchaseNo}</span></div>
      <div className="text-sm"><span className="text-muted-foreground">Outstanding:</span> <span className="font-bold text-amber-600" data-num>{formatMoney(BigInt(purchase.outstandingAmount))}</span></div>
      <div><Label className="text-xs text-muted-foreground">Pay From</Label><Select value={accountId} onValueChange={setAccountId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></div>
      <div><Label className="text-xs text-muted-foreground">Amount (paisas)</Label><Input type="text" value={amountPaisas} onChange={e => setAmountPaisas(e.target.value)} className="h-9 bg-background" data-num /></div>
      <div><Label className="text-xs text-muted-foreground">Note</Label><Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" className="h-9 bg-background" /></div>
      <Button className="w-full" disabled={!accountId || !amountPaisas || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Paying…' : 'Pay Vendor'}</Button>
    </div>
  </Shell>
}

function ReturnModal({ purchase, user, onClose }: { purchase: PurchaseDetail; user: MeUser; onClose: () => void }) {
  const qc = useQueryClient()
  const [returnQty, setReturnQty] = useState<Record<string, string>>({})
  const [settlementType, setSettlementType] = useState('reduce_payable')
  const [notes, setNotes] = useState('')
  const mut = useMutation({
    mutationFn: async () => {
      const items = (purchase.items ?? []).filter(it => parseInt(returnQty[it.id] || '0') > 0).map(it => ({ purchaseItemId: it.id, productId: it.productId, productName: it.productName, quantity: parseInt(returnQty[it.id]), unitCostPaisas: it.unitCost }))
      const r = await fetch(`/api/purchases/${purchase.id}/return`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnItems: items, settlementType, notes: notes || undefined }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j
    },
    onSuccess: () => { toast.success('Purchase return posted.'); void qc.invalidateQueries({ queryKey: ['purchases'] }); void qc.invalidateQueries({ queryKey: ['purchase', purchase.id] }); void qc.invalidateQueries({ queryKey: ['products'] }); onClose() },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })
  return <Shell title="Return Items" onClose={onClose} wide>
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">{purchase.purchaseNo} · {purchase.vendorName}</div>
      <div className="space-y-1">{purchase.items?.map(it => <div key={it.id} className="flex items-center gap-2 p-2 border border-border/50 rounded"><span className="flex-1 text-sm">{it.productName}</span><span className="text-xs text-muted-foreground">Qty: {it.quantity}</span><Input type="number" value={returnQty[it.id] || ''} onChange={e => setReturnQty(s => ({ ...s, [it.id]: e.target.value }))} placeholder="0" className="h-7 w-16 bg-background text-sm" data-num /></div>)}</div>
      <div><Label className="text-xs text-muted-foreground">Settlement</Label><Select value={settlementType} onValueChange={setSettlementType}><SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="reduce_payable">Reduce Payable</SelectItem><SelectItem value="vendor_refund">Vendor Refund</SelectItem><SelectItem value="vendor_credit">Vendor Credit</SelectItem></SelectContent></Select></div>
      <div><Label className="text-xs text-muted-foreground">Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" className="h-9 bg-background" /></div>
      <Button className="w-full" disabled={mut.isPending || !Object.values(returnQty).some(v => parseInt(v) > 0)} onClick={() => mut.mutate()}>{mut.isPending ? 'Posting…' : 'Post Return'}</Button>
    </div>
  </Shell>
}
