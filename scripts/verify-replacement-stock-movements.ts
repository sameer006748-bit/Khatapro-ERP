#!/usr/bin/env bun
/**
 * verify-replacement-stock-movements.ts — verifies that replacement items
 * have linked stock_movement_ids for both outgoing and incoming.
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

async function main() {
  // Fetch all replacement items with their stock movement links
  const r = await fetch(`${SUPABASE_URL}/rest/v1/purchase_replacement_items?select=id,outgoing_product_name,outgoing_quantity,outgoing_stock_movement_id,incoming_product_name,incoming_quantity,incoming_stock_movement_id,purchase_replacements(replacement_no)`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  const items = await r.json() as any[]
  console.log(`Found ${items.length} replacement item rows`)
  console.log('')
  let allLinked = true
  for (const it of items) {
    const repNo = it.purchase_replacements?.replacement_no ?? '?'
    const outLinked = !!it.outgoing_stock_movement_id
    const inLinked = !!it.incoming_stock_movement_id
    console.log(`  ${repNo}: ${it.outgoing_product_name} (out ${it.outgoing_qty ?? it.outgoing_quantity}) → ${it.incoming_product_name} (in ${it.incoming_quantity})`)
    console.log(`    outgoing_stock_movement_id: ${it.outgoing_stock_movement_id ?? 'NULL'} ${outLinked ? '✓' : '✗'}`)
    console.log(`    incoming_stock_movement_id: ${it.incoming_stock_movement_id ?? 'NULL'} ${inLinked ? '✓' : '✗'}`)
    if (!outLinked || !inLinked) allLinked = false
  }
  console.log('')
  console.log(allLinked ? '✅ ALL replacement items have linked stock movements' : '❌ Some replacement items missing stock movement links')

  // Also verify the stock movements exist and have correct type
  console.log('')
  console.log('Verifying stock movement types…')
  const smIds = items.flatMap(it => [it.outgoing_stock_movement_id, it.incoming_stock_movement_id]).filter(Boolean) as string[]
  if (smIds.length > 0) {
    const smR = await fetch(`${SUPABASE_URL}/rest/v1/stock_movements?id=in.(${smIds.join(',')})&select=id,movement_type,quantity,reason`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    })
    const sms = await smR.json() as any[]
    for (const sm of sms) {
      console.log(`  ${sm.id.slice(0,8)}: ${sm.movement_type} qty=${sm.quantity} reason="${sm.reason}"`)
    }
    const outCount = sms.filter(s => s.movement_type === 'adjustment_out').length
    const inCount = sms.filter(s => s.movement_type === 'adjustment_in').length
    console.log(`  adjustment_out: ${outCount}, adjustment_in: ${inCount}`)
    if (outCount > 0 && inCount > 0) {
      console.log('✅ Both adjustment_out (defective) and adjustment_in (replacement) movements exist')
    } else {
      console.log('❌ Missing adjustment_out or adjustment_in movements')
    }
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
