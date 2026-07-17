/**
 * Money & number formatting — all money is stored as BigInt minor units
 * (paisas). Display is always PKR with thousands separators. Numeric
 * business values are rendered in a monospace font in the UI; this lib
 * returns plain strings and the UI wraps them with `font-mono`.
 */
import { bizFormat } from '@/lib/dates'

/** Parse a user-entered money string ("8,000" / "8000" / "8000.50") into paisas. */
export function parseMoney(input: string): bigint | null {
  if (!input) return null
  const cleaned = input.replace(/[,_\s]/g, '')
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [whole, frac = ''] = cleaned.split('.')
  const fracPadded = (frac + '00').slice(0, 2)
  const negative = whole.startsWith('-')
  const wholeAbs = negative ? whole.slice(1) : whole
  const v = BigInt(wholeAbs) * 100n + BigInt(fracPadded)
  return negative ? -v : v
}

/** Format paisas as "Rs 12,345.00" or "-Rs 12,345.00". */
export function formatMoney(paisas: bigint | number | null | undefined, withSymbol = true): string {
  if (paisas == null) return withSymbol ? 'Rs 0.00' : '0.00'
  const b = typeof paisas === 'number' ? BigInt(Math.round(paisas)) : paisas
  const negative = b < 0n
  const abs = negative ? -b : b
  const whole = abs / 100n
  const frac = abs % 100n
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fracStr = frac.toString().padStart(2, '0')
  const body = `${wholeStr}.${fracStr}`
  if (!withSymbol) return negative ? `-${body}` : body
  return negative ? `-Rs ${body}` : `Rs ${body}`
}

/** Format paisa-denominated values as whole rupees with comma separators. */
export function formatWholeRupees(paisas: bigint | number | null | undefined, withSymbol = true): string {
  if (paisas == null) return withSymbol ? 'Rs 0' : '0'
  const b = typeof paisas === 'number' ? BigInt(Math.round(paisas)) : paisas
  const negative = b < 0n
  const abs = negative ? -b : b
  const whole = abs / 100n
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (!withSymbol) return negative ? `-${wholeStr}` : wholeStr
  return negative ? `-Rs ${wholeStr}` : `Rs ${wholeStr}`
}

/** Format an integer quantity with thousands separators. */
export function formatQty(q: bigint | number | null | undefined): string {
  if (q == null) return '0'
  const b = typeof q === 'number' ? BigInt(Math.round(q)) : q
  const neg = b < 0n
  const abs = neg ? -b : b
  const s = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return neg ? `-${s}` : s
}

/** Format a Date for table display. */
export function formatTableDate(d: Date | string | number): string {
  return bizFormat(d, 'date')
}
