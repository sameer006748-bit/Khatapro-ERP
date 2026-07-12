import { readFileSync } from 'fs'
import { join } from 'path'
try {
  const envLocal = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of envLocal.split('\n')) { const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
} catch { console.error('no env'); process.exit(1) }
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function checkTable(name: string) {
  const r = await fetch(`${URL}/rest/v1/${name}?select=id&limit=1`, { headers })
  return r.ok
}
async function checkRpc(name: string, body: any = { p_business_id: 'biz-default' }) {
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.status !== 404
}
async function countRows(table: string) {
  const r = await fetch(`${URL}/rest/v1/${table}?select=id&limit=1000`, { headers })
  if (!r.ok) return -1
  const data = await r.json() as any[]
  return data.length
}
async function checkColumn(table: string, column: string) {
  const r = await fetch(`${URL}/rest/v1/${table}?select=${column}&limit=1`, { headers })
  return r.ok
}

async function main() {
  console.log('━'.repeat(72))
  console.log('  Phase 1–5 Table + Data Verification')
  console.log('━'.repeat(72))

  // Phase 1 tables
  const p1Tables = ['business', 'profiles', 'roles', 'permissions', 'role_permissions', 'accounts', 'account_categories', 'business_accounts', 'audit_logs']
  for (const t of p1Tables) {
    const exists = await checkTable(t)
    const count = exists ? await countRows(t) : -1
    console.log(`  ${exists ? '✓' : '✗'} ${t}: ${exists ? `${count} rows` : 'MISSING'}`)
  }

  console.log('')
  console.log('━'.repeat(72))
  console.log('  Phase 2 Tables')
  console.log('━'.repeat(72))
  const p2Tables = ['vouchers', 'voucher_lines']
  for (const t of p2Tables) {
    const exists = await checkTable(t)
    const count = exists ? await countRows(t) : -1
    console.log(`  ${exists ? '✓' : '✗'} ${t}: ${exists ? `${count} rows` : 'MISSING'}`)
  }
  const tbRpc = await checkRpc('trial_balance')
  const ledgerRpc = await checkRpc('account_ledger')
  console.log(`  ${tbRpc ? '✓' : '✗'} trial_balance RPC`)
  console.log(`  ${ledgerRpc ? '✓' : '✗'} account_ledger RPC`)

  console.log('')
  console.log('━'.repeat(72))
  console.log('  Phase 3 Tables')
  console.log('━'.repeat(72))
  const p3Tables = ['products', 'product_categories', 'stock_movements']
  for (const t of p3Tables) {
    const exists = await checkTable(t)
    const count = exists ? await countRows(t) : -1
    console.log(`  ${exists ? '✓' : '✗'} ${t}: ${exists ? `${count} rows` : 'MISSING'}`)
  }

  console.log('')
  console.log('━'.repeat(72))
  console.log('  Phase 4 Tables')
  console.log('━'.repeat(72))
  const p4Tables = ['invoices', 'invoice_items', 'payment_allocations', 'salesmen', 'sales_returns', 'salesman_commissions']
  for (const t of p4Tables) {
    const exists = await checkTable(t)
    const count = exists ? await countRows(t) : -1
    console.log(`  ${exists ? '✓' : '✗'} ${t}: ${exists ? `${count} rows` : 'MISSING'}`)
  }

  console.log('')
  console.log('━'.repeat(72))
  console.log('  Phase 5 Tables')
  console.log('━'.repeat(72))
  const p5Tables = ['vendors', 'purchases', 'purchase_items', 'purchase_payments', 'purchase_returns', 'purchase_return_items', 'purchase_replacements', 'purchase_replacement_items']
  for (const t of p5Tables) {
    const exists = await checkTable(t)
    const count = exists ? await countRows(t) : -1
    console.log(`  ${exists ? '✓' : '✗'} ${t}: ${exists ? `${count} rows` : 'MISSING'}`)
  }
  const p5Rpcs = ['post_purchase', 'post_vendor_payment', 'post_vendor_advance', 'post_purchase_return', 'post_purchase_replacement', 'post_advance_application', 'vendor_ledger']
  for (const r of p5Rpcs) {
    const exists = await checkRpc(r)
    console.log(`  ${exists ? '✓' : '✗'} ${r}() RPC`)
  }

  console.log('')
  console.log('━'.repeat(72))
  console.log('  Phase 6 Migration 00006 Status')
  console.log('━'.repeat(72))

  // Check Phase 6 tables
  const p6Tables = ['expenses', 'expense_lines', 'receipts', 'payments', 'contra_entries']
  let p6TablesExist = true
  for (const t of p6Tables) {
    const exists = await checkTable(t)
    if (!exists) p6TablesExist = false
    console.log(`  ${exists ? '✓' : '✗'} ${t}: ${exists ? 'EXISTS' : 'MISSING'}`)
  }

  // Check Phase 6 RPCs
  const p6Rpcs = ['post_payment_voucher', 'post_receipt_voucher', 'post_journal_voucher', 'post_contra_entry', 'post_expense_batch', 'reverse_voucher_safe', 'day_book', 'next_document_no']
  let p6RpcsExist = true
  for (const r of p6Rpcs) {
    const exists = await checkRpc(r)
    if (!exists) p6RpcsExist = false
    console.log(`  ${exists ? '✓' : '✗'} ${r}() RPC`)
  }

  // Check Phase 5 WAC columns (added by 00006)
  const wacCol = await checkColumn('products', 'weighted_average_cost')
  const latestCostCol = await checkColumn('products', 'latest_purchase_cost')
  const smCostCol = await checkColumn('stock_movements', 'unit_cost_paisas')
  console.log(`  ${wacCol ? '✓' : '✗'} products.weighted_average_cost column`)
  console.log(`  ${latestCostCol ? '✓' : '✗'} products.latest_purchase_cost column`)
  console.log(`  ${smCostCol ? '✓' : '✗'} stock_movements.unit_cost_paisas column`)

  // Check Phase 6 permissions
  const permR = await fetch(`${URL}/rest/v1/permissions?code=in.(can_view_day_book,can_create_payment_voucher,can_create_receipt_voucher,can_create_journal_voucher,can_create_contra,can_manage_petty_cash,can_create_expense_batch,can_reverse_voucher,can_replace_purchases)&select=code`, { headers })
  const permData = await permR.json() as any[]
  console.log(`  Phase 6 permissions in catalog: ${permData?.length ?? 0} / 9`)

  console.log('')
  console.log('━'.repeat(72))
  if (p6TablesExist && p6RpcsExist && wacCol) {
    console.log('  ✅ Migration 00006 IS APPLIED — Phase 6 is live')
  } else {
    console.log('  ❌ Migration 00006 is NOT APPLIED — Phase 6 tables/RPCs missing')
    console.log('')
    console.log('  Action required: Apply migration file in Supabase SQL Editor:')
    console.log('    supabase/migrations/00006_phase6_vouchers_expenses.sql')
  }
  console.log('━'.repeat(72))
}
main().catch(e => { console.error('Fatal:', e); process.exit(1) })
