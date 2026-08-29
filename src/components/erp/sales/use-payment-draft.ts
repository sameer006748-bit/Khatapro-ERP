'use client'

/**
 * Payment state for a sale screen, in one place.
 *
 * Every sale channel (Counter, Online, OFC, Other) holds the same payment
 * state — mode, paid amount, account, split rows, change account — and derives
 * the same things from it. This hook owns that state and runs it through
 * `payment-allocation.ts`, so a channel view only decides its own rules
 * (`requirePayment`, what the net payable is, what label to show) and never
 * repeats the arithmetic or the validation.
 */

import { useCallback, useMemo, useState } from 'react'
import { parseMoney } from '@/lib/format'
import {
  DEFAULT_PAYMENT_SPLIT_MODE,
  buildPaymentAllocations,
  changeDuePaisas,
  primaryPaymentAccountId,
  resolveDefaultPaymentAccountId,
  serializePaymentAllocations,
  splitTotalPaisas as sumSplitRows,
  validatePaymentDraft,
  type PaymentDraft,
  type PaymentRowInput,
  type PaymentSplitMode,
} from '@/lib/sales/payment-allocation'
import {
  newPaymentSplitRow,
  type PaymentAccountOption,
  type PaymentPanelProps,
  type PaymentSplitRow,
} from './payment-panel'

export type UsePaymentDraftOptions = {
  accounts: PaymentAccountOption[]
  /** What the bill actually owes — change is anything paid beyond it. */
  netPayablePaisas: bigint
  /** True for channels that refuse a fully unpaid bill (Counter Sale). */
  requirePayment?: boolean
}

export function usePaymentDraft({
  accounts,
  netPayablePaisas,
  requirePayment = false,
}: UsePaymentDraftOptions) {
  const [mode, setMode] = useState<PaymentSplitMode>(DEFAULT_PAYMENT_SPLIT_MODE)
  const [paidAmount, setPaidAmount] = useState('')
  const [accountId, setAccountId] = useState('')
  const [splitRows, setSplitRows] = useState<PaymentSplitRow[]>(() => [newPaymentSplitRow()])
  const [changeAccountId, setChangeAccountId] = useState('')

  const accountIds = useMemo(() => accounts.map((account) => account.id), [accounts])

  // Positional fallback only: the first active account, never one matched by
  // name or code, because payment accounts are user-created data.
  const effectiveAccountId = useMemo(
    () => resolveDefaultPaymentAccountId(accounts, accountId),
    [accounts, accountId],
  )

  const paidPaisas = useMemo(() => parseMoney(paidAmount) ?? 0n, [paidAmount])

  const rows = useMemo<PaymentRowInput[]>(
    () => splitRows.map((row) => ({ accountId: row.accountId, amountPaisas: parseMoney(row.amount) })),
    [splitRows],
  )

  const draftWithoutChange = useMemo<PaymentDraft>(
    () => ({
      mode,
      paidPaisas,
      accountId: effectiveAccountId,
      rows,
      netPayablePaisas,
    }),
    [mode, paidPaisas, effectiveAccountId, rows, netPayablePaisas],
  )

  const changePaisas = useMemo(() => changeDuePaisas(draftWithoutChange), [draftWithoutChange])

  const effectiveChangeAccountId = useMemo(() => {
    if (changeAccountId && accountIds.includes(changeAccountId)) return changeAccountId
    return primaryPaymentAccountId(draftWithoutChange)
  }, [changeAccountId, accountIds, draftWithoutChange])

  const draft = useMemo<PaymentDraft>(
    () => ({ ...draftWithoutChange, changeAccountId: effectiveChangeAccountId }),
    [draftWithoutChange, effectiveChangeAccountId],
  )

  const allocations = useMemo(() => buildPaymentAllocations(draft), [draft])
  const error = useMemo(
    () => validatePaymentDraft(draft, { requirePayment, availableAccountIds: accountIds }),
    [draft, requirePayment, accountIds],
  )
  const splitTotalPaisas = useMemo(() => sumSplitRows(rows), [rows])

  /** Payment rows in the wire format every `/api/sales/*` route accepts. */
  const serializedPayments = useMemo(() => serializePaymentAllocations(allocations), [allocations])

  /** Clear payment entry for a new bill; account choice is intentionally kept. */
  const reset = useCallback(() => {
    setMode(DEFAULT_PAYMENT_SPLIT_MODE)
    setPaidAmount('')
    setSplitRows([newPaymentSplitRow()])
    setChangeAccountId('')
  }, [])

  /**
   * Switching modes must never disturb the bill, so it only touches payment
   * state: entering split mode seeds the first row from the single-account
   * choice, and leaving it keeps the paid amount as typed.
   */
  const changeMode = useCallback(
    (next: PaymentSplitMode) => {
      setMode(next)
      if (next === 'split') {
        setSplitRows((current) => {
          const untouched =
            current.length === 1 && current[0].accountId === '' && current[0].amount === ''
          if (!untouched) return current
          return [{ ...current[0], accountId: effectiveAccountId }]
        })
      }
    },
    [effectiveAccountId],
  )

  /** Everything `<PaymentPanel>` needs, so a channel spreads it in one line. */
  const panelProps: Omit<PaymentPanelProps, 'accounts' | 'error'> = {
    mode,
    onModeChange: changeMode,
    paidAmount,
    onPaidAmountChange: setPaidAmount,
    accountId: effectiveAccountId,
    onAccountIdChange: setAccountId,
    splitRows,
    onSplitRowsChange: setSplitRows,
    splitTotalPaisas,
    paidPaisas,
    changePaisas,
    changeAccountId: effectiveChangeAccountId,
    onChangeAccountIdChange: setChangeAccountId,
  }

  return {
    mode,
    setMode: changeMode,
    paidAmount,
    setPaidAmount,
    accountId: effectiveAccountId,
    setAccountId,
    splitRows,
    setSplitRows,
    paidPaisas,
    splitTotalPaisas,
    changePaisas,
    changeAccountId: effectiveChangeAccountId,
    setChangeAccountId,
    draft,
    allocations,
    serializedPayments,
    error,
    isValid: error === null,
    reset,
    panelProps,
  }
}
