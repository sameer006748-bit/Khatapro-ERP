import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import { ACCOUNT_CATEGORY_DEFINITIONS, UNCATEGORIZED_CATEGORY } from '../src/lib/money/account-subcategories.ts'
import { CODE_WORD_PATTERN, normalizeCodeWord } from '../src/lib/accounting/code-words.ts'

const migration = await readFile('supabase/migrations/00035_top_level_category_code_words.sql', 'utf8')
const source = await readFile('src/lib/money/account-subcategories.ts', 'utf8')
const accountsView = await readFile('src/components/erp/views/accounts-view.tsx', 'utf8')

const expected = {
  sales: 'INCOME',
  expenses: 'EXP',
  'accounts-receivable': 'AR',
  'accounts-payable': 'LIAB',
  purchases: 'PUR',
  capital: 'EQUITY',
  'current-assets': 'ASSET',
  salesman: 'COMM',
} as const

test('every fixed top-level category has a canonical readable code word', () => {
  assert.deepEqual(Object.fromEntries(ACCOUNT_CATEGORY_DEFINITIONS.map(category => [category.id, category.code])), expected)
  for (const category of ACCOUNT_CATEGORY_DEFINITIONS) {
    assert.equal(normalizeCodeWord(category.code).ok, true)
    assert.match(category.code, CODE_WORD_PATTERN)
  }
  assert.equal(UNCATEGORIZED_CATEGORY.code, 'UNCAT')
})

test('top-level code words are exposed without a parallel category model', () => {
  assert.match(source, /code: 'INCOME'/)
  assert.match(accountsView, /parent\.label} · \{parent\.code}/)
  assert.match(accountsView, /parentCategories\.map/)
  assert.doesNotMatch(source, /persist|insert|update/)
})

test('migration 00035 maps fixed parents and preserves child IDs', () => {
  for (const [id, code] of Object.entries(expected)) {
    assert.match(migration, new RegExp(`when '${id}' then '${code}'`))
    assert.match(migration, new RegExp(`'id', '${id}'.*'code', '${code}'`))
  }
  assert.match(migration, /create or replace function public\.account_parent_code_word/)
  assert.match(migration, /account_subcategories s/)
  assert.doesNotMatch(migration, /drop table|alter table public\.account_subcategories.*drop|delete from public\./i)
})

test('subcategory readable code requirements remain present', () => {
  assert.match(source, /subcategories/)
  assert.match(accountsView, /category\.code/)
  assert.match(accountsView, /EXP-COMM/)
})
