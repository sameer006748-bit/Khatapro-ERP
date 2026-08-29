/**
 * Business (payment) account type vocabulary.
 *
 * Payment accounts themselves are user-created data — "Main Cash", "Meezan
 * Bank", "JazzCash Shop" are things an Owner types in, never values this
 * codebase ships. Only the four generic CLASSES below are built in, and no
 * bank or wallet brand appears anywhere in the sales UI.
 *
 * Import-safe from both client components and API routes.
 */

/** The classes an Owner picks from when creating a payment account. */
export const BUSINESS_ACCOUNT_TYPES = ['Cash', 'Bank', 'Wallet', 'Other'] as const

export type BusinessAccountType = (typeof BUSINESS_ACCOUNT_TYPES)[number]

/**
 * Type labels written by earlier releases. They are still accepted on read and
 * on edit so existing rows keep working without a data migration, but they are
 * never offered for new accounts.
 */
export const LEGACY_BUSINESS_ACCOUNT_TYPES = [
  'Petty Cash',
  'Easypaisa',
  'JazzCash',
  'Custom / Other',
] as const

export const ACCEPTED_BUSINESS_ACCOUNT_TYPES = [
  ...BUSINESS_ACCOUNT_TYPES,
  ...LEGACY_BUSINESS_ACCOUNT_TYPES,
] as const

export function isBusinessAccountType(value: string): value is BusinessAccountType {
  return (BUSINESS_ACCOUNT_TYPES as readonly string[]).includes(value)
}

export function isAcceptedBusinessAccountType(value: string): boolean {
  return (ACCEPTED_BUSINESS_ACCOUNT_TYPES as readonly string[]).includes(value)
}

/** Map a stored (possibly legacy) label onto one of the four current classes. */
export function normalizeBusinessAccountType(value: string): BusinessAccountType {
  if (isBusinessAccountType(value)) return value
  if (value === 'Petty Cash') return 'Cash'
  if (value === 'Easypaisa' || value === 'JazzCash') return 'Wallet'
  return 'Other'
}
