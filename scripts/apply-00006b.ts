import { readFileSync } from 'fs'
import { join } from 'path'
import { Client } from 'pg'
import { lookup } from 'dns/promises'

try {
  const envLocal = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of envLocal.split('\n')) { const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
} catch { process.exit(1) }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const PROJECT_REF = SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] || ''
const SQL = readFileSync(join(process.cwd(), 'supabase', 'migrations', '00006b_fix_purchase_wac.sql'), 'utf8')

console.log(`Project: ${PROJECT_REF}, SQL: ${SQL.length} bytes`)

async function tryApply(): Promise<boolean> {
  const directHost = `db.${PROJECT_REF}.supabase.co`
  let directIp: string | null = null
  try { const r = await lookup(directHost, { family: 4 }); directIp = r.address; console.log(`IPv4: ${directIp}`) } catch {}

  const targets: Array<{ host: string; port: number; user: string; pwd: string; label: string }> = []
  if (directIp) targets.push({ host: directIp, port: 5432, user: 'postgres', pwd: SERVICE_KEY, label: 'direct-ipv4' })
  targets.push({ host: directHost, port: 5432, user: 'postgres', pwd: SERVICE_KEY, label: 'direct-host' })

  for (const t of targets) {
    process.stdout.write(`  ▸ ${t.label}… `)
    const client = new Client({ host: t.host, port: t.port, user: t.user, password: t.pwd, database: 'postgres', connectionTimeoutMillis: 8000, ssl: { rejectUnauthorized: false } } as any)
    try {
      await client.connect()
      console.log('✓ connected!')
      await client.query('BEGIN')
      await client.query(SQL)
      await client.query('COMMIT')
      console.log('  ✓ Migration applied!')
      // Verify
      const { rows } = await client.query("select proname, pronargs from pg_proc where proname in ('post_purchase', 'post_purchase_replacement') and pronamespace = 'public'::regnamespace")
      console.log(`  ✓ Functions: ${rows.map(r => `${r.proname}(${r.pronargs} params)`).join(', ')}`)
      await client.end()
      return true
    } catch (e) { console.log(`✗ ${(e as Error).message.slice(0, 70)}`); try { await client.end() } catch {} }
  }
  return false
}

async function main() {
  const ok = await tryApply()
  if (!ok) { console.log('\n✗ Could not apply automatically. Apply manually via Supabase SQL Editor:'); console.log('  supabase/migrations/00006b_fix_purchase_wac.sql'); process.exit(1) }
}
main().catch(e => { console.error(e); process.exit(1) })
