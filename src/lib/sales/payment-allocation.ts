/**
 * Shared payment-allocation engine for every sale channel.
 *
 * ONE implementation used by Counter, Online, OFC and Other sale screens so the
 * money a cashier types is turned into invoice payment allocations by the same
 * rules everywhere. Channel-specific concerns (COD, rider earning, delivery
 * fee, advance semantics) stay in the channel views and routes.
 *
 * A payment allocation always carries the payment ACCOUNT IDENTITY, never a
 * display name: accounts are user-created business accounts and may be renamed
 * or deactivated later without rewriting posted invoices.
 *
 * Money is BigInt paisas throughout. Like `sale-engine.ts`, this module is
 * intentionally free of imports so the same arithmetic runs in the browser, in
 * the API routes and in tests.
 *
 * Approved rules encoded here (do not reinterpret):
 *   single mode  -> one allocation: the whole paid amount into one account
 *   split mode   -> one allocation per row; rows must sum EXACTLY to paid
 *   change       -> paid − net payable, when positive, as a change allocation
 *   no allocation may be zero or negative
 */

export type PaymentSplitMode = 'single' | 'split'

/** The default a sale screen opens in: one amount, one account, no split rows. */
export const DEFAULT_PAYMENT_SPLIT_MODE: PaymentSplitMode = 'single'

/** One split row as the screen holds it. */
export type PaymentRowInput = {
  accountId: string
  /** null when the typed amount is blank or not a valid money string. */
  amountPaisas: bigint | null
}

export type PaymentDraft = {
  mode: PaymentSplitMode
  /** Total money received from the customer (excluding change handed back). */
  paidPaisas: bigint
  /** Account selected in single mode. */
  accountId: string
  /** Rows used in split mode. */
  rows: readonly PaymentRowInput[]
  /** Net payable of the bill — change is derived from paid minus this. */
  netPayablePaisas: bigint
  /** Account the change is handed back from. Defaults to the paying account. */
  changeAccountId?: string
}

export type PaymentAllocation = {
  accountId: string
  amountPaisas: bigint
  isChange: boolean
}

export type ValidatePaymentOptions = {
  /** The channel refuses a fully unpaid bill (Counter Sale). */
  requirePayment?: boolean
  /** Active account ids; a stale selection is rejected instead of posted. */
  availableAccountIds?: readonly string[]
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Plain rupees rendering for validation messages (no locale, no symbol). */
function rupees(paisas: bigint): string {
  const negative = paisas < 0n
  const abs = negative ? -paisas : paisas
  const whole = abs / 100n
  const frac = abs % 100n
  const body = frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(2, '0')}`
  return negative ? `-${body}` : body
}

/**
 * Rows the operator has actually started filling in. A pristine empty row is
 * not an error — it is the blank row the screen always offers.
 */
export function usedPaymentRows(rows: readonly PaymentRowInput[]): PaymentRowInput[] {
  return rows.filter((row) => row.accountId !== '' || row.amountPaisas !== null)
}

/** Sum of the split rows that carry a usable amount. */
export function splitTotalPaisas(rows: readonly PaymentRowInput[]): bigint {
  let total = 0n
  for (const row of rows) {
    if (row.amountPaisas !== null && row.amountPaisas > 0n) total += row.amountPaisas
  }
  return total
}

/** Change handed back to the customer: paid beyond the net payable. */
export function changeDuePaisas(draft: Pick<PaymentDraft, 'paidPaisas' | 'netPayablePaisas'>): bigint {
  const excess = draft.paidPaisas - draft.netPayablePaisas
  return excess > 0n ? excess : 0n
}

/**
 * The account money is primarily received into — used as the default account
 * for handing change back so the common case needs no extra choice.
 */
export function primaryPaymentAccountId(draft: PaymentDraft): string {
  if (draft.mode === 'single') return draft.accountId
  const firstUsable = draft.rows.find((row) => row.accountId !== '')
  return firstUsable?.accountId ?? ''
}

/**
 * Pick the account a screen should start on. Deliberately positional — never
 * matched on a name or a code, because payment accounts are user-created data
 * and no built-in "Cash" or wallet account is guaranteed to exist.
 */
export function resolveDefaultPaymentAccountId(
  accounts: readonly { id: string }[],
  selected: string,
): string {
  if (selected && accounts.some((account) => account.id === selected)) return selected
  return accounts.length > 0 ? accounts[0].id : ''
}

// ─────────────────────────────────────────────────────────────
// Allocation building
// ─────────────────────────────────────────────────────────────

/**
 * Turn a draft into the allocations to post. Returns an empty list for a fully
 * unpaid (credit) bill. Never returns a zero or negative allocation, so an
 * incomplete draft simply produces fewer rows rather than invalid money.
 *
 * Validate with `validatePaymentDraft` before posting: this function shapes
 * money, it does not decide whether the draft is acceptable.
 */
export function buildPaymentAllocations(draft: PaymentDraft): PaymentAllocation[] {
  const allocations: PaymentAllocation[] = []

  if (draft.paidPaisas > 0n) {
    if (draft.mode === 'single') {
      if (draft.accountId) {
        allocations.push({ accountId: draft.accountId, amountPaisas: draft.paidPaisas, isChange: false })
      }
    } else {
      for (const row of draft.rows) {
        if (!row.accountId) continue
        if (row.amountPaisas === null || row.amountPaisas <= 0n) continue
        allocations.push({ accountId: row.accountId, amountPaisas: row.amountPaisas, isChange: false })
      }
    }
  }

  const change = changeDuePaisas(draft)
  if (change > 0n) {
    const changeAccountId = draft.changeAccountId || primaryPaymentAccountId(draft)
    if (changeAccountId) {
      allocations.push({ accountId: changeAccountId, amountPaisas: change, isChange: true })
    }
  }

  return allocations
}

/** Wire format accepted by every `/api/sales/*` route. */
export function serializePaymentAllocations(
  allocations: readonly PaymentAllocation[],
): Array<{ accountId: string; amount: string; isChange: boolean }> {
  return allocations.map((allocation) => ({
    accountId: allocation.accountId,
    amount: allocation.amountPaisas.toString(),
    isChange: allocation.isChange,
  }))
}

/** Money actually received (change excluded). */
export function receivedTotalPaisas(allocations: readonly PaymentAllocation[]): bigint {
  return allocations.reduce((total, a) => (a.isChange ? total : total + a.amountPaisas), 0n)
}

/** Money handed back to the customer. */
export function changeTotalPaisas(allocations: readonly PaymentAllocation[]): bigint {
  return allocations.reduce((total, a) => (a.isChange ? total + a.amountPaisas : total), 0n)
}

// ─────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────

/**
 * Return the first blocking problem with the draft, or null when it can post.
 * Used by the sale screens (to disable Post) and re-checked server-side by the
 * route + posting layer, which fail closed on any non-positive allocation.
 */
export function validatePaymentDraft(
  draft: PaymentDraft,
  options: ValidatePaymentOptions = {},
): string | null {
  const { requirePayment = false, availableAccountIds } = options
  const isAvailable = (accountId: string) =>
    availableAccountIds === undefined || availableAccountIds.includes(accountId)

  if (draft.paidPaisas < 0n) return 'Paid amount cannot be negative.'
  if (requirePayment && draft.paidPaisas <= 0n) {
    return 'Enter the amount received from the customer.'
  }

  const used = usedPaymentRows(draft.rows)

  if (draft.paidPaisas === 0n) {
    if (draft.mode === 'split' && used.length > 0) {
      return 'Enter the paid amount, or clear the split payment rows.'
    }
    return null
  }

  if (draft.mode === 'single') {
    if (!draft.accountId) return 'Select the payment account for this bill.'
    if (!isAvailable(draft.accountId)) {
      return 'The selected payment account is no longer active. Choose another account.'
    }
  } else {
    if (used.length === 0) return 'Add at least one payment account row.'
    for (const row of used) {
      if (!row.accountId) return 'Select an account for every split payment row.'
      if (!isAvailable(row.accountId)) {
        return 'A split payment row uses an account that is no longer active. Choose another account.'
      }
      if (row.amountPaisas === null) return 'Enter a valid amount for every split payment row.'
      if (row.amountPaisas <= 0n) {
        return 'Every split payment row needs an amount greater than zero.'
      }
    }
    const total = splitTotalPaisas(draft.rows)
    if (total !== draft.paidPaisas) {
      return `Split rows total Rs ${rupees(total)} but the paid amount is Rs ${rupees(draft.paidPaisas)}. They must match exactly.`
    }
  }

  const change = changeDuePaisas(draft)
  if (change > 0n) {
    const changeAccountId = draft.changeAccountId || primaryPaymentAccountId(draft)
    if (!changeAccountId) return 'Select the account the change is returned from.'
    if (!isAvailable(changeAccountId)) {
      return 'The change account is no longer active. Choose another account.'
    }
  }

  return null
}
