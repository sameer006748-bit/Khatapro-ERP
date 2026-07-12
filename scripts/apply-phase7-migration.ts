import { readFileSync } from 'fs'
import { join } from 'path'
import { Client } from 'pg'
import { lookup } from 'dns/promises'
try {
  const envLocal = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of envLocal.split('\n')) { const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
} catch { process.exit(1) }
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const REF = URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] || ''
const SQL = readFileSync(join(process.cwd(), 'supabase', 'migrations', '00007_phase7_rider_cod.sql'), 'utf8')
console.log(`Project: ${REF}, SQL: ${SQL.length} bytes`)

// Check if already applied
async function check() {
  const r = await fetch(`${URL}/rest/v1/delivery_orders?select=id&limit=1`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  if (r.ok) { console.log('Already applied (delivery_orders table exists)'); return true }
  // Check RPC
  const r2 = await fetch(`${URL}/rest/v1/rpc/mark_order_delivered`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_business_id: 'biz-default', p_delivery_order_id: 'test', p_collected_amount: '0' }) })
  if (r2.status !== 404) { console.log('RPC exists (may already be applied)'); }
  return false
}

async function tryApply() {
  const host = `db.${REF}.supabase.co`
  let ip: string | null = null
  try { const r = await lookup(host, { family: 4 }); ip = r.address } catch {}
  const targets: Array<{host:string;port:number;user:string;pwd:string;label:string}> = []
  if (ip) targets.push({ host: ip, port: 5432, user: 'postgres', pwd: KEY, label: 'direct-ipv4' })
  targets.push({ host, port: 5432, user: 'postgres', pwd: KEY, label: 'direct-host' })
  for (const t of targets) {
    process.stdout.write(`  ▸ ${t.label}… `)
    const client = new Client({ host: t.host, port: t.port, user: t.user, password: t.pwd, database: 'postgres', connectionTimeoutMillis: 8000, ssl: { rejectUnauthorized: false } } as any)
    try {
      await client.connect(); console.log('✓ connected!')
      await client.query('BEGIN'); await client.query(SQL); await client.query('COMMIT')
      console.log('  ✓ Migration applied!')
      const { rows } = await client.query("select table_name from information_schema.tables where table_name in ('riders','delivery_orders','rider_cod_submissions') order by table_name")
      console.log(`  ✓ Tables: ${rows.map(r => r.table_name).join(', ')}`)
      await client.end(); return true
    } catch (e) { console.log(`✗ ${(e as Error).message.slice(0,70)}`); try { await client.end() } catch {} }
  }
  return false
}

async function main() {
  console.log('\nStep 1: Check if already applied…')
  if (await check()) return
  console.log('\nStep 2: Try direct connection…')
  if (await tryApply()) return
  console.log('\n✗ Could not apply automatically.')
  console.log('  Apply manually via Supabase SQL Editor:')
  console.log('  supabase/migrations/00007_phase7_rider_cod.sql')
  process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
