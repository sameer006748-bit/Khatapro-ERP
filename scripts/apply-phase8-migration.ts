import { readFileSync } from 'fs'
import { join } from 'path'
import { Client } from 'pg'
try {
  const envLocal = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of envLocal.split('\n')) { const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
} catch { process.exit(1) }
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const REF = URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] || ''
const SQL = readFileSync(join(process.cwd(), 'supabase', 'migrations', '00008_phase8_reports.sql'), 'utf8')
console.log(`Project: ${REF}, SQL: ${SQL.length} bytes`)
async function check() {
  const r = await fetch(`${URL}/rest/v1/rpc/report_profit_loss`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_business_id: 'biz-default', p_from_date: '2026-07-01', p_to_date: '2026-07-31' }) })
  if (r.ok) { console.log('Already applied'); return true }
  return false
}
async function tryApply() {
  const host = `db.${REF}.supabase.co`
  const client = new Client({ host, port: 5432, user: 'postgres', password: KEY, database: 'postgres', connectionTimeoutMillis: 8000, ssl: { rejectUnauthorized: false } } as any)
  try { await client.connect(); console.log('connected'); await client.query('BEGIN'); await client.query(SQL); await client.query('COMMIT'); console.log('✓ Applied'); await client.end(); return true }
  catch (e) { console.log(`✗ ${(e as Error).message.slice(0,80)}`); try { await client.end() } catch {} return false }
}
async function main() { if (await check()) return; await tryApply() || (console.log('\nApply manually: supabase/migrations/00008_phase8_reports.sql'), process.exit(1)) }
main().catch(e => { console.error(e); process.exit(1) })
