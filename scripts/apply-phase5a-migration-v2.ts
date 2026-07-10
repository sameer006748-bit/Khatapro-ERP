#!/usr/bin/env bun
/**
 * apply-phase5a-migration-v2.ts — tries harder to connect.
 * Forces IPv4, tries more regions, and attempts the direct host.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { Client } from 'pg'
import { lookup } from 'dns/promises'

// Load .env.local
try {
  const envLocal = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of envLocal.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
} catch { console.error('⚠ .env.local not found'); process.exit(1) }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const PROJECT_REF = SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] || ''
const SQL_FILE = join(process.cwd(), 'supabase', 'migrations', '00005a_phase5_replacements.sql')
const SQL = readFileSync(SQL_FILE, 'utf8')

console.log(`Project: ${PROJECT_REF}`)

// First, check if the purchase_replacements table already exists (via REST API)
async function checkTableExists(): Promise<boolean> {
  try {
    const url = `${SUPABASE_URL}/rest/v1/purchase_replacements?select=id&limit=1`
    const r = await fetch(url, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    })
    if (r.ok) return true
    // 404 = table doesn't exist; 400/401 = other error
    return false
  } catch { return false }
}

// Try calling vendor_ledger RPC — if it exists, migration was already applied
async function checkRpcExists(name: string): Promise<boolean> {
  try {
    const url = `${SUPABASE_URL}/rest/v1/rpc/${name}`
    const r = await fetch(url, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_business_id: 'biz-default', p_vendor_id: '00000000-0000-0000-0000-000000000000' }),
    })
    // 404 = RPC doesn't exist; any other response (even error) = RPC exists
    return r.status !== 404
  } catch { return false }
}

async function tryApplyViaPg(): Promise<boolean> {
  const passwords = [process.env.SUPABASE_DB_PASSWORD, SERVICE_KEY, 'postgres'].filter(Boolean) as string[]
  
  // Resolve the direct host to get IPv4
  const directHost = `db.${PROJECT_REF}.supabase.co`
  let directIp: string | null = null
  try {
    const records = await lookup(directHost, { family: 4 })
    directIp = records.address
    console.log(`Direct host ${directHost} → IPv4 ${directIp}`)
  } catch (e) {
    console.log(`Could not resolve ${directHost} to IPv4: ${(e as Error).message}`)
  }

  const targets: Array<{ host: string; port: number; user: string; pwd: string; label: string }> = []
  
  // Direct connection (try IPv4 IP if resolved)
  if (directIp) {
    for (const pwd of passwords) {
      targets.push({ host: directIp, port: 5432, user: 'postgres', pwd, label: `direct-ipv4 user=postgres pwd=${pwd.slice(0,8)}…` })
    }
  }
  // Direct by hostname
  for (const pwd of passwords) {
    targets.push({ host: directHost, port: 5432, user: 'postgres', pwd, label: `direct-host user=postgres pwd=${pwd.slice(0,8)}…` })
  }

  // Pooler regions (comprehensive list)
  const regions = [
    'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
    'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-central-2',
    'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
    'ca-central-1', 'sa-east-1', 'af-south-1', 'me-south-1',
  ]
  // Only try pooler if we have a real DB password (service key won't work on pooler)
  if (process.env.SUPABASE_DB_PASSWORD) {
    for (const region of regions) {
      targets.push({
        host: `aws-0-${region}.pooler.supabase.com`,
        port: 6543,
        user: `postgres.${PROJECT_REF}`,
        pwd: process.env.SUPABASE_DB_PASSWORD,
        label: `pooler-${region}`,
      })
    }
  }

  for (const t of targets) {
    process.stdout.write(`  ▸ ${t.label}… `)
    const client = new Client({
      host: t.host, port: t.port, user: t.user, password: t.pwd,
      database: 'postgres',
      connectionTimeoutMillis: 6000,
      ssl: { rejectUnauthorized: false },
    } as any)
    try {
      await client.connect()
      console.log('✓ connected!')
      console.log('  ▸ Executing migration…')
      await client.query('BEGIN')
      await client.query(SQL)
      await client.query('COMMIT')
      console.log('  ✓ Migration applied!')
      const { rows } = await client.query("select table_name from information_schema.tables where table_name like 'purchase_replac%'")
      console.log(`  ✓ Tables: ${rows.map(r => r.table_name).join(', ')}`)
      await client.end()
      return true
    } catch (e) {
      const msg = (e as Error).message.slice(0, 70)
      console.log(`✗ ${msg}`)
      try { await client.end() } catch {}
    }
  }
  return false
}

async function main() {
  console.log('')
  console.log('Step 1: Check if migration already applied (via REST API)...')
  const tableExists = await checkTableExists()
  const rpcExists = await checkRpcExists('vendor_ledger')
  if (tableExists && rpcExists) {
    console.log('  ✓ Migration already applied (table + RPC exist). Skipping.')
    return
  }
  console.log(`  Table exists: ${tableExists}, RPC exists: ${rpcExists}`)

  console.log('')
  console.log('Step 2: Try direct Postgres connection...')
  const ok = await tryApplyViaPg()
  if (ok) return

  console.log('')
  console.log('━'.repeat(72))
  console.log('  ✗ Could not apply migration automatically.')
  console.log('  Please apply manually via Supabase Dashboard SQL Editor:')
  console.log(`    ${SQL_FILE}`)
  console.log('━'.repeat(72))
  process.exit(1)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
