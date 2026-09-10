import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { productColumnCandidates } from '../src/lib/products/schema-compatibility.ts'

const root = new URL('../', import.meta.url)
const read = (path: string) => readFile(new URL(path, root), 'utf8')

test('reports skip the redundant UUID capability preflight and retain fail-closed handling', async () => {
  const [route, readers] = await Promise.all([
    read('src/app/api/reports/route.ts'),
    read('src/lib/reports/data-access.ts'),
  ])

  assert.doesNotMatch(route, /getAccountingAvailability|preflight\.accountingAvailability/)
  assert.match(route, /isSchemaUnavailableError/)
  assert.match(route, /unavailableAccountingPayload/)
  assert.match(readers, /usesLegacyTransactionSchema/)
  assert.match(readers, /report_profit_loss/)
  assert.match(readers, /ledger_profit_loss/)
})

test('parallel report readers share one in-flight legacy-schema probe', async () => {
  const bridge = await read('src/lib/identity/legacy-bridge.ts')

  assert.match(bridge, /let legacySchemaPromise: Promise<boolean> \| null = null/)
  assert.match(bridge, /if \(legacySchemaPromise\) return legacySchemaPromise/)
  assert.match(bridge, /legacySchemaPromise = measurePerformanceStage\(/)
  assert.match(bridge, /\.finally\(\(\) => \{\s+legacySchemaPromise = null/)
  assert.match(bridge, /throw new Error\(`Legacy schema probe:/)
})

test('the production product list skips its redundant table probe', async () => {
  const products = await read('src/lib/products/data-access.ts')
  const list = products.slice(
    products.indexOf('export async function listProducts'),
    products.indexOf('async function fetchProductRow'),
  )

  assert.match(list, /if \(isSupabaseConfigured\(\) \|\| await isPhase3Live\(\)\)/)
  assert.match(list, /SUPABASE_URL\.includes\(PRODUCTION_PROJECT_REF\)/)
  assert.match(list, /PRODUCTION_PRODUCT_COLUMNS/)
  assert.match(list, /missingProductOptionalColumn/)
  assert.equal((list.match(/endpoint\.productQuery/g) ?? []).length, 1)
})

test('known production columns are attempted first while all compatibility fallbacks remain', () => {
  const production = { lowStockThreshold: true, commissionRate: false }
  const candidates = productColumnCandidates(production)

  assert.deepEqual(candidates[0], production)
  assert.deepEqual(candidates.at(-1), {
    lowStockThreshold: false,
    commissionRate: false,
  })
  assert.ok(candidates.some(candidate => candidate.lowStockThreshold && candidate.commissionRate))
  assert.equal(new Set(candidates.map(candidate => JSON.stringify(candidate))).size, 4)
})
