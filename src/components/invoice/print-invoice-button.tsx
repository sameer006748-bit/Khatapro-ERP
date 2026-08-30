'use client'

import { useState } from 'react'
import { InvoicePrintDialog, type PrintableInvoice, type PrintableCommission } from '@/components/invoice/invoice-print-dialog'
import { toast } from 'sonner'

/**
 * Wraps a print trigger button. Fetches invoice data from the server
 * (with permission check) and opens the InvoicePrintDialog.
 *
 * Usage:
 *   <PrintInvoiceButton invoiceId="..." label="Print" />
 *   <PrintInvoiceButton invoiceIds={["id1", "id2"]} label="Print 2" />  // batch
 *   <PrintInvoiceButton invoiceId="..." allowInternalCopy />            // owner copy
 *
 * `allowInternalCopy` only offers the option: commission is fetched for the
 * preview, stays off by default, and is never part of the customer document.
 */
export function PrintInvoiceButton({
  invoiceId,
  invoiceIds,
  label = 'Print',
  variant = 'outline',
  size = 'sm',
  className = '',
  icon: Icon,
  disabled = false,
  allowInternalCopy = false,
}: {
  invoiceId?: string
  invoiceIds?: string[]
  label?: string
  variant?: 'outline' | 'default' | 'ghost'
  size?: 'sm' | 'default'
  className?: string
  icon?: React.ComponentType<{ className?: string }>
  disabled?: boolean
  allowInternalCopy?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [invoices, setInvoices] = useState<PrintableInvoice[]>([])
  const [businessName, setBusinessName] = useState('Invoice')
  const [businessContact, setBusinessContact] = useState<{ phone?: string; address?: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const ids = invoiceIds || (invoiceId ? [invoiceId] : [])

  /** Owner-only extra. A failure here must never block printing the invoice. */
  async function loadCommission(id: string): Promise<PrintableCommission | null> {
    try {
      const r = await fetch(`/api/sales/${id}/commission`)
      if (!r.ok) return null
      const data = await r.json()
      if (!data?.available || !Array.isArray(data.rows) || data.rows.length === 0) return null
      const lines = data.rows
        .filter((row: any) => row.eventType === 'calculated')
        .map((row: any) => ({
          productName: row.productName,
          netEligibleQty: row.netEligibleQty,
          ratePaisas: String(row.ratePaisas),
          commissionPaisas: String(row.commissionPaisas),
        }))
      if (lines.length === 0) return null
      return { totalPaisas: String(data.totalPaisas ?? '0'), lines }
    } catch {
      return null
    }
  }

  async function handleOpen() {
    if (ids.length === 0) return
    setLoading(true)
    try {
      const fetched: PrintableInvoice[] = []
      for (const id of ids) {
        const r = await fetch(`/api/sales/${id}`)
        if (!r.ok) {
          const e = await r.json()
          throw new Error(e?.error || `Failed to load invoice ${id}`)
        }
        const data = await r.json()
        const inv = data.invoice
        if (data.business?.name) {
          setBusinessName(data.business.name)
          setBusinessContact({ phone: data.business.phone ?? undefined, address: data.business.address ?? undefined })
        }
        fetched.push({
          id: inv.id,
          invoiceNo: inv.invoiceNo,
          invoiceType: inv.invoiceType,
          invoiceDate: inv.invoiceDate,
          customerName: inv.customerName,
          customerPhone: inv.customerPhone,
          customerAddress: inv.customerAddress,
          customerCity: inv.customerCity,
          salesmanName: inv.salesmanName,
          source: data.delivery?.source ?? null,
          memo: inv.memo,
          subtotal: inv.subtotal,
          discount: inv.discount || '0',
          deliveryFee: data.delivery?.customerDeliveryCharge ?? null,
          total: inv.total,
          paidAmount: inv.paidAmount,
          outstanding: (BigInt(inv.total) - BigInt(inv.paidAmount)).toString(),
          changeAmount: null,
          codAmount: data.delivery?.totalCodAmount ?? null,
          riderName: data.delivery?.riderName ?? null,
          isReturned: inv.isReturned,
          isCancelled: inv.isCancelled,
          items: (inv.items || []).map((it: any) => ({
            productName: it.productName,
            // Use real SKU from server if available, otherwise null (omitted in print).
            // NEVER fabricate SKU from product_id.
            sku: it.sku || null,
            qty: it.qty,
            returnedQty: it.returnedQty ?? 0,
            unitPrice: it.unitPrice,
            lineTotal: it.lineTotal,
          })),
          payments: (inv.payments || []).map((p: any) => ({
            accountCode: p.accountCode,
            accountName: p.accountName,
            amount: p.amount,
            isChange: p.isChange,
          })),
          commission: allowInternalCopy ? await loadCommission(id) : null,
        })
      }
      setInvoices(fetched)
      setOpen(true)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const variantClass = variant === 'default' ? 'bg-primary text-primary-foreground' : variant === 'ghost' ? 'hover:bg-muted' : 'border border-border'
  const sizeClass = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'

  return (
    <>
      <button
        onClick={handleOpen}
        disabled={disabled || loading || ids.length === 0}
        className={`${variantClass} ${sizeClass} rounded-md font-medium press-sm flex items-center gap-1.5 disabled:opacity-50 ${className}`}
      >
        {Icon && <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} />}
        {loading ? 'Loading…' : label}
      </button>
      <InvoicePrintDialog
        open={open}
        onClose={() => setOpen(false)}
        invoices={invoices}
        businessName={businessName}
        businessContact={businessContact}
      />
    </>
  )
}
