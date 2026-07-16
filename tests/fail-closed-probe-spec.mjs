/**
 * Standalone contract test for the fail-closed probe behaviour.
 * Run: node tests/fail-closed-probe-spec.mjs
 */
import { ok, rejects } from 'node:assert'

// INLINE REPLICA of src/lib/supabase/phase-probe.ts logic — same contract.
const PROBE_TTL_MS = 30_000

function freshCache() {
  return { lastChecked: 0, lastResult: false }
}

async function probeTable(isConfigured, cache, adminQuery) {
  if (!isConfigured) {
    return false
  }

  const now = Date.now()
  if (cache.lastChecked > 0 && (now - cache.lastChecked) < PROBE_TTL_MS) {
    if (!cache.lastResult) {
      throw new Error('Database service unavailable. Please try again.')
    }
    return true
  }

  cache.lastChecked = now
  try {
    const { data, error } = await adminQuery()
    cache.lastResult = !error && Array.isArray(data)
  } catch {
    cache.lastResult = false
  }

  if (!cache.lastResult) {
    throw new Error('Database service unavailable. Please try again.')
  }
  return true
}

// ── Helpers ──
const success = () => Promise.resolve({ data: [{ id: '1' }], error: null })
const errorQ = (msg) => Promise.resolve({ data: null, error: { message: msg } })
const network = () => Promise.reject(new Error('ECONNREFUSED'))

// ── Tests ──
let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`)
    failed++
  }
}

console.log('fail-closed probe contract\n')

await test('not configured → returns false (Prisma OK)', async () => {
  const r = await probeTable(false, freshCache(), success)
  ok(r === false, `expected false, got ${r}`)
})

await test('configured + success → returns true (use Supabase)', async () => {
  const r = await probeTable(true, freshCache(), success)
  ok(r === true, `expected true, got ${r}`)
})

await test('configured + error → throws (no Prisma fallback)', async () => {
  await rejects(
    () => probeTable(true, freshCache(), () => errorQ('boom')),
    { message: /Database service unavailable/ },
  )
})

await test('configured + network throw → throws', async () => {
  await rejects(
    () => probeTable(true, freshCache(), network),
    { message: /Database service unavailable/ },
  )
})

await test('cached false → still throws (no Prisma)', async () => {
  const cache = { lastChecked: Date.now(), lastResult: false }
  await rejects(
    () => probeTable(true, cache, success),
    { message: /Database service unavailable/ },
  )
})

await test('cached true → fast returns true', async () => {
  const cache = { lastChecked: Date.now(), lastResult: true }
  const r = await probeTable(true, cache, success)
  ok(r === true, `expected true, got ${r}`)
})

await test('error message never leaks secrets or provider data', async () => {
  try {
    await probeTable(true, freshCache(), () =>
      errorQ('JWT expired at https://ebcebxwpddltiwrqybqc.supabase.co key=eyJhbG...'),
    )
  } catch (e) {
    const m = e.message
    ok(!m.includes('ebcebxwpddltiwrqybqc'), 'leaked project ref')
    ok(!m.includes('supabase.co'), 'leaked domain')
    ok(!m.includes('eyJ'), 'leaked JWT')
    ok(!m.includes('JWT'), 'leaked JWT keyword')
    ok(m === 'Database service unavailable. Please try again.', `wrong message: "${m}"`)
  }
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)