#!/usr/bin/env bun
/**
 * apply-phase6-migration.ts — applies 00006_phase6_vouchers_expenses.sql to Supabase.
 * Tries direct Postgres connection, then reports the file for manual application.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { Client } from 'pg'
import { lookup } from 'dns/promises'

try {
  const envLocal = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of envLocal.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch { console.error('⚠ .env.local not found'); process.exit(1) }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const PROJECT_REF = SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] || ''
const SQL_FILE = join(process.cwd(), 'supabase', 'migrations', '00006_phase6_vouchers_expenses.sql')
const SQL = readFileSync(SQL_FILE, 'utf8')

console.log(`Project: ${PROJECT_REF}`)
console.log(`SQL size: ${SQL.length} bytes`)

// Check if migration already applied (via REST API)
async function checkApplied(): Promise<boolean> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/expenses?select=id&limit=1`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    })
    return r.ok
  } catch { return false }
}

async function checkRpc(name: string): Promise<boolean> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_business_id: 'biz-default' }),
    })
    return r.status !== 404
  } catch { return false }
}

async function tryApplyViaPg(): Promise<boolean> {
  const passwords = [process.env.SUPABASE_DB_PASSWORD, SERVICE_KEY, 'postgres'].filter(Boolean) as string[]
  const directHost = `db.${PROJECT_REF}.supabase.co`

  let directIp: string | null = null
  try {
    const records = await lookup(directHost, { family: 4 })
    directIp = records.address
    console.log(`Direct host → IPv4 ${directIp}`)
  } catch {}

  const targets: Array<{ host: string; port: number; user: string; pwd: string; label: string }> = []
  if (directIp) {
    for (const pwd of passwords) {
      targets.push({ host: directIp, port: 5432, user: 'postgres', pwd, label: `direct-ipv4 pwd=${pwd.slice(0,8)}…` })
    }
  }
  for (const pwd of passwords) {
    targets.push({ host: directHost, port: 5432, user: 'postgres', pwd, label: `direct-host pwd=${pwd.slice(0,8)}…` })
  }

  for (const t of targets) {
    process.stdout.write(`  ▸ ${t.label}… `)
    const client = new Client({
      host: t.host, port: t.port, user: t.user, password: t.pwd,
      database: 'postgres', connectionTimeoutMillis: 6000,
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
      const { rows } = await client.query("select table_name from information_schema.tables where table_name in ('expenses','receipts','payments','contra_entries') order by table_name")
      console.log(`  ✓ Tables: ${rows.map(r => r.table_name).join(', ')}`)
      await client.end()
      return true
    } catch (e) {
      console.log(`✗ ${(e as Error).message.slice(0, 70)}`)
      try { await client.end() } catch {}
    }
  }
  return false
}

async function main() {
  console.log('\nStep 1: Check if migration already applied…')
  const applied = await checkApplied()
  const rpcExists = await checkRpc('post_payment_voucher')
  if (applied && rpcExists) {
    console.log('  ✓ Migration already applied (expenses table + RPC exist). Skipping.')
    return
  }
  console.log(`  expenses table: ${applied}, post_payment_voucher RPC: ${rpcExists}`)

  console.log('\nStep 2: Try direct Postgres connection…')
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
