export type DashboardActivity = {
  id: string
  timestamp: string
  kind: 'sale' | 'purchase' | 'payment' | 'expense' | 'transfer' | 'return' | 'rider' | 'entry'
  title: string
  reference: string | null
  amount: string | null
  destination: string
}

type AuditRow = {
  id: string
  timestamp: string | Date
  action: string
  entity: string
  entityId: string | null
  details?: unknown
}

function detailsObject(details: unknown): Record<string, unknown> {
  if (details && typeof details === 'object' && !Array.isArray(details)) return details as Record<string, unknown>
  if (typeof details !== 'string') return {}
  try {
    const parsed: unknown = JSON.parse(details)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function readableReference(value: string | null): string | null {
  return value && /^[A-Z]{2,8}-\d+$/i.test(value) ? value : null
}

function referenceValue(value: unknown) {
  return readableReference(typeof value === 'string' ? value : null)
}

function amountValue(details: Record<string, unknown>) {
  const candidate = details.total_debit ?? details.amount
  if (typeof candidate === 'string' && /^-?\d+$/.test(candidate)) return candidate
  return typeof candidate === 'number' && Number.isSafeInteger(candidate) ? String(candidate) : null
}

const voucherActivity: Record<string, Omit<DashboardActivity, 'id' | 'timestamp' | 'reference' | 'amount'>> = {
  JV: { kind: 'entry', title: 'Journal entry posted', destination: '/?page=day-book' },
}

/** Projects bounded audit rows into meaningful, client-safe timeline events. */
export function buildRecentDashboardActivity(rows: AuditRow[]): DashboardActivity[] {
  const activities = rows.flatMap((row): DashboardActivity[] => {
    const details = detailsObject(row.details)
    const action = row.action.toUpperCase()
    if (action === 'POST_VOUCHER') {
      const voucherType = typeof details.voucher_type === 'string' ? details.voucher_type.toUpperCase() : ''
      const event = voucherActivity[voucherType]
      if (!event) return []
      return [{ id: row.id, timestamp: String(row.timestamp), ...event, reference: readableReference(row.entityId), amount: amountValue(details) }]
    }
    if (action === 'POST_SALE') return [{ id: row.id, timestamp: String(row.timestamp), kind: 'sale', title: 'Sale posted', reference: referenceValue(details.invoice_no), amount: amountValue({ amount: details.total }), destination: '/?page=sales-list' }]
    if (action === 'POST_SALES_RETURN') return [{ id: row.id, timestamp: String(row.timestamp), kind: 'return', title: 'Sale return posted', reference: referenceValue(details.return_no), amount: null, destination: '/?page=sales-list' }]
    if (action === 'POST_PURCHASE') return [{ id: row.id, timestamp: String(row.timestamp), kind: 'purchase', title: 'Purchase posted', reference: referenceValue(details.purchase_no), amount: amountValue({ amount: details.total }), destination: '/?page=purchases' }]
    if (action === 'PURCHASE_RETURN') return [{ id: row.id, timestamp: String(row.timestamp), kind: 'return', title: 'Purchase return posted', reference: referenceValue(details.return_no), amount: amountValue({ amount: details.total }), destination: '/?page=purchases' }]
    if (action === 'VENDOR_PAYMENT' || action === 'VENDOR_ADVANCE' || action === 'POST_PAYMENT_VOUCHER') return [{ id: row.id, timestamp: String(row.timestamp), kind: 'payment', title: 'Payment recorded', reference: referenceValue(details.payment_no), amount: amountValue(details), destination: '/?page=accounts' }]
    if (action === 'POST_RECEIPT_VOUCHER') return [{ id: row.id, timestamp: String(row.timestamp), kind: 'payment', title: 'Payment received', reference: referenceValue(details.receipt_no), amount: amountValue(details), destination: '/?page=accounts' }]
    if (action === 'POST_EXPENSE_BATCH') return [{ id: row.id, timestamp: String(row.timestamp), kind: 'expense', title: 'Expense posted', reference: referenceValue(details.expense_no), amount: amountValue({ amount: details.total }), destination: '/?page=accounts' }]
    if (action === 'POST_CONTRA_ENTRY' || action === 'POST_CONTRA_BATCH') return [{ id: row.id, timestamp: String(row.timestamp), kind: 'transfer', title: 'Funds transferred', reference: referenceValue(details.contra_no ?? details.batch_no), amount: amountValue({ amount: details.amount ?? details.total }), destination: '/?page=accounts' }]
    if (action === 'CANCEL_VOUCHER' || action === 'REVERSE_VOUCHER') return [{ id: row.id, timestamp: String(row.timestamp), kind: 'return', title: 'Entry reversed', reference: null, amount: null, destination: '/?page=day-book' }]
    if (action === 'PURCHASE_REPLACEMENT') return [{ id: row.id, timestamp: String(row.timestamp), kind: 'purchase', title: 'Purchase replacement posted', reference: readableReference(row.entityId), amount: null, destination: '/?page=purchases' }]
    if (action === 'PAY_RIDER_EARNING') return [{ id: row.id, timestamp: String(row.timestamp), kind: 'rider', title: 'Rider earning paid', reference: null, amount: amountValue(details), destination: '/?page=delivery' }]
    if (action === 'RECORD_DELIVERY_OUTCOME') return [{ id: row.id, timestamp: String(row.timestamp), kind: 'rider', title: 'Delivery outcome recorded', reference: referenceValue(details.outcome_no), amount: amountValue({ amount: details.cash }), destination: '/?page=delivery' }]
    if (action === 'SETTLE_RIDER_COD') return [{ id: row.id, timestamp: String(row.timestamp), kind: 'rider', title: 'Rider COD settled', reference: referenceValue(details.reference), amount: amountValue(details), destination: '/?page=delivery' }]
    return []
  })

  return activities
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 8)
}
