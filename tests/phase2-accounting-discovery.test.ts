import { strict as assert } from 'node:assert'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { promisify } from 'node:util'

const DISCOVERY = (await readFile('supabase/migrations/00015_phase2_accounting_discovery.sql', 'utf8')).toLowerCase()
const RPC_DISCOVERY = (await readFile('supabase/migrations/00015_phase2_rpc_discovery.sql', 'utf8')).toLowerCase()
const execFileAsync = promisify(execFile)

function executableLines(source: string) {
  return source.split('\n').filter((line) => !line.trim().startsWith('--'))
}

test('Phase 2 discovery SQL is metadata-only and read-only', () => {
  const combined = `${DISCOVERY}\n${RPC_DISCOVERY}`
  const forbidden = ['insert into', 'update ', 'delete from', 'alter ', 'create ', 'drop ', 'truncate ', 'grant ', 'revoke ', 'call ', 'perform ']
  for (const term of forbidden) assert.ok(!executableLines(combined).some((line) => line.includes(term)), `discovery SQL must not execute ${term}`)
  assert.ok(!combined.includes('from public.'), 'discovery must not read application-table rows')
  assert.ok(!combined.includes('join public.'), 'discovery must not join application-table rows')
})

test('Phase 2 discovery uses only metadata and catalog sources', () => {
  const combined = `${DISCOVERY}\n${RPC_DISCOVERY}`
  for (const source of [
    'information_schema.tables', 'information_schema.columns', 'information_schema.table_constraints',
    'information_schema.key_column_usage', 'information_schema.parameters',
    'information_schema.role_table_grants', 'pg_catalog.pg_proc', 'pg_catalog.pg_namespace',
    'pg_catalog.pg_class', 'pg_catalog.pg_constraint', 'pg_catalog.pg_indexes', 'pg_catalog.pg_policies',
  ]) assert.ok(combined.includes(source), `missing metadata source: ${source}`)
  assert.ok(combined.includes('pg_get_functiondef'), 'function definitions must be discoverable')
  assert.ok(combined.includes('pg_get_function_arguments'), 'function argument signatures must be discoverable')
  assert.ok(combined.includes('pg_get_function_result'), 'function return types must be discoverable')
})

test('Phase 2 discovery covers accounting, sale, and permission metadata', () => {
  for (const keyword of [
    'voucher', 'journal', 'ledger', 'account', 'debit', 'credit', 'customer', 'receivable',
    'payable', 'payment', 'receipt', 'cash', 'bank', 'expense', 'revenue', 'inventory',
    'stock', 'return', 'refund', 'credit', 'invoice', 'profile', 'role', 'permission', 'salesman',
  ]) assert.ok(DISCOVERY.includes(keyword), `missing discovery keyword: ${keyword}`)
  for (const section of ['primary key', 'unique', 'foreign keys', 'index', 'rls', 'policy', 'grants']) {
    assert.ok(DISCOVERY.includes(section), `missing discovery section: ${section}`)
  }
})

test('RPC discovery includes signatures, definitions, and execute grants', () => {
  for (const file of [DISCOVERY, RPC_DISCOVERY]) {
    assert.ok(file.includes('security_definer'), 'security definer status must be returned')
    assert.ok(file.includes('volatility'), 'routine volatility must be returned')
  }
  assert.ok(RPC_DISCOVERY.includes('function_definition'), 'complete function definitions must be returned')
  assert.ok(RPC_DISCOVERY.includes('aclexplode'), 'execute grants must be returned from routine ACLs')
})

test('function helpers are sourced only from ordinary public functions', () => {
  for (const file of [DISCOVERY, RPC_DISCOVERY]) {
    const definitionCalls = file.match(/pg_catalog\.pg_get_functiondef/g) ?? []
    const ordinarySources = file.match(/ordinary_public_functions as materialized/g) ?? []
    const ordinaryFilters = file.match(/p\.prokind\s*=\s*'f'/g) ?? []
    assert.ok(definitionCalls.length > 0, 'function definitions must remain discoverable')
    assert.ok(ordinarySources.length >= 1, 'definition helpers require a materialized ordinary-function source')
    assert.ok(ordinaryFilters.length >= ordinarySources.length, 'every ordinary-function source must filter p.prokind = f')
    assert.ok(file.includes("n.nspname = 'public'"), 'routine discovery must be limited to the public schema')
    assert.ok(!/p\.prokind\s*(?:=|in)\s*[^\n;]*'a'/.test(file), 'aggregate prokind a must never enter helper input')
    assert.ok(!/p\.prokind\s*(?:=|in)\s*[^\n;]*'w'/.test(file), 'window prokind w must never enter helper input')
    const sql = executableLines(file).join('\n')
    assert.ok(sql.indexOf('pg_catalog.pg_get_functiondef') > sql.indexOf('ordinary_public_functions as materialized'), 'definition helper must appear after the verified ordinary-function source')
    assert.ok(!sql.includes('array_agg'), 'array_agg cannot enter routine metadata processing')
  }
})

test('discovery package has no secret or hardcoded business access', () => {
  const combined = `${DISCOVERY}\n${RPC_DISCOVERY}`
  for (const forbidden of ['service_role_key', 'supabase_service', 'process.env', 'authorization:', 'bearer ', 'from public.businesses']) {
    assert.ok(!combined.includes(forbidden), `discovery must not contain ${forbidden}`)
  }
  assert.ok(!combined.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i), 'discovery must not contain a hardcoded UUID')
})

test('Phase 1 and protected historical migrations are untouched', async () => {
  const protectedPaths = [
    'supabase/migrations/00009_phase9_discount_support.sql',
    'supabase/migrations/00010_phase10_ai_settings.sql',
    'supabase/migrations/00011_phase11_placeholder.sql',
    'supabase/migrations/00012_post_opening_stock.sql',
    'supabase/migrations/00013_fix_post_opening_stock_execution.sql',
    'supabase/migrations/00014_phase1_foundation.sql',
  ]
  const { stdout } = await execFileAsync('git', ['diff', '--name-only', '--', ...protectedPaths])
  assert.equal(stdout.trim(), '', 'discovery work must not modify migrations 00009–00014')
})
