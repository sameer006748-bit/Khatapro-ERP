// One-off production diagnostic for post_opening_stock.
// - Verifies the connected project ref is EXACTLY ebcebxwpddltiwrqybqc.
// - Reproduces the app's RPC call faithfully (via PostgREST) with a fake
//   product id so NOTHING is mutated (product lookup fails → rollback).
// - Checks accounts 1100 / 3030 presence + active flag for the business.
// Prints only status codes and sanitized error bodies — no secrets, no prices.
import { readFileSync } from 'node:fs'

const ALLOWED_REF = 'ebcebxwpddltiwrqybqc'
const FORBIDDEN_REF = 'wkjavxiviyzfirjnfltg'

const raw = readFileSync(process.env.KP_ENV_FILE, 'utf8').replace(/\r/g, '')
const env = {}
for (const line of raw.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const url = (env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
const key = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const ref = (url.match(/https:\/\/([a-z0-9]+)\.supabase/) || [])[1]
console.log(`url present: ${url.length > 0}, url length: ${url.length}, parsed ref: ${ref ?? '(none)'}`)

if (ref === FORBIDDEN_REF) { console.error('ABORT: forbidden project ref'); process.exit(2) }
if (ref !== ALLOWED_REF) { console.error(`ABORT: unexpected project ref "${ref}"`); process.exit(2) }
console.log(`project ref OK: ${ref}`)

const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

// 1) Is the function reachable? Fake product id → guaranteed rollback, no writes.
const rpcRes = await fetch(`${url}/rest/v1/rpc/post_opening_stock`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    p_business_id: 'biz-default',
    p_product_id: '__diag_nonexistent__',
    p_quantity: 1,
    p_unit_cost_paisas: '1',
    p_created_by: null,
  }),
})
const rpcBody = await rpcRes.text()
console.log(`\n[RPC post_opening_stock] HTTP ${rpcRes.status}`)
console.log(rpcBody.slice(0, 500))

// 2) Do the ledger accounts exist and are active?
const acctRes = await fetch(
  `${url}/rest/v1/accounts?select=code,name,is_active&business_id=eq.biz-default&code=in.(1100,3030)`,
  { headers: H },
)
console.log(`\n[accounts 1100/3030] HTTP ${acctRes.status}`)
console.log((await acctRes.text()).slice(0, 500))

// 3) Confirm the real business id in production (register hardcodes biz-default).
const bizRes = await fetch(`${url}/rest/v1/business?select=id,name&limit=5`, { headers: H })
console.log(`\n[business rows] HTTP ${bizRes.status}`)
console.log((await bizRes.text()).slice(0, 300))
