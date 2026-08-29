'use client'

/**
 * Shared payment panel for every sale channel (Counter, Online, OFC, Other).
 *
 * Default state is the workflow almost every bill uses — one amount into one
 * account:
 *
 *     Paid Amount        [________]
 *     Payment Account    [Select account ▼]
 *
 *     [ Split Payment ]
 *
 * Split rows only appear once the operator asks for them, and switching back to
 * single payment keeps the rest of the bill untouched. Accounts come from the
 * business's own active payment accounts: no payment method, bank or wallet name
 * is hard-coded here.
 */

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Split, Trash2, Undo2, AlertCircle } from 'lucide-react'
import { formatWholeRupees } from '@/lib/format'
import type { PaymentSplitMode } from '@/lib/sales/payment-allocation'

export type PaymentAccountOption = { id: string; code: string; name: string }

/** One split row as the screen holds it: a stable key plus raw typed text. */
export type PaymentSplitRow = { key: string; accountId: string; amount: string }

export function newPaymentSplitRow(): PaymentSplitRow {
  return { key: crypto.randomUUID(), accountId: '', amount: '' }
}

export type PaymentPanelProps = {
  accounts: PaymentAccountOption[]
  mode: PaymentSplitMode
  onModeChange: (mode: PaymentSplitMode) => void
  /** Raw text of the paid amount, in rupees. */
  paidAmount: string
  onPaidAmountChange: (value: string) => void
  accountId: string
  onAccountIdChange: (accountId: string) => void
  splitRows: PaymentSplitRow[]
  onSplitRowsChange: (rows: PaymentSplitRow[]) => void
  /** Sum of the split rows in paisas, for the live total line. */
  splitTotalPaisas: bigint
  paidPaisas: bigint
  /** Change owed back to the customer, in paisas (0 when none). */
  changePaisas: bigint
  changeAccountId: string
  onChangeAccountIdChange: (accountId: string) => void
  /** First blocking problem from `validatePaymentDraft`, or null. */
  error: string | null
  /** Migration/setup notice shown beside the feature it affects. */
  notice?: string | null
  paidLabel?: string
  /** Shown in the empty Paid Amount box — usually the bill's net payable. */
  paidPlaceholder?: string
  idPrefix?: string
  /** Rendered next to the heading (AI help, channel hints). */
  headerSlot?: React.ReactNode
  /** Channel-specific fields rendered under the payment inputs. */
  children?: React.ReactNode
}

export function PaymentPanel({
  accounts,
  mode,
  onModeChange,
  paidAmount,
  onPaidAmountChange,
  accountId,
  onAccountIdChange,
  splitRows,
  onSplitRowsChange,
  splitTotalPaisas,
  paidPaisas,
  changePaisas,
  changeAccountId,
  onChangeAccountIdChange,
  error,
  notice,
  paidLabel = 'Paid Amount (Rs)',
  paidPlaceholder = '0',
  idPrefix = 'payment',
  headerSlot,
  children,
}: PaymentPanelProps) {
  const isSplit = mode === 'split'
  const hasAccounts = accounts.length > 0

  function patchRow(key: string, patch: Partial<PaymentSplitRow>) {
    onSplitRowsChange(splitRows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  return (
    <div className="card-3d p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-sm font-semibold text-foreground">Payment</span>
        {headerSlot}
      </div>

      {notice && (
        <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
          {notice}
        </div>
      )}

      {!hasAccounts && (
        <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-700">
          No active payment account yet. An Owner can add one under Setup →
          Business Accounts; sales can then be received into it.
        </div>
      )}

      {/* ── Default: one amount, one account ── */}
      <div className="grid sm:grid-cols-2 gap-2">
        <div>
          <label
            htmlFor={`${idPrefix}-paid`}
            className="text-[10px] uppercase tracking-wide text-muted-foreground"
          >
            {paidLabel}
          </label>
          <Input
            id={`${idPrefix}-paid`}
            value={paidAmount}
            onChange={(e) => onPaidAmountChange(e.target.value)}
            placeholder={paidPlaceholder}
            className="h-9 bg-background press-sm text-sm"
            data-num
          />
        </div>
        {!isSplit && (
          <div>
            <label
              htmlFor={`${idPrefix}-account`}
              className="text-[10px] uppercase tracking-wide text-muted-foreground"
            >
              Payment Account
            </label>
            <Select value={accountId} onValueChange={onAccountIdChange}>
              <SelectTrigger
                id={`${idPrefix}-account`}
                className="h-9 bg-background press-sm text-sm"
                aria-label="Payment account"
              >
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name} ({account.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* ── Optional: split the same paid amount across accounts ── */}
      {isSplit && (
        <div className="mt-2 space-y-1.5 rounded-md border border-border/70 bg-muted/20 p-2">
          {splitRows.map((row, index) => (
            <div key={row.key} className="grid grid-cols-[1fr_auto] gap-1 items-center">
              <Select
                value={row.accountId}
                onValueChange={(value) => patchRow(row.key, { accountId: value })}
              >
                <SelectTrigger
                  className="h-8 bg-background press-sm text-sm"
                  aria-label={`Split payment account ${index + 1}`}
                >
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name} ({account.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <Input
                  value={row.amount}
                  onChange={(e) => patchRow(row.key, { amount: e.target.value })}
                  placeholder="Rs"
                  aria-label={`Split payment amount ${index + 1}`}
                  className="h-8 w-24 bg-background press-sm text-sm"
                  data-num
                />
                <button
                  type="button"
                  onClick={() =>
                    onSplitRowsChange(
                      splitRows.length <= 1
                        ? splitRows
                        : splitRows.filter((candidate) => candidate.key !== row.key),
                    )
                  }
                  disabled={splitRows.length <= 1}
                  aria-label={`Remove split payment row ${index + 1}`}
                  className="text-muted-foreground hover:text-destructive press-sm disabled:opacity-40"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between gap-2 pt-0.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs press-sm"
              onClick={() => onSplitRowsChange([...splitRows, newPaymentSplitRow()])}
            >
              <Plus className="size-3" /> Add payment account
            </Button>
            <div className="text-[11px] text-muted-foreground" data-num>
              Split total{' '}
              <span
                className={
                  splitTotalPaisas === paidPaisas
                    ? 'font-semibold text-foreground'
                    : 'font-semibold text-destructive'
                }
              >
                {formatWholeRupees(splitTotalPaisas, false)}
              </span>{' '}
              / paid {formatWholeRupees(paidPaisas, false)}
            </div>
          </div>
        </div>
      )}

      {children}

      {/* ── Change: only ever shown when the customer overpays ── */}
      {changePaisas > 0n && (
        <div className="mt-2">
          <label
            htmlFor={`${idPrefix}-change-account`}
            className="text-[10px] uppercase tracking-wide text-muted-foreground"
          >
            Return change of {formatWholeRupees(changePaisas, false)} from
          </label>
          <Select value={changeAccountId} onValueChange={onChangeAccountIdChange}>
            <SelectTrigger
              id={`${idPrefix}-change-account`}
              className="h-8 bg-background press-sm text-sm"
              aria-label="Change return account"
            >
              <SelectValue placeholder="Select account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name} ({account.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {error && (
        <div className="mt-2 rounded-md bg-destructive/10 p-2 text-[11px] text-destructive flex items-start gap-1">
          <AlertCircle className="size-3 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* Secondary action — the split workflow stays one click away, and one
          click back, without disturbing the bill. */}
      <button
        type="button"
        onClick={() => onModeChange(isSplit ? 'single' : 'split')}
        className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground press-sm"
      >
        {isSplit ? (
          <>
            <Undo2 className="size-3" /> Single Payment
          </>
        ) : (
          <>
            <Split className="size-3" /> Split Payment
          </>
        )}
      </button>
    </div>
  )
}
