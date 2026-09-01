import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const accounts = await readFile('src/components/erp/views/accounts-view.tsx', 'utf8')
const businessAccounts = await readFile('src/components/erp/views/business-accounts-view.tsx', 'utf8')
const pettyCash = await readFile('src/components/erp/views/petty-cash-view.tsx', 'utf8')

test('accounts workspace uses a consistent professional icon and balance system', () => {
  for (const icon of ['Banknote', 'WalletCards', 'Landmark', 'Smartphone', 'CircleDollarSign']) {
    assert.match(accounts, new RegExp(`\\b${icon}\\b`), icon)
  }
  assert.doesNotMatch(accounts, /[💵🪙🏦📱📲💼💰]/u)
  assert.match(accounts, /function FinanceAccountCard/)
  assert.match(accounts, /text-lg font-semibold/)
  assert.match(accounts, /Overdrawn/)
  assert.match(accounts, /'Zero'/)
  assert.match(accounts, /'Unavailable'/)
})

test('accounts stay distinguishable and actions remain available without changing data', () => {
  assert.match(accounts, /Account \{account\.code\}/)
  assert.match(accounts, /ACCOUNT_GROUPS/)
  assert.match(accounts, /Cash', 'Bank', 'Mobile Wallets', 'Other/)
  assert.match(accounts, /> New Entry</)
  assert.match(accounts, /Receive Payment/)
  assert.match(accounts, /Pay Vendor/)
})

test('business accounts preserve existing management paths with finance styling', () => {
  assert.match(businessAccounts, /\/api\/setup\/business-accounts/)
  assert.match(businessAccounts, /method: 'POST'/)
  assert.match(businessAccounts, /method: 'PATCH'/)
  assert.match(businessAccounts, /method: 'DELETE'/)
  assert.match(businessAccounts, /AccountTypeLabel/)
  assert.match(businessAccounts, /Active/)
  assert.match(businessAccounts, /Inactive/)
  assert.match(businessAccounts, /New business account/)
})

test('petty cash preserves funding and expense entry flows with clear balance states', () => {
  assert.match(pettyCash, /\/api\/contra-entry/)
  assert.match(pettyCash, /\/api\/expense-batch/)
  assert.match(pettyCash, /Current Petty Cash Balance/)
  assert.match(pettyCash, /Overdrawn/)
  assert.match(pettyCash, /'Zero'/)
  assert.match(pettyCash, /New Entry/)
  assert.doesNotMatch(pettyCash, /voucher_lines/)
})
