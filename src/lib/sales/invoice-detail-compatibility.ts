/**
 * Invoice-detail read compatibility for the legacy production schema.
 *
 * Production `invoices` has PRIMARY KEY (business_id, id) — verified by the
 * 00014 preflight — so no single-column foreign key from `invoice_items.invoice_id`
 * to `invoices(id)` can exist there. PostgREST resolves embedded resources from
 * foreign keys alone, so reading line items as `invoices(..., invoice_items(...))`
 * cannot resolve on that shape and fails the WHOLE invoice read. Line items are
 * therefore fetched as their own business-scoped query, keyed on the same
 * (business_id, invoice_id) pair the index already covers.
 *
 * The core column list is deliberately the set `listInvoices` reads in
 * production today: whatever else an older database is missing, an invoice's
 * identity and its money (subtotal, total, paid) come back. The detail list adds
 * presentation-only columns and is dropped wholesale if the database predates
 * them, so a schema that has not caught up can still open its own invoices.
 */

/** Identity + money. Proven present on production by the sales list query. */
export const INVOICE_CORE_COLUMNS =
  'id, invoice_no, invoice_type, invoice_date, customer_name, salesman_id, subtotal, total, paid, status'

/** Core plus presentation-only columns; retried without these when absent. */
export const INVOICE_DETAIL_COLUMNS =
  `${INVOICE_CORE_COLUMNS}, customer_phone, customer_address, customer_city, discount, memo`

/**
 * PostgREST/Postgres codes that mean "the schema does not have this shape"
 * rather than "the query failed":
 *   42703    undefined column
 *   42P01    undefined table
 *   PGRST200 no relationship found for an embedded resource
 *   PGRST204 column absent from the schema cache
 *   PGRST205 table absent from the schema cache
 */
const SCHEMA_SHAPE_CODES = new Set(['42703', '42P01', 'PGRST200', 'PGRST204', 'PGRST205'])

const SCHEMA_SHAPE_TEXT =
  /column .* does not exist|column .* schema cache|could not find a relationship|does not exist in the schema cache|relation .* does not exist/

/**
 * True when a failed read is explained by the database's shape, and a narrower
 * query is therefore worth trying. Anything else — permissions, connectivity,
 * a genuine query fault — returns false so it propagates as a real error and is
 * never silently absorbed.
 */
export function isSchemaShapeError(
  error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined,
): boolean {
  if (!error) return false
  if (SCHEMA_SHAPE_CODES.has(String(error.code ?? '').toUpperCase())) return true
  const text = [error.message, error.details].filter(Boolean).join(' ').toLowerCase()
  return SCHEMA_SHAPE_TEXT.test(text)
}

/** Optional invoice-detail sections that may legitimately be unreadable. */
export const INVOICE_DETAIL_SECTIONS = ['items', 'payments', 'returns', 'salesman', 'returnDetail'] as const

export type InvoiceDetailSection = typeof INVOICE_DETAIL_SECTIONS[number]
