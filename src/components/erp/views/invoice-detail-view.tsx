'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { formatMoney } from '@/lib/format'
import { bizDate } from '@/lib/dates'
import { ArrowLeft, Printer, RotateCcw, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { PrintInvoiceButton } from '@/components/invoice/print-invoice-button'

type Invoice = {
  id: string
  invoiceNo: string
  invoiceType: string
  invoiceDate: string
  customerName: string | null
  customerPhone: string | null
  customerAddress: string | null
  customerCity: string | null
  salesmanName: string | null
  subtotal: string
  total: string
  paidAmount: string
  isCancelled: boolean
  isReturned: boolean
  memo: string | null
  items?: Array<{ id: string; productId: string | null; productName: string; qty: number; unitPrice: string; lineTotal: string; isTemporary: boolean }>
  payments?: Array<{ id: string; accountId: string; accountCode: string; accountName: string; amount: string; isChange: boolean }>
}

const TYPE_BADGE: Record<string, string> = {
  COUNTER: 'bg-emerald-100 text-emerald-700',
  ONLINE: 'bg-sky-100 text-sky-700',
  OFC: 'bg-violet-100 text-violet-700',
}

export function InvoiceDetailView({ invoiceId }: { invoiceId: string }) {
  const router = useRouter()
  const qc = useQueryClient()
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const [printOpen, setPrintOpen] = useState(false)

  const q = useQuery<{ invoice: Invoice }>({
    queryKey: ['invoice', invoiceId],
    queryFn: () => fetch(`/api/sales/${invoiceId}`).then(r => r.json()),
    enabled: !!invoiceId,
    retry: 1,
    retryDelay: 500,
  })

  const returnMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/sales/${invoiceId}/return`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: returnReason || undefined }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error ?? 'RETURN_FAILED')
      return j
    },
    onSuccess: () => {
      toast.success('Sales return posted. Stock restored. Reversing voucher posted.')
      void qc.invalidateQueries({ queryKey: ['invoice', invoiceId] })
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      void qc.invalidateQueries({ queryKey: ['trial-balance'] })
      void qc.invalidateQueries({ queryKey: ['products'] })
      setReturnOpen(false)
      setReturnReason('')
    },
    onError: (e: Error) => toast.error(`Return failed: ${e.message}`),
  })

  if (!invoiceId) return null
  if (q.isLoading) return (
    <div className="card-3d p-8 text-center">
      <div className="animate-pulse text-sm text-muted-foreground">Loading invoice…</div>
    </div>
  )
  if (q.isError || !q.data?.invoice) {
    const errorData = q.data as any
    const errorMsg = errorData?.error === 'FORBIDDEN'
      ? 'You do not have permission to view this invoice.'
      : errorData?.error === 'UNAUTHORIZED'
      ? 'Please sign in again.'
      : q.isError
      ? 'Unable to load invoice. Please try again.'
      : 'Invoice not found.'
    return (
      <div className="card-3d p-8 text-center">
        <p className="text-sm text-destructive mb-4">{errorMsg}</p>
        <Button variant="outline" size="sm" className="press-sm" onClick={() => q.refetch()}>Retry</Button>
      </div>
    )
  }

  const inv = q.data.invoice
  const outstanding = BigInt(inv.total) - BigInt(inv.paidAmount)

  function back() { router.push('/') }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <button onClick={back} className="flex items-center text-xs text-muted-foreground hover:text-foreground press-sm"><ArrowLeft className="size-3.5 mr-1.5" /> Back</button>

      {/* Invoice header */}
      <div className="card-3d p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium ${TYPE_BADGE[inv.invoiceType]}`} data-num>{inv.invoiceType}</span>
              <span className="text-2xl font-semibold text-foreground tracking-tight" data-num>{inv.invoiceNo}</span>
            </div>
            <div className="text-xs text-muted-foreground" data-num>{bizDate(inv.invoiceDate)}</div>
            {inv.salesmanName && <div className="text-xs text-muted-foreground mt-1">Salesman: {inv.salesmanName}</div>}
          </div>
          <div className="flex gap-2">
            <PrintInvoiceButton invoiceId={inv.id} label="Print" size="sm" icon={Printer} />
            {!inv.isReturned && !inv.isCancelled && (
              <Button variant="outline" size="sm" className="press-sm text-amber-700" onClick={() => setReturnOpen(true)}><RotateCcw className="size-3.5" /> Return</Button>
            )}
          </div>
        </div>
        {inv.isReturned && <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-700">This invoice has been returned. Reversing voucher posted. Stock restored.</div>}
      </div>

      {/* Customer info */}
      {(inv.customerName || inv.customerPhone) && (
        <div className="card-3d p-5">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Customer</h2>
          <div className="text-sm text-foreground">{inv.customerName ?? 'Walk-in'}</div>
          {inv.customerPhone && <div className="text-xs text-muted-foreground mt-0.5" data-num>{inv.customerPhone}</div>}
          {inv.customerAddress && <div className="text-xs text-muted-foreground">{inv.customerAddress}{inv.customerCity ? `, ${inv.customerCity}` : ''}</div>}
        </div>
      )}

      {/* Items */}
      <div className="card-3d overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border"><h2 className="text-sm font-semibold text-foreground">Items</h2></div>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
            <th className="text-left p-3.5 font-medium">Item</th><th className="text-right p-3.5 font-medium">Qty</th><th className="text-right p-3.5 font-medium">Unit Price</th><th className="text-right p-3.5 font-medium">Total</th>
          </tr></thead>
          <tbody>
            {inv.items?.map(it => (
              <tr key={it.id} className="border-b border-border/60 last:border-0">
                <td className="p-3.5 text-foreground">{it.productName}{it.isTemporary && <span className="ml-2 text-[10px] uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Temp</span>}</td>
                <td className="p-3.5 text-right" data-num>{it.qty}</td>
                <td className="p-3.5 text-right" data-num>{formatMoney(BigInt(it.unitPrice), false)}</td>
                <td className="p-3.5 text-right font-medium" data-num>{formatMoney(BigInt(it.lineTotal), false)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-5 py-3 border-t border-border bg-muted/30 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span><span className="font-semibold text-foreground" data-num>{formatMoney(BigInt(inv.subtotal))}</span>
        </div>
      </div>

      {/* Payments */}
      {inv.payments && inv.payments.length > 0 && (
        <div className="card-3d overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border"><h2 className="text-sm font-semibold text-foreground">Payments</h2></div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
              <th className="text-left p-3.5 font-medium">Account</th><th className="text-left p-3.5 font-medium">Type</th><th className="text-right p-3.5 font-medium">Amount</th>
            </tr></thead>
            <tbody>
              {inv.payments.map(p => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="p-3.5 text-foreground">{p.accountName} <span className="text-xs text-muted-foreground" data-num>({p.accountCode})</span></td>
                  <td className="p-3.5">{p.isChange ? <span className="text-[10px] uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Change</span> : <span className="text-[10px] uppercase bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">Payment</span>}</td>
                  <td className="p-3.5 text-right font-medium" data-num>{formatMoney(BigInt(p.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5 py-3 border-t border-border bg-muted/30 grid grid-cols-3 gap-2 text-sm">
            <div><div className="text-[10px] uppercase text-muted-foreground">Total</div><div className="font-semibold text-foreground" data-num>{formatMoney(BigInt(inv.total))}</div></div>
            <div><div className="text-[10px] uppercase text-muted-foreground">Paid</div><div className="font-semibold text-primary" data-num>{formatMoney(BigInt(inv.paidAmount))}</div></div>
            <div className="text-right"><div className="text-[10px] uppercase text-muted-foreground">Outstanding</div><div className={`font-semibold ${outstanding > 0n ? 'text-amber-600' : 'text-primary'}`} data-num>{formatMoney(outstanding)}</div></div>
          </div>
        </div>
      )}

      {/* Return modal */}
      {returnOpen && (
        <div className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={() => setReturnOpen(false)}>
          <div className="card-3d p-6 w-full max-w-md sheet-enter" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground mb-2">Post sales return?</h3>
            <p className="text-xs text-muted-foreground mb-4">This will post a reversing voucher, restore stock, and mark the invoice as returned. Already-accrued commission will NOT be reversed.</p>
            <textarea value={returnReason} onChange={e => setReturnReason(e.target.value)} placeholder="Reason (optional)" className="w-full bg-background border border-border rounded-lg p-3 text-sm mb-4 min-h-[60px]" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="press-sm" onClick={() => setReturnOpen(false)}>Cancel</Button>
              <Button className="press-md shadow-sm" disabled={returnMut.isPending} onClick={() => returnMut.mutate()}>{returnMut.isPending ? 'Posting…' : 'Confirm return'}</Button>
            </div>
          </div>
        </div>
      )}

      {/* ─── PRINT-ONLY INVOICE (half-A4/A5) ─── */}
      {/* Hidden on screen via offscreen positioning; shown only during print via @media print CSS */}
      <div className="print-invoice" style={{ position: 'absolute', left: '-9999px', top: 0, width: '100%' }}>
        <div style={{ fontFamily: 'Arial, sans-serif', color: '#000', padding: '6mm', maxWidth: '140mm', margin: '0 auto' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000', paddingBottom: '6px', marginBottom: '8px' }}>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#000' }}>KhataPro ERP</div>
              <div style={{ fontSize: '8px', color: '#666' }}>Accounting-First Garments ERP</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{inv.invoiceNo}</div>
              <div style={{ fontSize: '9px', color: '#666' }}>{inv.invoiceType} · {bizDate(inv.invoiceDate)}</div>
            </div>
          </div>
          {/* Meta */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '9px' }}>
            <div>
              {inv.salesmanName && <div><strong>Salesman:</strong> {inv.salesmanName}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              {inv.customerName && <div><strong>Customer:</strong> {inv.customerName}</div>}
              {inv.customerPhone && <div><strong>Phone:</strong> {inv.customerPhone}</div>}
              {inv.customerAddress && <div style={{ fontSize: '8px' }}>{inv.customerAddress}{inv.customerCity ? `, ${inv.customerCity}` : ''}</div>}
            </div>
          </div>
          {/* Items */}
          <table style={{ width: '100%', fontSize: '9px', borderCollapse: 'collapse', marginBottom: '6px' }}>
            <thead>
              <tr style={{ background: '#f0f0f0', borderBottom: '1px solid #000' }}>
                <th style={{ textAlign: 'left', padding: '3px 4px', fontSize: '8px', textTransform: 'uppercase' }}>Item</th>
                <th style={{ textAlign: 'center', padding: '3px', width: '25px', fontSize: '8px' }}>Qty</th>
                <th style={{ textAlign: 'right', padding: '3px 4px', width: '50px', fontSize: '8px' }}>Price</th>
                <th style={{ textAlign: 'right', padding: '3px 4px', width: '60px', fontSize: '8px' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {inv.items?.map((it, i) => (
                <tr key={it.id} style={{ borderBottom: '1px solid #ddd' }}>
                  <td style={{ padding: '3px 4px' }}>{it.productName}{it.isTemporary ? ' *' : ''}</td>
                  <td style={{ textAlign: 'center', padding: '3px' }}>{it.qty}</td>
                  <td style={{ textAlign: 'right', padding: '3px 4px', fontFamily: 'monospace' }}>{formatMoney(BigInt(it.unitPrice), false)}</td>
                  <td style={{ textAlign: 'right', padding: '3px 4px', fontFamily: 'monospace', fontWeight: 'bold' }}>{formatMoney(BigInt(it.lineTotal), false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Totals */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
            <div style={{ minWidth: '140px', fontSize: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderTop: '1px solid #000', fontWeight: 'bold' }}>
                <span>Total</span><span style={{ fontFamily: 'monospace' }}>{formatMoney(BigInt(inv.total))}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                <span>Paid</span><span style={{ fontFamily: 'monospace' }}>{formatMoney(BigInt(inv.paidAmount))}</span>
              </div>
              {outstanding > 0n && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', color: '#c00' }}>
                  <span>Outstanding</span><span style={{ fontFamily: 'monospace' }}>{formatMoney(outstanding)}</span>
                </div>
              )}
              {inv.payments?.filter(p => p.isChange).map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span>Change ({p.accountName})</span><span style={{ fontFamily: 'monospace' }}>{formatMoney(BigInt(p.amount))}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Footer */}
          <div style={{ textAlign: 'center', fontSize: '7px', color: '#999', borderTop: '1px solid #ccc', paddingTop: '4px' }}>
            KhataPro ERP · PKR · Asia/Karachi · * = temporary item
          </div>
          {inv.memo && <div style={{ fontSize: '8px', color: '#666', marginTop: '4px' }}><strong>Note:</strong> {inv.memo}</div>}
        </div>
      </div>
    </motion.div>
  )
}
