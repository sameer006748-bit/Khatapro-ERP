import { readFileSync } from 'fs'
import { join } from 'path'
try {
  const envLocal = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of envLocal.split('\n')) { const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
} catch { process.exit(1) }
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function checkRpc(name: string, body: any = { p_business_id: 'biz-default' }) {
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, ok: r.status !== 404 }
}

async function main() {
  const rpcs = ['post_payment_voucher', 'post_receipt_voucher', 'post_journal_voucher', 'post_contra_entry', 'post_expense_batch', 'reverse_voucher_safe', 'day_book', 'next_document_no', 'recalculate_product_cost', 'create_stock_movement', 'post_voucher', 'trial_balance', 'account_ledger', 'post_purchase', 'vendor_ledger']
  for (const r of rpcs) {
    const result = await checkRpc(r)
    console.log(`  ${result.ok ? '✓' : '✗'} ${r}(): status=${result.status}`)
  }
  
  // Try NOTIFY pgrst to reload schema
  console.log('\nTrying schema reload via SQL...')
  // We can't run NOTIFY directly via REST, but we can check if the RPCs appear after a moment
  console.log('Note: PostgREST schema cache may need manual reload.')
  console.log('Run this in Supabase SQL Editor: NOTIFY pgrst, \'reload schema\';')
}
main().catch(e => { console.error(e); process.exit(1) })
