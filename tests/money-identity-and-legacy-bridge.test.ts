/**
 * Readable money identities, and the bridge that makes a chart-seeded ledger
 * money account manageable.
 *
 * The identity generator is a pure module, so its rules are exercised directly.
 * The bridge, the union list and the screens that read them are pinned with
 * source assertions, the way the rest of this suite covers UI behaviour.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  MONEY_IDENTITY_MAX_LENGTH,
  MONEY_IDENTITY_PATTERN,
  SEEDED_MONEY_IDENTITY_BY_LEDGER_CODE,
  assignMoneyIdentities,
  deriveMoneyIdentity,
  isMoneyIdentity,
  moneyAccountContext,
  moneyIdentityToken,
} from '../src/lib/accounting/money-account-identity.ts'

const identityModule = await readFile('src/lib/accounting/money-account-identity.ts', 'utf8')
const listRoute = await readFile('src/app/api/setup/business-accounts/route.ts', 'utf8')
const itemRoute = await readFile('src/app/api/setup/business-accounts/[id]/route.ts', 'utf8')
const linkRoute = await readFile('src/app/api/setup/business-accounts/link/route.ts', 'utf8')
const legacyAccess = await readFile('src/lib/accounting/legacy-business-accounts.ts', 'utf8')
const businessAccountsView = await readFile('src/components/erp/views/business-accounts-view.tsx', 'utf8')
const accountsView = await readFile('src/components/erp/views/accounts-view.tsx', 'utf8')
const expenseView = await readFile('src/components/erp/views/expense-batch-view.tsx', 'utf8')
const expenseRoute = await readFile('src/app/api/expense-batch/route.ts', 'utf8')
const auditView = await readFile('src/components/erp/views/audit-log-view.tsx', 'utf8')
const prismaSchema = await readFile('prisma/schema.prisma', 'utf8')

// ===========================================================================
// Identity rules
// ===========================================================================

test('every money account gets a readable identity, and it is never a number', () => {
  // A name that is only digits, or missing entirely, still yields a word.
  assert.equal(deriveMoneyIdentity({ name: '1060', type: 'Cash' }), 'CASH')
  assert.equal(deriveMoneyIdentity({ name: '', type: 'Bank' }), 'BANK')
  assert.equal(deriveMoneyIdentity({ name: '  ---  ', type: 'Cash' }), 'CASH')
  assert.equal(deriveMoneyIdentity({ name: 'Till Cash', type: 'Cash' }), 'TILL-CASH')
  assert.equal(deriveMoneyIdentity({ name: 'UBL', type: 'Bank' }), 'BANK-UBL')
  assert.equal(deriveMoneyIdentity({ name: 'Bank Al Habib', type: 'Bank' }), 'BANK-AL-HABIB')
  // The canonical form starts with a letter, so no identity can read as a code.
  assert.match(String(MONEY_IDENTITY_PATTERN.source), /^\^\[A-Z\]/)
  for (const bad of ['1010', '9CASH', 'cash', 'PETTY CASH', 'PETTY_CASH', '-CASH', 'CASH-', 'CASH--BANK', '', null, undefined, 'A'.repeat(MONEY_IDENTITY_MAX_LENGTH + 1)]) {
    assert.equal(isMoneyIdentity(bad), false, `must reject: ${bad}`)
  }
  assert.ok(isMoneyIdentity('CASH'))
  assert.ok(isMoneyIdentity('PETTY-CASH'))
  assert.ok(isMoneyIdentity('BANK-UBL-KORANGI'))
})

test('renaming an account never changes the identity of a seeded money account', () => {
  // The seeded five are keyed on their immutable ledger code, so the identity
  // survives any rename — that is what makes it usable as a business identity.
  assert.deepEqual(SEEDED_MONEY_IDENTITY_BY_LEDGER_CODE, {
    '1010': 'CASH', '1020': 'PETTY-CASH', '1030': 'BANK', '1040': 'EASYPAISA', '1050': 'JAZZCASH',
  })
  assert.equal(deriveMoneyIdentity({ name: 'Main Cash Drawer', type: 'Cash', ledgerCode: '1010' }), 'CASH')
  assert.equal(deriveMoneyIdentity({ name: 'Office Float', type: 'Bank', ledgerCode: '1020' }), 'PETTY-CASH')
  assert.equal(deriveMoneyIdentity({ name: 'Meezan Current', type: 'Bank', ledgerCode: '1030' }), 'BANK')
  assert.equal(deriveMoneyIdentity({ name: 'Wallet One', type: 'Cash', ledgerCode: '1040' }), 'EASYPAISA')
  assert.equal(deriveMoneyIdentity({ name: 'Wallet Two', type: 'Cash', ledgerCode: '1050' }), 'JAZZCASH')
  // Moving one between Cash and Bank does not rewrite it either.
  assert.equal(deriveMoneyIdentity({ name: 'Cash', type: 'Bank', ledgerCode: '1010' }), 'CASH')
  // A stored identity, once the column exists, wins over any derivation.
  assert.deepEqual(assignMoneyIdentities([{ name: 'Renamed Till', type: 'Cash', ledgerCode: '1070', identity: 'TILL-CASH' }]), ['TILL-CASH'])
  assert.match(identityModule, /Once the identity column exists, the stored value wins outright/)
})

test('identities are unique within a business and disambiguate readably', () => {
  const identities = assignMoneyIdentities([
    { name: 'UBL', type: 'Bank', ledgerCode: '1060' },
    { name: 'UBL', type: 'Bank', ledgerCode: '1061', hints: ['Korangi'] },
    { name: 'UBL', type: 'Bank', ledgerCode: '1062' },
  ])
  assert.deepEqual(identities, ['BANK-UBL', 'BANK-UBL-KORANGI', 'BANK-UBL-ALT'])
  assert.equal(new Set(identities).size, identities.length)
  // Never a meaningless number-shaped identity: no ACCOUNT-1060, BA-17, ACC-009.
  for (const identity of identities) {
    assert.ok(isMoneyIdentity(identity), identity)
    assert.doesNotMatch(identity, /^(ACCOUNT|BA|ACC)-\d+$/)
    assert.doesNotMatch(identity, /\d{4}$/)
  }
  // A derived identity can never take one the business already stores.
  assert.deepEqual(
    assignMoneyIdentities([
      { name: 'Renamed', type: 'Cash', ledgerCode: '1070', identity: 'TILL-CASH' },
      { name: 'Till Cash', type: 'Cash', ledgerCode: '1071' },
    ]),
    ['TILL-CASH', 'TILL-CASH-ALT'],
  )
  // An unusable stored value is ignored rather than shown.
  assert.deepEqual(assignMoneyIdentities([{ name: 'Petty Cash', type: 'Cash', identity: '1020' }]), ['PETTY-CASH'])
  // Long names are trimmed on a word boundary, so they still read as words.
  const long = deriveMoneyIdentity({ name: 'Habib Metropolitan Bank Limited Korangi Industrial Area', type: 'Bank' })
  assert.ok(long.length <= MONEY_IDENTITY_MAX_LENGTH, long)
  assert.ok(isMoneyIdentity(long), long)
})

test('no internal id is ever used or shown as an identity', () => {
  assert.doesNotMatch(identityModule, /randomUUID|uuidv4|crypto\./)
  // Derivation reads a name, a type and the numeric ledger code — nothing else.
  assert.match(identityModule, /export type MoneyIdentityInput = \{/)
  assert.doesNotMatch(identityModule, /accountId|businessAccountId|profileId/)
  // A cuid or uuid passed as a name is not accepted as an identity.
  assert.equal(isMoneyIdentity('clx3n2k9a0000abcd1234efgh'), false)
  assert.equal(isMoneyIdentity('6f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f'), false)
  // The picker context is a label and an identity, never an id.
  assert.match(moneyAccountContext('Cash', 'JAZZCASH'), /^Cash .+ JAZZCASH$/)
  assert.match(moneyAccountContext('Easypaisa', 'EASYPAISA'), /^Cash .+ EASYPAISA$/)
  assert.equal(moneyAccountContext('Bank', null), 'Bank')
  assert.equal(moneyIdentityToken('  Bank Al-Habib // Korangi '), 'BANK-AL-HABIB-KORANGI')
})

// ===========================================================================
// Legacy money accounts become manageable
// ===========================================================================

test('chart-seeded money accounts appear in Business Accounts as unmanaged rows', () => {
  // The list is a union: rows in business_accounts, plus Asset money accounts in
  // the chart that have no row of their own. Read through the shared chart
  // reader, so it works the same on the legacy schema and on Prisma.
  assert.match(listRoute, /async function listUnlinkedLedgerMoneyAccounts\(/)
  assert.match(listRoute, /chart = await getChartOfAccounts\(businessId\)/)
  assert.match(listRoute, /if \(category\.type !== 'Asset'\) continue/)
  assert.match(listRoute, /if \(!account\.isBusinessAccount\) continue/)
  assert.match(listRoute, /if \(linkedLedgerAccountIds\.has\(account\.id\)\) continue/)
  assert.match(listRoute, /linked: false/)
  // Both data paths return the same union, identities assigned once for all.
  assert.equal(listRoute.match(/withIdentities\(\[\.\.\.managed, \.\.\.unlinked\]\)/g)?.length, 2)
  // The screen shows them, says why they are read-only, and offers the fix.
  assert.match(businessAccountsView, /const unmanagedCount = rows\.filter\(\(row\) => !row\.linked\)\.length/)
  assert.match(businessAccountsView, /came with your chart of/)
  assert.match(businessAccountsView, /Enable management/)
  // Editing, moving, deactivating and deleting stay behind the linked flag.
  assert.match(businessAccountsView, /\{row\.linked && <ManagedRowActions row=\{row\} controls=\{controls\} \/>\}/)
  assert.match(businessAccountsView, /controls\.canManage && row\.linked && controls\.editingId === row\.id/)
})

test('bringing one under management reuses the ledger row and never duplicates it', () => {
  // Prisma path: the existing account is looked up, then only the missing
  // business_accounts row is created. No account create, no code, no balance.
  assert.match(linkRoute, /const account = await db\.account\.findFirst\(/)
  assert.match(linkRoute, /await db\.businessAccount\.create\(/)
  assert.match(linkRoute, /accountId: account\.id/)
  assert.doesNotMatch(linkRoute, /db\.account\.create|tx\.account\.create/)
  assert.doesNotMatch(linkRoute, /balanceCache/)
  assert.doesNotMatch(linkRoute, /account\.update|accounts'\)\.update/)
  // Legacy path: a plain insert of columns the table has had since migration 1.
  assert.match(legacyAccess, /from\('business_accounts'\)\.insert\(\{/)
  assert.match(legacyAccess, /account_id: account\.id/)
  assert.doesNotMatch(legacyAccess, /from\('accounts'\)\.insert/)
  // Only a real money account qualifies, on both paths.
  assert.match(linkRoute, /!account\.isBusinessAccount \|\| account\.category\.type !== 'Asset'/)
  assert.match(legacyAccess, /if \(account\.is_business_account !== true\) return \{ ok: false, reason: 'NOT_MONEY_ACCOUNT' \}/)
  assert.match(legacyAccess, /if \(category\?\.type !== 'Asset'\) return \{ ok: false, reason: 'NOT_MONEY_ACCOUNT' \}/)
})

test('linking twice returns the same account instead of creating a second', () => {
  // Prisma: the row is detected first, and accountId is unique, so the database
  // refuses a duplicate even under a concurrent second attempt.
  assert.match(linkRoute, /if \(account\.businessAccount\) \{/)
  assert.match(linkRoute, /alreadyLinked: true/)
  assert.match(prismaSchema, /accountId\s+String\s+@unique/)
  // Legacy: same detection, and a unique violation is the idempotent outcome.
  assert.match(legacyAccess, /\.eq\('account_id', account\.id\)/)
  assert.match(legacyAccess, /if \(insertError && insertError\.code !== '23505'\) unavailable\(insertError\)/)
  assert.match(legacyAccess, /return \{ ok: true, alreadyLinked: Boolean\(existing\), row \}/)
  // The audit entry is written once — the second run records nothing new.
  assert.match(linkRoute, /if \(!probe\.alreadyLinked\) \{/)
  assert.match(linkRoute, /action: 'MONEY_ACCOUNT_LINK'/)
  assert.match(auditView, /MONEY_ACCOUNT_LINK: 'Money account from the chart made manageable'/)
})

test('the ledger id, numeric code, balance and posted history are preserved', () => {
  // The linked row carries the ledger account's own id, so every posted entry
  // still points at the same account; the code is read, never rewritten.
  assert.match(listRoute, /id: account\.id,\s+linked: false/)
  assert.match(listRoute, /balancePaisas: account\.balanceCache\.toString\(\)/)
  assert.match(linkRoute, /isActive: account\.isActive/)
  assert.match(legacyAccess, /is_active: account\.is_active !== false/)
  // Nothing in the link path writes a voucher, a line or a balance.
  assert.doesNotMatch(linkRoute, /balanceCache|balance_cache|balancePaisas/)
  assert.doesNotMatch(linkRoute, /post_voucher|voucherLine|voucher_lines/)
  // The seeded codes stay the accounting reference on both screens.
  assert.match(businessAccountsView, /\{row\.ledger\.code\}/)
  assert.match(accountsView, /Account \{account\.code\}/)
})

test('Business Accounts groups every row under Cash or Bank and nothing else', () => {
  assert.match(businessAccountsView, /const groups = useMemo\(\(\) => BUSINESS_ACCOUNT_TYPES\.map\(\(type\) => \(\{/)
  assert.match(businessAccountsView, /<GroupTable rows=\{group\.rows\} controls=\{controls\} \/>/)
  assert.match(businessAccountsView, /<GroupCards rows=\{group\.rows\} controls=\{controls\} \/>/)
  assert.doesNotMatch(businessAccountsView, /Mobile Wallets/)
  // The identity leads each row; the ledger code is the secondary reference.
  assert.match(businessAccountsView, /function IdentityChip\(\{ identity \}: \{ identity: string \}\)/)
  assert.match(businessAccountsView, /<IdentityChip identity=\{row\.identity\} \/>/)
  assert.match(businessAccountsView, /title=\{`Identity: \$\{identity\}`\}/)
  // Delete still names the identity and repeats the history rule.
  assert.match(businessAccountsView, /An account with transaction history cannot be deleted/)
  assert.match(itemRoute, /This account has transaction history and cannot be deleted\.|ACCOUNT_IN_USE_MESSAGE/)
})

// ===========================================================================
// Accounts & Balances reads the same accounts, and manages none of them
// ===========================================================================

test('Accounts and Balances shows the same identity and defers management', () => {
  // One list feeds both screens, so a row cannot read differently on each.
  assert.match(accountsView, /queryKey: \['business-accounts'\]/)
  assert.match(businessAccountsView, /queryKey: \['business-accounts'\]/)
  assert.match(expenseView, /queryKey: \['business-accounts'\]/)
  // Identity comes from the endpoint keyed on the immutable ledger code.
  assert.match(accountsView, /const moneyIdentities = useMemo\(\(\) => \{/)
  assert.match(accountsView, /byLedgerCode\.set\(code, row\.identity\)/)
  assert.match(accountsView, /identity=\{moneyIdentities\.get\(a\.code\) \?\? null\}/)
  assert.match(accountsView, /title=\{`Identity: \$\{identity\}`\}/)
  // Two groups only, and no separate wallet or other bucket.
  assert.match(accountsView, /const ACCOUNT_GROUPS: AccountGroup\[\] = \['Cash', 'Bank'\]/)
  assert.doesNotMatch(accountsView, /Mobile Wallets/)
  // Manage hands off to the management screen; nothing is edited here.
  assert.match(accountsView, /onManage=\{canManageAccounts \? openBusinessAccounts : undefined\}/)
  assert.doesNotMatch(accountsView, /business-accounts\/link|MONEY_ACCOUNT|method: 'PATCH'|method: 'DELETE'/)
})

// ===========================================================================
// Expense Batch: layout, validation, and the Paid From list
// ===========================================================================

test('Expense Batch reads Date, Paid From, Reference, Notes then lines then total', () => {
  const header = expenseView.slice(expenseView.indexOf('{/* Header:'), expenseView.indexOf('{/* Lines */}'))
  assert.ok(header.indexOf('>Date<') < header.indexOf('>Paid From<'), 'Date precedes Paid From')
  assert.ok(header.indexOf('>Paid From<') < header.indexOf('>Reference<'), 'Paid From precedes Reference')
  assert.ok(header.indexOf('>Reference<') < header.indexOf('>Notes<'), 'Reference precedes Notes')
  assert.match(header, /grid gap-3 sm:grid-cols-2 lg:grid-cols-4/)
  // Lines: a wide category, a description, a right-aligned amount, a remove.
  assert.match(expenseView, /w-\[40%\]/)
  assert.match(expenseView, /text-right/)
  assert.match(expenseView, /inputMode="decimal"/)
  assert.match(expenseView, /Add another line/)
  // One dominant action at the bottom, with the total beside it.
  assert.match(expenseView, /Post Expense Batch/)
  assert.match(expenseView, /h-12 w-full px-6 text-base font-semibold/)
  assert.doesNotMatch(expenseView, /<tfoot/)
})

test('Paid From offers active Cash and Bank money accounts, read by name and identity', () => {
  // Only money accounts — an Asset account that is not one the business holds
  // money in (inventory, receivable control) is no longer offered.
  assert.match(expenseView, /\.filter\(a => a\.categoryType === 'Asset' && a\.isBusinessAccount\)/)
  // Inactive accounts never reach the picker: the chart read drops them first.
  assert.match(expenseView, /c\.accounts\.filter\(\(a: any\) => a\.isActive\)/)
  // Grouped under the two money types, from the one vocabulary module.
  assert.match(expenseView, /BUSINESS_ACCOUNT_TYPES\n?\s*\.map\(type => \(\{ type, rows: rows\.filter\(row => row\.type === type\) \}\)\)/)
  assert.match(expenseView, /<SelectLabel className="text-\[11px\] uppercase tracking-wider">\{group\.type\}<\/SelectLabel>/)
  // The row reads as a name plus "Cash · CASH"; the id is the value, never shown.
  assert.match(expenseView, /<span>\{row\.name\}<\/span>/)
  assert.match(expenseView, /<span className="text-\[10px\] text-muted-foreground">\{row\.context\}<\/span>/)
  assert.match(expenseView, /context: moneyAccountContext\(type, identity\)/)
  assert.doesNotMatch(expenseView, /\{row\.id\}<\/|\{row\.ledger|\{a\.code\}/)
  assert.match(expenseView, /'No active Cash or Bank account to pay from\.'/)
})

test('a line that cannot post says so beside the field, and nothing is sent', () => {
  assert.match(expenseView, /'Pick an expense category\.'/)
  assert.match(expenseView, /'Enter the amount\.'/)
  assert.match(expenseView, /'Enter a plain number, like 1250\.00'/)
  assert.match(expenseView, /'Amount must be more than zero\.'/)
  assert.match(expenseView, /'Choose the account this batch was paid from\.'/)
  // Shown only once a post has been attempted; an untouched form is not an error.
  assert.match(expenseView, /const issue = attempted \? lineIssues\.get\(line\.key\) : undefined/)
  assert.match(expenseView, /function attemptPost\(\) \{\s+if \(canPost\) \{/)
  assert.match(expenseView, /setAttempted\(true\)/)
  assert.match(expenseView, /function FieldError\(\{ children \}: \{ children: ReactNode \}\)/)
})

// ===========================================================================
// Compatibility: identity is metadata, the ledger account id still posts
// ===========================================================================

test('expense accounting semantics are unchanged by the layout work', () => {
  // The same payload, the same endpoint, the same idempotency key.
  assert.match(expenseView, /fetch\('\/api\/expense-batch', \{/)
  assert.match(expenseView, /paymentAccountId,/)
  assert.match(expenseView, /categoryId: choice\?\.categoryId/)
  assert.match(expenseView, /expenseAccountId: choice\?\.expenseAccountId/)
  assert.match(expenseView, /idempotencyKey,/)
  assert.match(expenseView, /const canPost = paymentAccountId && lines\.length >= 1/)
  // The server still validates the ledger account, not a type or an identity.
  assert.match(expenseRoute, /!paymentAccount\?\.isActive \|\| !paymentAccount\.isBusinessAccount \|\| paymentAccount\.category\.type !== 'Asset'/)
  assert.match(expenseRoute, /INVALID_PAYMENT_ACCOUNT/)
  assert.doesNotMatch(expenseRoute, /moneyAccountContext|deriveMoneyIdentity|MONEY_IDENTITY/)
})

test('no identity column is written or required — the read path prefers one if it lands', () => {
  // The migration gate: nothing here adds a column, so identity is derived and
  // the feature ships on the schema that is already deployed.
  assert.doesNotMatch(prismaSchema, /^\s*identity\s+String/m)
  assert.match(identityModule, /there is no identity column on `business_accounts`/)
  // Derived server-side in one place, so every screen reads the same value.
  assert.match(listRoute, /function withIdentities\(rows: Omit<MoneyAccountRow, 'identity'>\[\]\): MoneyAccountRow\[\]/)
  assert.match(listRoute, /ordered\.sort|\[\.\.\.rows\]\.sort/)
  assert.match(listRoute, /identity: string/)
  // Audit entries carry the identity and keep the code as a secondary reference.
  assert.match(itemRoute, /identity: deriveMoneyIdentity\(\{/)
  assert.match(itemRoute, /ledgerCode: input\.after\.code/)
  assert.match(auditView, /changes\.push\(\{ label: 'Identity', value: identity \}\)/)
})
