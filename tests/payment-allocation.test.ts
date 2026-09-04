/**
 * Simplified payment UI + user-managed payment accounts.
 *
 * Behavioural tests drive the shared engine directly; the source-text
 * assertions pin the parts that only exist in the React views (what mode a
 * screen opens in, that no brand name is hard-coded, that every channel posts
 * through the same engine).
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  DEFAULT_PAYMENT_SPLIT_MODE,
  buildPaymentAllocations,
  changeTotalPaisas,
  receivedTotalPaisas,
  resolveDefaultPaymentAccountId,
  serializePaymentAllocations,
  splitTotalPaisas,
  validatePaymentDraft,
  type PaymentDraft,
} from '../src/lib/sales/payment-allocation.ts'
import {
  BUSINESS_ACCOUNT_TYPES,
  ACCEPTED_BUSINESS_ACCOUNT_TYPES,
  normalizeBusinessAccountType,
} from '../src/lib/accounting/business-account-types.ts'
import {
  resolvePaymentAccountGate,
  selectActivePaymentAccounts,
} from '../src/lib/sales/payment-accounts.ts'

const CASHBOX = 'acc-cashbox'
const MEEZAN = 'acc-meezan'
const WALLET = 'acc-wallet'

function draft(overrides: Partial<PaymentDraft> = {}): PaymentDraft {
  return {
    mode: 'single',
    paidPaisas: 0n,
    accountId: '',
    rows: [],
    netPayablePaisas: 0n,
    ...overrides,
  }
}

const counterView = await readFile('src/components/erp/views/counter-sale-view.tsx', 'utf8')
const onlineView = await readFile('src/components/erp/views/online-sale-view.tsx', 'utf8')
const ofcView = await readFile('src/components/erp/views/ofc-sale-view.tsx', 'utf8')
const otherView = await readFile('src/components/erp/views/other-sale-view.tsx', 'utf8')
const panel = await readFile('src/components/erp/sales/payment-panel.tsx', 'utf8')
const draftHook = await readFile('src/components/erp/sales/use-payment-draft.ts', 'utf8')
const accountsHook = await readFile('src/components/erp/sales/use-payment-accounts.ts', 'utf8')
const accountsView = await readFile('src/components/erp/views/business-accounts-view.tsx', 'utf8')
const accountRoute = await readFile('src/app/api/setup/business-accounts/route.ts', 'utf8')
const accountItemRoute = await readFile('src/app/api/setup/business-accounts/[id]/route.ts', 'utf8')
const salesViews = [counterView, onlineView, ofcView, otherView]

test('single payment is the default mode and split starts collapsed', () => {
  assert.equal(DEFAULT_PAYMENT_SPLIT_MODE, 'single')
  assert.match(draftHook, /useState<PaymentSplitMode>\(DEFAULT_PAYMENT_SPLIT_MODE\)/)
  // The split block only renders once the operator switches into split mode.
  assert.match(panel, /isSplit/)
  assert.match(panel, /Split Payment/)
  assert.match(panel, /Single Payment/)
})

test('one selected account posts a single allocation for the whole paid amount', () => {
  const d = draft({ paidPaisas: 250_00n, accountId: MEEZAN, netPayablePaisas: 250_00n })
  assert.equal(validatePaymentDraft(d, { requirePayment: true, availableAccountIds: [MEEZAN] }), null)
  const allocations = buildPaymentAllocations(d)
  assert.deepEqual(allocations, [{ accountId: MEEZAN, amountPaisas: 250_00n, isChange: false }])
  assert.deepEqual(serializePaymentAllocations(allocations), [
    { accountId: MEEZAN, amount: '25000', isChange: false },
  ])
})

test('split mode is optional and never required to post', () => {
  const single = draft({ paidPaisas: 100_00n, accountId: CASHBOX, netPayablePaisas: 100_00n })
  assert.equal(validatePaymentDraft(single, { requirePayment: true }), null)
  // A pristine blank row in single mode is not an error.
  const withBlankRow = draft({
    paidPaisas: 100_00n,
    accountId: CASHBOX,
    netPayablePaisas: 100_00n,
    rows: [{ accountId: '', amountPaisas: null }],
  })
  assert.equal(validatePaymentDraft(withBlankRow, { requirePayment: true }), null)
})

test('two or more split rows post one allocation each, in row order', () => {
  const d = draft({
    mode: 'split',
    paidPaisas: 500_00n,
    netPayablePaisas: 500_00n,
    rows: [
      { accountId: CASHBOX, amountPaisas: 200_00n },
      { accountId: MEEZAN, amountPaisas: 250_00n },
      { accountId: WALLET, amountPaisas: 50_00n },
    ],
  })
  assert.equal(validatePaymentDraft(d, { requirePayment: true }), null)
  const allocations = buildPaymentAllocations(d)
  assert.equal(allocations.length, 3)
  assert.deepEqual(allocations.map((a) => a.accountId), [CASHBOX, MEEZAN, WALLET])
  assert.equal(receivedTotalPaisas(allocations), 500_00n)
  assert.equal(changeTotalPaisas(allocations), 0n)
})

test('split total must equal the paid amount exactly', () => {
  const short = draft({
    mode: 'split',
    paidPaisas: 500_00n,
    netPayablePaisas: 500_00n,
    rows: [
      { accountId: CASHBOX, amountPaisas: 200_00n },
      { accountId: MEEZAN, amountPaisas: 100_00n },
    ],
  })
  assert.equal(splitTotalPaisas(short.rows), 300_00n)
  assert.match(String(validatePaymentDraft(short)), /must match exactly/)

  const over = draft({
    mode: 'split',
    paidPaisas: 100_00n,
    netPayablePaisas: 100_00n,
    rows: [
      { accountId: CASHBOX, amountPaisas: 90_00n },
      { accountId: MEEZAN, amountPaisas: 20_00n },
    ],
  })
  assert.match(String(validatePaymentDraft(over)), /must match exactly/)
})

test('no allocation may be negative or zero', () => {
  assert.equal(validatePaymentDraft(draft({ paidPaisas: -1n })), 'Paid amount cannot be negative.')
  const zeroRow = draft({
    mode: 'split',
    paidPaisas: 100_00n,
    netPayablePaisas: 100_00n,
    rows: [{ accountId: CASHBOX, amountPaisas: 0n }],
  })
  assert.match(String(validatePaymentDraft(zeroRow)), /greater than zero/)
  const built = buildPaymentAllocations(zeroRow)
  assert.equal(built.length, 0)
  for (const a of buildPaymentAllocations(
    draft({ mode: 'split', paidPaisas: 10n, netPayablePaisas: 10n, rows: [{ accountId: CASHBOX, amountPaisas: 10n }] }),
  )) {
    assert.ok(a.amountPaisas > 0n)
  }
})

test('change is a separate allocation and does not inflate money received', () => {
  const d = draft({ paidPaisas: 1000_00n, accountId: CASHBOX, netPayablePaisas: 940_00n })
  const allocations = buildPaymentAllocations(d)
  assert.equal(allocations.length, 2)
  assert.equal(receivedTotalPaisas(allocations), 1000_00n)
  assert.equal(changeTotalPaisas(allocations), 60_00n)
  assert.equal(allocations[1].isChange, true)
  assert.equal(allocations[1].accountId, CASHBOX)
})

test('a user-created account is selectable and an inactive one is rejected', () => {
  const accounts = [{ id: MEEZAN }, { id: WALLET }]
  // Multiple active accounts require an explicit choice; one is unambiguous.
  assert.equal(resolveDefaultPaymentAccountId(accounts, ''), '')
  assert.equal(resolveDefaultPaymentAccountId([{ id: MEEZAN }], ''), MEEZAN)
  assert.equal(resolveDefaultPaymentAccountId(accounts, WALLET), WALLET)
  // A stale selection clears when several choices remain, or uses the sole fallback.
  assert.equal(resolveDefaultPaymentAccountId(accounts, 'acc-deactivated'), '')
  assert.equal(resolveDefaultPaymentAccountId([{ id: MEEZAN }], 'acc-deactivated'), MEEZAN)
  assert.equal(resolveDefaultPaymentAccountId([], 'acc-deactivated'), '')

  const stale = draft({ paidPaisas: 100_00n, accountId: 'acc-deactivated', netPayablePaisas: 100_00n })
  assert.match(
    String(validatePaymentDraft(stale, { availableAccountIds: [MEEZAN, WALLET] })),
    /no longer active/,
  )
  const staleSplit = draft({
    mode: 'split',
    paidPaisas: 100_00n,
    netPayablePaisas: 100_00n,
    rows: [{ accountId: 'acc-deactivated', amountPaisas: 100_00n }],
  })
  assert.match(String(validatePaymentDraft(staleSplit, { availableAccountIds: [MEEZAN] })), /no longer active/)
})

test('sale screens use the supported shared Business Accounts source', () => {
  for (const view of salesViews) {
    assert.match(view, /usePaymentAccounts/)
    assert.doesNotMatch(view, /\/api\/setup\/coa/)
    // No name/code based default may reappear in any sale screen.
    assert.doesNotMatch(view, /name === 'Cash'/)
    assert.doesNotMatch(view, /name === 'Bank'/)
    assert.doesNotMatch(view, /'JazzCash'/)
    assert.doesNotMatch(view, /'Easypaisa'/)
    assert.doesNotMatch(view, /code === '10\d0'/)
  }
  assert.match(accountsHook, /\/api\/setup\/business-accounts/)
  assert.match(accountsHook, /queryKey: \['business-accounts'\]/)
})

test('Business Accounts are projected to active ledger payment identities only', () => {
  const projected = selectActivePaymentAccounts([
    {
      id: 'business-account-cash', name: 'CASH', type: 'Cash', isActive: true,
      ledger: { id: CASHBOX, code: '1060', name: 'CASH' },
    },
    {
      id: 'business-account-old', name: 'Old Bank', type: 'Bank', isActive: false,
      ledger: { id: 'ledger-old', code: '1061', name: 'Old Bank' },
    },
  ])
  assert.deepEqual(projected, [{ id: CASHBOX, code: '1060', name: 'CASH', isActive: true, type: 'Cash' }])
})

test('Counter setup gate waits for loading and blocks only a confirmed zero-account result', () => {
  assert.equal(resolvePaymentAccountGate({ isPending: true, isError: false, isSuccess: false, accountCount: 0 }), 'loading')
  assert.equal(resolvePaymentAccountGate({ isPending: false, isError: true, isSuccess: false, accountCount: 0 }), 'error')
  assert.equal(resolvePaymentAccountGate({ isPending: false, isError: false, isSuccess: true, accountCount: 0 }), 'setup-required')
  assert.equal(resolvePaymentAccountGate({ isPending: false, isError: false, isSuccess: true, accountCount: 1 }), 'ready')
  assert.match(counterView, /Payment account required/)
  assert.match(counterView, /Set up payment account/)
  assert.doesNotMatch(counterView, /ACCOUNTING_MIGRATION_REQUIRED/)
})

test('payment account identity is what gets posted, never the display name', () => {
  const allocations = buildPaymentAllocations(
    draft({ paidPaisas: 100_00n, accountId: MEEZAN, netPayablePaisas: 100_00n }),
  )
  const wire = serializePaymentAllocations(allocations)
  assert.deepEqual(Object.keys(wire[0]).sort(), ['accountId', 'amount', 'isChange'])
  assert.equal(wire[0].accountId, MEEZAN)
  for (const view of salesViews) assert.match(view, /serializedPayments/)
})

test('duplicate submission stays blocked while posting', () => {
  // Idempotency key + a disabled button while the mutation is in flight.
  assert.match(counterView, /idempotencyKey/)
  assert.match(counterView, /disabled=\{[^}]*isPending/)
  assert.match(onlineView, /disabled=\{[^}]*isPending/)
  assert.match(ofcView, /disabled=\{[^}]*isPending/)
  assert.match(otherView, /disabled=\{[^}]*isPosting/)
})

test('Counter, Online, OFC and Other share one payment implementation', () => {
  for (const view of salesViews) {
    assert.match(view, /usePaymentDraft/)
    assert.match(view, /<PaymentPanel/)
  }
  // Channel rules stay in the channel: OFC still demands a full advance and
  // Online keeps its COD handling.
  assert.match(ofcView, /requirePayment: true/)
  assert.match(ofcView, /ofcUnderpayment/)
  assert.match(counterView, /requirePayment: true/)
  assert.match(onlineView, /cod/i)
})

test('money accounts are Cash or Bank, with legacy labels still accepted', () => {
  assert.deepEqual([...BUSINESS_ACCOUNT_TYPES], ['Cash', 'Bank'])
  for (const legacy of ['Wallet', 'Other', 'Petty Cash', 'JazzCash', 'Easypaisa', 'Custom / Other']) {
    assert.ok((ACCEPTED_BUSINESS_ACCOUNT_TYPES as readonly string[]).includes(legacy), legacy)
  }
  // Wallet money is cash the business holds; only a bank label reads as Bank.
  assert.equal(normalizeBusinessAccountType('JazzCash'), 'Cash')
  assert.equal(normalizeBusinessAccountType('Petty Cash'), 'Cash')
  assert.equal(normalizeBusinessAccountType('Wallet'), 'Cash')
  assert.equal(normalizeBusinessAccountType('Bank'), 'Bank')
  // New accounts may only be created as Cash or Bank.
  assert.match(accountRoute, /z\.enum\(BUSINESS_ACCOUNT_TYPES\)/)
  assert.match(accountItemRoute, /z\.enum\(ACCEPTED_BUSINESS_ACCOUNT_TYPES\)/)
})

test('owner can create, edit, activate/deactivate and is blocked from deleting used accounts', () => {
  assert.match(accountsView, /BUSINESS_ACCOUNT_TYPES/)
  assert.doesNotMatch(accountsView, /const TYPES =/)
  assert.match(accountsView, /method: 'PATCH'/)
  assert.match(accountsView, /method: 'DELETE'/)
  assert.match(accountsView, /patch: \{ isActive: !row\.isActive \}/)
  // Deactivation must follow through to the ledger account the sale screens read.
  assert.match(accountItemRoute, /tx\.account\.update/)
  assert.match(accountItemRoute, /ACCOUNT_IN_USE/)
  assert.match(accountItemRoute, /paymentAllocation\.count/)
  assert.match(accountItemRoute, /voucherLine\.count/)
  assert.match(accountItemRoute, /purchasePayment\.count/)
})
