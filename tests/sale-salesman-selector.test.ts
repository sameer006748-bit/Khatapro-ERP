import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const read = async (path: string) =>
  (await readFile(`src/components/erp/views/${path}-sale-view.tsx`, 'utf8')).replace(/\r\n/g, '\n')

const [counter, online, ofc, other] = await Promise.all(
  ['counter', 'online', 'ofc', 'other'].map(read),
)

// ---------------------------------------------------------------------------
// Every sale channel must attribute the bill to whoever actually made it:
// commission is paid from this field. Replaces the two never-executed scratch
// specs (tests/sale-salesman-selector-spec.mjs, tests/counter-sale-fix-spec.mjs)
// whose filenames the runner glob never matched and whose assertions had gone
// stale - they still expected fetch('/api/salesmen'), which no view uses.
// ---------------------------------------------------------------------------

test('all four sale channels read the salesman list from the one shared route', () => {
  for (const [name, source] of [['counter', counter], ['online', online], ['ofc', ofc], ['other', other]] as const) {
    assert.equal(
      source.match(/apiFetchJson\('\/api\/salesmen'/g)?.length,
      1,
      `${name} sale must load salesmen once through the shared client`,
    )
  }
})

// A wrong default silently pays another person's commission, so a default is
// only allowed when there is nothing to choose between.
test('no channel auto-picks a salesman while several are active', () => {
  for (const [name, source] of [['counter', counter], ['online', online], ['ofc', ofc]] as const) {
    assert.ok(
      source.includes('activeSalesmen.length === 1 ? activeSalesmen[0].id : \'\''),
      `${name} sale may default only to a single unambiguous active salesman`,
    )
    assert.ok(source.includes('s.isActive !== false'), `${name} sale must offer active salesmen only`)
  }
})

test('Online and OFC require a selection from roles that sell for someone else', () => {
  for (const [name, source] of [['online', online], ['ofc', ofc]] as const) {
    assert.ok(source.includes("const mustPickSalesman = user.permissions.includes('can_view_sales')"), name)
    assert.ok(source.includes('salesmanId: mustPickSalesman ? effectiveSalesmanId : undefined'), name)
    assert.ok(source.includes('(!mustPickSalesman || !!effectiveSalesmanId)'), name)
    // A salesman-role user is resolved server-side, so the picker is not shown
    // to them and must not be required of them.
    assert.ok(source.includes('enabled: mustPickSalesman'), name)
  }
})

// Counter Sale is the one channel an Owner works themselves, so it asks who
// sold rather than assuming, and refuses to post until that is answered.
test('Counter Sale distinguishes an Owner sale from a salesman sale', () => {
  assert.ok(counter.includes("const sellerReady = sellerRole === 'OWNER' || Boolean(effectiveSalesmanId)"))
  assert.ok(counter.includes("salesmanId: sellerRole === 'SALESMAN' ? effectiveSalesmanId : null"))
  assert.ok(counter.includes("if (role === 'OWNER') setSalesmanId('')"))
})

test('Other Sale refuses to post without a salesman', () => {
  assert.ok(other.includes("if (!salesmanId) { toast.error('Select a salesman'); return }"))
})

// A double tap on a slow connection used to post the bill twice. The guard is a
// ref rather than state because a state update is not synchronous and both taps
// would read the old value. Counter rejects re-entry by throwing into its
// mutation's onError, Other by returning; either way the second tap posts
// nothing.
test('the channels an operator taps fast guard against a double submit', () => {
  for (const [name, source] of [['counter', counter], ['other', other]] as const) {
    assert.ok(source.includes('const postingRef = useRef(false)'), `${name} sale needs a synchronous guard`)
    assert.match(
      source,
      /if \(postingRef\.current\) (return|throw)/,
      `${name} sale must refuse a re-entrant submit`,
    )
    assert.ok(source.includes('postingRef.current = true'), `${name} sale must claim the guard`)
    assert.ok(source.includes('postingRef.current = false'), `${name} sale must release the guard`)
  }
  // Every channel is also disabled while its post is in flight, so the guard is
  // the second line of defence rather than the only one.
  assert.ok(counter.includes('disabled={!canPost || isPending}'))
  assert.ok(other.includes('disabled={isPosting ||'))
  for (const [name, source] of [['online', online], ['ofc', ofc]] as const) {
    assert.ok(/disabled=\{postMut\.isPending/.test(source), `${name} sale must disable while posting`)
  }
})

// The last line of defence is the server: a duplicate that still gets through
// carries the same key as the first attempt and is deduplicated rather than
// posted twice. The key must therefore survive a failed attempt and rotate only
// when the operator starts a different bill.
test('a retried Counter bill reuses its idempotency key and a new bill gets a fresh one', () => {
  assert.ok(counter.includes('const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())'))
  assert.ok(counter.includes('idempotencyKey,'))
  const reset = counter.slice(counter.indexOf('const resetBill'))
  assert.ok(
    reset.slice(0, reset.indexOf('}, [')).includes('setIdempotencyKey(crypto.randomUUID())'),
    'clearing the bill must start a new idempotency scope',
  )
})

test('money crosses the wire as a string on every channel', () => {
  for (const [name, source] of [['counter', counter], ['online', online], ['ofc', ofc], ['other', other]] as const) {
    assert.doesNotMatch(
      source,
      /JSON\.stringify\([^)]*[Pp]aisas: *[a-zA-Z.]+ *[,}]/,
      `${name} sale must not serialize a BigInt directly`,
    )
  }
  assert.ok(ofc.includes('discountPaisas: discountPaisas.toString()'))
  assert.ok(other.includes('const discountPaisas = discount > 0n ? String(discount) : undefined'))
})
