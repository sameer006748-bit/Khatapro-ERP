#!/usr/bin/env bun
/**
 * verify-supabase-connection.ts
 *
 * Loads .env.local, verifies the Supabase env vars are present, and tests
 * the connection by:
 *   1. Calling the Auth health endpoint with the publishable key.
 *   2. Querying the `permissions` table with the service-role key (RLS bypass).
 *   3. Attempting a DDL-equivalent operation to see if we can apply migrations.
 *
 * NEVER prints key values — only booleans, counts, and masked prefixes.
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// Load .env.local manually.
const envLocalPath = join(process.cwd(), '.env.local')
if (!existsSync(envLocalPath)) {
  console.error('✗ .env.local not found.')
  process.exit(1)
}
const envLocal = readFileSync(envLocalPath, 'utf8')
for (const line of envLocal.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

function mask(s: string | undefined, visible = 8): string {
  if (!s) return '(unset)'
  if (s.length <= visible) return '*'.repeat(s.length)
  return s.slice(0, visible) + '****'
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY

console.log('━'.repeat(72))
console.log('  Supabase Connection Verification')
console.log('━'.repeat(72))
console.log(`  URL         : ${URL ?? '(unset)'}`)
console.log(`  Publishable : ${mask(PUB)}`)
console.log(`  Service     : ${mask(SVC)}`)
console.log('')

if (!URL || !PUB || !SVC) {
  console.error('✗ One or more Supabase env vars missing.')
  process.exit(1)
}
if (PUB.includes('<') || SVC.includes('<')) {
  console.error('✗ Env vars still contain placeholder text.')
  process.exit(1)
}

// ── Test 1: Auth health (publishable key) ──────────────────────────────
async function testAuthHealth() {
  try {
    const r = await fetch(`${URL}/auth/v1/health`, {
      headers: { apikey: PUB! },
    })
    return { ok: r.ok, status: r.status, body: r.ok ? await r.json() : null }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ── Test 2: Query permissions table (service-role key) ─────────────────
async function testServiceQuery() {
  try {
    const r = await fetch(`${URL}/rest/v1/permissions?select=id&limit=5`, {
      headers: {
        apikey: SVC!,
        Authorization: `Bearer ${SVC}`,
      },
    })
    const body = r.ok ? await r.json() : null
    return {
      ok: r.ok,
      status: r.status,
      rowCount: Array.isArray(body) ? body.length : 0,
      error: r.ok ? null : body,
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ── Test 3: Try to query a Phase 2 table (vouchers) to see if migration ran ─
async function testVouchersTable() {
  try {
    const r = await fetch(`${URL}/rest/v1/vouchers?select=id&limit=1`, {
      headers: {
        apikey: SVC!,
        Authorization: `Bearer ${SVC}`,
      },
    })
    if (r.ok) {
      const body = await r.json()
      return { exists: true, rowCount: Array.isArray(body) ? body.length : 0 }
    }
    // 404 = table doesn't exist (migration not applied)
    return { exists: false, status: r.status }
  } catch (e) {
    return { exists: false, error: (e as Error).message }
  }
}

// ── Test 4: Try to query voucher_lines (Phase 2) ───────────────────────
async function testVoucherLinesTable() {
  try {
    const r = await fetch(`${URL}/rest/v1/voucher_lines?select=id&limit=1`, {
      headers: {
        apikey: SVC!,
        Authorization: `Bearer ${SVC}`,
      },
    })
    if (r.ok) return { exists: true }
    return { exists: false, status: r.status }
  } catch (e) {
    return { exists: false, error: (e as Error).message }
  }
}

// ── Test 5: Try calling post_voucher RPC (should fail gracefully if not created) ─
async function testPostVoucherRpc() {
  try {
    const r = await fetch(`${URL}/rest/v1/rpc/post_voucher`, {
      method: 'POST',
      headers: {
        apikey: SVC!,
        Authorization: `Bearer ${SVC}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_business_id: 'biz-default',
        p_voucher_type: 'JV',
        p_voucher_date: '2026-07-10',
        p_memo: 'connection test',
        p_lines: [],
      }),
    })
    const body = await r.json()
    // If the RPC exists, it should return an error (because lines is empty).
    // If the RPC doesn't exist, PostgREST returns a specific error.
    const rpcExists = !(body?.code === 'PGRST202' || body?.message?.includes('Could not find the function'))
    return { rpcExists, status: r.status, body: JSON.stringify(body).slice(0, 200) }
  } catch (e) {
    return { rpcExists: false, error: (e as Error).message }
  }
}

async function main() {
  console.log('▸ Test 1: Auth health endpoint (publishable key)…')
  const t1 = await testAuthHealth()
  console.log(`  ${t1.ok ? '✓' : '✗'} status=${t1.status} ${t1.ok ? JSON.stringify(t1.body) : ''}`)

  console.log('')
  console.log('▸ Test 2: Query permissions table (service-role key)…')
  const t2 = await testServiceQuery()
  if (t2.ok) {
    console.log(`  ✓ permissions table exists, ${t2.rowCount} rows returned (Phase 1 migration applied).`)
  } else {
    console.log(`  ✗ permissions table query failed (Phase 1 migration NOT applied).`)
    console.log(`    status=${t2.status} error=${JSON.stringify(t2.error)}`)
  }

  console.log('')
  console.log('▸ Test 3: Query vouchers table (Phase 2)…')
  const t3 = await testVouchersTable()
  if (t3.exists) {
    console.log(`  ✓ vouchers table exists (Phase 2 migration applied).`)
  } else {
    console.log(`  ✗ vouchers table NOT found (Phase 2 migration NOT applied).`)
  }

  console.log('')
  console.log('▸ Test 4: Query voucher_lines table (Phase 2)…')
  const t4 = await testVoucherLinesTable()
  if (t4.exists) {
    console.log(`  ✓ voucher_lines table exists.`)
  } else {
    console.log(`  ✗ voucher_lines table NOT found.`)
  }

  console.log('')
  console.log('▸ Test 5: post_voucher() RPC exists?…')
  const t5 = await testPostVoucherRpc()
  if (t5.rpcExists) {
    console.log(`  ✓ post_voucher() RPC exists.`)
  } else {
    console.log(`  ✗ post_voucher() RPC NOT found.`)
  }

  console.log('')
  console.log('━'.repeat(72))
  const phase1Applied = t2.ok && (t2.rowCount ?? 0) > 0
  const phase2Applied = t3.exists && t4.exists && t5.rpcExists
  if (phase1Applied && phase2Applied) {
    console.log('  ✅ Supabase fully live — Phase 1 + Phase 2 migrations applied.')
  } else if (phase1Applied && !phase2Applied) {
    console.log('  ⚠ Phase 1 applied but Phase 2 NOT applied.')
    console.log('    Run supabase/migrations/00002_phase2_accounting.sql in SQL Editor.')
  } else if (!phase1Applied) {
    console.log('  ⚠ Phase 1 NOT applied.')
    console.log('    Run supabase/migrations/00001_phase1_foundation.sql in SQL Editor first,')
    console.log('    then supabase/migrations/00002_phase2_accounting.sql.')
  }
  console.log('━'.repeat(72))
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
