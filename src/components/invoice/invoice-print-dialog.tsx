'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Printer } from 'lucide-react'
import { formatMoney } from '@/lib/format'
import { bizDate, bizFormat } from '@/lib/dates'

/**
 * Half-A4 Invoice Print System
 *
 * Modes:
 *   1. single — One invoice on a half A4 sheet (148.5mm × 210mm)
 *   2. two-up — Two invoices on one full A4 page (top + bottom halves)
 *   3. top-half — One invoice on the top half of a full A4 page
 *   4. bottom-half — One invoice on the bottom half of a full A4 page
 *   5. full-a4 — One invoice on a full A4 page (fallback for long invoices)
 */

export type InvoicePrintMode = 'single' | 'two-up' | 'top-half' | 'bottom-half' | 'full-a4'

export type PrintableInvoice = {
  id: string
  invoiceNo: string
  invoiceType: 'COUNTER' | 'ONLINE' | 'OFC'
  invoiceDate: string
  customerName: string | null
  customerPhone: string | null
  customerAddress: string | null
  customerCity: string | null
  salesmanName: string | null
  source: string | null
  memo: string | null
  subtotal: string
  discount: string
  deliveryFee: string | null
  total: string
  paidAmount: string
  outstanding: string
  changeAmount: string | null
  codAmount: string | null
  isReturned: boolean
  isCancelled: boolean
  items: Array<{
    productName: string
    sku: string | null  // Real SKU from server, or null if unavailable
    qty: number
    unitPrice: string
    lineTotal: string
  }>
  payments: Array<{
    accountCode: string
    accountName: string
    amount: string
    isChange: boolean
  }>
}

const MODE_LABELS: Record<InvoicePrintMode, string> = {
  'single': 'Half A4 — Single Sheet',
  'two-up': 'Full A4 — Two Invoices',
  'top-half': 'Full A4 — Top Half Only',
  'bottom-half': 'Full A4 — Bottom Half Only',
  'full-a4': 'Full A4 — Single Invoice',
}

const STORAGE_KEY = 'khatapro-invoice-print-mode'

export function InvoicePrintDialog({
  open,
  onClose,
  invoices,
  businessName,
  businessContact,
}: {
  open: boolean
  onClose: () => void
  invoices: PrintableInvoice[]
  businessName: string
  businessContact?: { phone?: string; address?: string; email?: string } | null
}) {
  const [mode, setMode] = useState<InvoicePrintMode>(() => {
    if (typeof window === 'undefined') return 'single'
    const saved = localStorage.getItem(STORAGE_KEY) as InvoicePrintMode | null
    if (saved && ['single', 'two-up', 'top-half', 'bottom-half', 'full-a4'].includes(saved)) return saved
    return 'single'
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(STORAGE_KEY, mode)
  }, [mode])

  if (!open) return null

  const maxItems = Math.max(...invoices.map(inv => inv.items.length), 0)
  const tooManyItems = mode !== 'full-a4' && maxItems > 12
  const overflowWarning = mode !== 'full-a4' && maxItems > 10

  function handlePrint() {
    // Add body class for reliable print isolation (no :has() dependency).
    document.body.classList.add('printing-invoice')
    // Inject mode-specific @page style for true physical page sizing.
    // Physical Half-A4: 210mm × 148.5mm. Full A4: 210mm × 297mm.
    const pageStyle = document.createElement('style')
    pageStyle.id = 'invoice-print-page-size'
    if (mode === 'single') {
      // Physical Half-A4 sheet
      pageStyle.textContent = '@page { size: 210mm 148.5mm; margin: 0; }'
    } else {
      // Full A4 for two-up, top-half, bottom-half, full-a4
      pageStyle.textContent = '@page { size: A4 portrait; margin: 0; }'
    }
    document.head.appendChild(pageStyle)
    // Use setTimeout to ensure DOM updates before print dialog opens.
    setTimeout(() => {
      window.print()
      // Clean up after print dialog closes.
      setTimeout(() => {
        document.body.classList.remove('printing-invoice')
        pageStyle.remove()
      }, 500)
    }, 100)
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="no-print fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <div className="no-print fixed inset-0 z-50 grid place-items-center p-4 pointer-events-none">
            <motion.div
              className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col pointer-events-auto"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="flex items-center justify-between p-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <Printer className="size-5 text-primary" />
                  <h2 className="text-base font-semibold">Print Invoice</h2>
                </div>
                <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted press-sm" aria-label="Close">
                  <X className="size-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">Print Mode</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {(Object.keys(MODE_LABELS) as InvoicePrintMode[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMode(m)}
                        className={`px-3 py-2.5 rounded-lg border text-xs font-medium press-sm text-left ${
                          mode === m
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border bg-background text-muted-foreground hover:bg-muted/50'
                        }`}
                      >
                        {MODE_LABELS[m]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">
                    Selected Invoices ({invoices.length})
                  </label>
                  <div className="space-y-1.5">
                    {invoices.map((inv, i) => (
                      <div key={inv.id} className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/40 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="size-5 rounded-full bg-primary/10 text-primary grid place-items-center text-[10px] font-bold">
                            {i + 1}
                          </span>
                          <span className="font-medium" data-num>{inv.invoiceNo}</span>
                          <span className="text-muted-foreground">{inv.invoiceType}</span>
                          <span className="text-muted-foreground">{inv.items.length} items</span>
                        </div>
                        <span className="font-medium" data-num>{formatMoney(BigInt(inv.total))}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {overflowWarning && (
                  <div className="p-3 rounded-lg border border-amber-200 bg-amber-50">
                    <p className="text-xs font-medium text-amber-800">
                      ⚠ This invoice has {maxItems} line items. Half A4 may be tight — consider using &quot;Full A4 — Single Invoice&quot; mode for best readability.
                    </p>
                  </div>
                )}

                {tooManyItems && (
                  <div className="p-3 rounded-lg border border-rose-200 bg-rose-50">
                    <p className="text-xs font-medium text-rose-800">
                      ⚠ This invoice has {maxItems} line items — more than Half A4 can fit without shrinking text. Use &quot;Full A4 — Single Invoice&quot; mode to avoid clipping.
                    </p>
                    <button
                      onClick={() => setMode('full-a4')}
                      className="mt-2 px-3 py-1.5 rounded-md bg-rose-600 text-white text-xs font-medium press-sm"
                    >
                      Switch to Full A4
                    </button>
                  </div>
                )}

                {mode === 'two-up' && invoices.length !== 2 && (
                  <div className="p-3 rounded-lg border border-sky-200 bg-sky-50">
                    <p className="text-xs text-sky-800">
                      Two-Up mode works best with 2 invoices. Currently {invoices.length} selected — the second half will be blank.
                    </p>
                  </div>
                )}

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">Preview</label>
                  <div className="border border-border rounded-lg overflow-hidden bg-muted/30">
                    <InvoicePreview mode={mode} invoices={invoices} businessName={businessName} />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 p-4 border-t border-border">
                <p className="text-[10px] text-muted-foreground">Print at 100% scale. Use A4 paper.</p>
                <div className="flex gap-2">
                  <button onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium border border-border press-sm">Cancel</button>
                  <button
                    onClick={handlePrint}
                    className="px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground press-sm flex items-center gap-1.5"
                  >
                    <Printer className="size-4" /> Print
                  </button>
                </div>
              </div>
            </motion.div>
          </div>

          <InvoicePrintRoot mode={mode} invoices={invoices} businessName={businessName} businessContact={businessContact} />
        </>
      )}
    </AnimatePresence>
  )
}

function InvoicePreview({ mode, invoices, businessName }: { mode: InvoicePrintMode; invoices: PrintableInvoice[]; businessName: string }) {
  const isHalf = mode === 'single'
  const isFullA4 = mode === 'full-a4'
  const showTop = mode === 'single' || mode === 'two-up' || mode === 'top-half'
  const showBottom = mode === 'single' || mode === 'two-up' || mode === 'bottom-half'

  if (isFullA4) {
    return (
      <div className="p-4 flex justify-center">
        <div className="bg-white border border-border shadow-sm" style={{ width: 140, height: 198 }}>
          <div className="h-full p-2"><MiniInvoice inv={invoices[0]} businessName={businessName} /></div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 flex justify-center">
      <div className="bg-white border border-border shadow-sm" style={{ width: 140, height: isHalf ? 198 : 198 }}>
        {isHalf ? (
          <div className="h-full p-2"><MiniInvoice inv={invoices[0]} businessName={businessName} /></div>
        ) : (
          <div className="h-full flex flex-col">
            <div className={`flex-1 p-2 ${showTop ? '' : 'opacity-20'}`}>
              {showTop && invoices[0] && <MiniInvoice inv={invoices[0]} businessName={businessName} />}
            </div>
            <div className="border-t border-dashed border-foreground/40 relative">
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[7px] bg-muted px-1 text-muted-foreground">cut</span>
            </div>
            <div className={`flex-1 p-2 ${showBottom ? '' : 'opacity-20'}`}>
              {showBottom && <MiniInvoice inv={invoices[1] || invoices[0]} businessName={businessName} />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MiniInvoice({ inv, businessName }: { inv?: PrintableInvoice; businessName: string }) {
  if (!inv) return <div className="h-full grid place-items-center text-[8px] text-muted-foreground">blank</div>
  return (
    <div className="h-full flex flex-col text-[7px] leading-tight">
      <div className="font-bold text-[8px]">{businessName}</div>
      <div className="text-[6px] text-muted-foreground">{inv.invoiceNo}</div>
      <div className="mt-1 flex-1 space-y-0.5">
        {inv.items.slice(0, 3).map((it, i) => (
          <div key={i} className="flex justify-between">
            <span className="truncate">{it.productName}</span>
            <span className="whitespace-nowrap">{it.qty}x</span>
          </div>
        ))}
        {inv.items.length > 3 && <div className="text-[6px] text-muted-foreground">+{inv.items.length - 3} more</div>}
      </div>
      <div className="mt-1 font-bold border-t border-foreground/20 pt-0.5">Total: Rs {(Number(inv.total) / 100).toFixed(0)}</div>
    </div>
  )
}

function InvoicePrintRoot({ mode, invoices, businessName, businessContact }: { mode: InvoicePrintMode; invoices: PrintableInvoice[]; businessName: string; businessContact?: { phone?: string; address?: string; email?: string } | null }) {
  const isHalf = mode === 'single'
  const isFullA4 = mode === 'full-a4'
  const showTop = mode === 'single' || mode === 'two-up' || mode === 'top-half'
  const showBottom = mode === 'single' || mode === 'two-up' || mode === 'bottom-half'

  if (isFullA4) {
    // Full A4 — single invoice uses entire page
    return (
      <div className="invoice-print-root hidden print:block">
        <div className="a4-page a4-single">
          <FullA4Invoice inv={invoices[0]} businessName={businessName} businessContact={businessContact} />
        </div>
      </div>
    )
  }

  return (
    <div className="invoice-print-root hidden print:block">
      {isHalf ? (
        <HalfA4Invoice inv={invoices[0]} businessName={businessName} businessContact={businessContact} />
      ) : (
        <div className="a4-page">
          {showTop ? (
            <div className="a4-half a4-half-top">
              <HalfA4Invoice inv={invoices[0]} businessName={businessName} businessContact={businessContact} />
            </div>
          ) : <div className="a4-half a4-half-top a4-half-blank" />}
          {showBottom ? (
            <div className="a4-half a4-half-bottom">
              <HalfA4Invoice inv={invoices[1] || invoices[0]} businessName={businessName} businessContact={businessContact} />
            </div>
          ) : <div className="a4-half a4-half-bottom a4-half-blank" />}
        </div>
      )}
    </div>
  )
}

function HalfA4Invoice({ inv, businessName, businessContact }: { inv: PrintableInvoice; businessName: string; businessContact?: { phone?: string; address?: string; email?: string } | null }) {
  if (!inv) return null
  const paid = BigInt(inv.paidAmount)
  const total = BigInt(inv.total)
  const outstanding = total - paid

  return (
    <div className="invoice-half">
      <div className="inv-header">
        <div className="inv-business">
          <div className="inv-business-name">{businessName}</div>
          {businessContact?.phone && <div className="inv-business-contact">{businessContact.phone}</div>}
          {businessContact?.address && <div className="inv-business-contact">{businessContact.address}</div>}
        </div>
        <div className="inv-title-block">
          <div className="inv-title">INVOICE</div>
          <div className="inv-no" data-num>{inv.invoiceNo}</div>
          <div className="inv-type-badge">{inv.invoiceType}</div>
        </div>
      </div>

      <div className="inv-meta">
        <div className="inv-meta-col">
          <div className="inv-meta-row"><span className="inv-meta-label">Date:</span><span className="inv-meta-value" data-num>{bizDate(inv.invoiceDate)}</span></div>
          {inv.salesmanName && <div className="inv-meta-row"><span className="inv-meta-label">Salesman:</span><span className="inv-meta-value">{inv.salesmanName}</span></div>}
          {inv.source && <div className="inv-meta-row"><span className="inv-meta-label">Source:</span><span className="inv-meta-value">{inv.source}</span></div>}
        </div>
        <div className="inv-meta-col">
          {inv.customerName && <div className="inv-meta-row"><span className="inv-meta-label">Customer:</span><span className="inv-meta-value">{inv.customerName}</span></div>}
          {inv.customerPhone && <div className="inv-meta-row"><span className="inv-meta-label">Phone:</span><span className="inv-meta-value" data-num>{inv.customerPhone}</span></div>}
          {inv.customerAddress && <div className="inv-meta-row"><span className="inv-meta-label">Address:</span><span className="inv-meta-value">{inv.customerAddress}{inv.customerCity ? `, ${inv.customerCity}` : ''}</span></div>}
        </div>
      </div>

      <table className="inv-items-table">
        <thead>
          <tr>
            <th className="inv-col-item">Item</th>
            <th className="inv-col-qty">Qty</th>
            <th className="inv-col-rate">Rate</th>
            <th className="inv-col-total">Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.items.map((it, i) => (
            <tr key={i}>
              <td className="inv-col-item">
                {it.productName}
                {it.sku && <span className="inv-sku"> [{it.sku}]</span>}
              </td>
              <td className="inv-col-qty" data-num>{it.qty}</td>
              <td className="inv-col-rate" data-num>{formatMoney(BigInt(it.unitPrice), false)}</td>
              <td className="inv-col-total" data-num>{formatMoney(BigInt(it.lineTotal), false)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="inv-totals">
        <div className="inv-totals-row"><span>Subtotal</span><span data-num>{formatMoney(BigInt(inv.subtotal), false)}</span></div>
        {BigInt(inv.discount) > 0n && <div className="inv-totals-row inv-totals-discount"><span>Discount</span><span data-num>-{formatMoney(BigInt(inv.discount), false)}</span></div>}
        {inv.deliveryFee && BigInt(inv.deliveryFee) > 0n && <div className="inv-totals-row"><span>Delivery Fee</span><span data-num>{formatMoney(BigInt(inv.deliveryFee), false)}</span></div>}
        <div className="inv-totals-row inv-totals-grand"><span>Grand Total</span><span data-num>{formatMoney(total, false)}</span></div>
        <div className="inv-totals-row"><span>Paid</span><span data-num>{formatMoney(paid, false)}</span></div>
        {outstanding > 0n && <div className="inv-totals-row inv-totals-outstanding"><span>Outstanding</span><span data-num>{formatMoney(outstanding, false)}</span></div>}
        {inv.changeAmount && BigInt(inv.changeAmount) > 0n && <div className="inv-totals-row"><span>Change</span><span data-num>{formatMoney(BigInt(inv.changeAmount), false)}</span></div>}
        {inv.codAmount && BigInt(inv.codAmount) > 0n && <div className="inv-totals-row inv-totals-cod"><span>COD Amount</span><span data-num>{formatMoney(BigInt(inv.codAmount), false)}</span></div>}
      </div>

      {inv.payments.length > 0 && (
        <div className="inv-payments">
          <div className="inv-payments-title">Payment Summary</div>
          {inv.payments.map((p, i) => (
            <div key={i} className="inv-payment-row">
              <span>[{p.accountCode}] {p.accountName}{p.isChange && ' (Change)'}</span>
              <span data-num>{formatMoney(BigInt(p.amount), false)}</span>
            </div>
          ))}
        </div>
      )}

      {inv.isReturned && <div className="inv-status-banner inv-status-returned">RETURNED</div>}
      {inv.isCancelled && <div className="inv-status-banner inv-status-cancelled">CANCELLED</div>}
      {outstanding === 0n && !inv.isReturned && !inv.isCancelled && <div className="inv-status-banner inv-status-paid">PAID</div>}

      <div className="inv-footer">
        <div className="inv-footer-message">{inv.memo || 'Thank you for your business!'}</div>
        <div className="inv-footer-timestamp" data-num>Printed: {bizFormat(new Date().toISOString(), 'datetime')}</div>
      </div>
    </div>
  )
}

function FullA4Invoice({ inv, businessName, businessContact }: { inv: PrintableInvoice; businessName: string; businessContact?: { phone?: string; address?: string; email?: string } | null }) {
  if (!inv) return null
  const paid = BigInt(inv.paidAmount)
  const total = BigInt(inv.total)
  const outstanding = total - paid

  return (
    <div className="invoice-full-a4">
      <div className="inv-header">
        <div className="inv-business">
          <div className="inv-business-name">{businessName}</div>
          {businessContact?.phone && <div className="inv-business-contact">{businessContact.phone}</div>}
          {businessContact?.address && <div className="inv-business-contact">{businessContact.address}</div>}
          {businessContact?.email && <div className="inv-business-contact">{businessContact.email}</div>}
        </div>
        <div className="inv-title-block">
          <div className="inv-title">INVOICE</div>
          <div className="inv-no" data-num>{inv.invoiceNo}</div>
          <div className="inv-type-badge">{inv.invoiceType}</div>
        </div>
      </div>

      <div className="inv-meta">
        <div className="inv-meta-col">
          <div className="inv-meta-row"><span className="inv-meta-label">Date:</span><span className="inv-meta-value" data-num>{bizDate(inv.invoiceDate)}</span></div>
          {inv.salesmanName && <div className="inv-meta-row"><span className="inv-meta-label">Salesman:</span><span className="inv-meta-value">{inv.salesmanName}</span></div>}
          {inv.source && <div className="inv-meta-row"><span className="inv-meta-label">Source:</span><span className="inv-meta-value">{inv.source}</span></div>}
        </div>
        <div className="inv-meta-col">
          {inv.customerName && <div className="inv-meta-row"><span className="inv-meta-label">Customer:</span><span className="inv-meta-value">{inv.customerName}</span></div>}
          {inv.customerPhone && <div className="inv-meta-row"><span className="inv-meta-label">Phone:</span><span className="inv-meta-value" data-num>{inv.customerPhone}</span></div>}
          {inv.customerAddress && <div className="inv-meta-row"><span className="inv-meta-label">Address:</span><span className="inv-meta-value">{inv.customerAddress}{inv.customerCity ? `, ${inv.customerCity}` : ''}</span></div>}
        </div>
      </div>

      <table className="inv-items-table">
        <thead>
          <tr>
            <th className="inv-col-item">Item</th>
            <th className="inv-col-qty">Qty</th>
            <th className="inv-col-rate">Rate</th>
            <th className="inv-col-total">Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.items.map((it, i) => (
            <tr key={i}>
              <td className="inv-col-item">
                {it.productName}
                {it.sku && <span className="inv-sku"> [{it.sku}]</span>}
              </td>
              <td className="inv-col-qty" data-num>{it.qty}</td>
              <td className="inv-col-rate" data-num>{formatMoney(BigInt(it.unitPrice), false)}</td>
              <td className="inv-col-total" data-num>{formatMoney(BigInt(it.lineTotal), false)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="inv-totals">
        <div className="inv-totals-row"><span>Subtotal</span><span data-num>{formatMoney(BigInt(inv.subtotal), false)}</span></div>
        {BigInt(inv.discount) > 0n && <div className="inv-totals-row inv-totals-discount"><span>Discount</span><span data-num>-{formatMoney(BigInt(inv.discount), false)}</span></div>}
        {inv.deliveryFee && BigInt(inv.deliveryFee) > 0n && <div className="inv-totals-row"><span>Delivery Fee</span><span data-num>{formatMoney(BigInt(inv.deliveryFee), false)}</span></div>}
        <div className="inv-totals-row inv-totals-grand"><span>Grand Total</span><span data-num>{formatMoney(total, false)}</span></div>
        <div className="inv-totals-row"><span>Paid</span><span data-num>{formatMoney(paid, false)}</span></div>
        {outstanding > 0n && <div className="inv-totals-row inv-totals-outstanding"><span>Outstanding</span><span data-num>{formatMoney(outstanding, false)}</span></div>}
        {inv.changeAmount && BigInt(inv.changeAmount) > 0n && <div className="inv-totals-row"><span>Change</span><span data-num>{formatMoney(BigInt(inv.changeAmount), false)}</span></div>}
        {inv.codAmount && BigInt(inv.codAmount) > 0n && <div className="inv-totals-row inv-totals-cod"><span>COD Amount</span><span data-num>{formatMoney(BigInt(inv.codAmount), false)}</span></div>}
      </div>

      {inv.payments.length > 0 && (
        <div className="inv-payments">
          <div className="inv-payments-title">Payment Summary</div>
          {inv.payments.map((p, i) => (
            <div key={i} className="inv-payment-row">
              <span>[{p.accountCode}] {p.accountName}{p.isChange && ' (Change)'}</span>
              <span data-num>{formatMoney(BigInt(p.amount), false)}</span>
            </div>
          ))}
        </div>
      )}

      {inv.isReturned && <div className="inv-status-banner inv-status-returned">RETURNED</div>}
      {inv.isCancelled && <div className="inv-status-banner inv-status-cancelled">CANCELLED</div>}
      {outstanding === 0n && !inv.isReturned && !inv.isCancelled && <div className="inv-status-banner inv-status-paid">PAID</div>}

      <div className="inv-footer">
        <div className="inv-footer-message">{inv.memo || 'Thank you for your business!'}</div>
        <div className="inv-footer-timestamp" data-num>Printed: {bizFormat(new Date().toISOString(), 'datetime')}</div>
      </div>
    </div>
  )
}
