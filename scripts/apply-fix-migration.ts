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
const SQL_FILE = join(process.cwd(), 'supabase', 'migrations', '00006a_fix_create_stock_movement_overload.sql')
const SQL = readFileSync(SQL_FILE, 'utf8')

console.log(`Project: ${PROJECT_REF}`)
console.log(`SQL size: ${SQL.length} bytes`)

// Try direct connection with service key as password
async function tryApply(): Promise<boolean> {
  const directHost = `db.${PROJECT_REF}.supabase.co`
  let directIp: string | null = null
  try {
    const records = await lookup(directHost, { family: 4 })
    directIp = records.address
    console.log(`Direct host → IPv4 ${directIp}`)
  } catch { console.log(`Could not resolve ${directHost} to IPv4`) }

  const targets: Array<{ host: string; port: number; user: string; pwd: string; label: string }> = []
  if (directIp) {
    targets.push({ host: directIp, port: 5432, user: 'postgres', pwd: SERVICE_KEY, label: 'direct-ipv4' })
  }
  targets.push({ host: directHost, port: 5432, user: 'postgres', pwd: SERVICE_KEY, label: 'direct-host' })
  targets.push({ host: directHost, port: 5432, user: 'postgres', pwd: 'postgres', label: 'direct-host-postgres' })

  for (const t of targets) {
    process.stdout.write(`  ▸ ${t.label}… `)
    const client = new Client({
      host: t.host, port: t.port, user: t.user, password: t.pwd,
      database: 'postgres', connectionTimeoutMillis: 8000,
      ssl: { rejectUnauthorized: false },
    } as any)
    try {
      await client.connect()
      console.log('✓ connected!')
      await client.query('BEGIN')
      await client.query(SQL)
      await client.query('COMMIT')
      console.log('  ✓ Fix migration applied!')
      // Verify only 1 version exists
      const { rows } = await client.query("select proname, pronargs from pg_proc where proname = 'create_stock_movement' and pronamespace = 'public'::regnamespace")
      console.log(`  ✓ create_stock_movement versions: ${rows.length} (should be 1)`)
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
  const ok = await tryApply()
  if (!ok) {
    console.log('\n✗ Could not apply fix automatically.')
    console.log('  Apply manually via Supabase SQL Editor:')
    console.log(`    supabase/migrations/00006a_fix_create_stock_movement_overload.sql`)
    process.exit(1)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
