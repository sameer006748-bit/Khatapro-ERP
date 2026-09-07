'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X, Printer } from 'lucide-react'
import { formatMoney } from '@/lib/format'
import { bizDate, bizFormat } from '@/lib/dates'
import { buildInvoicePrintModel, type InvoicePrintModel } from '@/lib/sales/sale-engine'

/**
 * Invoice Print System
 *
 * Modes:
 *   1. single  — One invoice on the top half of an A4 sheet (148.5mm)
 *   2. two-up  — Two invoices on one full A4 page (top + bottom halves)
 *   3. full-a4 — One invoice on a full A4 page (long invoices)
 *   4. thermal — 80mm continuous roll receipt
 *
 * Every layout renders from the same `buildInvoicePrintModel` serialization,
 * so sold/returned/net quantities and totals cannot diverge between them.
 * Commission is internal: it prints only on an explicitly selected owner copy.
 */

export type InvoicePrintMode = 'single' | 'two-up' | 'top-half' | 'bottom-half' | 'full-a4' | 'thermal'

export type PrintableCommission = {
  totalPaisas: string
  lines: Array<{ productName: string; netEligibleQty: number; ratePaisas: string; commissionPaisas: string }>
}

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
  riderName?: string | null
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
  /** Optional document presentation metadata for purchases and returns. */
  documentKind?: 'sale' | 'sales-return' | 'purchase' | 'purchase-return'
  documentTitle?: string
  channelLabel?: string
  partyLabel?: 'Customer' | 'Vendor'
  originalReference?: string | null
  referenceLabel?: string | null
  additionalCharges?: string | null
  settlementLabel?: string | null
  showSettlement?: boolean
  isReturned: boolean
  isCancelled: boolean
  items: Array<{
    productName: string
    sku: string | null  // Real SKU from server, or null if unavailable
    qty: number
    /** Pieces handed back on this bill. Drives the returned/net columns. */
    returnedQty?: number
    unitPrice: string
    lineTotal: string
  }>
  payments: Array<{
    accountCode: string
    accountName: string
    amount: string
    isChange: boolean
  }>
  /** Owner-only. Present only when the caller opted into an internal copy. */
  commission?: PrintableCommission | null
}

type PrintDocumentModel = InvoicePrintModel & {
  documentKind: NonNullable<PrintableInvoice['documentKind']>
  partyLabel: NonNullable<PrintableInvoice['partyLabel']>
  originalReference: string | null
  referenceLabel: string | null
  additionalChargesPaisas: string | null
  settlementLabel: string | null
  showSettlement: boolean
}

const MODE_LABELS: Record<InvoicePrintMode, string> = {
  'single': 'Half A4 — Single Sheet',
  'two-up': 'Full A4 — Two Half-A4 Copies',
  'top-half': 'Full A4 — Top Half Only',
  'bottom-half': 'Full A4 — Bottom Half Only',
  'full-a4': 'Full A4 — Single Invoice',
  'thermal': 'Thermal — 80mm Receipt',
}

const STORAGE_KEY = 'khatapro-invoice-print-mode'
const PRINT_MODE_OPTIONS: InvoicePrintMode[] = ['single', 'two-up', 'full-a4', 'thermal']

const PRINT_ACTION_LABELS: Record<InvoicePrintMode, string> = {
  'single': 'Print Half A4',
  'two-up': 'Print Two Copies on A4',
  'top-half': 'Print Half A4',
  'bottom-half': 'Print Half A4',
  'full-a4': 'Print Full A4',
  'thermal': 'Print 80mm Receipt',
}

/** Map the transport shape onto the shared engine serialization. */
function toModel(inv: PrintableInvoice, includeCommission: boolean): PrintDocumentModel {
  const model = buildInvoicePrintModel({
    invoiceNo: inv.invoiceNo,
    invoiceType: inv.invoiceType,
    invoiceDate: inv.invoiceDate,
    sellerName: inv.salesmanName,
    sellerRole: inv.salesmanName ? 'SALESMAN' : 'OWNER',
    customerName: inv.customerName,
    customerPhone: inv.customerPhone,
    customerAddress: inv.customerAddress,
    customerCity: inv.customerCity,
    source: inv.source,
    riderName: inv.riderName,
    codAmountPaisas: inv.codAmount,
    deliveryFeePaisas: inv.deliveryFee,
    memo: inv.memo,
    items: inv.items,
    subtotal: inv.subtotal,
    discount: inv.discount,
    total: inv.total,
    paidAmount: inv.paidAmount,
    changeAmount: inv.changeAmount,
    payments: inv.payments,
    isReturned: inv.isReturned,
    isCancelled: inv.isCancelled,
    commission: includeCommission ? inv.commission ?? null : null,
  })
  return {
    ...model,
    documentTitle: inv.documentTitle ?? model.documentTitle,
    channelLabel: inv.channelLabel ?? model.channelLabel,
    documentKind: inv.documentKind ?? 'sale',
    partyLabel: inv.partyLabel ?? 'Customer',
    originalReference: inv.originalReference ?? null,
    referenceLabel: inv.referenceLabel ?? null,
    additionalChargesPaisas: inv.additionalCharges ?? null,
    settlementLabel: inv.settlementLabel ?? null,
    showSettlement: inv.showSettlement ?? true,
  }
}

export function InvoicePrintDialog({
  open,
  onClose,
  invoices,
  businessName,
  businessContact,
  onRequestInternalCopy,
}: {
  open: boolean
  onClose: () => void
  invoices: PrintableInvoice[]
  businessName: string
  businessContact?: { phone?: string; address?: string; email?: string } | null
  /** Loads owner-only commission data only when an internal copy is requested. */
  onRequestInternalCopy?: () => Promise<boolean>
}) {
  const [mode, setMode] = useState<InvoicePrintMode>(() => {
    if (typeof window === 'undefined') return 'single'
    const saved = localStorage.getItem(STORAGE_KEY) as InvoicePrintMode | null
    if (saved && PRINT_MODE_OPTIONS.includes(saved)) return saved
    return 'single'
  })
  // Internal copies are opt-in per print, never sticky.
  const [internalCopy, setInternalCopy] = useState(false)
  const [internalCopyLoading, setInternalCopyLoading] = useState(false)
  const printCleanupRef = useRef<(() => void) | null>(null)
  const printInProgressRef = useRef(false)

  // The native dialog can outlive this component. Always restore the normal
  // screen if navigation closes the dialog while a print request is active.
  useEffect(() => () => printCleanupRef.current?.(), [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(STORAGE_KEY, mode)
  }, [mode])

  // The interactive workspace lives in a body portal, but it still needs to
  // own scrolling while open so the invoice underneath cannot move or receive
  // pointer input through a nested page container.
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [open])

  // Real rendered-height overflow detection (hooks must be before early return)
  // Keep a safety allowance for real printer metrics and the document footer.
  // Half A4 must fail closed rather than trim the total or signature line.
  const HALF_A4_PRINTABLE_PX = 490
  const printRootRef = useRef<HTMLDivElement>(null)
  const [measuredHeight, setMeasuredHeight] = useState(0)
  const [overflowDetected, setOverflowDetected] = useState(false)

  const commissionAvailable = invoices.some(inv => (inv.commission?.lines.length ?? 0) > 0)
  const canRequestInternalCopy = commissionAvailable || Boolean(onRequestInternalCopy)
  const models = useMemo(
    () => invoices.map(inv => toModel(inv, internalCopy && commissionAvailable)),
    [invoices, internalCopy, commissionAvailable],
  )

  useEffect(() => {
    if (!open || !printRootRef.current) return
    const measure = () => {
      const root = printRootRef.current
      if (!root) return
      // Measure the MeasurementInvoice child div (the one with inline styles)
      const invoiceEl = root.firstElementChild as HTMLElement
      if (!invoiceEl) return
      const h = invoiceEl.scrollHeight
      setMeasuredHeight(h)
      const isHalfMode = mode === 'single' || mode === 'two-up' || mode === 'top-half' || mode === 'bottom-half'
      setOverflowDetected(isHalfMode && h > HALF_A4_PRINTABLE_PX)
    }
    const timer = setTimeout(measure, 200)
    return () => clearTimeout(timer)
  }, [open, invoices, mode, internalCopy])

  if (!open) return null

  const maxItems = Math.max(...invoices.map(inv => inv.items.length), 0)
  const isHalfLayout = mode === 'single' || mode === 'two-up' || mode === 'top-half' || mode === 'bottom-half'
  const overflowWarning = isHalfLayout && (maxItems > 10 || overflowDetected)
  const twoUpInvalid = mode === 'two-up' && invoices.length === 0

  function handlePrint() {
    if (twoUpInvalid || (overflowDetected && isHalfLayout) || printInProgressRef.current) return

    // Keep the selected document mounted, isolate it with print CSS, then let
    // the browser own the transition. The former fixed cleanup delay could
    // restore the app while the native print dialog was still compositing.
    printInProgressRef.current = true
    const markPrinting = () => {
      document.documentElement.classList.add('invoice-printing')
      document.documentElement.classList.toggle('invoice-printing-thermal', mode === 'thermal')
      document.body.classList.add('printing-invoice')
      document.body.classList.toggle('printing-invoice-thermal', mode === 'thermal')
    }
    const mediaQuery = window.matchMedia('print')
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      printInProgressRef.current = false
      printCleanupRef.current = null
      window.removeEventListener('beforeprint', markPrinting)
      window.removeEventListener('afterprint', cleanup)
      mediaQuery.removeEventListener('change', onMediaChange)
      document.documentElement.classList.remove('invoice-printing')
      document.documentElement.classList.remove('invoice-printing-thermal')
      document.body.classList.remove('printing-invoice', 'printing-invoice-thermal')
    }
    const onMediaChange = (event: MediaQueryListEvent) => {
      if (!event.matches) cleanup()
    }

    printCleanupRef.current?.()
    printCleanupRef.current = cleanup
    markPrinting()
    window.addEventListener('beforeprint', markPrinting)
    window.addEventListener('afterprint', cleanup, { once: true })
    mediaQuery.addEventListener('change', onMediaChange)

    // Keep the native print call in the button event. Deferring it through
    // requestAnimationFrame can lose the browser's user activation, which
    // silently suppresses the print UI in Chromium. The dialog and its page
    // rule are already mounted before this user can click this button.
    try {
      window.print()
    } catch (error) {
      cleanup()
      throw error
    }
  }

  async function enableInternalCopy() {
    if (internalCopy) {
      setInternalCopy(false)
      return
    }
    if (!commissionAvailable && onRequestInternalCopy) {
      setInternalCopyLoading(true)
      try {
        if (!(await onRequestInternalCopy())) return
      } finally {
        setInternalCopyLoading(false)
      }
    }
    setInternalCopy(true)
  }

  return (
    <>
      {createPortal(
        <motion.div
          className="no-print fixed inset-0 z-[100] isolate overflow-y-auto bg-background p-3 sm:p-6"
          data-print-workspace
          role="dialog"
          aria-modal="true"
          aria-label="Print Document"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.16 }}
        >
          <div className="grid min-h-full place-items-center pointer-events-none">
            <motion.div
              className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] flex flex-col pointer-events-auto"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="flex items-center justify-between p-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <Printer className="size-5 text-primary" />
                  <h2 className="text-base font-semibold">Print Document</h2>
                </div>
                <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted press-sm" aria-label="Close">
                  <X className="size-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">Print Mode</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {PRINT_MODE_OPTIONS.map((m) => (
                      <button
                        key={m}
                        onClick={() => setMode(m)}
                        title={MODE_LABELS[m]}
                        className={`px-3 py-2.5 rounded-lg border text-xs font-medium press-sm text-left ${
                          mode === m
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border bg-background text-muted-foreground hover:bg-muted/50'
                        }`}
                      >
                          {PRINT_ACTION_LABELS[m]}
                      </button>
                    ))}
                  </div>
                </div>

                {canRequestInternalCopy && (
                  <label className="flex items-start gap-2 p-3 rounded-lg border border-border bg-muted/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={internalCopy}
                      onChange={() => void enableInternalCopy()}
                      disabled={internalCopyLoading}
                      className="mt-0.5"
                    />
                    <span className="text-xs">
                      <span className="font-medium text-foreground">{internalCopyLoading ? 'Loading internal commission details…' : 'Internal copy — include commission'}</span>
                      <span className="block text-[10px] text-muted-foreground mt-0.5">
                        Off by default. Never give a copy printed with this option to a customer.
                      </span>
                    </span>
                  </label>
                )}

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">
                    Selected Documents ({invoices.length})
                  </label>
                  <div className="space-y-1.5">
                    {invoices.map((inv, i) => (
                      <div key={inv.id} className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/40 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="size-5 rounded-full bg-primary/10 text-primary grid place-items-center text-[10px] font-bold">
                            {i + 1}
                          </span>
                          <span className="font-medium" data-num>{inv.invoiceNo}</span>
                          <span className="text-muted-foreground">{inv.channelLabel ?? inv.invoiceType}</span>
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
                    {measuredHeight > 0 && (
                      <p className="text-[10px] text-amber-700 mt-1">
                        Measured content height: {measuredHeight}px · Available Half-A4 height: {HALF_A4_PRINTABLE_PX}px
                      </p>
                    )}
                  </div>
                )}

                {overflowDetected && isHalfLayout && (
                  <div className="p-3 rounded-lg border border-rose-200 bg-rose-50">
                    <p className="text-xs font-medium text-rose-800">
                      ⚠ Content overflow detected! Rendered height ({measuredHeight}px) exceeds Half-A4 printable height ({HALF_A4_PRINTABLE_PX}px). Half-A4 printing is blocked to prevent clipping.
                    </p>
                    <p className="text-[10px] text-rose-700 mt-1">Switch to &quot;Full A4 — Single Invoice&quot; or the 80mm receipt to print without clipping.</p>
                    <button
                      onClick={() => setMode('full-a4')}
                      className="mt-2 px-3 py-1.5 rounded-md bg-rose-600 text-white text-xs font-medium press-sm"
                    >
                      Switch to Full A4
                    </button>
                  </div>
                )}

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">Preview</label>
                  <div className="border border-border rounded-lg overflow-hidden bg-muted/30">
                    <InvoicePreview mode={mode} models={models} businessName={businessName} />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 p-4 border-t border-border">
                <p className="text-[10px] text-muted-foreground">
                  {mode === 'thermal' ? 'Print at 100% scale on an 80mm roll.' : 'Print at 100% scale. Use A4 paper.'}
                </p>
                <div className="flex gap-2">
                  <button onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium border border-border press-sm">Cancel</button>
                  <button
                    onClick={handlePrint}
                    disabled={twoUpInvalid || (overflowDetected && isHalfLayout)}
                    className="px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground press-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Printer className="size-4" /> {PRINT_ACTION_LABELS[mode]}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>,
        document.body,
      )}

      {/* Off-screen measurement container — visible (not display:none) but positioned off-screen.
          Uses MeasurementInvoice with inline styles that mimic print CSS for accurate height measurement. */}
      <div className="invoice-print-measure" ref={printRootRef} style={{ position: 'absolute', left: '-9999px', top: '0', width: '210mm', visibility: 'hidden' }} aria-hidden="true">
        {models[0] && <MeasurementInvoice model={models[0]} businessName={businessName} />}
      </div>
      {/* Actual print root for printing */}
      <InvoicePrintStyles mode={mode} />
      <InvoicePrintRoot mode={mode} models={models} businessName={businessName} businessContact={businessContact} />
    </>
  )
}

function InvoicePreview({ mode, models, businessName }: { mode: InvoicePrintMode; models: PrintDocumentModel[]; businessName: string }) {
  const isFullA4 = mode === 'full-a4'
  const showTop = mode === 'single' || mode === 'two-up' || mode === 'top-half'
  const showBottom = mode === 'two-up' || mode === 'bottom-half'

  if (mode === 'thermal') {
    return (
      <div className="p-4 flex justify-center">
        <div className="bg-white border border-border shadow-sm" style={{ width: 76 }}>
          <div className="p-1.5"><MiniInvoice model={models[0]} businessName={businessName} /></div>
        </div>
      </div>
    )
  }

  if (isFullA4) {
    return (
      <div className="p-4 flex justify-center">
        <div className="bg-white border border-border shadow-sm" style={{ width: 140, height: 198 }}>
          <div className="h-full p-2"><MiniInvoice model={models[0]} businessName={businessName} /></div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 flex justify-center">
        <div className="bg-white border border-border shadow-sm" style={{ width: 140, height: 198 }}>
        <div className="h-full flex flex-col">
          <div className={`flex-1 p-2 ${showTop ? '' : 'opacity-20'}`}>
            {showTop && models[0] && <MiniInvoice model={models[0]} businessName={businessName} />}
          </div>
          <div className="border-t border-dashed border-foreground/40 relative">
            <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[7px] bg-muted px-1 text-muted-foreground">cut</span>
          </div>
          <div className={`flex-1 p-2 ${showBottom ? '' : 'opacity-20'}`}>
            {showBottom && models[0] && <MiniInvoice model={models[1] ?? models[0]} businessName={businessName} />}
          </div>
        </div>
      </div>
    </div>
  )
}

function MiniInvoice({ model, businessName }: { model?: PrintDocumentModel; businessName: string }) {
  if (!model) return <div className="h-full grid place-items-center text-[8px] text-muted-foreground">blank</div>
  return (
    <div className="h-full flex flex-col text-[6px] leading-tight text-black">
      <div className="flex items-start justify-between gap-1 border-b border-black pb-1">
        <div className="font-bold text-[8px] truncate">{businessName}</div>
        <div className="text-right shrink-0">
          <div className="font-bold text-[6px]">{model.documentTitle}</div>
          <div className="font-medium text-[5px]">{model.invoiceNo}</div>
        </div>
      </div>
      <div className="mt-1 flex justify-between gap-1 text-[5px] text-neutral-600">
        <span className="truncate">{model.customerName ? `${model.partyLabel}: ${model.customerName}` : model.channelLabel}</span>
        <span className="shrink-0">{bizDate(model.invoiceDate)}</span>
      </div>
      <div className="mt-1 border border-neutral-400">
        <div className="grid grid-cols-[1fr_auto_auto] gap-1 border-b border-neutral-400 bg-neutral-100 px-1 py-0.5 text-[5px] font-semibold">
          <span>ITEM</span><span>QTY</span><span>AMOUNT</span>
        </div>
        {model.lines.slice(0, 3).map((line, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-1 border-b border-neutral-200 px-1 py-0.5 last:border-0">
            <span className="truncate">{line.productName}</span>
            <span className="whitespace-nowrap">{model.hasReturns ? `${line.netQty} net` : `${line.soldQty}x`}</span>
            <span className="whitespace-nowrap">{formatMoney(BigInt(line.lineTotalPaisas), false)}</span>
          </div>
        ))}
        {model.lines.length > 3 && <div className="px-1 py-0.5 text-[5px] text-muted-foreground">+{model.lines.length - 3} more items</div>}
      </div>
      <div className="mt-1 flex items-center justify-between border-y border-black py-0.5 text-[6px] font-bold"><span>NET PAYABLE</span><span>{formatMoney(BigInt(model.netPayablePaisas), false)}</span></div>
      <div className="mt-auto pt-1 text-center text-[5px] text-neutral-500">{model.memo || 'Thank you for your business.'}</div>
    </div>
  )
}

// ─── Measurement container — renders invoice content off-screen for height measurement ───
// Uses inline styles that mimic the print CSS so the measurement is accurate in screen media.
function MeasurementInvoice({ model, businessName }: { model: PrintDocumentModel; businessName: string }) {
  if (!model) return null
  const cell = { border: '0.5pt solid #999', padding: '0.8mm 1.5mm', textAlign: 'right' as const }

  return (
    <div style={{
      width: '194mm',  /* 210mm - 16mm padding (8mm each side) */
      padding: '6mm 8mm',
      boxSizing: 'border-box',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '9pt',
      lineHeight: '1.3',
      color: '#000',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1.5pt solid #000', paddingBottom: '2mm', marginBottom: '2mm' }}>
        <div>
          <div style={{ fontSize: '13pt', fontWeight: 700 }}>{businessName}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '11pt', fontWeight: 700 }}>{model.documentTitle}</div>
          <div style={{ fontSize: '10pt', fontWeight: 600 }}>{model.invoiceNo}</div>
          <div style={{ display: 'inline-block', fontSize: '7pt', fontWeight: 600, padding: '0.5mm 1.5mm', border: '0.5pt solid #000', borderRadius: '1mm' }}>{model.channelLabel}</div>
        </div>
      </div>

      {/* Meta */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '4mm', marginBottom: '2mm', fontSize: '8pt' }}>
        <div>
          <div><strong>Date:</strong> {bizDate(model.invoiceDate)}</div>
          {model.sellerName && <div><strong>Seller:</strong> {model.sellerName}</div>}
          {model.source && <div><strong>Source:</strong> {model.source}</div>}
          {model.riderName && <div><strong>Rider:</strong> {model.riderName}</div>}
          {model.originalReference && <div><strong>{model.referenceLabel ?? 'Original document'}:</strong> {model.originalReference}</div>}
        </div>
        <div>
          {model.customerName && <div><strong>{model.partyLabel}:</strong> {model.customerName}</div>}
          {model.customerPhone && <div><strong>Phone:</strong> {model.customerPhone}</div>}
          {model.customerAddress && <div><strong>Address:</strong> {model.customerAddress}{model.customerCity ? `, ${model.customerCity}` : ''}</div>}
        </div>
      </div>

      {/* Items table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5pt', marginBottom: '2mm' }}>
        <thead>
          <tr>
            <th style={{ background: '#f0f0f0', border: '0.5pt solid #000', padding: '1mm 1.5mm', textAlign: 'left', fontWeight: 600, fontSize: '8pt' }}>Item</th>
            <th style={{ background: '#f0f0f0', ...cell, fontWeight: 600, fontSize: '8pt' }}>{model.hasReturns && model.documentKind === 'sale' ? 'Sold' : 'Qty'}</th>
            {model.hasReturns && <th style={{ background: '#f0f0f0', ...cell, fontWeight: 600, fontSize: '8pt' }}>Ret.</th>}
            {model.hasReturns && <th style={{ background: '#f0f0f0', ...cell, fontWeight: 600, fontSize: '8pt' }}>Net</th>}
            <th style={{ background: '#f0f0f0', ...cell, fontWeight: 600, fontSize: '8pt' }}>Rate</th>
            <th style={{ background: '#f0f0f0', ...cell, fontWeight: 600, fontSize: '8pt' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {model.lines.map((line, i) => (
            <tr key={i}>
              <td style={{ border: '0.5pt solid #999', padding: '0.8mm 1.5mm', verticalAlign: 'top' }}>
                {line.productName}{line.sku && <span style={{ color: '#666', fontSize: '7.5pt' }}> [{line.sku}]</span>}
              </td>
              <td style={cell}>{line.soldQty}</td>
              {model.hasReturns && <td style={cell}>{line.returnedQty}</td>}
              {model.hasReturns && <td style={cell}>{line.netQty}</td>}
              <td style={cell}>{formatMoney(BigInt(line.unitPricePaisas), false)}</td>
              <td style={cell}>{formatMoney(BigInt(line.lineTotalPaisas), false)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ marginLeft: 'auto', width: '60%', fontSize: '8.5pt', marginBottom: '1.5mm' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4mm 0' }}><span>Subtotal</span><span>{formatMoney(BigInt(model.subtotalPaisas), false)}</span></div>
        {BigInt(model.returnDeductionPaisas) > 0n && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4mm 0' }}><span>Less returns</span><span>-{formatMoney(BigInt(model.returnDeductionPaisas), false)}</span></div>}
        {BigInt(model.discountPaisas) > 0n && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4mm 0', color: '#666' }}><span>Discount</span><span>-{formatMoney(BigInt(model.discountPaisas), false)}</span></div>}
        {model.deliveryFeePaisas && BigInt(model.deliveryFeePaisas) > 0n && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4mm 0' }}><span>Delivery Fee</span><span>{formatMoney(BigInt(model.deliveryFeePaisas), false)}</span></div>}
        {model.additionalChargesPaisas && BigInt(model.additionalChargesPaisas) > 0n && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4mm 0' }}><span>Additional Charges</span><span>{formatMoney(BigInt(model.additionalChargesPaisas), false)}</span></div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1pt solid #000', borderBottom: '1pt solid #000', fontWeight: 700, fontSize: '10pt', padding: '1mm 0', margin: '0.5mm 0' }}><span>{model.documentKind.includes('return') ? 'Return Total' : 'Net Payable'}</span><span>{formatMoney(BigInt(model.netPayablePaisas), false)}</span></div>
        {model.showSettlement && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4mm 0' }}><span>Paid</span><span>{formatMoney(BigInt(model.paidPaisas), false)}</span></div>}
        {model.showSettlement && BigInt(model.balancePaisas) > 0n && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4mm 0', fontWeight: 600 }}><span>Balance</span><span>{formatMoney(BigInt(model.balancePaisas), false)}</span></div>}
        {model.showSettlement && model.changePaisas && BigInt(model.changePaisas) > 0n && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4mm 0' }}><span>Change</span><span>{formatMoney(BigInt(model.changePaisas), false)}</span></div>}
        {model.showSettlement && model.codAmountPaisas && BigInt(model.codAmountPaisas) > 0n && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4mm 0' }}><span>COD Amount</span><span>{formatMoney(BigInt(model.codAmountPaisas), false)}</span></div>}
      </div>

      {/* Payment summary */}
      {model.showSettlement && model.payments.length > 0 && (
        <div style={{ border: '0.5pt solid #999', padding: '1mm 1.5mm', fontSize: '7.5pt', marginBottom: '1.5mm' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.5mm', fontSize: '8pt' }}>Payment Summary</div>
          {model.payments.map((p, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.2mm 0' }}>
              <span>{p.accountName}{p.isChange && ' (Change)'}</span>
              <span>{formatMoney(BigInt(p.amountPaisas), false)}</span>
            </div>
          ))}
        </div>
      )}

      {model.internalCommission && (
        <div style={{ border: '0.5pt dashed #333', padding: '1mm 1.5mm', fontSize: '7.5pt', marginBottom: '1.5mm' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.5mm' }}>Internal copy — commission</div>
          {model.internalCommission.lines.map((line, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '2mm' }}><span>{line.productName} × {line.netEligibleQty}</span><span>{formatMoney(BigInt(line.commissionPaisas), false)}</span></div>
          ))}
        </div>
      )}

      {(model.settlementLabel || model.isReturned || model.isCancelled || (model.documentKind === 'sale' && BigInt(model.balancePaisas) === 0n)) && (
        <div style={{ border: '0.5pt solid #333', padding: '0.8mm', textAlign: 'center', fontSize: '7pt', fontWeight: 700, marginBottom: '1.5mm' }}>
          {model.settlementLabel || (model.isCancelled ? 'CANCELLED' : model.isReturned ? 'RETURNED' : 'PAID')}
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: 'auto', borderTop: '0.5pt solid #999', paddingTop: '1mm', fontSize: '7.5pt', color: '#555', display: 'grid', gridTemplateColumns: '1fr 36mm auto', gap: '3mm', alignItems: 'end' }}>
        <span style={{ fontStyle: 'italic' }}>{model.memo || 'Thank you for your business!'}</span>
        <span style={{ borderTop: '0.5pt solid #777', paddingTop: '1mm', textAlign: 'center', fontSize: '6.5pt' }}>Authorized Signature</span>
        <span>{bizFormat(new Date().toISOString(), 'datetime')}</span>
      </div>
    </div>
  )
}

function InvoicePrintRoot({ mode, models, businessName, businessContact }: { mode: InvoicePrintMode; models: PrintDocumentModel[]; businessName: string; businessContact?: { phone?: string; address?: string; email?: string } | null }) {
  const isHalf = mode === 'single'
  const showTop = mode === 'single' || mode === 'two-up' || mode === 'top-half'
  const showBottom = mode === 'two-up' || mode === 'bottom-half'

  if (mode === 'thermal') {
    return (
      <div className="invoice-print-root invoice-print-root-thermal" data-print-surface="invoice">
        <ThermalReceipt model={models[0]} businessName={businessName} businessContact={businessContact} />
      </div>
    )
  }

  if (mode === 'full-a4') {
    // Full A4 — single invoice uses entire page
    return (
      <div className="invoice-print-root" data-print-surface="invoice">
        <div className="a4-page a4-single">
          <InvoiceDocument model={models[0]} variant="full" businessName={businessName} businessContact={businessContact} />
        </div>
      </div>
    )
  }

  return (
    <div className="invoice-print-root" data-print-surface="invoice">
      {isHalf ? (
        <div className="a4-page">
          <div className="a4-half a4-half-top"><InvoiceDocument model={models[0]} variant="half" businessName={businessName} businessContact={businessContact} /></div>
          <div className="a4-half a4-half-bottom a4-half-blank" />
        </div>
      ) : (
        <div className="a4-page">
          {showTop ? (
            <div className="a4-half a4-half-top">
              <InvoiceDocument model={models[0]} variant="half" businessName={businessName} businessContact={businessContact} />
            </div>
          ) : <div className="a4-half a4-half-top a4-half-blank" />}
          {showBottom ? (
            <div className="a4-half a4-half-bottom">
              {models[0] && <InvoiceDocument model={models[1] ?? models[0]} variant="half" businessName={businessName} businessContact={businessContact} />}
            </div>
          ) : <div className="a4-half a4-half-bottom a4-half-blank" />}
        </div>
      )}
    </div>
  )
}

/**
 * Half-A4 and full-A4 share one document body: only the page box differs, so
 * the two sheet sizes can never drift apart in content.
 */
function InvoiceDocument({
  model,
  variant,
  businessName,
  businessContact,
}: {
  model?: PrintDocumentModel
  variant: 'half' | 'full'
  businessName: string
  businessContact?: { phone?: string; address?: string; email?: string } | null
}) {
  if (!model) return null

  return (
    <div className={variant === 'half' ? 'invoice-half' : 'invoice-full-a4'}>
      <div className="inv-header">
        <div className="inv-business">
          <div className="inv-business-name">{businessName}</div>
          {[businessContact?.phone, businessContact?.email].filter(Boolean).length > 0 && (
            <div className="inv-business-contact">{[businessContact?.phone, businessContact?.email].filter(Boolean).join(' · ')}</div>
          )}
          {businessContact?.address && <div className="inv-business-contact">{businessContact.address}</div>}
        </div>
        <div className="inv-title-block">
          <div className="inv-document-kicker">BUSINESS DOCUMENT</div>
          <div className="inv-title">{model.documentTitle}</div>
          <div className="inv-no"><span>Document No.</span><strong data-num>{model.invoiceNo}</strong></div>
          <div className="inv-type-badge">{model.channelLabel}</div>
        </div>
      </div>

      <div className="inv-meta">
        {(model.customerName || model.customerPhone || model.customerAddress) && (
          <div className="inv-meta-col inv-party-block">
            <div className="inv-meta-heading">{model.partyLabel === 'Vendor' ? 'Supplier' : 'Bill To'}</div>
            {model.customerName && <div className="inv-party-name">{model.customerName}</div>}
            {model.customerPhone && <div className="inv-meta-row"><span className="inv-meta-label">Phone</span><span className="inv-meta-value" data-num>{model.customerPhone}</span></div>}
            {model.customerAddress && <div className="inv-meta-row"><span className="inv-meta-label">Address</span><span className="inv-meta-value">{model.customerAddress}{model.customerCity ? `, ${model.customerCity}` : ''}</span></div>}
          </div>
        )}
        <div className="inv-meta-col inv-document-meta">
          <div className="inv-meta-heading">Document Details</div>
          <div className="inv-meta-row"><span className="inv-meta-label">Date</span><span className="inv-meta-value" data-num>{bizFormat(model.invoiceDate, 'datetime')}</span></div>
          {model.sellerName && (
            <div className="inv-meta-row">
              <span className="inv-meta-label">Seller</span>
              <span className="inv-meta-value">{model.sellerName}{model.sellerRoleLabel ? ` (${model.sellerRoleLabel})` : ''}</span>
            </div>
          )}
          {model.source && <div className="inv-meta-row"><span className="inv-meta-label">Source</span><span className="inv-meta-value">{model.source}</span></div>}
          {model.riderName && <div className="inv-meta-row"><span className="inv-meta-label">Rider</span><span className="inv-meta-value">{model.riderName}</span></div>}
          {model.originalReference && <div className="inv-meta-row"><span className="inv-meta-label">{model.referenceLabel ?? 'Original document'}</span><span className="inv-meta-value" data-num>{model.originalReference}</span></div>}
        </div>
      </div>

      <table className={`inv-items-table${model.hasReturns ? ' inv-items-table-returns' : ''}`}>
        <thead>
          <tr>
            <th className="inv-col-item">Item</th>
            <th className="inv-col-qty">{model.hasReturns && model.documentKind === 'sale' ? 'Sold' : 'Qty'}</th>
            {model.hasReturns && <th className="inv-col-qty">Ret.</th>}
            {model.hasReturns && <th className="inv-col-qty">Net</th>}
            <th className="inv-col-rate">Rate</th>
            <th className="inv-col-total">Amount</th>
          </tr>
        </thead>
        <tbody>
          {model.lines.map((line, i) => (
            <tr key={i}>
              <td className="inv-col-item">
                {line.productName}
                {line.sku && <span className="inv-sku"> [{line.sku}]</span>}
              </td>
              <td className="inv-col-qty" data-num>{line.soldQty}</td>
              {model.hasReturns && <td className="inv-col-qty" data-num>{line.returnedQty}</td>}
              {model.hasReturns && <td className="inv-col-qty" data-num>{line.netQty}</td>}
              <td className="inv-col-rate" data-num>{formatMoney(BigInt(line.unitPricePaisas), false)}</td>
              <td className="inv-col-total" data-num>{formatMoney(BigInt(line.lineTotalPaisas), false)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="inv-totals">
        <div className="inv-totals-row"><span>Subtotal</span><span data-num>{formatMoney(BigInt(model.subtotalPaisas), false)}</span></div>
        {BigInt(model.returnDeductionPaisas) > 0n && <div className="inv-totals-row inv-totals-discount"><span>Less returns</span><span data-num>-{formatMoney(BigInt(model.returnDeductionPaisas), false)}</span></div>}
        {BigInt(model.discountPaisas) > 0n && <div className="inv-totals-row inv-totals-discount"><span>Discount</span><span data-num>-{formatMoney(BigInt(model.discountPaisas), false)}</span></div>}
        {model.deliveryFeePaisas && BigInt(model.deliveryFeePaisas) > 0n && <div className="inv-totals-row"><span>Delivery Fee</span><span data-num>{formatMoney(BigInt(model.deliveryFeePaisas), false)}</span></div>}
        {model.additionalChargesPaisas && BigInt(model.additionalChargesPaisas) > 0n && <div className="inv-totals-row"><span>Additional Charges</span><span data-num>{formatMoney(BigInt(model.additionalChargesPaisas), false)}</span></div>}
        <div className="inv-totals-row inv-totals-grand"><span>{model.documentKind.includes('return') ? 'Return Total' : 'Net Payable'}</span><span data-num>{formatMoney(BigInt(model.netPayablePaisas), false)}</span></div>
        {model.showSettlement && <div className="inv-totals-row"><span>Paid</span><span data-num>{formatMoney(BigInt(model.paidPaisas), false)}</span></div>}
        {model.showSettlement && BigInt(model.balancePaisas) > 0n && <div className="inv-totals-row inv-totals-outstanding"><span>Balance</span><span data-num>{formatMoney(BigInt(model.balancePaisas), false)}</span></div>}
        {model.showSettlement && model.changePaisas && BigInt(model.changePaisas) > 0n && <div className="inv-totals-row"><span>Change</span><span data-num>{formatMoney(BigInt(model.changePaisas), false)}</span></div>}
        {model.showSettlement && model.codAmountPaisas && BigInt(model.codAmountPaisas) > 0n && <div className="inv-totals-row inv-totals-cod"><span>COD Amount</span><span data-num>{formatMoney(BigInt(model.codAmountPaisas), false)}</span></div>}
      </div>

      {model.showSettlement && model.payments.length > 0 && (
        <div className="inv-payments">
          <div className="inv-payments-title">Payment Summary</div>
          {model.payments.map((p, i) => (
            <div key={i} className="inv-payment-row">
              <span>{p.accountName}{p.isChange && ' (Change)'}</span>
              <span data-num>{formatMoney(BigInt(p.amountPaisas), false)}</span>
            </div>
          ))}
        </div>
      )}

      {model.internalCommission && <InternalCommissionBlock commission={model.internalCommission} />}

      {model.settlementLabel && <div className="inv-status-banner">{model.settlementLabel}</div>}

      {model.documentKind === 'sale' && model.isReturned && <div className="inv-status-banner inv-status-returned">RETURNED</div>}
      {model.documentKind === 'sale' && model.isCancelled && <div className="inv-status-banner inv-status-cancelled">CANCELLED</div>}
      {model.documentKind === 'sale' && BigInt(model.balancePaisas) === 0n && !model.isReturned && !model.isCancelled && <div className="inv-status-banner inv-status-paid">PAID</div>}

      <div className="inv-footer">
        <div className="inv-footer-message">{model.memo || 'Thank you for your business!'}</div>
        <div className="inv-signature-line">Authorized Signature</div>
        <div className="inv-footer-timestamp" data-num>Printed: {bizFormat(new Date().toISOString(), 'datetime')}</div>
      </div>
    </div>
  )
}

/** Owner copy only — rendered solely when commission was explicitly included. */
function InternalCommissionBlock({ commission }: { commission: NonNullable<InvoicePrintModel['internalCommission']> }) {
  return (
    <div className="inv-commission">
      <div className="inv-commission-title">Internal copy — commission (not for customer)</div>
      {commission.lines.map((line, i) => (
        <div key={i} className="inv-payment-row">
          <span>{line.productName} — {line.netEligibleQty} × {formatMoney(BigInt(line.ratePaisas), false)}</span>
          <span data-num>{formatMoney(BigInt(line.commissionPaisas), false)}</span>
        </div>
      ))}
      <div className="inv-payment-row inv-commission-total">
        <span>Total commission</span>
        <span data-num>{formatMoney(BigInt(commission.totalPaisas), false)}</span>
      </div>
    </div>
  )
}

/** 80mm roll receipt — same model, single-column layout. */
function ThermalReceipt({
  model,
  businessName,
  businessContact,
}: {
  model?: PrintDocumentModel
  businessName: string
  businessContact?: { phone?: string; address?: string; email?: string } | null
}) {
  if (!model) return null

  return (
    <div className="thermal-receipt">
      <div className="thr-head">
        <div className="thr-business">{businessName}</div>
        {businessContact?.phone && <div className="thr-line">{businessContact.phone}</div>}
        {businessContact?.address && <div className="thr-line">{businessContact.address}</div>}
        <div className="thr-title">{model.documentTitle}</div>
      </div>

      <div className="thr-meta">
        <div className="thr-row"><span>Document</span><span data-num>{model.invoiceNo}</span></div>
        <div className="thr-row"><span>Date</span><span data-num>{bizFormat(model.invoiceDate, 'datetime')}</span></div>
        <div className="thr-row"><span>Channel</span><span>{model.channelLabel}</span></div>
        {model.sellerName && <div className="thr-row"><span>Seller</span><span>{model.sellerName}{model.sellerRoleLabel ? ` (${model.sellerRoleLabel})` : ''}</span></div>}
        {model.source && <div className="thr-row"><span>Source</span><span>{model.source}</span></div>}
        {model.riderName && <div className="thr-row"><span>Rider</span><span>{model.riderName}</span></div>}
        {model.originalReference && <div className="thr-row"><span>{model.referenceLabel ?? 'Original'}</span><span data-num>{model.originalReference}</span></div>}
        {model.customerName && <div className="thr-row"><span>{model.partyLabel}</span><span>{model.customerName}</span></div>}
        {model.customerPhone && <div className="thr-row"><span>Phone</span><span data-num>{model.customerPhone}</span></div>}
      </div>

      <div className="thr-rule" />

      <div className="thr-items">
        {model.lines.map((line, i) => (
          <div key={i} className="thr-item">
            <div className="thr-item-name">{line.productName}</div>
            <div className="thr-row">
              <span data-num>
                {model.hasReturns
                  ? `${line.soldQty} - ${line.returnedQty} = ${line.netQty} × ${formatMoney(BigInt(line.unitPricePaisas), false)}`
                  : `${line.soldQty} × ${formatMoney(BigInt(line.unitPricePaisas), false)}`}
              </span>
              <span data-num>{formatMoney(BigInt(line.lineTotalPaisas), false)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="thr-rule" />

      <div className="thr-totals">
        <div className="thr-row"><span>Subtotal</span><span data-num>{formatMoney(BigInt(model.subtotalPaisas), false)}</span></div>
        {BigInt(model.returnDeductionPaisas) > 0n && <div className="thr-row"><span>Less returns</span><span data-num>-{formatMoney(BigInt(model.returnDeductionPaisas), false)}</span></div>}
        {BigInt(model.discountPaisas) > 0n && <div className="thr-row"><span>Discount</span><span data-num>-{formatMoney(BigInt(model.discountPaisas), false)}</span></div>}
        {model.deliveryFeePaisas && BigInt(model.deliveryFeePaisas) > 0n && <div className="thr-row"><span>Delivery Fee</span><span data-num>{formatMoney(BigInt(model.deliveryFeePaisas), false)}</span></div>}
        {model.additionalChargesPaisas && BigInt(model.additionalChargesPaisas) > 0n && <div className="thr-row"><span>Additional Charges</span><span data-num>{formatMoney(BigInt(model.additionalChargesPaisas), false)}</span></div>}
        <div className="thr-row thr-grand"><span>{model.documentKind.includes('return') ? 'Return Total' : 'Net Payable'}</span><span data-num>{formatMoney(BigInt(model.netPayablePaisas), false)}</span></div>
        {model.showSettlement && <div className="thr-row"><span>Paid</span><span data-num>{formatMoney(BigInt(model.paidPaisas), false)}</span></div>}
        {model.showSettlement && BigInt(model.balancePaisas) > 0n && <div className="thr-row"><span>Balance</span><span data-num>{formatMoney(BigInt(model.balancePaisas), false)}</span></div>}
        {model.showSettlement && model.codAmountPaisas && BigInt(model.codAmountPaisas) > 0n && <div className="thr-row"><span>COD</span><span data-num>{formatMoney(BigInt(model.codAmountPaisas), false)}</span></div>}
      </div>

      {model.showSettlement && model.payments.length > 0 && (
        <>
          <div className="thr-rule" />
          <div className="thr-totals">
            {model.payments.map((p, i) => (
              <div key={i} className="thr-row"><span>{p.accountName}{p.isChange ? ' (Change)' : ''}</span><span data-num>{formatMoney(BigInt(p.amountPaisas), false)}</span></div>
            ))}
          </div>
        </>
      )}

      {model.internalCommission && (
        <>
          <div className="thr-rule" />
          <div className="thr-totals">
            <div className="thr-item-name">Internal copy — commission</div>
            {model.internalCommission.lines.map((line, i) => (
              <div key={i} className="thr-row"><span>{line.productName} × {line.netEligibleQty}</span><span data-num>{formatMoney(BigInt(line.commissionPaisas), false)}</span></div>
            ))}
            <div className="thr-row thr-grand"><span>Total</span><span data-num>{formatMoney(BigInt(model.internalCommission.totalPaisas), false)}</span></div>
          </div>
        </>
      )}

      <div className="thr-rule" />
      <div className="thr-foot">
        <div>{model.memo || 'Thank you for your business!'}</div>
        {model.settlementLabel && <div className="thr-status">{model.settlementLabel}</div>}
        {model.documentKind === 'sale' && model.isReturned && <div className="thr-status">RETURNED</div>}
        {model.documentKind === 'sale' && model.isCancelled && <div className="thr-status">CANCELLED</div>}
        <div data-num>Printed: {bizFormat(new Date().toISOString(), 'datetime')}</div>
      </div>
    </div>
  )
}

function InvoicePrintStyles({ mode }: { mode: InvoicePrintMode }) {
  // This style exists while the dialog is open, rather than being injected at
  // click time. That makes the physical page rule part of the mounted print
  // surface before the native print lifecycle starts.
  // CSS paged-media does not accept a mixed length/`auto` value. Chromium
  // discards `80mm auto` and falls back to its default Letter page instead.
  // A real 80mm-wide custom sheet keeps the receipt out of both Letter and A4.
  const pageSize = mode === 'thermal' ? '80mm 297mm' : 'A4 portrait'
  return <style>{`
    @page { size: ${pageSize}; margin: 0; }
    .invoice-print-root { display: none; visibility: hidden; }
    @media print {
      html.invoice-printing:not(.invoice-printing-thermal), html.invoice-printing:not(.invoice-printing-thermal) body { width: 210mm; min-height: 297mm; margin: 0 !important; padding: 0 !important; background: #fff !important; }
      html.invoice-printing.invoice-printing-thermal, html.invoice-printing.invoice-printing-thermal body { width: 80mm; min-height: 0; margin: 0 !important; padding: 0 !important; background: #fff !important; }
      body.printing-invoice .no-print,
      body.printing-invoice .invoice-print-measure { display: none !important; visibility: hidden !important; }
      body.printing-invoice > *:not(#__next) { display: none !important; visibility: hidden !important; }
      body.printing-invoice #__next * { visibility: hidden !important; }
      body.printing-invoice .invoice-print-root,
      body.printing-invoice .invoice-print-root * { visibility: visible !important; }
      body.printing-invoice .invoice-print-root { display: block !important; position: fixed; inset: 0 auto auto 0; z-index: 2147483647; width: 210mm; color: #000; background: #fff; }
      body.printing-invoice .invoice-print-root-thermal { width: 80mm; min-height: 0; }
      .invoice-print-root .a4-page { position: relative; width: 210mm; height: 297mm; padding: 0 !important; box-sizing: border-box; overflow: hidden; break-after: page; page-break-after: always; background: #fff; }
      .invoice-print-root .a4-page.a4-single { min-height: 297mm; height: auto; overflow: visible; break-after: auto; page-break-after: auto; }
      .invoice-print-root .a4-half { position: relative; width: 210mm; height: 148.5mm; padding: 0 !important; box-sizing: border-box; overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
      .invoice-print-root .a4-half-top { border-bottom: 0.3mm dashed #777; }
      .invoice-print-root .a4-half-top::after { content: 'CUT HERE'; position: absolute; bottom: -2.4mm; left: 50%; transform: translateX(-50%); padding: 0 2mm; font: 6pt Arial, sans-serif; color: #555; background: #fff; }
      .invoice-print-root .a4-half-blank { background: #fff; }
      .invoice-print-root .invoice-half { width: 100%; height: 100%; box-sizing: border-box; overflow: hidden; padding: 5.5mm 7mm 4.5mm; font: 8.3pt/1.25 Arial, sans-serif; color: #111; }
      .invoice-print-root .invoice-full-a4 { width: 100%; min-height: 297mm; height: auto; box-sizing: border-box; overflow: visible; padding: 12mm 14mm; font: 10pt/1.4 Arial, sans-serif; color: #111; }
      .invoice-print-root .inv-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 7mm; border-top: .8mm solid #111; border-bottom: .25mm solid #555; padding: 2mm 0 2.5mm; margin-bottom: 3mm; }
      .invoice-print-root .inv-business { min-width: 0; }
      .invoice-print-root .inv-business-name { font-size: 14pt; font-weight: 700; letter-spacing: .1mm; overflow-wrap: anywhere; }
      .invoice-print-root .inv-business-contact { font-size: 7.2pt; color: #444; overflow-wrap: anywhere; }
      .invoice-print-root .inv-title-block { text-align: right; }
      .invoice-print-root .inv-document-kicker { font-size: 6.2pt; font-weight: 700; letter-spacing: .45mm; color: #555; }
      .invoice-print-root .inv-title { font-size: 11pt; font-weight: 700; letter-spacing: .3mm; }
      .invoice-print-root .inv-no { display: flex; justify-content: flex-end; gap: 2mm; align-items: baseline; font-size: 7pt; color: #555; }
      .invoice-print-root .inv-no strong { font-size: 9pt; color: #111; }
      .invoice-print-root .inv-type-badge { display: inline-block; margin-top: 1mm; border: .25mm solid #333; padding: .45mm 1.5mm; font-size: 6.5pt; font-weight: 700; letter-spacing: .15mm; }
      .invoice-print-root .inv-meta { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 4mm; margin-bottom: 3mm; font-size: 7.4pt; }
      .invoice-print-root .inv-meta-col { min-width: 0; border-left: .45mm solid #222; padding: 1mm 0 1mm 2mm; overflow-wrap: anywhere; }
      .invoice-print-root .inv-document-meta { text-align: right; border-left: 0; border-right: .45mm solid #222; padding-left: 0; padding-right: 2mm; }
      .invoice-print-root .inv-meta-heading { margin-bottom: .7mm; font-size: 6.2pt; font-weight: 700; letter-spacing: .35mm; text-transform: uppercase; color: #555; }
      .invoice-print-root .inv-party-name { margin-bottom: .6mm; font-size: 8.5pt; font-weight: 700; }
      .invoice-print-root .inv-meta-row { display: flex; justify-content: space-between; gap: 2mm; margin-bottom: .35mm; overflow-wrap: anywhere; }
      .invoice-print-root .inv-document-meta .inv-meta-row { justify-content: flex-end; }
      .invoice-print-root .inv-meta-label { font-weight: 700; color: #555; }
      .invoice-print-root .inv-items-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 7.5pt; }
      .invoice-print-root .inv-items-table thead { display: table-header-group; }
      .invoice-print-root .inv-items-table tr { break-inside: avoid; page-break-inside: avoid; }
      .invoice-print-root .inv-items-table th { border: .25mm solid #222; padding: 1mm; text-align: left; font-size: 6.8pt; letter-spacing: .12mm; background: #f1f1f1 !important; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .invoice-print-root .inv-items-table td { border: .18mm solid #999; padding: .85mm 1mm; vertical-align: top; overflow-wrap: anywhere; }
      .invoice-print-root .inv-col-item { width: 52%; text-align: left; }
      .invoice-print-root .inv-col-qty { width: 11%; text-align: right !important; }
      .invoice-print-root .inv-col-rate, .invoice-print-root .inv-col-total { width: 18.5%; text-align: right !important; }
      /* Sold/returned/net needs two extra columns; narrow the item column to fit. */
      .invoice-print-root .inv-items-table-returns .inv-col-item { width: 36%; }
      .invoice-print-root .inv-items-table-returns .inv-col-qty { width: 9%; }
      .invoice-print-root .inv-items-table-returns .inv-col-rate, .invoice-print-root .inv-items-table-returns .inv-col-total { width: 18.5%; }
      .invoice-print-root .inv-sku { color: #555; font-size: 6.5pt; }
      .invoice-print-root .inv-totals { width: 58%; margin: 2.5mm 0 1.8mm auto; font-size: 7.5pt; break-inside: avoid; page-break-inside: avoid; }
      .invoice-print-root .inv-totals-row, .invoice-print-root .inv-payment-row { display: flex; justify-content: space-between; gap: 4mm; padding: .45mm 0; }
      .invoice-print-root .inv-totals-grand { border-top: .5mm solid #111; border-bottom: .5mm solid #111; padding: 1mm 0; font-size: 9.2pt; font-weight: 700; }
      .invoice-print-root .inv-totals-discount, .invoice-print-root .inv-totals-outstanding { font-weight: 700; }
      .invoice-print-root .inv-payments { border: .2mm solid #777; padding: 1.2mm; font-size: 6.8pt; break-inside: avoid; page-break-inside: avoid; }
      .invoice-print-root .inv-payments-title { font-size: 6.3pt; font-weight: 700; letter-spacing: .25mm; text-transform: uppercase; margin-bottom: .6mm; }
      .invoice-print-root .inv-commission { border: .3mm dashed #000; padding: 1mm; margin-top: 1.5mm; font-size: 6.8pt; break-inside: avoid; page-break-inside: avoid; }
      .invoice-print-root .inv-commission-title { font-weight: 700; margin-bottom: .5mm; }
      .invoice-print-root .inv-commission-total { border-top: .2mm solid #000; margin-top: .5mm; padding-top: .5mm; font-weight: 700; }
      .invoice-print-root .inv-status-banner { margin-top: 1.5mm; border: .3mm solid #222; padding: .8mm; text-align: center; font-size: 7pt; font-weight: 700; letter-spacing: .25mm; }
      .invoice-print-root .inv-footer { display: grid; grid-template-columns: 1fr 38mm auto; align-items: end; gap: 4mm; border-top: .2mm solid #777; margin-top: 2mm; padding-top: 1.5mm; font-size: 6.4pt; color: #444; break-inside: avoid; page-break-inside: avoid; overflow-wrap: anywhere; }
      .invoice-print-root .inv-footer-message { font-style: italic; }
      .invoice-print-root .inv-signature-line { border-top: .2mm solid #555; padding-top: .7mm; text-align: center; font-size: 6pt; color: #555; }

      /* ── 80mm thermal roll ── */
      body.printing-invoice .invoice-print-root-thermal { width: 80mm; }
      .invoice-print-root .thermal-receipt { width: 80mm; box-sizing: border-box; padding: 3mm 3mm 6mm; font: 8pt/1.3 'Courier New', monospace; color: #000; }
      .invoice-print-root .thr-head { text-align: center; margin-bottom: 1.5mm; }
      .invoice-print-root .thr-business { font-size: 11pt; font-weight: 700; }
      .invoice-print-root .thr-line { font-size: 7pt; }
      .invoice-print-root .thr-title { margin-top: 1mm; font-size: 8.5pt; font-weight: 700; letter-spacing: .3mm; }
      .invoice-print-root .thr-row { display: flex; justify-content: space-between; gap: 2mm; }
      .invoice-print-root .thr-row > span:last-child { text-align: right; white-space: nowrap; }
      .invoice-print-root .thr-rule { border-top: .2mm dashed #000; margin: 1.5mm 0; }
      .invoice-print-root .thr-item { margin-bottom: 1mm; }
      .invoice-print-root .thr-item-name { font-weight: 700; overflow-wrap: anywhere; }
      .invoice-print-root .thr-grand { border-top: .3mm solid #000; margin-top: 1mm; padding-top: 1mm; font-size: 9.5pt; font-weight: 700; }
      .invoice-print-root .thr-foot { text-align: center; font-size: 7pt; }
      .invoice-print-root .thr-status { margin-top: 1mm; font-weight: 700; letter-spacing: .4mm; }
    }
  `}</style>
}
