import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const read = async (path: string) => (await readFile(path, 'utf8')).replace(/\r\n/g, '\n')

const products = await read('src/lib/products/data-access.ts')
const compat = await read('src/lib/products/schema-compatibility.ts')
const patchRoute = await read('src/app/api/products/[id]/route.ts')

const createProduct = products.slice(
  products.indexOf('export async function createProduct'),
  products.indexOf('export async function updateProduct'),
)
const updateProduct = products.slice(
  products.indexOf('export async function updateProduct'),
  products.indexOf('// ─────────────────────────────────────────────────────────────\n// Stock Movements'),
)

// ---------------------------------------------------------------------------
// products.commission_rate and products.low_stock_threshold come from feature
// migrations that the live production database does not have. This module
// already probes for them on read (schema-compatibility.ts). Writes have to
// respect the same fact, because PostgREST rejects an entire insert or update
// whose payload names a column the table does not have - and it rejects it for
// the key alone, so `commission_rate: null` fails exactly as hard as a value.
//
// Sending that key unconditionally made every "Add Product" on production fail
// with "Failed to create product. Please try again.", which is the whole
// inventory feature, so the shape of these payloads is pinned here.
// ---------------------------------------------------------------------------

test('the optional-column contract still names both columns and both PostgREST codes', () => {
  assert.match(compat, /lowStockThreshold: boolean/)
  assert.match(compat, /commissionRate: boolean/)
  assert.match(compat, /new Set\(\['42703', 'PGRST204'\]\)/)
  assert.match(compat, /column \.\* does not exist\|column \.\* schema cache/)
})

test('creating a product never names an optional column it was not given a value for', () => {
  const insertStart = createProduct.indexOf('const productInsert')
  assert.ok(insertStart > 0, 'the insert payload is built as a named object')
  const payload = createProduct.slice(insertStart, createProduct.indexOf('.insert(productInsert)'))
  // The base payload is exactly the columns the verified production table has.
  for (const column of ['business_id', 'name', 'category_id', 'unit', 'sale_price', 'purchase_price', 'current_stock', 'is_temporary']) {
    assert.match(payload, new RegExp(`\\n\\s+${column}:`), `base payload must set ${column}`)
  }
  assert.doesNotMatch(payload, /\n\s+commission_rate:/, 'commission_rate must not be an unconditional key')
  assert.doesNotMatch(payload, /\n\s+low_stock_threshold:/, 'low_stock_threshold is set separately')
  assert.match(
    payload,
    /if \(input\.commissionRatePaisas !== undefined && input\.commissionRatePaisas !== null\) \{\n\s+productInsert\.commission_rate =/,
    'the column may only be named when a rate was actually entered',
  )
})

test('a commission rate the database cannot store refuses the create instead of dropping it', () => {
  assert.match(createProduct, /if \(createErr && missingProductOptionalColumn\(createErr\) === 'commissionRate'\) \{/)
  assert.match(createProduct, /throw new SafeProductError\(/)
  assert.match(createProduct, /was not created/, 'the message must state that nothing was created')
  // The generic failure stays as the fallback for every other insert error.
  assert.match(createProduct, /if \(createErr \|\| !created\) throw new Error\('Failed to create product\. Please try again\.'\)/)
  // Order matters: the specific diagnosis has to come first or it is dead code.
  assert.ok(
    createProduct.indexOf("=== 'commissionRate'") < createProduct.indexOf("throw new Error('Failed to create product"),
    'the optional-column branch must precede the generic failure',
  )
})

test('an update rejected for the same reason says that nothing was saved', () => {
  assert.match(updateProduct, /if \(error && missingProductOptionalColumn\(error\) === 'commissionRate'\) \{/)
  assert.match(updateProduct, /no changes were saved/)
  assert.ok(
    updateProduct.indexOf("=== 'commissionRate'") < updateProduct.indexOf('throw new Error(`Supabase:'),
    'the optional-column branch must precede the generic failure',
  )
})

test('the product PATCH route shows that refusal to the operator and logs the raw code only', () => {
  assert.match(patchRoute, /import \{ SafeProductError \} from '@\/lib\/products\/opening-stock'/)
  assert.match(patchRoute, /if \(error instanceof SafeProductError\) \{/)
  assert.match(patchRoute, /userMessage: error\.message/)
  assert.match(patchRoute, /error: error\.diagnostic \?\? error\.message/)
  assert.match(patchRoute, /status: 400/)
  // The catch-all keeps its generic message: no provider text reaches a client.
  assert.match(patchRoute, /userMessage: 'The product could not be updated\.'/)
})

// The opening-stock RPC belongs to a lineage production does not have, so this
// is a known, reported V1 limitation rather than a defect - but it must stay a
// clean refusal that leaves no quantity behind without valuation.
test('a failed opening-stock post leaves the product at zero and says so', () => {
  assert.match(createProduct, /rpc\('post_opening_stock_ledger'/)
  assert.match(createProduct, /The product currently has zero stock\. Add the opening quantity via Stock Entry/)
  assert.match(createProduct, /const diagnostic = `post_opening_stock_ledger \[\$\{code\}\] \$\{rawMsg\}`\.slice\(0, 200\)/)
})
