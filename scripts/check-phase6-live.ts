import { readFileSync } from 'fs'
import { join } from 'path'
try {
  const envLocal = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of envLocal.split('\n')) { const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
} catch { console.error('no env'); process.exit(1) }
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
async function check(path: string, label: string) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  console.log(`${label}: ${r.ok ? 'EXISTS' : `MISSING (${r.status})`}`)
}
async function checkRpc(name: string) {
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_business_id: 'biz-default' }) })
  console.log(`${name} RPC: ${r.status !== 404 ? 'EXISTS' : 'MISSING'} (${r.status})`)
}
async function main() {
  await check('expenses?select=id&limit=1', 'expenses table')
  await check('receipts?select=id&limit=1', 'receipts table')
  await check('payments?select=id&limit=1', 'payments table')
  await check('contra_entries?select=id&limit=1', 'contra_entries table')
  await check('products?select=weighted_average_cost&limit=1', 'weighted_average_cost column')
  await checkRpc('post_payment_voucher')
  await checkRpc('post_receipt_voucher')
  await checkRpc('post_journal_voucher')
  await checkRpc('post_contra_entry')
  await checkRpc('post_expense_batch')
  await checkRpc('reverse_voucher_safe')
  await checkRpc('day_book')
  await checkRpc('recalculate_product_cost')
}
main().catch(e => { console.error(e); process.exit(1) })
