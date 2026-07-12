import { readFileSync } from 'fs'
import { join } from 'path'
try {
  const envLocal = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of envLocal.split('\n')) { const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
} catch { process.exit(1) }
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function checkTable(name: string) {
  const r = await fetch(`${URL}/rest/v1/${name}?select=id&limit=1`, { headers })
  return r.ok
}
async function checkRpc(name: string, body: any) {
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.status !== 404
}

async function main() {
  console.log('━'.repeat(60))
  console.log('  Phase 7 Migration Verification')
  console.log('━'.repeat(60))
  const tables = ['riders', 'delivery_orders', 'delivery_status_events', 'rider_cod_submissions', 'rider_cod_submission_items']
  let allOk = true
  for (const t of tables) { const ok = await checkTable(t); if (!ok) allOk = false; console.log(`  ${ok ? '✓' : '✗'} ${t}`) }
  
  const rpcs: Array<[string, any]> = [
    ['assign_rider_to_order', { p_business_id: 'biz-default', p_delivery_order_id: 'test', p_rider_id: 'test' }],
    ['update_delivery_status', { p_business_id: 'biz-default', p_delivery_order_id: 'test', p_new_status: 'out_for_delivery' }],
    ['mark_order_delivered', { p_business_id: 'biz-default', p_delivery_order_id: 'test', p_collected_amount: '0' }],
    ['mark_order_returned', { p_business_id: 'biz-default', p_delivery_order_id: 'test' }],
    ['create_cod_submission', { p_business_id: 'biz-default', p_rider_id: 'test', p_items: '[]', p_settlement_mode: 'full', p_requested_amount: '0' }],
    ['confirm_cod_submission', { p_business_id: 'biz-default', p_submission_id: 'test', p_confirmed_cash_amount: '0', p_received_into_account_id: 'test' }],
    ['rider_ledger', { p_business_id: 'biz-default', p_rider_id: 'test' }],
    ['rider_dashboard_summary', { p_business_id: 'biz-default', p_rider_id: 'test' }],
    ['next_cod_submission_no', { p_business_id: 'biz-default' }],
  ]
  for (const [name, body] of rpcs) { const ok = await checkRpc(name, body); if (!ok) allOk = false; console.log(`  ${ok ? '✓' : '✗'} ${name}() RPC`) }
  
  // Check CoA accounts
  for (const code of ['1310', '4030', '2020']) {
    const r = await fetch(`${URL}/rest/v1/accounts?code=eq.${code}&select=id`, { headers })
    const data = await r.json() as any[]
    const ok = data && data.length > 0
    if (!ok) allOk = false
    console.log(`  ${ok ? '✓' : '✗'} Account ${code}`)
  }
  
  console.log('')
  console.log(allOk ? '  ✅ Phase 7 migration FULLY APPLIED' : '  ❌ Some Phase 7 objects missing')
}
main().catch(e => { console.error(e); process.exit(1) })
