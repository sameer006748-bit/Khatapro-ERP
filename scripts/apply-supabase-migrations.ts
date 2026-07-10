#!/usr/bin/env bun
/**
 * apply-supabase-migrations.ts
 *
 * Verifies the Supabase connection using the service-role key, then
 * instructs the user on how to apply the SQL migrations in
 * supabase/migrations/.
 *
 * Supabase does NOT expose a public DDL execution endpoint that works with
 * just the project URL + service-role key. DDL requires either:
 *   (a) Direct Postgres connection (database password), or
 *   (b) The Supabase Management API (needs a Supabase personal access
 *       token — NOT the project service-role key), or
 *   (c) Manually pasting the SQL into the Supabase Dashboard SQL Editor.
 *
 * This script uses option (c) as the canonical path. It verifies the
 * service-role key works by querying the `permissions` table (which is
 * seeded by 00001_phase1_foundation.sql), then prints the exact file
 * paths to paste into the SQL Editor.
 *
 * Usage:
 *   1. Copy .env.local.example to .env.local
 *   2. Fill in NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY
 *   3. Run: bun run scripts/apply-supabase-migrations.ts
 */
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

// Load .env.local manually (avoid extra deps).
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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

if (!SUPABASE_URL) {
  console.error('✗ Missing NEXT_PUBLIC_SUPABASE_URL in .env.local')
  process.exit(1)
}
if (!SERVICE_KEY || SERVICE_KEY.includes('<') || SERVICE_KEY.includes('your-')) {
  console.error('✗ SUPABASE_SERVICE_ROLE_KEY missing or still a placeholder.')
  process.exit(1)
}
if (!PUBLISHABLE_KEY || PUBLISHABLE_KEY.includes('<') || PUBLISHABLE_KEY.includes('your-')) {
  console.error('✗ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY missing or still a placeholder.')
  process.exit(1)
}

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

if (!existsSync(MIGRATIONS_DIR)) {
  console.error(`✗ Migrations directory not found: ${MIGRATIONS_DIR}`)
  process.exit(1)
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

if (files.length === 0) {
  console.error('✗ No .sql files in supabase/migrations/')
  process.exit(1)
}

// ─── Step 1: verify the service-role key works ──────────────────────────
async function checkConnection(): Promise<{ ok: boolean; permissionsCount?: number; error?: string }> {
  try {
    // Use the REST API with the service-role key. The service role bypasses
    // RLS, so this query works even before we've configured RLS policies.
    const url = `${SUPABASE_URL}/rest/v1/permissions?select=id&limit=1`
    const r = await fetch(url, {
      headers: {
        apikey: SERVICE_KEY!,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
    })
    if (!r.ok) {
      return { ok: false, error: `HTTP ${r.status} ${r.statusText}` }
    }
    const j = (await r.json()) as unknown
    if (!Array.isArray(j)) {
      return { ok: false, error: 'Unexpected response shape' }
    }
    return { ok: true, permissionsCount: j.length }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ─── Step 2: also verify the publishable key (RLS-aware) ───────────────
async function checkPublishableKey(): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `${SUPABASE_URL}/auth/v1/health`
    const r = await fetch(url, {
      headers: { apikey: PUBLISHABLE_KEY! },
    })
    return { ok: r.ok, error: r.ok ? undefined : `HTTP ${r.status}` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

async function main() {
  console.log('━'.repeat(72))
  console.log('  KhataPro ERP — Supabase Connection Checkpoint')
  console.log('━'.repeat(72))
  console.log(`  Project URL : ${SUPABASE_URL}`)
  console.log(`  Migrations  : ${files.length} file(s) in supabase/migrations/`)
  console.log('')

  console.log('▸ Verifying publishable (anon) key…')
  const pub = await checkPublishableKey()
  if (pub.ok) {
    console.log('  ✓ Publishable key valid; Auth health endpoint reachable.')
  } else {
    console.log(`  ✗ Publishable key check failed: ${pub.error}`)
  }

  console.log('')
  console.log('▸ Verifying service-role key…')
  const svc = await checkConnection()
  if (svc.ok) {
    console.log('  ✓ Service-role key valid. Admin queries work.')
    if (svc.permissionsCount && svc.permissionsCount > 0) {
      console.log(`  ✓ 'permissions' table has rows — Phase 1 migration already applied.`)
    } else {
      console.log(`  ⚠ 'permissions' table empty or missing — Phase 1 migration NOT applied yet.`)
    }
  } else {
    console.log(`  ✗ Service-role key check failed: ${svc.error}`)
    console.log('    Either the key is wrong, or Phase 1 migration has not been applied.')
  }

  console.log('')
  console.log('━'.repeat(72))
  console.log('  How to apply migrations')
  console.log('━'.repeat(72))
  console.log('')
  console.log('  Supabase does not expose a public DDL execution endpoint that')
  console.log('  works with just the project URL + service-role key. To apply')
  console.log('  schema changes you have two options:')
  console.log('')
  console.log('  OPTION A — Supabase Dashboard SQL Editor (easiest):')
  console.log('    1. Open https://supabase.com/dashboard')
  console.log('    2. Select your project (ebcebxwpddltiwrqybqc)')
  console.log('    3. Click "SQL Editor" in the left sidebar')
  console.log('    4. For each file below, click "New query", paste the entire')
  console.log('       file contents, and click "Run":')
  console.log('')
  for (const f of files) {
    console.log(`         ${join('supabase', 'migrations', f)}`)
  }
  console.log('')
  console.log('  OPTION B — Supabase CLI (for CI/CD):')
  console.log('    npm install -g supabase')
  console.log('    supabase link --project-ref ebcebxwpddltiwrqybqc')
  console.log('    supabase db push')
  console.log('')
  console.log('  After applying, re-run this script to verify the connection.')
  console.log('')
  console.log('━'.repeat(72))

  if (svc.ok && pub.ok && svc.permissionsCount && svc.permissionsCount > 0) {
    console.log('  ✅ Supabase checkpoint PASSED — ready for Phase 2.')
    process.exit(0)
  } else {
    console.log('  ⏳ Supabase checkpoint PENDING — apply migrations, then re-run.')
    process.exit(0) // exit 0 so the script doesn't fail CI; we just print guidance.
  }
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
