/**
 * Operational Pulse — how many things happened, never how much money moved.
 *
 * Every count comes from a document set the dashboard payload already
 * measured for the selected period, so this section adds no request and
 * repeats no value shown by the hero KPIs, Cash Position or Recent Activity.
 */

export type OperationalPulseKey =
  | 'invoices'
  | 'collections'
  | 'expenses'
  | 'purchases'
  | 'salesReturns'
  | 'purchaseReturns'

export type OperationalPulseState = 'available' | 'not-tracked' | 'error'

export type OperationalPulseCounts = Record<OperationalPulseKey, number | null>

export type OperationalPulseItem = {
  key: OperationalPulseKey
  label: string
  count: number
  destination: string
}

/** Rider/COD is deliberately absent: no rider table is verified in production. */
const DEFINITIONS: Array<{ key: OperationalPulseKey; label: string; destination: string }> = [
  { key: 'invoices', label: 'Invoices', destination: '/?page=sales-list' },
  { key: 'collections', label: 'Collections', destination: '/?page=accounts' },
  { key: 'expenses', label: 'Expenses', destination: '/?page=accounts' },
  { key: 'purchases', label: 'Purchases', destination: '/?page=purchases' },
  { key: 'salesReturns', label: 'Sales Returns', destination: '/?page=sales-list' },
  { key: 'purchaseReturns', label: 'Purchase Returns', destination: '/?page=purchases' },
]

export function buildOperationalPulse(input: {
  counts: Partial<OperationalPulseCounts> | null | undefined
  states?: Partial<Record<OperationalPulseKey, OperationalPulseState>>
  canOpen?: (destination: string) => boolean
}): OperationalPulseItem[] {
  const counts = input.counts ?? {}
  return DEFINITIONS.flatMap((definition) => {
    const count = counts[definition.key]
    const state = input.states?.[definition.key] ?? (typeof count === 'number' ? 'available' : 'not-tracked')
    if (state !== 'available' || typeof count !== 'number' || !Number.isInteger(count) || count < 0) return []
    if (input.canOpen && !input.canOpen(definition.destination)) return []
    return [{ key: definition.key, label: definition.label, count, destination: definition.destination }]
  })
}

/** True when at least one count failed to load, so the section can offer Retry. */
export function operationalPulseHasError(
  states: Partial<Record<OperationalPulseKey, OperationalPulseState>> | undefined,
): boolean {
  return DEFINITIONS.some((definition) => states?.[definition.key] === 'error')
}
