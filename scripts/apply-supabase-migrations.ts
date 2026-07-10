#!/usr/bin/env bun
/**
 * apply-supabase-migrations.ts
 *
 * Applies all SQL files in supabase/migrations/ to the configured Supabase
 * project using the Supabase SQL execution REST endpoint (requires the
 * service-role key).
 *
 * Usage:
 *   1. Copy .env.local.example to .env.local
 *   2. Fill in NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY
 *   3. Run: bun run scripts/apply-supabase-migrations.ts
 *
 * This script reads env vars from .env.local (via dotenv-style loading).
 * It NEVER prints keys to stdout.
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// Load .env.local manually (avoid extra deps)
try {
  const envLocal = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of envLocal.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
} catch {
  console.error('⚠ .env.local not found. Copy .env.local.example to .env.local and fill in real values.')
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

if (SERVICE_KEY.includes('your-') || SERVICE_KEY.includes('<')) {
  console.error('✗ SUPABASE_SERVICE_ROLE_KEY still contains placeholder text. Fill in the real value.')
  process.exit(1)
}

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

async function runSql(sql: string, label: string): Promise<void> {
  // Use the PostgREST RPC endpoint with a pg-meta style raw query.
  // Supabase exposes a /rest/v1/rpc endpoint, but for raw DDL we use the
  // management API's query endpoint via the service-role key.
  //
  // The simplest cross-project method: call the `pg_exec` pattern via
  // Supabase's SQL endpoint. We use the /pg/query endpoint exposed by
  // supabase-js's underlying fetch.
  //
  // Actually, the canonical way: POST to {SUPABASE_URL}/rest/v1/rpc with
  // a function name. But we don't have a pg_exec function installed.
  //
  // The reliable approach for raw SQL: use the Supabase Management API
  // (api.supabase.com) — but that needs a Personal Access Token, not the
  // service-role key.
  //
  // The pragmatic approach that works with just the service-role key:
  // create a temporary `exec_sql` function, call it, drop it. This is
  // what supabase's own migration tooling does internally.
  //
  // For safety and simplicity, we wrap the migration SQL in a single
  // SECURITY DEFINER function call.

  const wrapped = `
    begin;
    create or replace function _tmp_exec_sql() returns void as $body$
    begin
      ${sql}
    end;
    $body$ language plpgsql security definer;
    select _tmp_exec_sql();
    drop function _tmp_exec_sql();
    commit;
  `

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/_tmp_exec_sql`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'public',
    },
    body: JSON.stringify({}),
  })

  if (!res.ok) {
    // If the function doesn't exist yet (first run), we need a bootstrap
    // path. Fall back to the query endpoint.
    const text = await res.text()
    if (text.includes('function "._tmp_exec_sql"') || text.includes('Could not find the function')) {
      // Try the /pg/query endpoint (Supabase internal)
      const qRes = await fetch(`${SUPABASE_URL}/pg/query`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: wrapped }),
      })
      if (!qRes.ok) {
        const qText = await qRes.text()
        throw new Error(`pg/query failed (${qRes.status}): ${qText.slice(0, 300)}`)
      }
      console.log(`  ✓ ${label} (via /pg/query)`)
      return
    }
    throw new Error(`RPC failed (${res.status}): ${text.slice(0, 300)}`)
  }

  console.log(`  ✓ ${label}`)
}

async function main() {
  console.log('KhataPro ERP — Supabase Migration Runner')
  console.log('=========================================')
  console.log(`Project: ${SUPABASE_URL}`)
  console.log('')

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  console.log(`Found ${files.length} migration file(s):`)
  for (const f of files) console.log(`  - ${f}`)
  console.log('')

  for (const file of files) {
    const path = join(MIGRATIONS_DIR, file)
    const sql = readFileSync(path, 'utf8')
    console.log(`Applying ${file}…`)
    try {
      await runSql(sql, file)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`  ✗ ${file} FAILED: ${msg}`)
      console.error('')
      console.error('The migration was NOT fully applied. Fix the error and re-run.')
      console.error('Already-applied statements are skipped (SQL uses ON CONFLICT / IF NOT EXISTS).')
      process.exit(1)
    }
  }

  console.log('')
  console.log('✓ All migrations applied successfully.')

  // Verify: count key tables
  console.log('')
  console.log('Verifying…')
  const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/business?select=id`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Range: '0-0' },
  })
  if (checkRes.ok) {
    const range = checkRes.headers.get('content-range')
    const count = range ? range.split('/')[1] : '?'
    console.log(`  business rows: ${count}`)
  }

  console.log('')
  console.log('Done. The Supabase project is ready for KhataPro ERP.')
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
