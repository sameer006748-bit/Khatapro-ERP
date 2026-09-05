'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { openShellHome } from '@/lib/navigation/shell-navigation'
import { formatMoney } from '@/lib/format'
import { bizDate, bizFormat } from '@/lib/dates'
import { ArrowLeft, Printer, RotateCcw, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { PrintInvoiceButton } from '@/components/invoice/print-invoice-button'
import { InvoicePrintDialog, type PrintableInvoice } from '@/components/invoice/invoice-print-dialog'

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
  discount?: string
  total: string
  paidAmount: string
  status?: string
  isCancelled: boolean
  isReturned: boolean
  memo: string | null
  items?: Array<{ id: string; productId: string | null; productName: string; qty: number; returnedQty?: number; unitPrice: string; lineTotal: string; isTemporary: boolean }>
  payments?: Array<{ id: string; accountId?: string; accountCode?: string; accountName: string; amount: string; isChange?: boolean; direction?: string | null; paymentMode?: string | null }>
  returns?: Array<{ returnNo: string; returnDate: string; total: string; settlementStatus: string; reason: string | null; lines: Array<{ productName: string; qty: number; unitPrice: string; lineTotal: string }> }>
  /**
   * Sections the server could not read on this database. The invoice still
   * opens; anything listed here is shown as unavailable rather than as empty,
   * so a failed read is never mistaken for "there is nothing here".
   */
  unavailableSections?: Array<'items' | 'payments' | 'returns' | 'salesman' | 'returnDetail'>
}

const SECTION_UNAVAILABLE_LABEL: Record<string, string> = {
  items: 'line items',
  payments: 'payment history',
  returns: 'returns',
  salesman: 'salesman name',
  returnDetail: 'return breakdown',
}

/** One commission entry as returned by GET /api/sales/:id/commission. */
type CommissionRow = {
  invoiceItemId: string
  productId: string | null
  productName: string
  soldQty: number
  returnedQty: number
  netEligibleQty: number
  ratePaisas: string
  commissionPaisas: string
  status: string
  eventType: string
  sellerName: string | null
  sellerRole: 'OWNER' | 'SALESMAN'
  paymentReference: string | null
  createdAt: string | null
}

type CommissionDetail = {
  available: boolean
  reason: string | null
  rows: CommissionRow[]
  totalPaisas: string
  error?: string
}

const EVENT_LABEL: Record<string, string> = {
  calculated: 'Eligible on sale',
  collection: 'Earned on collection',
  reversal: 'Reversed by return',
}

/**
 * Carries the HTTP status of a failed invoice fetch so the screen can tell the
 * user which of four different things actually happened — the invoice does not
 * exist, it is not theirs, their session lapsed, or the server could not read
 * it — instead of reporting all four as "Invoice not found".
 */
class InvoiceLoadError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly requestId: string | null,
  ) {
    super(`Invoice request failed with ${status}`)
    this.name = 'InvoiceLoadError'
  }
}

const TYPE_BADGE: Record<string, string> = {
  COUNTER: 'bg-emerald-100 text-emerald-700',
  ONLINE: 'bg-sky-100 text-sky-700',
  OFC: 'bg-violet-100 text-violet-700',
}

export function InvoiceDetailView({ invoiceId, openReturn = false }: { invoiceId: string; openReturn?: boolean }) {
  const qc = useQueryClient()
  const [returnOpen, setReturnOpen] = useState(openReturn)
  const [returnReason, setReturnReason] = useState('')
  const [refundMode, setRefundMode] = useState<'CREDIT' | 'CASH' | 'BANK'>('CREDIT')
  const [refundAccountId, setRefundAccountId] = useState('')
  const [returnQty, setReturnQty] = useState<Record<string, number>>({})
  const [returnIdempotencyKey, setReturnIdempotencyKey] = useState(() => crypto.randomUUID())
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMode, setPaymentMode] = useState('CASH')
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState(() => crypto.randomUUID())
  const [returnPrintDocuments, setReturnPrintDocuments] = useState<PrintableInvoice[]>([])

  const q = useQuery<{ invoice: Invoice; business?: { name: string; phone: string | null; address: string | null } | null }>({
    queryKey: ['invoice', invoiceId],
    // The status has to be read here. Resolving the promise on a 404 or a 500
    // hands the query an object with no `invoice`, which is indistinguishable
    // from a genuinely missing invoice — that is how a server-side failure ended
    // up being reported to the user as "Invoice not found".
    queryFn: async () => {
      const res = await fetch(`/api/sales/${invoiceId}`)
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new InvoiceLoadError(res.status, body?.error ?? null, body?.requestId ?? res.headers.get('x-request-id'))
      return body
    },
    enabled: !!invoiceId,
    // Retrying tells the user nothing new when the answer was "no", "not yours"
    // or "sign in again".
    retry: (failureCount, error) =>
      failureCount < 1 && !(error instanceof InvoiceLoadError && error.status < 500),
    retryDelay: 500,
  })

  // Commission is internal data on a separate endpoint: a missing accounting
  // migration must degrade this card alone, never the whole invoice page.
  const commissionQ = useQuery<CommissionDetail>({
    queryKey: ['invoice-commission', invoiceId],
    queryFn: () => fetch(`/api/sales/${invoiceId}/commission`).then(r => r.json()),
    enabled: !!invoiceId,
    retry: 0,
  })

  const accountsQ = useQuery<any>({
    queryKey: ['coa'],
    queryFn: () => fetch('/api/setup/coa').then(r => r.json()),
    enabled: returnOpen,
    staleTime: 300_000,
  })
  const refundAccounts = useMemo(() => {
    const categories = accountsQ.data?.categories ?? []
    return categories
      .flatMap((category: any) => category.accounts ?? [])
      .filter((account: any) => account.isBusinessAccount && account.isActive !== false)
      .map((account: any) => ({ id: String(account.id), code: String(account.code), name: String(account.name) }))
  }, [accountsQ.data])

  const returnMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/sales/${invoiceId}/return`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: Object.entries(returnQty).filter(([, qty]) => qty > 0).map(([invoiceItemId, qty]) => ({ invoiceItemId, qty })),
          refundMode,
          ...(refundMode === 'CREDIT' ? {} : { refundAccountId }),
          reason: returnReason || undefined,
          idempotencyKey: returnIdempotencyKey,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.message ?? j?.error ?? 'RETURN_FAILED')
      return j
    },
    onSuccess: (result) => {
      toast.success(
        result.settlementStatus === 'REFUNDED'
          ? `Return ${result.returnNo ?? ''} posted and refunded. Stock restored once.`
          : `Return ${result.returnNo ?? ''} posted as customer credit. Stock restored once.`,
      )
      void qc.invalidateQueries({ queryKey: ['invoice', invoiceId] })
      void qc.invalidateQueries({ queryKey: ['invoice-commission', invoiceId] })
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      void qc.invalidateQueries({ queryKey: ['trial-balance'] })
      void qc.invalidateQueries({ queryKey: ['products'] })
      setReturnOpen(false)
      setReturnReason('')
      setReturnQty({})
      setRefundAccountId('')
      setReturnIdempotencyKey(crypto.randomUUID())
    },
    onError: (e: Error) => toast.error(`Return failed: ${e.message}`),
  })

  const paymentMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/sales/${invoiceId}/payment`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: paymentAmount, mode: paymentMode, idempotencyKey: paymentIdempotencyKey }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error ?? 'PAYMENT_FAILED')
      return j
    },
    onSuccess: () => { toast.success('Invoice collection posted.'); void qc.invalidateQueries({ queryKey: ['invoice', invoiceId] }); void qc.invalidateQueries({ queryKey: ['invoice-commission', invoiceId] }); void qc.invalidateQueries({ queryKey: ['invoices'] }); setPaymentOpen(false); setPaymentAmount(''); setPaymentIdempotencyKey(crypto.randomUUID()) },
    onError: (e: Error) => toast.error(`Collection failed: ${e.message}`),
  })

  if (!invoiceId) return null
  if (q.isLoading) return (
    <div className="card-3d p-8 text-center">
      <div className="animate-pulse text-sm text-muted-foreground">Loading invoice…</div>
    </div>
  )
  if (q.isError || !q.data?.invoice) {
    const failure = q.error instanceof InvoiceLoadError ? q.error : null
    const errorMsg = failure?.status === 403 || failure?.code === 'FORBIDDEN'
      ? 'You do not have permission to view this invoice.'
      : failure?.status === 401 || failure?.code === 'UNAUTHORIZED'
      ? 'Please sign in again.'
      : failure?.status === 404
      ? 'Invoice not found.'
      : failure
      ? 'This invoice exists, but the server could not read it. Please retry — if it keeps failing, share the reference below with support.'
      : q.isError
      ? 'Unable to load invoice. Please try again.'
      : 'Invoice not found.'
    return (
      <div className="card-3d p-8 text-center">
        <p className="text-sm text-destructive mb-4">{errorMsg}</p>
        {failure?.requestId && failure.status >= 500 ? (
          <p className="text-xs text-muted-foreground mb-4">Reference: {failure.requestId}</p>
        ) : null}
        <Button variant="outline" size="sm" className="press-sm" onClick={() => q.refetch()}>Retry</Button>
      </div>
    )
  }

  const inv = q.data.invoice
  const unavailableSections = inv.unavailableSections ?? []
  // `paidAmount` is a column on the invoice itself, so an unreadable payment
  // history costs only the list of receipts. Returns are different: they net off
  // what the customer still owes, so if the returns table could not be read the
  // outstanding balance is not knowable and is withheld rather than overstated.
  const outstandingKnown = !unavailableSections.includes('returns')
  const returnedTotal = (inv.returns ?? []).reduce((sum, item) => sum + BigInt(item.total), 0n)
  const outstandingBeforeFloor = BigInt(inv.total) - returnedTotal - BigInt(inv.paidAmount)
  const outstanding = outstandingBeforeFloor > 0n ? outstandingBeforeFloor : 0n
  const business = q.data.business ?? null

  function salesReturnDocument(row: NonNullable<Invoice['returns']>[number]): PrintableInvoice {
    return {
      id: `${inv.id}-${row.returnNo}`, invoiceNo: row.returnNo, invoiceType: 'COUNTER', invoiceDate: row.returnDate,
      customerName: inv.customerName, customerPhone: inv.customerPhone, customerAddress: inv.customerAddress, customerCity: inv.customerCity,
      salesmanName: inv.salesmanName, source: null, memo: row.reason, subtotal: row.total, discount: '0', deliveryFee: null,
      total: row.total, paidAmount: '0', outstanding: '0', changeAmount: null, codAmount: null,
      isReturned: false, isCancelled: false, documentKind: 'sales-return', documentTitle: 'SALES RETURN', channelLabel: 'Customer Return',
      partyLabel: 'Customer', originalReference: inv.invoiceNo, referenceLabel: 'Original invoice', showSettlement: false,
      settlementLabel: row.settlementStatus === 'REFUNDED' ? 'REFUNDED' : row.settlementStatus === 'CREDIT_DUE' ? 'CUSTOMER CREDIT DUE' : 'POSTED',
      items: row.lines.map(line => ({ productName: line.productName, sku: null, qty: line.qty, unitPrice: line.unitPrice, lineTotal: line.lineTotal })),
      payments: [],
    }
  }

  // Back clears ?invoice= from the shell URL, returning to the page underneath.
  function back() { openShellHome() }


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
            {/* allowInternalCopy only offers the owner an opt-in commission copy;
                the default print stays a clean customer document. */}
            <PrintInvoiceButton invoiceId={inv.id} label="Print" size="sm" icon={Printer} allowInternalCopy />
            {outstandingKnown && outstanding > 0n && !inv.isCancelled && !inv.isReturned && <Button variant="outline" size="sm" className="press-sm" onClick={() => setPaymentOpen(true)}>Collect payment</Button>}
            {!inv.isReturned && !inv.isCancelled && (
              <Button variant="outline" size="sm" className="press-sm text-amber-700" onClick={() => setReturnOpen(true)}><RotateCcw className="size-3.5" /> Return</Button>
            )}
          </div>
        </div>
        {inv.isReturned && <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-700">This invoice has been returned. Reversing voucher posted. Stock restored.</div>}
        {/* The invoice opens even when a related section cannot be read. Say
            which ones, so nothing missing is mistaken for nothing recorded. */}
        {unavailableSections.length > 0 && (
          <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-700">
            The server could not read {unavailableSections.map(section => SECTION_UNAVAILABLE_LABEL[section] ?? section).join(', ')} for this invoice.
            {!outstandingKnown ? ' The outstanding balance is withheld until returns can be read.' : ''} Everything shown above is exact.
          </div>
        )}
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
            <th className="text-left p-3.5 font-medium">Item</th><th className="text-right p-3.5 font-medium">Sold</th><th className="text-right p-3.5 font-medium">Returned</th><th className="text-right p-3.5 font-medium">Remaining</th><th className="text-right p-3.5 font-medium">Unit Price</th><th className="text-right p-3.5 font-medium">Total</th>
          </tr></thead>
          <tbody>
            {inv.items?.map(it => (
              <tr key={it.id} className="border-b border-border/60 last:border-0">
                <td className="p-3.5 text-foreground">{it.productName}{it.isTemporary && <span className="ml-2 text-[10px] uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Temp</span>}</td>
                <td className="p-3.5 text-right" data-num>{it.qty}</td>
                <td className="p-3.5 text-right" data-num>{it.returnedQty ?? 0}</td>
                <td className="p-3.5 text-right" data-num>{it.qty - (it.returnedQty ?? 0)}</td>
                <td className="p-3.5 text-right" data-num>{formatMoney(BigInt(it.unitPrice), false)}</td>
                <td className="p-3.5 text-right font-medium" data-num>{formatMoney(BigInt(it.lineTotal), false)}</td>
              </tr>
            ))}
            {unavailableSections.includes('items') && (
              <tr><td colSpan={6} className="p-3.5 text-xs text-amber-700">Line items could not be read. The totals below come from the invoice record and are exact.</td></tr>
            )}
          </tbody>
        </table>
        <div className="px-5 py-3 border-t border-border bg-muted/30 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span><span className="font-semibold text-foreground" data-num>{formatMoney(BigInt(inv.subtotal))}</span>
        </div>
        {inv.discount && BigInt(inv.discount) > 0n && (
          <div className="px-5 py-2 border-t border-border/40 bg-muted/20 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Discount</span><span className="font-semibold text-destructive" data-num>−{formatMoney(BigInt(inv.discount))}</span>
          </div>
        )}
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
                  <td className="p-3.5 text-foreground">{p.accountName} {p.accountCode && <span className="text-xs text-muted-foreground" data-num>({p.accountCode})</span>}</td>
                  <td className="p-3.5">{p.isChange && p.accountCode === '1200' ? <span className="text-[10px] uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Customer credit</span> : p.direction === 'Paid' || p.isChange ? <span className="text-[10px] uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Refund</span> : <span className="text-[10px] uppercase bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">Collection</span>}</td>
                  <td className="p-3.5 text-right font-medium" data-num>{formatMoney(BigInt(p.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5 py-3 border-t border-border bg-muted/30 grid grid-cols-3 gap-2 text-sm">
            <div><div className="text-[10px] uppercase text-muted-foreground">Total</div><div className="font-semibold text-foreground" data-num>{formatMoney(BigInt(inv.total))}</div></div>
            <div><div className="text-[10px] uppercase text-muted-foreground">Paid</div><div className="font-semibold text-primary" data-num>{formatMoney(BigInt(inv.paidAmount))}</div></div>
            <div className="text-right"><div className="text-[10px] uppercase text-muted-foreground">Outstanding</div>{outstandingKnown ? <div className={`font-semibold ${outstanding > 0n ? 'text-amber-600' : 'text-primary'}`} data-num>{formatMoney(outstanding)}</div> : <div className="font-semibold text-amber-700 text-xs">Unavailable</div>}</div>
          </div>
        </div>
      )}

      {inv.returns && inv.returns.length > 0 && (
        <div className="card-3d overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border"><h2 className="text-sm font-semibold text-foreground">Historical returns</h2></div>
          <div className="divide-y divide-border/60">
            {inv.returns.map(item => (
              <div key={item.returnNo} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <div><div className="font-medium text-foreground" data-num>{item.returnNo}</div><div className="text-xs text-muted-foreground">Original invoice {inv.invoiceNo} · {bizDate(item.returnDate)}</div></div>
                <div className="flex items-center gap-3"><div className="text-right"><div className="font-medium text-foreground" data-num>{formatMoney(BigInt(item.total))}</div><div className={`text-[10px] uppercase ${item.settlementStatus === 'REFUNDED' ? 'text-emerald-700' : 'text-amber-700'}`}>{item.settlementStatus === 'REFUNDED' ? 'Refunded' : item.settlementStatus === 'CREDIT_DUE' ? 'Customer credit due' : 'Posted'}</div></div><Button variant="outline" size="sm" className="h-7 px-2 text-[10px]" onClick={() => setReturnPrintDocuments([salesReturnDocument(item)])}><Printer className="size-3" /> Print</Button></div>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 border-t border-border bg-muted/30 flex items-center justify-between text-sm"><span className="text-muted-foreground">Total returned</span><span className="font-semibold text-foreground" data-num>{formatMoney(returnedTotal)}</span></div>
        </div>
      )}

      {/* Commission — internal only, never printed on the customer invoice */}
      <div className="card-3d overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Commission</h2>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Internal</span>
        </div>
        {commissionQ.isLoading ? (
          <div className="px-5 py-4 text-xs text-muted-foreground">Loading commission detail…</div>
        ) : !commissionQ.data || commissionQ.data.error || !commissionQ.data.available ? (
          <div className="px-5 py-4 text-xs text-amber-700 bg-amber-50/60">
            {commissionQ.data?.reason ?? 'Commission detail is unavailable for this invoice.'}
          </div>
        ) : commissionQ.data.rows.length === 0 ? (
          <div className="px-5 py-4 text-xs text-muted-foreground">No commission entries on this invoice.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                  <th className="text-left p-3.5 font-medium">Product</th><th className="text-left p-3.5 font-medium">Seller</th><th className="text-right p-3.5 font-medium">Sold</th><th className="text-right p-3.5 font-medium">Returned</th><th className="text-right p-3.5 font-medium">Net</th><th className="text-right p-3.5 font-medium">Rate/pc</th><th className="text-right p-3.5 font-medium">Commission</th><th className="text-left p-3.5 font-medium">Status</th>
                </tr></thead>
                <tbody>
                  {commissionQ.data.rows.map((row, i) => (
                    <tr key={`${row.invoiceItemId}-${row.eventType}-${i}`} className="border-b border-border/60 last:border-0">
                      <td className="p-3.5 text-foreground">{row.productName}</td>
                      <td className="p-3.5">
                        <div className="text-foreground">{row.sellerName ?? (row.sellerRole === 'OWNER' ? 'Owner' : 'Salesman')}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{row.sellerRole === 'OWNER' ? 'Owner' : 'Salesman'}</div>
                      </td>
                      <td className="p-3.5 text-right" data-num>{row.soldQty}</td>
                      <td className="p-3.5 text-right" data-num>{row.returnedQty}</td>
                      <td className="p-3.5 text-right font-medium" data-num>{row.netEligibleQty}</td>
                      <td className="p-3.5 text-right" data-num>{formatMoney(BigInt(row.ratePaisas), false)}</td>
                      <td className="p-3.5 text-right font-medium" data-num>{formatMoney(BigInt(row.commissionPaisas), false)}</td>
                      <td className="p-3.5">
                        <div className="text-xs text-foreground">{EVENT_LABEL[row.eventType] ?? row.eventType}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{row.status}{row.paymentReference ? ` · ${row.paymentReference}` : ''}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3 border-t border-border bg-muted/30 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total commission on this invoice</span>
              <span className="font-semibold text-foreground" data-num>{formatMoney(BigInt(commissionQ.data.totalPaisas))}</span>
            </div>
          </>
        )}
      </div>

      {/* Return modal */}
      {returnOpen && (
        <div className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={() => setReturnOpen(false)}>
          <div className="card-3d p-6 w-full max-w-md sheet-enter" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground mb-1">Create historical return</h3>
            <p className="text-xs font-medium text-foreground mb-1">Original invoice: <span data-num>{inv.invoiceNo}</span> · {inv.invoiceType}</p>
            <p className="text-xs text-muted-foreground mb-4">Select an original invoice line. The return posts Sold 0, restores stock, and adjusts only commission earned for eligible returned units.</p>
            <div className="space-y-2 mb-4 max-h-52 overflow-auto">
              {inv.items?.map(item => {
                const remaining = item.qty - (item.returnedQty ?? 0)
                return <div key={item.id} className="grid grid-cols-[1fr_84px] gap-3 items-center rounded-md border border-border/70 p-2 text-xs">
                  <div><div className="text-foreground">{item.productName}</div><div className="text-muted-foreground">Original sold {item.qty} · previously returned {item.returnedQty ?? 0} · returnable {remaining}</div></div>
                  <div><label htmlFor={`return-${item.id}`} className="block text-[10px] uppercase text-muted-foreground mb-1">Return qty</label><input id={`return-${item.id}`} aria-label={`Return quantity for ${item.productName}`} type="number" min="0" max={remaining} disabled={remaining === 0} value={returnQty[item.id] ?? 0} onChange={e => setReturnQty(q => ({ ...q, [item.id]: Math.max(0, Math.min(remaining, Number.parseInt(e.target.value || '0', 10) || 0)) }))} className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm disabled:opacity-50" /></div>
                </div>
              })}
            </div>
            <label className="block text-xs text-muted-foreground mb-1">Settlement</label>
            <select value={refundMode} onChange={e => { setRefundMode(e.target.value as typeof refundMode); setRefundAccountId('') }} className="w-full bg-background border border-border rounded-lg p-2 text-sm mb-3"><option value="CREDIT">Customer credit (refund remains due)</option><option value="CASH">Refund now from a business account</option></select>
            {refundMode !== 'CREDIT' && (
              <div className="mb-3">
                <label className="block text-xs text-muted-foreground mb-1">Refund account</label>
                <select value={refundAccountId} onChange={e => setRefundAccountId(e.target.value)} className="w-full bg-background border border-border rounded-lg p-2 text-sm">
                  <option value="">Select active business account</option>
                  {refundAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} ({account.code})</option>)}
                </select>
                {!accountsQ.isLoading && refundAccounts.length === 0 && <p className="mt-1 text-[11px] text-amber-700">No active refund account is available. Record customer credit or ask an Owner to add a business account.</p>}
              </div>
            )}
            <textarea value={returnReason} onChange={e => setReturnReason(e.target.value)} placeholder="Reason (optional)" className="w-full bg-background border border-border rounded-lg p-3 text-sm mb-4 min-h-[60px]" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="press-sm" onClick={() => setReturnOpen(false)}>Cancel</Button>
              <Button className="press-md shadow-sm" disabled={returnMut.isPending || !Object.values(returnQty).some(q => q > 0) || (refundMode !== 'CREDIT' && !refundAccountId)} onClick={() => returnMut.mutate()}>{returnMut.isPending ? 'Posting…' : 'Confirm return'}</Button>
            </div>
          </div>
        </div>
      )}

      {paymentOpen && (
        <div className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={() => setPaymentOpen(false)}>
          <div className="card-3d p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground mb-2">Collect against this invoice</h3>
            <p className="text-xs text-muted-foreground mb-4">Outstanding: {formatMoney(outstanding)}. This allocation is the only receipt path that earns invoice commission.</p>
            <input inputMode="numeric" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value.replace(/\D/g, ''))} placeholder="Amount in paisas" className="w-full bg-background border border-border rounded-lg p-3 text-sm mb-3" />
            <select value={paymentMode} onChange={e => setPaymentMode(e.target.value)} className="w-full bg-background border border-border rounded-lg p-2 text-sm mb-4"><option value="CASH">Cash</option><option value="BANK">Bank</option><option value="CARD">Card</option><option value="OTHER">Other</option></select>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button><Button disabled={paymentMut.isPending || !/^\d+$/.test(paymentAmount) || paymentAmount === '0'} onClick={() => paymentMut.mutate()}>{paymentMut.isPending ? 'Posting…' : 'Post collection'}</Button></div>
          </div>
        </div>
      )}

      {/* ─── PRINT-ONLY INVOICE (half-A4/A5, browser print) ─── */}
      {/* Hidden on screen via offscreen positioning; shown only during print via @media print CSS */}
      <InvoicePrintDialog
        open={returnPrintDocuments.length > 0}
        onClose={() => setReturnPrintDocuments([])}
        invoices={returnPrintDocuments}
        businessName={business?.name ?? 'Sales Return'}
        businessContact={business ? { phone: business.phone ?? undefined, address: business.address ?? undefined } : null}
      />
    </motion.div>
  )
}
