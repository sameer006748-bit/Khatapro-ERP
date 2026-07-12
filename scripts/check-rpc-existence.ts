import { readFileSync } from 'fs'
import { join } from 'path'
try {
  const envLocal = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of envLocal.split('\n')) { const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
} catch { process.exit(1) }
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// Use the REST API to query pg_proc indirectly — we can't query information_schema directly,
// but we can check if the RPC responds to a proper call with the right parameters.
// The 404 from PostgREST means the function is not in the exposed schema cache.
// Let's try calling with different parameter names to see if the function exists but with a different signature.

async function tryRpc(name: string, bodies: any[]) {
  for (const body of bodies) {
    const r = await fetch(`${URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await r.text()
    console.log(`  ${name} with ${JSON.stringify(body).slice(0,80)}: ${r.status} — ${text.slice(0,120)}`)
  }
}

async function main() {
  // post_voucher might need all params
  await tryRpc('post_voucher', [
    { p_business_id: 'biz-default', p_voucher_type: 'JV', p_voucher_date: '2026-07-11', p_memo: 'test', p_lines: '[]' },
  ])
  // create_stock_movement might need p_unit_cost_paisas (new param added by 00006)
  await tryRpc('create_stock_movement', [
    { p_business_id: 'biz-default', p_product_id: '00000000-0000-0000-0000-000000000000', p_movement_type: 'adjustment_in', p_quantity: 1 },
    { p_business_id: 'biz-default', p_product_id: '00000000-0000-0000-0000-000000000000', p_movement_type: 'adjustment_in', p_quantity: 1, p_unit_cost_paisas: '1000' },
  ])
  // next_document_no needs 4 params
  await tryRpc('next_document_no', [
    { p_business_id: 'biz-default', p_prefix: 'PV', p_table: 'payments', p_column: 'payment_no' },
  ])
}
main().catch(e => { console.error(e); process.exit(1) })
