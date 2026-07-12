import { readFileSync } from 'fs'
import { join } from 'path'
try {
  const envLocal = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of envLocal.split('\n')) { const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
} catch { process.exit(1) }
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }

// First verify the overload fix worked
async function checkRpc(name: string, body: any) {
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const text = await r.text()
  return { status: r.status, body: text.slice(0, 200) }
}

async function main() {
  console.log('=== Verify create_stock_movement overload fix ===')
  // Call WITHOUT p_unit_cost_paisas — should now resolve (single function)
  const r1 = await checkRpc('create_stock_movement', {
    p_business_id: 'biz-default', p_product_id: '00000000-0000-0000-0000-000000000000',
    p_movement_type: 'adjustment_in', p_quantity: 1,
  })
  console.log(`Without p_unit_cost_paisas: status=${r1.status}, body=${r1.body}`)
  
  // Call WITH p_unit_cost_paisas
  const r2 = await checkRpc('create_stock_movement', {
    p_business_id: 'biz-default', p_product_id: '00000000-0000-0000-0000-000000000000',
    p_movement_type: 'adjustment_in', p_quantity: 1, p_unit_cost_paisas: '1000',
  })
  console.log(`With p_unit_cost_paisas: status=${r2.status}, body=${r2.body}`)

  // Check post_purchase exists and its behavior
  console.log('\n=== Check post_purchase RPC ===')
  const r3 = await checkRpc('post_purchase', {
    p_business_id: 'biz-default', p_vendor_id: '00000000-0000-0000-0000-000000000000',
    p_purchase_date: '2026-07-11', p_items: '[]', p_payments: '[]',
  })
  console.log(`post_purchase: status=${r3.status}, body=${r3.body}`)

  // Check an existing purchase_item to see the unit_cost format
  console.log('\n=== Check purchase_items.unit_cost format ===')
  const r4 = await fetch(`${URL}/rest/v1/purchase_items?select=id,unit_cost,line_total,quantity&limit=3`, { headers })
  const items = await r4.json() as any[]
  for (const it of items) {
    console.log(`  item ${it.id}: qty=${it.quantity}, unit_cost=${it.unit_cost}, line_total=${it.line_total}, calc=${Number(it.unit_cost) * it.quantity} ${Number(it.unit_cost) * it.quantity === Number(it.line_total) ? '(matches)' : '(MISMATCH)'}`)
  }
  
  // Check an existing stock_movement from a purchase to see if it has unit_cost_paisas
  console.log('\n=== Check stock_movements from purchases ===')
  const r5 = await fetch(`${URL}/rest/v1/stock_movements?movement_type=eq.adjustment_in&reason=like.Purchase%25&select=id,product_id,quantity,unit_cost_paisas,reason&limit=5`, { headers })
  const movements = await r5.json() as any[]
  for (const m of movements) {
    console.log(`  movement ${m.id}: qty=${m.quantity}, unit_cost_paisas=${m.unit_cost_paisas ?? 'NULL'}, reason=${m.reason}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
