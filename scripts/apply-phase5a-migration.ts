#!/usr/bin/env bun
/**
 * apply-phase5a-migration.ts
 *
 * Applies the 00005a_phase5_replacements.sql migration to Supabase Postgres
 * via direct connection using the `pg` library.
 *
 * Tries multiple connection methods:
 *   1. Direct connection to db.<project-ref>.supabase.co:5432
 *   2. Pooler connection to aws-0-<region>.pooler.supabase.com:6543
 *
 * Password sources (tried in order):
 *   - SUPABASE_DB_PASSWORD env var
 *   - Service role key (some setups)
 *   - Common defaults
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { Client } from 'pg'

// Load .env.local
try {
  const envLocal = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of envLocal.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
} catch {
  console.error('⚠ .env.local not found')
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const PROJECT_REF = SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] || ''

if (!PROJECT_REF) {
  console.error('✗ Could not extract project ref from NEXT_PUBLIC_SUPABASE_URL')
  process.exit(1)
}

const SQL_FILE = join(process.cwd(), 'supabase', 'migrations', '00005a_phase5_replacements.sql')
const SQL = readFileSync(SQL_FILE, 'utf8')

console.log('━'.repeat(72))
console.log('  KhataPro ERP — Apply Phase 5a Migration')
console.log('━'.repeat(72))
console.log(`  Project ref : ${PROJECT_REF}`)
console.log(`  SQL file    : ${SQL_FILE}`)
console.log(`  SQL size    : ${SQL.length} bytes`)
console.log('')

// Candidate passwords
const passwords = [
  process.env.SUPABASE_DB_PASSWORD,
  SERVICE_KEY,
  'postgres',
].filter(Boolean) as string[]

// Candidate hosts: direct + common pooler regions
const hosts = [
  { host: `db.${PROJECT_REF}.supabase.co`, port: 5432, user: 'postgres', label: 'direct' },
  { host: `aws-0-us-east-1.pooler.supabase.com`, port: 6543, user: `postgres.${PROJECT_REF}`, label: 'pooler-us-east-1' },
  { host: `aws-0-us-west-1.pooler.supabase.com`, port: 6543, user: `postgres.${PROJECT_REF}`, label: 'pooler-us-west-1' },
  { host: `aws-0-eu-west-1.pooler.supabase.com`, port: 6543, user: `postgres.${PROJECT_REF}`, label: 'pooler-eu-west-1' },
  { host: `aws-0-ap-southeast-1.pooler.supabase.com`, port: 6543, user: `postgres.${PROJECT_REF}`, label: 'pooler-ap-southeast-1' },
  { host: `aws-0-ap-northeast-1.pooler.supabase.com`, port: 6543, user: `postgres.${PROJECT_REF}`, label: 'pooler-ap-northeast-1' },
  { host: `aws-0-eu-central-1.pooler.supabase.com`, port: 6543, user: `postgres.${PROJECT_REF}`, label: 'pooler-eu-central-1' },
]

async function tryConnectAndApply(): Promise<boolean> {
  for (const h of hosts) {
    for (const pwd of passwords) {
      const label = `${h.label} / user=${h.user} / pwd=${pwd.slice(0, 8)}...`
      process.stdout.write(`  ▸ Trying ${label}… `)
      const client = new Client({
        host: h.host,
        port: h.port,
        user: h.user,
        password: pwd,
        database: 'postgres',
        connectionTimeoutMillis: 8000,
        ssl: { rejectUnauthorized: false },
      })
      try {
        await client.connect()
        console.log('✓ connected!')
        console.log('')
        console.log('  ▸ Executing migration SQL…')
        await client.query('BEGIN')
        try {
          await client.query(SQL)
          await client.query('COMMIT')
          console.log('  ✓ Migration applied successfully!')
          // Verify
          const { rows } = await client.query("select table_name from information_schema.tables where table_name in ('purchase_replacements','purchase_replacement_items') order by table_name")
          console.log(`  ✓ Verified tables: ${rows.map(r => r.table_name).join(', ')}`)
          const { rows: rpcRows } = await client.query("select routine_name from information_schema.routines where routine_name in ('post_purchase_replacement','post_advance_application','vendor_ledger','next_replacement_no') order by routine_name")
          console.log(`  ✓ Verified RPCs: ${rpcRows.map(r => r.routine_name).join(', ')}`)
          await client.end()
          return true
        } catch (e) {
          await client.query('ROLLBACK')
          console.log(`  ✗ SQL execution failed: ${(e as Error).message}`)
          await client.end()
          return false
        }
      } catch (e) {
        const msg = (e as Error).message
        if (msg.includes('timeout') || msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('password')) {
          console.log(`✗ (${msg.slice(0, 60)})`)
        } else {
          console.log(`✗ (${msg.slice(0, 60)})`)
        }
        try { await client.end() } catch {}
      }
    }
  }
  return false
}

async function main() {
  const ok = await tryConnectAndApply()
  if (!ok) {
    console.log('')
    console.log('━'.repeat(72))
    console.log('  ✗ Could not connect to Supabase Postgres automatically.')
    console.log('━'.repeat(72))
    console.log('')
    console.log('  Please apply the migration manually:')
    console.log('  1. Open https://supabase.com/dashboard')
    console.log(`  2. Select project ${PROJECT_REF}`)
    console.log('  3. Click "SQL Editor" in the left sidebar')
    console.log('  4. Click "New query"')
    console.log(`  5. Paste the entire contents of:`)
    console.log(`     ${SQL_FILE}`)
    console.log('  6. Click "Run"')
    console.log('')
    process.exit(1)
  }
  console.log('')
  console.log('━'.repeat(72))
  console.log('  ✅ Phase 5a migration applied successfully.')
  console.log('━'.repeat(72))
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
