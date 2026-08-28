import type { Prisma, PrismaClient } from '@prisma/client'

/**
 * Shared business-scoped transaction identity allocator (Prisma paths).
 *
 * Policy: docs/ACCOUNTING_CODES_AND_IDENTITIES.md §2-§3.
 * - `PREFIX-0001` format, uppercase prefix, business-scoped sequence.
 * - Allocation is an atomic `identity_sequence` upsert inside the caller's
 *   transaction: a rolled-back posting rolls the sequence back with it, so a
 *   retried submission never burns numbers and can never collide.
 * - Legacy identities (e.g. `PRN-xxxx`, `INV-xxxx`) are never rewritten; the
 *   sequence row per (business, prefix) keeps existing numbering monotonic.
 * - Supabase paths use the equivalent SQL allocator
 *   `public.allocate_readable_identity` (migrations 00020 + 00034).
 */

type IdentityTx = Prisma.TransactionClient | PrismaClient

/**
 * Approved user-facing document prefixes. `DBN`/`CRN`/`STM` have no posting
 * path yet but are reserved so callers cannot collide with future documents.
 */
export const DOCUMENT_PREFIXES = [
  'INV', 'SRT', 'PUR', 'PRT', 'EXP', 'REC', 'PAY', 'CON', 'JRV',
  'DBN', 'CRN', 'STA', 'STM', 'OPS', 'RDS', 'COM',
  'CAP', 'DRW', 'CS', 'DO',
] as const

export type DocumentPrefix = (typeof DOCUMENT_PREFIXES)[number]

export function isDocumentPrefix(value: string): value is DocumentPrefix {
  return (DOCUMENT_PREFIXES as readonly string[]).includes(value.trim().toUpperCase())
}

export function formatDocumentNumber(prefix: string, sequence: number, pad = 4): string {
  return `${prefix.trim().toUpperCase()}-${String(sequence).padStart(pad, '0')}`
}

/**
 * Allocate the next `PREFIX-0001` identity for a business inside `tx`.
 * Must be called within the same transaction that creates the business row,
 * so idempotent replays return the same document identity without consuming
 * an extra number.
 */
export async function allocateDocumentNumber(
  tx: IdentityTx,
  businessId: string,
  prefix: string,
  pad = 4,
): Promise<string> {
  const normalized = prefix.trim().toUpperCase()
  if (!isDocumentPrefix(normalized)) {
    throw new Error(`Unsupported document identity prefix: ${prefix}`)
  }
  const seq = await tx.identitySequence.upsert({
    where: { businessId_prefix: { businessId, prefix: normalized } },
    create: { businessId, prefix: normalized, lastSeq: 1 },
    update: { lastSeq: { increment: 1 } },
  })
  return formatDocumentNumber(normalized, seq.lastSeq, pad)
}
