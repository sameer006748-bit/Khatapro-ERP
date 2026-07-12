import { readFileSync } from 'fs'
import { join } from 'path'
try {
  const envLocal = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of envLocal.split('\n')) { const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
} catch { process.exit(1) }
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// Call create_stock_movement WITHOUT p_unit_cost_paisas (old signature) vs WITH (new signature)
async function main() {
  // Test 1: Call WITHOUT p_unit_cost_paisas (should use old 7-param version if it exists)
  console.log('Test 1: Call without p_unit_cost_paisas (7 params):')
  const r1 = await fetch(`${URL}/rest/v1/rpc/create_stock_movement`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_business_id: 'biz-default', p_product_id: '00000000-0000-0000-0000-000000000000', p_movement_type: 'adjustment_out', p_quantity: 1 }),
  })
  console.log(`  Status: ${r1.status}, Response: ${(await r1.text()).slice(0, 200)}`)

  // Test 2: Call WITH p_unit_cost_paisas (8 params - new version)
  console.log('\nTest 2: Call with p_unit_cost_paisas (8 params):')
  const r2 = await fetch(`${URL}/rest/v1/rpc/create_stock_movement`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_business_id: 'biz-default', p_product_id: '00000000-0000-0000-0000-000000000000', p_movement_type: 'adjustment_out', p_quantity: 1, p_unit_cost_paisas: '1000' }),
  })
  console.log(`  Status: ${r2.status}, Response: ${(await r2.text()).slice(0, 200)}`)

  // The issue: PostgREST can't resolve overloaded functions by name.
  // If both 7-param and 8-param versions exist, PostgREST returns 300 (Multiple Choices).
  // The migration uses CREATE OR REPLACE which should replace the old version.
  // But if the old version had a DIFFERENT signature, CREATE OR REPLACE creates a NEW function.
  
  console.log('\nDiagnosis: CREATE OR REPLACE with different param count creates overloaded function.')
  console.log('PostgREST cannot resolve overloaded functions — needs DROP + CREATE.')
}
main().catch(e => console.error(e))
