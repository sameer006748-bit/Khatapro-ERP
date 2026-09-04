/**
 * Money accounts are Cash or Bank — nothing else.
 *
 * The type vocabulary is a pure module, so its rules are exercised directly.
 * The rest — what the two money screens offer, what the routes accept, what the
 * audit log records, and that posting never reads a money type — is pinned with
 * source assertions, the way the other UI features in this suite are covered.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  ACCEPTED_BUSINESS_ACCOUNT_TYPES,
  BUSINESS_ACCOUNT_TYPES,
  LEGACY_BUSINESS_ACCOUNT_TYPES,
  isAcceptedBusinessAccountType,
  isBusinessAccountType,
  moneyTypeFromLedgerAccount,
  needsMoneyTypeReview,
  normalizeBusinessAccountType,
} from '../src/lib/accounting/business-account-types.ts'
import { selectActivePaymentAccounts } from '../src/lib/sales/payment-accounts.ts'
import { buildCashPosition } from '../src/lib/dashboard/cash-position.ts'

const accountsView = await readFile('src/components/erp/views/accounts-view.tsx', 'utf8')
const businessAccountsView = await readFile('src/components/erp/views/business-accounts-view.tsx', 'utf8')
const createRoute = await readFile('src/app/api/setup/business-accounts/route.ts', 'utf8')
const itemRoute = await readFile('src/app/api/setup/business-accounts/[id]/route.ts', 'utf8')
const auditView = await readFile('src/components/erp/views/audit-log-view.tsx', 'utf8')
const expenseRoute = await readFile('src/app/api/expense-batch/route.ts', 'utf8')
const contraRoute = await readFile('src/app/api/contra-entry/route.ts', 'utf8')
const typeFixMigration = await readFile('supabase/migrations/00041_legacy_business_accounts_type_fix.sql', 'utf8')

test('there are exactly two money types and no example names are offered', () => {
  assert.deepEqual([...BUSINESS_ACCOUNT_TYPES], ['Cash', 'Bank'])
  assert.ok(isBusinessAccountType('Cash'))
  assert.ok(isBusinessAccountType('Bank'))
  assert.equal(isBusinessAccountType('Mobile Wallets'), false)
  assert.equal(isBusinessAccountType('Other'), false)
  // Account names are the user's to invent, so no brand or branch name is ever
  // offered as a type — the two screens read the list from this one module.
  for (const name of ['Easypaisa', 'JazzCash', 'Meezan', 'HBL', 'UBL', 'Allied', 'Petty Cash']) {
    assert.equal((BUSINESS_ACCOUNT_TYPES as readonly string[]).includes(name), false, name)
  }
  assert.doesNotMatch(createRoute, /z\.enum\(\['/)
  assert.match(businessAccountsView, /<TypeChoice value=\{type\} options=\{typeOptions\(initial\?\.type\)\} onChange=\{setType\} \/>/)
})

test('unlimited accounts can be created under either type', () => {
  // Nothing counts, caps or de-duplicates accounts per type: the create route
  // validates a name and a type and allocates the next ledger code.
  assert.match(createRoute, /z\.enum\(BUSINESS_ACCOUNT_TYPES\)/)
  assert.match(createRoute, /name: z\.string\(\)\.min\(1\)\.max\(80\)/)
  assert.doesNotMatch(createRoute, /ACCOUNT_LIMIT|MAX_ACCOUNTS|already exists/)
  assert.match(createRoute, /let nextNum = 1060/)
  // Both screens offer the two types from the one vocabulary module.
  assert.match(businessAccountsView, /BUSINESS_ACCOUNT_TYPES/)
  assert.match(businessAccountsView, /TypeChoice/)
  assert.doesNotMatch(businessAccountsView, /const TYPES =/)
})

test('legacy labels are preserved, folded into Cash or Bank, and reclassifiable', () => {
  for (const legacy of LEGACY_BUSINESS_ACCOUNT_TYPES) {
    assert.ok(isAcceptedBusinessAccountType(legacy), legacy)
    assert.equal(isBusinessAccountType(legacy), false, legacy)
    assert.ok(needsMoneyTypeReview(legacy), legacy)
  }
  // Wallet money is cash the business holds; only a bank label reads as Bank.
  assert.equal(normalizeBusinessAccountType('Wallet'), 'Cash')
  assert.equal(normalizeBusinessAccountType('Easypaisa'), 'Cash')
  assert.equal(normalizeBusinessAccountType('JazzCash'), 'Cash')
  assert.equal(normalizeBusinessAccountType('Petty Cash'), 'Cash')
  assert.equal(normalizeBusinessAccountType('Custom / Other'), 'Cash')
  assert.equal(normalizeBusinessAccountType('Other'), 'Cash')
  assert.equal(normalizeBusinessAccountType('Bank'), 'Bank')
  assert.equal(normalizeBusinessAccountType('Bank Al Habib'), 'Bank')
  assert.equal(needsMoneyTypeReview('Cash'), false)
  assert.equal(needsMoneyTypeReview('Bank'), false)
  // The edit form keeps the stored label selectable, and the row offers a
  // deliberate, confirmed move to either type.
  assert.match(businessAccountsView, /if \(current && !options\.includes\(current\)\) options\.push\(current\)/)
  assert.match(businessAccountsView, /needsMoneyTypeReview/)
  assert.match(businessAccountsView, /Move to \{type\}/)
  assert.match(businessAccountsView, /window\.confirm\(/)
  assert.match(businessAccountsView, /patch: \{ type \}/)
})

test('reclassification is accepted by the app and by the deployed database function', () => {
  // The accepted list is exactly the allow-list the deployed RPC enforces, so an
  // edit that passes validation is never rejected by the database.
  assert.deepEqual(
    [...ACCEPTED_BUSINESS_ACCOUNT_TYPES],
    ['Cash', 'Bank', 'Wallet', 'Other', 'Petty Cash', 'Easypaisa', 'JazzCash', 'Custom / Other'],
  )
  assert.match(itemRoute, /z\.enum\(ACCEPTED_BUSINESS_ACCOUNT_TYPES\)/)
  assert.match(
    typeFixMigration,
    /array\['Cash','Bank','Wallet','Other','Petty Cash','Easypaisa','JazzCash','Custom \/ Other'\]/,
  )
  // Creating still requires one of the two current types on both paths.
  assert.match(typeFixMigration, /array\['Cash', 'Bank', 'Wallet', 'Other'\]/)
})

test('a ledger account with no money-account row falls back to code and name', () => {
  assert.equal(moneyTypeFromLedgerAccount({ code: '1010', name: 'Cash' }), 'Cash')
  assert.equal(moneyTypeFromLedgerAccount({ code: '1020', name: 'Petty Cash' }), 'Cash')
  assert.equal(moneyTypeFromLedgerAccount({ code: '1030', name: 'Bank' }), 'Bank')
  assert.equal(moneyTypeFromLedgerAccount({ code: '1040', name: 'Easypaisa' }), 'Cash')
  assert.equal(moneyTypeFromLedgerAccount({ code: '1050', name: 'JazzCash' }), 'Cash')
  assert.equal(moneyTypeFromLedgerAccount({ code: '1061', name: 'Meezan Bank' }), 'Bank')
  assert.equal(moneyTypeFromLedgerAccount({ code: '', name: '' }), 'Cash')
})

test('Accounts and Balances groups by the stored type under two headings only', () => {
  assert.match(accountsView, /const ACCOUNT_GROUPS: AccountGroup\[\] = \['Cash', 'Bank'\]/)
  assert.doesNotMatch(accountsView, /Mobile Wallets/)
  // The stored type decides the heading; the code/name rule is only a fallback.
  assert.match(accountsView, /storedMoneyTypes/)
  assert.match(accountsView, /stored \? normalizeBusinessAccountType\(stored\) : moneyTypeFromLedgerAccount\(account\)/)
  // Read from the list every sale screen already caches — no new endpoint.
  assert.match(accountsView, /queryKey: \['business-accounts'\]/)
  // Balances still come from the trial balance, untouched by this grouping.
  assert.match(accountsView, /row \? BigInt\(row\.balance\) : null/)
  assert.doesNotMatch(accountsView, /balanceCache/)
})

test('managing an account stays behind the permission the server enforces', () => {
  assert.match(accountsView, /can_manage_setup/)
  assert.match(accountsView, /onManage=\{canManageAccounts \? openBusinessAccounts : undefined\}/)
  assert.match(businessAccountsView, /canManage = user\.permissions\.includes\('can_manage_setup'\)/)
  assert.match(businessAccountsView, /canManage &&/)
  // Server side: create, edit and delete all require the same permission and
  // are scoped to the caller's own business.
  assert.match(createRoute, /requirePermission\(loaded, 'can_manage_setup'\)/)
  assert.match(itemRoute, /requirePermission\(loaded, 'can_manage_setup'\)/)
  assert.match(itemRoute, /where: \{ id, businessId: su\.businessId \}/)
})

test('rename, deactivate and reactivate keep working and follow through to the ledger', () => {
  assert.match(businessAccountsView, /method: 'PATCH'/)
  assert.match(businessAccountsView, /isActive: !r\.isActive/)
  assert.match(itemRoute, /tx\.account\.update/)
  assert.match(itemRoute, /patch\.name !== undefined \? \{ name: patch\.name \} : \{\}/)
})

test('an account money has moved through cannot be deleted, only deactivated', () => {
  assert.match(businessAccountsView, /method: 'DELETE'/)
  assert.match(itemRoute, /paymentAllocation\.count/)
  assert.match(itemRoute, /voucherLine\.count/)
  assert.match(itemRoute, /purchasePayment\.count/)
  assert.match(itemRoute, /references > 0 \|\| existing\.account\.balanceCache !== 0n/)
  assert.match(itemRoute, /ACCOUNT_IN_USE/)
  assert.match(itemRoute, /Deactivate it instead/)
  assert.match(itemRoute, /status: 409/)
  // Unreferenced accounts still delete, together with their linked ledger row.
  assert.match(itemRoute, /tx\.businessAccount\.delete/)
  assert.match(itemRoute, /tx\.account\.delete/)
})

test('audit records readable money-account events without backend metadata', () => {
  assert.match(createRoute, /action: 'MONEY_ACCOUNT_CREATE'/)
  assert.match(itemRoute, /MONEY_ACCOUNT_REACTIVATE/)
  assert.match(itemRoute, /MONEY_ACCOUNT_DEACTIVATE/)
  assert.match(itemRoute, /MONEY_ACCOUNT_TYPE_CHANGE/)
  assert.match(itemRoute, /MONEY_ACCOUNT_RENAME/)
  assert.match(itemRoute, /action: 'MONEY_ACCOUNT_DELETE'/)
  // Before/after snapshots carry the name, code, type and status — not ids or
  // the raw request payload.
  assert.match(itemRoute, /type MoneyAccountSnapshot = \{ code: string; name: string; type: string; isActive: boolean \}/)
  assert.doesNotMatch(itemRoute, /details: \{ patch/)
  assert.doesNotMatch(itemRoute, /ledgerAccountId/)
  assert.doesNotMatch(createRoute, /ledgerAccountId/)
  // The legacy path records the same readable event around the RPC call.
  assert.match(itemRoute, /legacySnapshotBefore/)
  assert.match(itemRoute, /auditMoneyAccountUpdate/)
  // The audit screen names those events and hides internal keys.
  assert.match(auditView, /business_account: 'Money account'/)
  assert.match(auditView, /MONEY_ACCOUNT_TYPE_CHANGE: 'Money account moved between Cash and Bank'/)
  assert.match(auditView, /HIDDEN_DETAIL_KEYS/)
  assert.match(auditView, /key: 'type', label: 'Money type'/)
})

test('posting never depends on a money type', () => {
  // Sale screens post the linked ledger account id; the type is passed through
  // for display only and is never branched on.
  const accounts = selectActivePaymentAccounts([
    { id: 'ba-1', name: 'Till Cash', type: 'Cash', isActive: true, ledger: { id: 'led-1', code: '1010' } },
    { id: 'ba-2', name: 'Meezan Bank', type: 'Bank', isActive: true, ledger: { id: 'led-2', code: '1061' } },
    { id: 'ba-3', name: 'Easypaisa', type: 'Wallet', isActive: true, ledger: { id: 'led-3', code: '1040' } },
    { id: 'ba-4', name: 'Closed', type: 'Bank', isActive: false, ledger: { id: 'led-4', code: '1062' } },
  ])
  assert.deepEqual(accounts.map((account) => account.id), ['led-1', 'led-2', 'led-3'])
  assert.deepEqual(accounts.map((account) => account.type), ['Cash', 'Bank', 'Wallet'])
  // Expense "paid from" and Contra validate capability, never a type label.
  assert.match(expenseRoute, /isBusinessAccount/)
  assert.doesNotMatch(expenseRoute, /'Wallet'|'Cash'|'Bank'/)
  assert.doesNotMatch(contraRoute, /'Wallet'|'Cash'|'Bank'/)
})

test('the Cash Position panel now reports two groups from the same mapping', () => {
  const position = buildCashPosition({
    state: 'available',
    normalizeType: normalizeBusinessAccountType,
    accounts: [
      { type: 'Cash', isActive: true, balancePaisas: '10000' },
      { type: 'Easypaisa', isActive: true, balancePaisas: '2500' },
      { type: 'Bank', isActive: true, balancePaisas: '50000' },
      { type: 'Custom / Other', isActive: true, balancePaisas: '500' },
      { type: 'Bank', isActive: false, balancePaisas: '999' },
    ],
  })
  assert.deepEqual(position.groups.map((group) => group.type), ['Cash', 'Bank'])
  assert.equal(position.groups[0].balancePaisas, '13000')
  assert.equal(position.groups[1].balancePaisas, '50000')
  // Folding the old wallet and other buckets in changes labels, not the total.
  assert.equal(position.totalPaisas, '63000')
  assert.equal(position.accountCount, 4)
})
