/**
 * Money account vocabulary — the one place that decides what a money account
 * type is.
 *
 * A business keeps its money in two places: cash it holds, and bank accounts it
 * banks with. Everything else is a *named account* the user creates under one
 * of those two — "Petty Cash", "Till Cash", "Easypaisa" and "Meezan Bank" are
 * accounts, not types. So the app offers exactly two types and lets the user
 * add as many accounts under each as they need.
 *
 * Rows written by earlier releases still carry their old label ('Wallet',
 * 'Easypaisa', 'Custom / Other', …). Those labels stay accepted on update so an
 * existing account can be saved and reclassified without rewriting production
 * data, and `normalizeBusinessAccountType` folds them into Cash or Bank for
 * display.
 */

/** The only types offered when creating a money account. */
export const BUSINESS_ACCOUNT_TYPES = ['Cash', 'Bank'] as const

/**
 * Why a delete was refused. Accounting history is never removed, so an account
 * money has moved through can only be deactivated. One wording, used by both
 * data paths, so the owner reads the same sentence everywhere.
 */
export const ACCOUNT_IN_USE_MESSAGE =
  'This account has transaction history and cannot be deleted. Deactivate it instead.'

export type BusinessAccountType = (typeof BUSINESS_ACCOUNT_TYPES)[number]

/**
 * Labels earlier releases stored. Accepted on update so a legacy account can be
 * saved and moved to Cash or Bank; never offered for a new account.
 */
export const LEGACY_BUSINESS_ACCOUNT_TYPES = [
  'Wallet',
  'Other',
  'Petty Cash',
  'Easypaisa',
  'JazzCash',
  'Custom / Other',
] as const

/**
 * Every label an existing row may be saved with. This list is deliberately the
 * same set the deployed `update_business_account` RPC allows (migration 00041),
 * so an edit that passes validation here is never rejected by the database.
 */
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

/**
 * Which of the two money types a stored label reads as. Bank labels read as
 * Bank; everything else reads as Cash, because money in a drawer or a mobile
 * wallet is cash the business holds rather than money at a bank.
 *
 * This is a display mapping only — the stored label is never rewritten by it.
 */
export function normalizeBusinessAccountType(value: string): BusinessAccountType {
  const label = String(value ?? '').trim()
  if (isBusinessAccountType(label)) return label
  return /bank/i.test(label) ? 'Bank' : 'Cash'
}

/**
 * True when a stored label is not one of the two money types, so the owner is
 * the one to decide where it belongs. Such an account keeps its label, its
 * balance and its history; it is shown under Cash with a review marker and a
 * one-click move to Cash or Bank.
 */
export function needsMoneyTypeReview(value: string | null | undefined): boolean {
  return !isBusinessAccountType(String(value ?? '').trim())
}

/**
 * Money type for a ledger account that has no money-account row of its own —
 * the accounts seeded with the chart (1010 Cash, 1020 Petty Cash, 1030 Bank,
 * 1040 Easypaisa, 1050 JazzCash). A stored type always wins over this guess;
 * no business-specific names are assumed, only the seeded bank code and the
 * word "bank" in the account's own name.
 */
export function moneyTypeFromLedgerAccount(input: {
  code?: string | null
  name?: string | null
}): BusinessAccountType {
  if (String(input.code ?? '').trim() === '1030') return 'Bank'
  return /bank/i.test(String(input.name ?? '')) ? 'Bank' : 'Cash'
}
