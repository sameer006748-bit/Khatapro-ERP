import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const migration = await readFile('supabase/migrations/00023_rider_cod_balance_reconciliation.sql', 'utf8')
const phase3 = await readFile('supabase/migrations/00017_phase3_rider_cod_settlement.sql', 'utf8')

test('outstanding-date check sums settlements per collection entry instead of checking a single row', () => {
  const fn = migration.slice(migration.indexOf('create or replace function public.get_rider_cod_balances'))
  assert.match(fn, /c\.amount > coalesce\(\(\s*select sum\(s\.amount\) from public\.rider_cash_ledger s/)
  assert.doesNotMatch(fn, /s\.amount >= c\.amount/)
})

test('collected, settled and outstanding totals are unchanged (still summed across all ledger rows)', () => {
  const fn = migration.slice(migration.indexOf('create or replace function public.get_rider_cod_balances'))
  assert.match(fn, /coalesce\(sum\(case when c\.event_type = 'collection' then c\.amount else 0 end\), 0\)/)
  assert.match(fn, /coalesce\(sum\(case when c\.event_type = 'settlement' then c\.amount else 0 end\), 0\)/)
  assert.match(fn, /coalesce\(sum\(case when c\.event_type = 'collection' then c\.amount else -c\.amount end\), 0\)/)
})

test('permission and self-view checks are preserved unchanged', () => {
  const fn = migration.slice(migration.indexOf('create or replace function public.get_rider_cod_balances'))
  assert.match(fn, /Rider can only view own COD balance/)
  assert.match(fn, /Profile is not permitted to view rider COD/)
})

test('business isolation is preserved: balances are scoped by r.business_id = p_business_id', () => {
  const fn = migration.slice(migration.indexOf('create or replace function public.get_rider_cod_balances'))
  assert.match(fn, /where r\.business_id = p_business_id and \(p_rider_id is null or r\.id = p_rider_id\)/)
})

test('this is the same function Phase 3 settlement writes into (single ledger, no second balance source)', () => {
  assert.match(phase3, /insert into public\.rider_cash_ledger/)
  assert.match(migration, /left join public\.rider_cash_ledger c on c\.business_id = r\.business_id and c\.rider_id = r\.id/)
})

test('migration is additive: replaces the function body only, no new tables or destructive statements', () => {
  assert.doesNotMatch(migration, /drop table|drop column|delete from|truncate/i)
  assert.match(migration, /create or replace function public\.get_rider_cod_balances/)
})
