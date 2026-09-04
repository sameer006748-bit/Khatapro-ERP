/**
 * Readable money-account identities.
 *
 * Policy: docs/ACCOUNTING_CODES_AND_IDENTITIES.md §4-§5 — the same shape as the
 * category code words in `code-words.ts`: uppercase, letters/digits/hyphens,
 * never a bare number, unique within the business. `CASH`, `PETTY-CASH`,
 * `EASYPAISA`, `BANK-UBL`.
 *
 * The identity is the account's *business* identity. The numeric ledger code
 * (1010, 1060, …) stays exactly as it is and remains the accounting number and
 * the posting key; nothing here replaces it, and no UUID is ever shown.
 *
 * STORAGE: production persists this on `business_accounts.identity`. This
 * module remains the rollout fallback and the matching pre-insert validator;
 * whenever a row carries a valid stored identity, that value wins outright.
 */
import { normalizeBusinessAccountType } from './business-account-types.ts'

/** Canonical form: uppercase, starts with a letter, hyphen-separated words. */
export const MONEY_IDENTITY_PATTERN = /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/

export const MONEY_IDENTITY_MAX_LENGTH = 40

/**
 * The chart seeds these five money accounts with fixed ledger codes. Keying
 * their identity on the code — not the name — is what makes it immutable: the
 * code never changes, so renaming "Cash" to "Main Cash" leaves `CASH` alone.
 */
export const SEEDED_MONEY_IDENTITY_BY_LEDGER_CODE: Readonly<Record<string, string>> = {
  '1010': 'CASH',
  '1020': 'PETTY-CASH',
  '1030': 'BANK',
  '1040': 'EASYPAISA',
  '1050': 'JAZZCASH',
}

export function isMoneyIdentity(value: string | null | undefined): boolean {
  const candidate = String(value ?? '')
  if (!candidate || candidate.length > MONEY_IDENTITY_MAX_LENGTH) return false
  return MONEY_IDENTITY_PATTERN.test(candidate)
}

/** Uppercase word tokens joined by single hyphens; anything else is a separator. */
export function moneyIdentityToken(raw: string | null | undefined): string {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

/** A user-created account must contribute a real readable word. */
export function hasReadableMoneyIdentitySource(raw: string | null | undefined): boolean {
  const token = moneyIdentityToken(raw)
  return Boolean(token && /^[A-Z]/.test(token) && !/^[0-9-]+$/.test(token))
}

/** Trim on a hyphen boundary so a shortened identity still reads as words. */
function clamp(identity: string): string {
  if (identity.length <= MONEY_IDENTITY_MAX_LENGTH) return identity
  const cut = identity.slice(0, MONEY_IDENTITY_MAX_LENGTH)
  const boundary = cut.lastIndexOf('-')
  return (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/-+$/, '')
}

export type MoneyIdentityInput = {
  name?: string | null
  type?: string | null
  /** The linked ledger account code, used only for the seeded accounts. */
  ledgerCode?: string | null
}

/**
 * The identity an account wants before uniqueness is applied. A bank account
 * reads as `BANK-<NAME>` unless its name already says BANK; cash keeps its own
 * words (`CASH`, `PETTY-CASH`, `EASYPAISA`, `TILL-CASH`).
 */
export function deriveMoneyIdentity(input: MoneyIdentityInput): string {
  const seeded = SEEDED_MONEY_IDENTITY_BY_LEDGER_CODE[String(input.ledgerCode ?? '').trim()]
  if (seeded) return seeded
  const type = normalizeBusinessAccountType(String(input.type ?? ''))
  const base = moneyIdentityToken(input.name)
  if (!hasReadableMoneyIdentitySource(input.name)) {
    throw new Error('A readable money-account identity cannot be derived from this name')
  }
  if (type === 'Bank' && !base.startsWith('BANK')) return clamp(`BANK-${base}`)
  return clamp(base)
}

/**
 * Readable disambiguation for a name that is already taken. Branch or holder
 * words first (`BANK-UBL` → `BANK-UBL-KORANGI`), then a readable `-ALT` ladder.
 * A meaningless numeric identity such as `ACCOUNT-1060` is never produced.
 */
function withSuffix(base: string, rawSuffix: string): string | null {
  const suffix = clamp(moneyIdentityToken(rawSuffix).slice(0, 20))
  if (!hasReadableMoneyIdentitySource(suffix)) return null
  const budget = MONEY_IDENTITY_MAX_LENGTH - suffix.length - 1
  if (budget < 1) return null
  let prefix = base.slice(0, budget)
  if (base.length > budget && prefix.includes('-')) prefix = prefix.slice(0, prefix.lastIndexOf('-'))
  prefix = prefix.replace(/-+$/, '')
  return prefix ? `${prefix}-${suffix}` : null
}

function* candidates(base: string, hints: readonly string[]): Generator<string> {
  yield base
  const seen = new Set([base])
  for (const hint of hints) {
    const candidate = withSuffix(base, hint)
    if (!candidate) continue
    if (!seen.has(candidate)) {
      seen.add(candidate)
      yield candidate
    }
  }
  yield withSuffix(base, 'ALT')!
  for (let n = 2; n <= 99; n += 1) yield withSuffix(base, `ALT-${n}`)!
}

export type MoneyIdentityRow = MoneyIdentityInput & {
  /** Once the identity column exists, the stored value wins outright. */
  identity?: string | null
  /** Extra readable words to disambiguate with, e.g. bank name or holder. */
  hints?: readonly (string | null | undefined)[]
}

/**
 * One identity per row, unique within the list. Deterministic in list order, so
 * the same business always reads the same identities, and a stored identity is
 * always preferred over a derived one.
 */
export function assignMoneyIdentities(rows: readonly MoneyIdentityRow[]): string[] {
  const taken = new Set<string>()
  const assigned: string[] = []
  // Stored identities are reserved before deriving, so a derived one can never
  // collide with an identity the business already owns.
  for (const row of rows) {
    if (isMoneyIdentity(row.identity)) taken.add(row.identity!)
  }
  for (const row of rows) {
    if (isMoneyIdentity(row.identity)) {
      assigned.push(row.identity!)
      continue
    }
    const base = deriveMoneyIdentity(row)
    const hints = (row.hints ?? []).filter((hint): hint is string => Boolean(hint && String(hint).trim()))
    let chosen: string | undefined
    for (const candidate of candidates(base, hints)) {
      if (!taken.has(candidate)) {
        chosen = candidate
        break
      }
    }
    if (!chosen) throw new Error('No safe unique readable money-account identity is available')
    taken.add(chosen)
    assigned.push(chosen)
  }
  return assigned
}

/** `Cash · CASH` — the readable context a picker or a row subtitle shows. */
export function moneyAccountContext(type: string | null | undefined, identity: string | null | undefined): string {
  const label = normalizeBusinessAccountType(String(type ?? ''))
  return identity ? `${label} · ${identity}` : label
}
