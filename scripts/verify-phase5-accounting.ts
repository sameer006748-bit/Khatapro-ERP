#!/usr/bin/env bun
/**
 * verify-phase5-accounting.ts
 *
 * Verifies the accounting correctness of ALL purchase payment modes by
 * posting real transactions through the API and checking the trial balance.
 *
 * Modes tested:
 *   1. Cash purchase (Rs 10,000)
 *   2. Credit purchase (Rs 10,000)
 *   3. Partial purchase (Rs 10,000 / paid Rs 4,000)
 *   4. Split purchase (Rs 20,000: Cash 5,000 + Bank 7,000 + Credit 8,000)
 *   5. Vendor advance (Rs 5,000)
 *   6. Advance application against purchase
 *   7. Purchase return
 *   8. Replacement (equal value)
 *   9. Replacement (value difference)
 */
import { readFileSync } from 'fs'
import { join } from 'path'

// Load .env.local
try {
  const envLocal = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of envLocal.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch { console.error('⚠ .env.local not found'); process.exit(1) }

const BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000'
let cookie = ''

async function login(email: string, password: string) {
  // If SESSION_COOKIE env var is set, use it directly (from browser session)
  if (process.env.SESSION_COOKIE) {
    cookie = process.env.SESSION_COOKIE
    const me = await fetch(`${BASE}/api/me`, { headers: { cookie } })
    const meJ = await me.json() as any
    if (meJ.user) return meJ.user
    throw new Error(`SESSION_COOKIE login failed for ${email}`)
  }

  // 1. Get CSRF token
  const csrfR = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie } })
  const csrfJ = await csrfR.json() as any
  const csrfToken = csrfJ.csrfToken
  cookie = (csrfR.headers.get('set-cookie') || '').split(';')[0] || cookie

  // 2. Login with credentials
  const r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({
      email, password, csrfToken, callbackUrl: '/', json: 'true',
    }).toString(),
    redirect: 'manual',
  })
  // Collect all set-cookie headers
  const setCookies = r.headers.get('set-cookie') || ''
  if (setCookies) {
    const sessionCookie = setCookies.split(';')[0]
    cookie = cookie ? `${cookie}; ${sessionCookie}` : sessionCookie
  }

  // 3. Verify with /api/me
  const me = await fetch(`${BASE}/api/me`, { headers: { cookie } })
  const meJ = await me.json() as any
  if (!meJ.user) throw new Error(`Login failed for ${email}`)
  return meJ.user
}

async function api(path: string, method = 'GET', body?: any) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json() as any
  return { ok: r.ok, status: r.status, json: j }
}

async function getTrialBalance() {
  const r = await api('/api/trial-balance')
  return r.json?.rows ?? []
}

function findAccount(rows: any[], code: string) {
  return rows.find((r: any) => r.accountCode === code)
}

async function main() {
  console.log('━'.repeat(72))
  console.log('  KhataPro ERP — Phase 5 Accounting Verification')
  console.log('━'.repeat(72))

  // Login as owner
  console.log('\n▸ Logging in as owner@test.local…')
  const user = await login('owner@test.local', 'password123')
  console.log(`  ✓ Logged in: ${user.displayName} (${user.roleName})`)

  // Get COA accounts (need Cash, Bank, Vendor Payable, Purchases account IDs)
  console.log('\n▸ Fetching Chart of Accounts…')
  const coaR = await api('/api/setup/coa')
  const accounts = (coaR.json?.categories ?? []).flatMap((c: any) => c.accounts)
    .filter((a: any) => a.isBusinessAccount && a.isActive)
  const cashAcct = accounts.find((a: any) => a.code === '1010')
  const bankAcct = accounts.find((a: any) => a.code === '1030')
  console.log(`  ✓ Cash: ${cashAcct?.id}, Bank: ${bankAcct?.id}`)

  // Get vendors
  console.log('\n▸ Fetching vendors…')
  const vendorsR = await api('/api/vendors')
  const vendors = vendorsR.json?.rows ?? []
  if (vendors.length === 0) throw new Error('No vendors found')
  const vendor = vendors[0]
  console.log(`  ✓ Using vendor: ${vendor.name} (${vendor.id})`)

  // Get products
  console.log('\n▸ Fetching products…')
  const productsR = await api('/api/products')
  const products = productsR.json?.rows ?? []
  if (products.length === 0) throw new Error('No products found')
  const product = products[0]
  console.log(`  ✓ Using product: ${product.name} (${product.id})`)

  // ─── 1. CASH PURCHASE (Rs 10,000 = 1,000,000 paisas) ───
  console.log('\n━'.repeat(40))
  console.log('  TEST 1: Cash Purchase Rs 10,000')
  console.log('━'.repeat(40))
  console.log('  Expected: Debit Purchases 1,000,000, Credit Cash 1,000,000')
  const tbBefore = await getTrialBalance()
  const purchasesBefore = findAccount(tbBefore, '5010')
  const cashBefore = findAccount(tbBefore, '1010')
  const cashPurR = await api('/api/purchases', 'POST', {
    vendorId: vendor.id,
    purchaseDate: new Date().toISOString().slice(0, 10),
    items: [{ productId: product.id, productName: product.name, quantity: 10, unitCostPaisas: '100000' }],
    payments: [{ accountId: cashAcct.id, amountPaisas: '1000000', paymentType: 'purchase_payment' }],
  })
  if (!cashPurR.ok) throw new Error(`Cash purchase failed: ${JSON.stringify(cashPurR.json)}`)
  console.log(`  ✓ Purchase posted: ${cashPurR.json.purchaseNo}`)
  const tbAfter1 = await getTrialBalance()
  const purchasesAfter1 = findAccount(tbAfter1, '5010')
  const cashAfter1 = findAccount(tbAfter1, '1010')
  const purchasesDelta1 = BigInt(purchasesAfter1.balance) - BigInt(purchasesBefore.balance)
  const cashDelta1 = BigInt(cashAfter1.balance) - BigInt(cashBefore.balance)
  console.log(`  Purchases balance delta: ${purchasesDelta1} (expected: +1,000,000 debit)`)
  console.log(`  Cash balance delta: ${cashDelta1} (expected: -1,000,000 credit)`)
  if (purchasesDelta1 === 1000000n && cashDelta1 === -1000000n) {
    console.log('  ✅ PASS: Cash purchase accounting correct')
  } else {
    console.log('  ❌ FAIL: Cash purchase accounting incorrect')
  }
  await new Promise(r => setTimeout(r, 500))

  // ─── 2. CREDIT PURCHASE (Rs 10,000) ───
  console.log('\n━'.repeat(40))
  console.log('  TEST 2: Credit Purchase Rs 10,000')
  console.log('━'.repeat(40))
  console.log('  Expected: Debit Purchases 1,000,000, Credit Vendor Payable 1,000,000')
  const tbBefore2 = await getTrialBalance()
  const purchasesBefore2 = findAccount(tbBefore2, '5010')
  const payableBefore2 = findAccount(tbBefore2, '2010')
  const creditPurR = await api('/api/purchases', 'POST', {
    vendorId: vendor.id,
    purchaseDate: new Date().toISOString().slice(0, 10),
    items: [{ productId: product.id, productName: product.name, quantity: 10, unitCostPaisas: '100000' }],
    payments: [{ accountId: '', amountPaisas: '', paymentType: 'credit' }],
  })
  if (!creditPurR.ok) throw new Error(`Credit purchase failed: ${JSON.stringify(creditPurR.json)}`)
  console.log(`  ✓ Purchase posted: ${creditPurR.json.purchaseNo}`)
  const creditPurId = creditPurR.json.purchaseId
  const tbAfter2 = await getTrialBalance()
  const purchasesAfter2 = findAccount(tbAfter2, '5010')
  const payableAfter2 = findAccount(tbAfter2, '2010')
  const purchasesDelta2 = BigInt(purchasesAfter2.balance) - BigInt(purchasesBefore2.balance)
  const payableDelta2 = BigInt(payableAfter2.balance) - BigInt(payableBefore2.balance)
  console.log(`  Purchases balance delta: ${purchasesDelta2} (expected: +1,000,000)`)
  console.log(`  Vendor Payable balance delta: ${payableDelta2} (expected: -1,000,000 credit)`)
  if (purchasesDelta2 === 1000000n && payableDelta2 === -1000000n) {
    console.log('  ✅ PASS: Credit purchase accounting correct')
  } else {
    console.log('  ❌ FAIL: Credit purchase accounting incorrect')
  }
  await new Promise(r => setTimeout(r, 500))

  // ─── 3. PARTIAL PURCHASE (Rs 10,000 / paid Rs 4,000) ───
  console.log('\n━'.repeat(40))
  console.log('  TEST 3: Partial Purchase Rs 10,000 / paid Rs 4,000')
  console.log('━'.repeat(40))
  console.log('  Expected: Debit Purchases 1,000,000, Credit Cash 400,000, Credit Payable 600,000')
  const tbBefore3 = await getTrialBalance()
  const cashBefore3 = findAccount(tbBefore3, '1010')
  const payableBefore3 = findAccount(tbBefore3, '2010')
  const purchasesBefore3 = findAccount(tbBefore3, '5010')
  const partialPurR = await api('/api/purchases', 'POST', {
    vendorId: vendor.id,
    purchaseDate: new Date().toISOString().slice(0, 10),
    items: [{ productId: product.id, productName: product.name, quantity: 10, unitCostPaisas: '100000' }],
    payments: [
      { accountId: cashAcct.id, amountPaisas: '400000', paymentType: 'purchase_payment' },
      { accountId: '', amountPaisas: '', paymentType: 'credit' },
    ],
  })
  if (!partialPurR.ok) throw new Error(`Partial purchase failed: ${JSON.stringify(partialPurR.json)}`)
  console.log(`  ✓ Purchase posted: ${partialPurR.json.purchaseNo}`)
  const partialPurId = partialPurR.json.purchaseId
  const tbAfter3 = await getTrialBalance()
  const cashAfter3 = findAccount(tbAfter3, '1010')
  const payableAfter3 = findAccount(tbAfter3, '2010')
  const purchasesAfter3 = findAccount(tbAfter3, '5010')
  const cashDelta3 = BigInt(cashAfter3.balance) - BigInt(cashBefore3.balance)
  const payableDelta3 = BigInt(payableAfter3.balance) - BigInt(payableBefore3.balance)
  const purchasesDelta3 = BigInt(purchasesAfter3.balance) - BigInt(purchasesBefore3.balance)
  console.log(`  Purchases delta: ${purchasesDelta3} (expected: +1,000,000)`)
  console.log(`  Cash delta: ${cashDelta3} (expected: -400,000)`)
  console.log(`  Payable delta: ${payableDelta3} (expected: -600,000)`)
  if (purchasesDelta3 === 1000000n && cashDelta3 === -400000n && payableDelta3 === -600000n) {
    console.log('  ✅ PASS: Partial purchase accounting correct')
  } else {
    console.log('  ❌ FAIL: Partial purchase accounting incorrect')
  }
  await new Promise(r => setTimeout(r, 500))

  // ─── 4. SPLIT PURCHASE (Rs 20,000: Cash 5,000 + Bank 7,000 + Credit 8,000) ───
  console.log('\n━'.repeat(40))
  console.log('  TEST 4: Split Purchase Rs 20,000 (Cash 5k + Bank 7k + Credit 8k)')
  console.log('━'.repeat(40))
  console.log('  Expected: Debit Purchases 2,000,000, Credit Cash 500,000, Credit Bank 700,000, Credit Payable 800,000')
  const tbBefore4 = await getTrialBalance()
  const cashBefore4 = findAccount(tbBefore4, '1010')
  const bankBefore4 = findAccount(tbBefore4, '1030')
  const payableBefore4 = findAccount(tbBefore4, '2010')
  const purchasesBefore4 = findAccount(tbBefore4, '5010')
  const splitPurR = await api('/api/purchases', 'POST', {
    vendorId: vendor.id,
    purchaseDate: new Date().toISOString().slice(0, 10),
    items: [{ productId: product.id, productName: product.name, quantity: 20, unitCostPaisas: '100000' }],
    payments: [
      { accountId: cashAcct.id, amountPaisas: '500000', paymentType: 'purchase_payment' },
      { accountId: bankAcct.id, amountPaisas: '700000', paymentType: 'purchase_payment' },
      { accountId: '', amountPaisas: '', paymentType: 'credit' },
    ],
  })
  if (!splitPurR.ok) throw new Error(`Split purchase failed: ${JSON.stringify(splitPurR.json)}`)
  console.log(`  ✓ Purchase posted: ${splitPurR.json.purchaseNo}`)
  const splitPurId = splitPurR.json.purchaseId
  const tbAfter4 = await getTrialBalance()
  const cashAfter4 = findAccount(tbAfter4, '1010')
  const bankAfter4 = findAccount(tbAfter4, '1030')
  const payableAfter4 = findAccount(tbAfter4, '2010')
  const purchasesAfter4 = findAccount(tbAfter4, '5010')
  const cashDelta4 = BigInt(cashAfter4.balance) - BigInt(cashBefore4.balance)
  const bankDelta4 = BigInt(bankAfter4.balance) - BigInt(bankBefore4.balance)
  const payableDelta4 = BigInt(payableAfter4.balance) - BigInt(payableBefore4.balance)
  const purchasesDelta4 = BigInt(purchasesAfter4.balance) - BigInt(purchasesBefore4.balance)
  console.log(`  Purchases delta: ${purchasesDelta4} (expected: +2,000,000)`)
  console.log(`  Cash delta: ${cashDelta4} (expected: -500,000)`)
  console.log(`  Bank delta: ${bankDelta4} (expected: -700,000)`)
  console.log(`  Payable delta: ${payableDelta4} (expected: -800,000)`)
  if (purchasesDelta4 === 2000000n && cashDelta4 === -500000n && bankDelta4 === -700000n && payableDelta4 === -800000n) {
    console.log('  ✅ PASS: Split purchase accounting correct')
  } else {
    console.log('  ❌ FAIL: Split purchase accounting incorrect')
  }
  await new Promise(r => setTimeout(r, 500))

  // ─── 5. VENDOR ADVANCE (Rs 5,000) ───
  console.log('\n━'.repeat(40))
  console.log('  TEST 5: Vendor Advance Rs 5,000')
  console.log('━'.repeat(40))
  console.log('  Expected: Debit Vendor Payable 500,000, Credit Cash 500,000')
  const tbBefore5 = await getTrialBalance()
  const cashBefore5 = findAccount(tbBefore5, '1010')
  const payableBefore5 = findAccount(tbBefore5, '2010')
  const advanceR = await api('/api/vendor-advance', 'POST', {
    vendorId: vendor.id,
    accountId: cashAcct.id,
    amountPaisas: '500000',
    notes: 'Test advance',
  })
  if (!advanceR.ok) throw new Error(`Vendor advance failed: ${JSON.stringify(advanceR.json)}`)
  console.log(`  ✓ Advance posted: ${advanceR.json.paymentId}`)
  const tbAfter5 = await getTrialBalance()
  const cashAfter5 = findAccount(tbAfter5, '1010')
  const payableAfter5 = findAccount(tbAfter5, '2010')
  const cashDelta5 = BigInt(cashAfter5.balance) - BigInt(cashBefore5.balance)
  const payableDelta5 = BigInt(payableAfter5.balance) - BigInt(payableBefore5.balance)
  console.log(`  Cash delta: ${cashDelta5} (expected: -500,000)`)
  console.log(`  Payable delta: ${payableDelta5} (expected: +500,000 debit on payable)`)
  if (cashDelta5 === -500000n && payableDelta5 === 500000n) {
    console.log('  ✅ PASS: Vendor advance accounting correct')
  } else {
    console.log('  ❌ FAIL: Vendor advance accounting incorrect')
  }
  await new Promise(r => setTimeout(r, 500))

  // ─── 6. ADVANCE APPLICATION against credit purchase ───
  console.log('\n━'.repeat(40))
  console.log('  TEST 6: Advance Application against credit purchase')
  console.log('━'.repeat(40))
  console.log('  Expected: Debit Payable, Credit Payable (no net change on 2010)')
  console.log('  Purchase outstanding should reduce by advance amount')
  // Use the credit purchase (creditPurId) which has Rs 10,000 outstanding
  const purDetailR = await api(`/api/purchases/${creditPurId}`)
  const outstandingBefore = BigInt(purDetailR.json?.purchase?.outstandingAmount ?? '0')
  console.log(`  Purchase ${creditPurR.json.purchaseNo} outstanding before: ${outstandingBefore}`)
  const applyR = await api(`/api/purchases/${creditPurId}/apply-advance`, 'POST', {
    vendorId: vendor.id,
    amountPaisas: '300000', // Apply Rs 3,000 from advance
    notes: 'Test advance application',
  })
  if (!applyR.ok) throw new Error(`Advance application failed: ${JSON.stringify(applyR.json)}`)
  console.log(`  ✓ Advance applied: ${applyR.json.paymentId}`)
  const purDetailR2 = await api(`/api/purchases/${creditPurId}`)
  const outstandingAfter = BigInt(purDetailR2.json?.purchase?.outstandingAmount ?? '0')
  console.log(`  Purchase outstanding after: ${outstandingAfter} (expected: ${outstandingBefore - 300000n})`)
  if (outstandingAfter === outstandingBefore - 300000n) {
    console.log('  ✅ PASS: Advance application reduced outstanding correctly')
  } else {
    console.log('  ❌ FAIL: Advance application outstanding mismatch')
  }
  await new Promise(r => setTimeout(r, 500))

  // ─── 7. PURCHASE RETURN ───
  console.log('\n━'.repeat(40))
  console.log('  TEST 7: Purchase Return (reduce payable)')
  console.log('━'.repeat(40))
  console.log('  Expected: Credit Purchases, Debit Vendor Payable')
  // Use the partial purchase which still has outstanding
  const tbBefore7 = await getTrialBalance()
  const payableBefore7 = findAccount(tbBefore7, '2010')
  const purchasesBefore7 = findAccount(tbBefore7, '5010')
  const partialDetailR = await api(`/api/purchases/${partialPurId}`)
  const partialItems = partialDetailR.json?.purchase?.items ?? []
  if (partialItems.length === 0) throw new Error('No items in partial purchase')
  const returnR = await api(`/api/purchases/${partialPurId}/return`, 'POST', {
    returnItems: [{ purchaseItemId: partialItems[0].id, productId: partialItems[0].productId, productName: partialItems[0].productName, quantity: 1, unitCostPaisas: partialItems[0].unitCost }],
    settlementType: 'reduce_payable',
    notes: 'Test return',
  })
  if (!returnR.ok) throw new Error(`Purchase return failed: ${JSON.stringify(returnR.json)}`)
  console.log(`  ✓ Return posted: ${returnR.json.returnNo}`)
  const tbAfter7 = await getTrialBalance()
  const payableAfter7 = findAccount(tbAfter7, '2010')
  const purchasesAfter7 = findAccount(tbAfter7, '5010')
  const payableDelta7 = BigInt(payableAfter7.balance) - BigInt(payableBefore7.balance)
  const purchasesDelta7 = BigInt(purchasesAfter7.balance) - BigInt(purchasesBefore7.balance)
  console.log(`  Payable delta: ${payableDelta7} (expected: +100,000 debit reduces payable)`)
  console.log(`  Purchases delta: ${purchasesDelta7} (expected: -100,000 credit reduces expense)`)
  if (payableDelta7 === 100000n && purchasesDelta7 === -100000n) {
    console.log('  ✅ PASS: Purchase return accounting correct')
  } else {
    console.log('  ❌ FAIL: Purchase return accounting incorrect')
  }
  await new Promise(r => setTimeout(r, 500))

  // ─── 8. REPLACEMENT (equal value) ───
  console.log('\n━'.repeat(40))
  console.log('  TEST 8: Replacement (equal value)')
  console.log('━'.repeat(40))
  console.log('  Expected: NO voucher posted, stock movements only, audit log entry')
  const tbBefore8 = await getTrialBalance()
  const purchasesBefore8 = findAccount(tbBefore8, '5010')
  const payableBefore8 = findAccount(tbBefore8, '2010')
  // Use the split purchase for replacement
  const splitDetailR = await api(`/api/purchases/${splitPurId}`)
  const splitItems = splitDetailR.json?.purchase?.items ?? []
  if (splitItems.length === 0) throw new Error('No items in split purchase')
  const repR = await api(`/api/purchases/${splitPurId}/replacement`, 'POST', {
    replacementItems: [{
      originalPurchaseItemId: splitItems[0].id,
      outgoingProductId: splitItems[0].productId,
      outgoingProductName: splitItems[0].productName,
      outgoingQuantity: 1,
      outgoingUnitCostPaisas: splitItems[0].unitCost,
      incomingProductId: splitItems[0].productId,
      incomingProductName: splitItems[0].productName,
      incomingQuantity: 1,
      incomingUnitCostPaisas: splitItems[0].unitCost, // SAME cost = equal value
    }],
    notes: 'Test replacement (equal value)',
  })
  if (!repR.ok) throw new Error(`Replacement failed: ${JSON.stringify(repR.json)}`)
  console.log(`  ✓ Replacement posted: ${repR.json.replacementNo}`)
  const tbAfter8 = await getTrialBalance()
  const purchasesAfter8 = findAccount(tbAfter8, '5010')
  const payableAfter8 = findAccount(tbAfter8, '2010')
  const purchasesDelta8 = BigInt(purchasesAfter8.balance) - BigInt(purchasesBefore8.balance)
  const payableDelta8 = BigInt(payableAfter8.balance) - BigInt(payableBefore8.balance)
  console.log(`  Purchases delta: ${purchasesDelta8} (expected: 0 — no voucher for equal value)`)
  console.log(`  Payable delta: ${payableDelta8} (expected: 0 — no voucher for equal value)`)
  if (purchasesDelta8 === 0n && payableDelta8 === 0n) {
    console.log('  ✅ PASS: Equal-value replacement — no accounting impact')
  } else {
    console.log('  ❌ FAIL: Equal-value replacement should have no impact')
  }
  await new Promise(r => setTimeout(r, 500))

  // ─── 9. REPLACEMENT (value difference — higher) ───
  console.log('\n━'.repeat(40))
  console.log('  TEST 9: Replacement (higher value — Rs 100 → Rs 150)')
  console.log('━'.repeat(40))
  console.log('  Expected: Debit Purchases 50, Credit Vendor Payable 50 (diff = 50 paisas × 1 qty)')
  const tbBefore9 = await getTrialBalance()
  const purchasesBefore9 = findAccount(tbBefore9, '5010')
  const payableBefore9 = findAccount(tbBefore9, '2010')
  const repR2 = await api(`/api/purchases/${splitPurId}/replacement`, 'POST', {
    replacementItems: [{
      originalPurchaseItemId: splitItems[0].id,
      outgoingProductId: splitItems[0].productId,
      outgoingProductName: splitItems[0].productName,
      outgoingQuantity: 1,
      outgoingUnitCostPaisas: '100000', // Rs 100
      incomingProductId: splitItems[0].productId,
      incomingProductName: splitItems[0].productName,
      incomingQuantity: 1,
      incomingUnitCostPaisas: '150000', // Rs 150 — higher by Rs 50 = 5000 paisas
    }],
    notes: 'Test replacement (higher value)',
  })
  if (!repR2.ok) throw new Error(`Higher-value replacement failed: ${JSON.stringify(repR2.json)}`)
  console.log(`  ✓ Replacement posted: ${repR2.json.replacementNo}`)
  const tbAfter9 = await getTrialBalance()
  const purchasesAfter9 = findAccount(tbAfter9, '5010')
  const payableAfter9 = findAccount(tbAfter9, '2010')
  const purchasesDelta9 = BigInt(purchasesAfter9.balance) - BigInt(purchasesBefore9.balance)
  const payableDelta9 = BigInt(payableAfter9.balance) - BigInt(payableBefore9.balance)
  console.log(`  Purchases delta: ${purchasesDelta9} (expected: +50,000 debit)`)
  console.log(`  Payable delta: ${payableDelta9} (expected: -50,000 credit)`)
  if (purchasesDelta9 === 50000n && payableDelta9 === -50000n) {
    console.log('  ✅ PASS: Higher-value replacement — diff voucher correct')
  } else {
    console.log('  ❌ FAIL: Higher-value replacement diff incorrect')
  }

  // ─── 10. VENDOR LEDGER ───
  console.log('\n━'.repeat(40))
  console.log('  TEST 10: Vendor Ledger (verify entries + running balance)')
  console.log('━'.repeat(40))
  const ledgerR = await api(`/api/vendor-ledger/${vendor.id}`)
  const ledgerRows = ledgerR.json?.rows ?? []
  console.log(`  Ledger rows: ${ledgerRows.length}`)
  for (const r of ledgerRows) {
    const bal = BigInt(r.runningBalance)
    console.log(`    ${r.date} | ${r.type.padEnd(20)} | ${r.reference.padEnd(20)} | Dr: ${r.debit.padStart(8)} | Cr: ${r.credit.padStart(8)} | Bal: ${bal}`)
  }
  if (ledgerRows.length > 0) {
    const finalBal = BigInt(ledgerRows[ledgerRows.length - 1].runningBalance)
    console.log(`  Final balance: ${finalBal} (${finalBal > 0n ? 'Payable to Vendor' : finalBal < 0n ? 'Advance With Vendor' : 'Settled'})`)
    console.log('  ✅ PASS: Vendor ledger has entries with running balance')
  } else {
    console.log('  ❌ FAIL: Vendor ledger empty')
  }

  console.log('\n━'.repeat(72))
  console.log('  Phase 5 Accounting Verification Complete')
  console.log('━'.repeat(72))
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
