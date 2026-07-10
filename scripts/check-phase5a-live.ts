#!/usr/bin/env bun
/**
 * check-phase5a-live.ts — verifies that migration 00005a is applied to Supabase.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

try {
  const envLocal = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of envLocal.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch { console.error('⚠ .env.local not found'); process.exit(1) }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

async function check() {
  // 1. Check purchase_replacements table exists (REST query)
  const r1 = await fetch(`${SUPABASE_URL}/rest/v1/purchase_replacements?select=id&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  console.log(`purchase_replacements table: ${r1.ok ? 'EXISTS ✓' : `MISSING (${r1.status})`}`)

  // 2. Check purchase_replacement_items table
  const r2 = await fetch(`${SUPABASE_URL}/rest/v1/purchase_replacement_items?select=id&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  console.log(`purchase_replacement_items table: ${r2.ok ? 'EXISTS ✓' : `MISSING (${r2.status})`}`)

  // 3. Check vendor_ledger RPC
  const r3 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vendor_ledger`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_business_id: 'biz-default', p_vendor_id: '00000000-0000-0000-0000-000000000000' }),
  })
  console.log(`vendor_ledger RPC: ${r3.status !== 404 ? 'EXISTS ✓' : 'MISSING ✗'} (status ${r3.status})`)

  // 4. Check post_purchase_replacement RPC
  const r4 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/post_purchase_replacement`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_business_id: 'biz-default', p_purchase_id: 'test', p_replacement_items: '[]' }),
  })
  console.log(`post_purchase_replacement RPC: ${r4.status !== 404 ? 'EXISTS ✓' : 'MISSING ✗'} (status ${r4.status})`)

  // 5. Check post_advance_application RPC
  const r5 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/post_advance_application`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_business_id: 'biz-default', p_vendor_id: 'test', p_purchase_id: 'test', p_amount_paisas: '0' }),
  })
  console.log(`post_advance_application RPC: ${r5.status !== 404 ? 'EXISTS ✓' : 'MISSING ✗'} (status ${r5.status})`)

  // 6. Check can_replace_purchases permission exists
  const r6 = await fetch(`${SUPABASE_URL}/rest/v1/permissions?code=eq.can_replace_purchases&select=id`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  const permData = r6.ok ? await r6.json() : []
  console.log(`can_replace_purchases permission: ${Array.isArray(permData) && permData.length > 0 ? 'EXISTS ✓' : 'MISSING ✗'}`)
}

check().catch(e => { console.error('Fatal:', e); process.exit(1) })
