import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const probe = (await readFile('src/lib/supabase/phase-probe.ts', 'utf8')).replace(/\r\n/g, '\n')
const body = probe.slice(probe.indexOf('export async function probeTable'))

// ---------------------------------------------------------------------------
// Production stores its data in Supabase; Prisma/SQLite is only the local
// development store. If a probe of a Supabase table answered "false" on a
// transient outage, the caller would quietly serve and write the local store
// instead - a second set of books, with no error for anyone to notice.
//
// Replaces tests/fail-closed-probe-spec.mjs, which the runner glob
// (tests/*.test.ts tests/*.test.mjs) never matched and which asserted against
// an "INLINE REPLICA" of this logic copied into the spec, so it could not fail
// no matter what this file did.
// ---------------------------------------------------------------------------

test('the probe returns false only when Supabase is genuinely not configured', () => {
  // Statement position only: the branch comment below also spells the words.
  assert.equal(
    body.match(/\n\s*return false/g)?.length,
    1,
    'a second false return is a silent fallback to the local database',
  )
  const beforeFalse = body.slice(0, body.search(/\n\s*return false/))
  assert.match(beforeFalse, /if \(!isSupabaseConfigured\(\)\) \{/)
  // Nothing may be probed before that decision: no query, no cache read.
  assert.doesNotMatch(beforeFalse, /getAdminSupabase|cache\.lastResult/)
})

test('an unconfigured serverless deployment refuses rather than falling back', () => {
  assert.match(body, /if \(process\.env\.VERCEL\) \{/)
  assert.match(body, /error\.name = 'ServerlessDatabaseProhibitedError'/)
  const guard = body.slice(body.indexOf('if (process.env.VERCEL)'), body.search(/\n\s*return false/))
  assert.match(guard, /throw error/, 'the serverless guard must throw before the fallback is reached')
})

test('a failed probe throws on the failing call and on every cached repeat', () => {
  assert.equal(
    body.match(/throw new Error\('Database service unavailable\. Please try again\.'\)/g)?.length,
    2,
    'both the live failure and the cached failure must throw',
  )
  // The cached branch is the one that used to be tempting to shortcut: a false
  // cache entry means configured-but-unreachable, not absent.
  const cached = body.slice(body.indexOf('if (cache.lastChecked > 0'))
  const cachedGuard = cached.slice(0, cached.indexOf('return true'))
  assert.match(cachedGuard, /if \(!cache\.lastResult\) \{\n\s+throw new Error\('Database service unavailable/)
})

test('a probe error is recorded as a failure, including a thrown one', () => {
  assert.match(body, /cache\.lastResult = !error && Array\.isArray\(data\)/)
  assert.match(body, /\} catch \{\n\s+cache\.lastResult = false\n\s+\}/)
  assert.ok(
    body.indexOf('cache.lastChecked = now') < body.indexOf('const admin = getAdminSupabase()'),
    'the attempt must be stamped before it can throw, or a hard outage re-probes every call',
  )
})

// The message reaches a browser. The provider's own error text carries the
// project ref, the endpoint and sometimes a JWT fragment.
test('the outage message is a fixed string that cannot carry provider detail', () => {
  for (const site of body.match(/throw new Error\([^)]*\)/g) ?? []) {
    if (site.includes('ServerlessDatabase') || site.includes('Serverless local')) continue
    assert.match(site, /^throw new Error\('[^'`$]+'\)$/, `${site} must not interpolate anything`)
  }
  assert.doesNotMatch(body, /catch \((e|err|error)\)/, 'the provider error is not bound, so it cannot leak')
  assert.doesNotMatch(body, /supabase\.co|eyJ|SERVICE_ROLE/)
})

// A probe that cached forever would keep a recovered database offline until the
// next deploy, and one that never cached would probe on every request.
test('the cache expires on its own', () => {
  assert.match(probe, /const PROBE_TTL_MS = 30_000/)
  assert.match(body, /\(now - cache\.lastChecked\) < PROBE_TTL_MS/)
})
