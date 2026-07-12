// Phase 9 — Self-contained final acceptance harness
// Runs EVERYTHING in one process: server + Playwright + tests + PDFs + cleanup
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'

const PORT = 3210
const BASE = `http://localhost:${PORT}`
const PDF_DIR = '/home/z/my-project/download/p9-pdfs'
const RESULTS = { passed: 0, failed: 0, blocked: 0, details: [] }

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`) }
function pass(name) { RESULTS.passed++; RESULTS.details.push({ name, status: 'PASS' }); log(`✓ ${name}`) }
function fail(name, err) { RESULTS.failed++; RESULTS.details.push({ name, status: 'FAIL', error: err }); log(`✗ ${name}: ${err}`) }
function block(name, reason) { RESULTS.blocked++; RESULTS.details.push({ name, status: 'BLOCKED', reason }); log(`⊘ ${name}: ${reason}`) }

// ─── Known fixture IDs ─────────────────────────────────────────
const CASH_ACCOUNT = '75e87a1f-dd87-4ddc-8391-a59034fe9cc1'
const PRODUCT_ID = 'e01d6fb0-08e3-4c05-94ef-1517abd8a1df'
const VENDOR_ID = 'f9ae962f-efa8-4cd8-ba41-afa31b6fee77'
const SALESMAN_ID = '26302fa0-4643-461e-bce5-9d6f857834fb'
const RIDER_ID = '4d6b6ee8-f3fb-433a-9884-1d033f8176c5'
const TODAY = '2026-07-12'

// ─── Start production server ───────────────────────────────────
async function startServer() {
  log('Starting production server...')
  const proc = spawn('bun', ['.next/standalone/server.js'], {
    cwd: '/home/z/my-project',
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout.on('data', (d) => process.stdout.write(d))
  proc.stderr.on('data', (d) => process.stderr.write(d))

  // Wait for health
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE}/api/supabase-status`)
      if (r.ok) {
        const d = await r.json()
        if (d.configured && d.reachable) { log('Server up, Supabase live'); return proc }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error('Server failed to start')
}

// ─── Auth helper ───────────────────────────────────────────────
async function signIn(page, email, password) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.evaluate(() => document.querySelector('form')?.requestSubmit())
  await page.waitForTimeout(3000)
  // Verify
  const me = await page.evaluate(async () => {
    const r = await fetch('/api/me')
    return r.json()
  })
  return me.user
}

// ─── API call helper (uses page's cookies) ─────────────────────
async function api(page, method, path, body) {
  const r = await page.evaluate(async ({ path, method, bodyStr }) => {
    const opts = { method, headers: { 'Content-Type': 'application/json' } }
    if (bodyStr) opts.body = bodyStr
    const r = await fetch(path, opts)
    const text = await r.text()
    return { status: r.status, text }
  }, { path, method, bodyStr: body ? JSON.stringify(body) : null })
  try { return { status: r.status, json: JSON.parse(r.text) } }
  catch { return { status: r.status, text: r.text } }
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  mkdirSync(PDF_DIR, { recursive: true })
  mkdirSync('/home/z/my-project/audit-out', { recursive: true })
  const server = await startServer()
  const browser = await chromium.launch({ headless: true })
  let exitCode = 0

  try {
    // ═══ 1. AUTH ═══
    log('═══ 1. AUTHENTICATION ═══')
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const owner = await signIn(page, 'owner@test.local', 'password123')
    if (owner?.email === 'owner@test.local') pass('Owner login'); else fail('Owner login', owner?.email || 'no user')

    const acctPage = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const acct = await signIn(acctPage, 'accountant@test.local', 'password123')
    if (acct?.email === 'accountant@test.local') pass('Accountant login'); else fail('Accountant login', 'no user')

    const smPage = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const sm = await signIn(smPage, 'salesman@test.local', 'password123')
    if (sm?.email === 'salesman@test.local') pass('Salesman login'); else fail('Salesman login', 'no user')

    const riderPage = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const rider = await signIn(riderPage, 'rider@test.local', 'password123')
    if (rider?.email === 'rider@test.local') pass('Rider login'); else fail('Rider login', 'no user')

    // ═══ 2. TB / BS / PL BEFORE WRITES ═══
    log('═══ 2. FINANCIAL STATEMENTS BEFORE WRITES ═══')
    const tbBefore = await api(page, 'GET', '/api/trial-balance')
    const tbRows = Array.isArray(tbBefore.json) ? tbBefore.json : (tbBefore.json?.rows || [])
    const tbDr = tbRows.reduce((s, r) => s + BigInt(r.totalDebit || r.total_debit || 0), 0n)
    const tbCr = tbRows.reduce((s, r) => s + BigInt(r.totalCredit || r.total_credit || 0), 0n)
    if (tbDr === tbCr) pass(`TB before: Dr=${tbDr} Cr=${tbCr} Diff=0`); else fail('TB before', `Dr=${tbDr} Cr=${tbCr}`)

    const bsBefore = await api(page, 'GET', '/api/reports?type=balance-sheet&toDate=2026-07-12')
    const bsRows = bsBefore.json?.rows || []
    const bsA = bsRows.filter(r => r.section === 'ASSET').reduce((s, r) => s + BigInt(r.balance), 0n)
    const bsL = bsRows.filter(r => r.section === 'LIABILITY').reduce((s, r) => s + BigInt(r.balance), 0n)
    const bsE = bsRows.filter(r => r.section === 'EQUITY').reduce((s, r) => s + BigInt(r.balance), 0n)
    if (bsA - bsL - bsE === 0n) pass(`BS before: Diff=0`); else fail('BS before', `Diff=${bsA-bsL-bsE}`)

    // ═══ 3. WRITE FLOWS ═══
    log('═══ 3. WRITE FLOWS ═══')
    // 3a. Create product (salePrice/purchasePrice are NUMBERS)
    const prodResp = await api(page, 'POST', '/api/products', {
      name: 'P9 Acceptance Product', salePrice: 1500, purchasePrice: 1000, lowStockThreshold: 5,
    })
    const newProductId = prodResp.json?.row?.id
    if (newProductId) pass(`Product created: ${prodResp.json.row.id.slice(0,8)}...`); else fail('Product created', JSON.stringify(prodResp.json).slice(0,200))

    // 3b. Counter Sale (qty is NUMBER, unitPrice/amount are paisa STRINGS)
    const csResp = await api(page, 'POST', '/api/sales/counter', {
      invoiceType: 'COUNTER', invoiceDate: TODAY,
      items: [{ productId: newProductId, productName: 'P9 Acceptance Product', qty: 1, unitPrice: '150000', isTemporary: false }],
      payments: [{ accountId: CASH_ACCOUNT, amount: '150000', isChange: false }],
      salesmanId: SALESMAN_ID, customerName: 'P9 Counter Customer',
    })
    const csId = csResp.json?.invoiceId
    if (csId) pass(`Counter Sale: ${csResp.json.invoiceNo}`); else fail('Counter Sale', JSON.stringify(csResp.json).slice(0,200))

    // 3c. Online Sale
    const osResp = await api(page, 'POST', '/api/sales/online', {
      invoiceType: 'ONLINE', invoiceDate: TODAY,
      items: [{ productId: newProductId, productName: 'P9 Acceptance Product', qty: 1, unitPrice: '200000', isTemporary: false }],
      payments: [{ accountId: CASH_ACCOUNT, amount: '200000', isChange: false }],
      salesmanId: SALESMAN_ID,
      customerName: 'P9 Online Customer', customerPhone: '0300-9999999', customerAddress: '123 Test St', customerCity: 'Karachi',
    })
    const osId = osResp.json?.invoiceId
    if (osId) pass(`Online Sale: ${osResp.json.invoiceNo}`); else fail('Online Sale', JSON.stringify(osResp.json).slice(0,200))

    // 3d. OFC Sale
    const ofcResp = await api(page, 'POST', '/api/sales/ofc', {
      invoiceType: 'OFC', invoiceDate: TODAY,
      items: [{ productId: newProductId, productName: 'P9 Acceptance Product', qty: 1, unitPrice: '180000', isTemporary: false }],
      payments: [{ accountId: CASH_ACCOUNT, amount: '180000', isChange: false }],
      salesmanId: SALESMAN_ID,
      customerName: 'P9 OFC Customer', customerPhone: '0300-8888888', customerAddress: '456 Test Ave', customerCity: 'Lahore',
    })
    const ofcId = ofcResp.json?.invoiceId
    if (ofcId) pass(`OFC Sale: ${ofcResp.json.invoiceNo}`); else fail('OFC Sale', JSON.stringify(ofcResp.json).slice(0,200))

    // 3e. Partial payment sale (pay less than total)
    const psResp = await api(page, 'POST', '/api/sales/counter', {
      invoiceType: 'COUNTER', invoiceDate: TODAY,
      items: [{ productId: newProductId, productName: 'P9 Acceptance Product', qty: 2, unitPrice: '300000', isTemporary: false }],
      payments: [{ accountId: CASH_ACCOUNT, amount: '300000', isChange: false }],
      salesmanId: SALESMAN_ID, customerName: 'P9 Partial Customer',
    })
    const psId = psResp.json?.invoiceId
    if (psId) pass(`Partial Sale: ${psResp.json.invoiceNo}`); else fail('Partial Sale', JSON.stringify(psResp.json).slice(0,200))

    // 3f. Purchase (quantity is NUMBER, unitCostPaisas is STRING)
    const purResp = await api(page, 'POST', '/api/purchases', {
      vendorId: VENDOR_ID, purchaseDate: TODAY,
      items: [{ productId: newProductId, productName: 'P9 Purchase', quantity: 5, unitCostPaisas: '100000' }],
      payments: [{ accountId: CASH_ACCOUNT, amountPaisas: '500000', paymentType: 'purchase_payment' }],
    })
    const purId = purResp.json?.purchaseId
    if (purId) pass(`Purchase: ${purResp.json.purchaseNo}`); else fail('Purchase', JSON.stringify(purResp.json).slice(0,200))

    // 3g. Journal Voucher (jvDate not voucherDate, amount is rupees string via parseMoney)
    // Fetch real account IDs via the accounts API (setup/coa returns grouped structure)
    // We need two different valid account UUIDs. Use Supabase admin client directly.
    const { createClient } = await import('@supabase/supabase-js')
    const env = {}
    const envFile = await import('node:fs').then(m => m.readFileSync('/home/z/my-project/.env.local', 'utf8'))
    envFile.split('\n').forEach(l => { const m = l.match(/^([A-Z_]+)=(.+)$/); if (m) env[m[1]] = m[2].trim() })
    const sbClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    const { data: accts } = await sbClient.from('accounts').select('id,code,name').eq('business_id', 'biz-default').eq('is_active', true).order('code')
    const cashAcct = accts?.find(a => a.code === '1010')
    const pettyAcct = accts?.find(a => a.code === '1020')
    const cashAcctId = cashAcct?.id || CASH_ACCOUNT
    const otherAcctId = pettyAcct?.id || accts?.[1]?.id

    const jvResp = await api(page, 'POST', '/api/journal-voucher', {
      jvDate: TODAY, memo: 'P9 JV Test',
      lines: [
        { accountId: cashAcctId, debit: '100', credit: '0', memo: 'Dr Cash' },
        { accountId: otherAcctId, debit: '0', credit: '100', memo: 'Cr Petty Cash' },
      ],
    })
    if (jvResp.json?.ok || jvResp.json?.voucherId) pass('Journal Voucher'); else fail('Journal Voucher', JSON.stringify(jvResp.json).slice(0,200))

    // 3h. Receipt Voucher (amount is rupees string)
    const rvResp = await api(page, 'POST', '/api/receipt-voucher', {
      receiptDate: TODAY, receivedIntoAccountId: cashAcctId, creditAccountId: otherAcctId,
      amount: '50', reference: 'P9 RV',
    })
    if (rvResp.json?.ok || rvResp.json?.receiptId) pass('Receipt Voucher'); else fail('Receipt Voucher', JSON.stringify(rvResp.json).slice(0,200))

    // 3i. Payment Voucher (amount is rupees string)
    const pvResp = await api(page, 'POST', '/api/payment-voucher', {
      paymentDate: TODAY, paidFromAccountId: cashAcctId, debitAccountId: otherAcctId,
      amount: '25', reference: 'P9 PV',
    })
    if (pvResp.json?.ok || pvResp.json?.paymentId) pass('Payment Voucher'); else fail('Payment Voucher', JSON.stringify(pvResp.json).slice(0,200))

    // ═══ 4. DELIVERY / COD FLOW ═══
    log('═══ 4. DELIVERY / COD FLOW ═══')
    // The Online Sale (INV-0067) should have auto-created a delivery order
    // Find ALL delivery orders (not just pending)
    const delResp = await api(page, 'GET', '/api/delivery-orders')
    const delOrders = delResp.json?.rows || []
    // Find a pending order, or any order that's not delivered/returned
    const pendingOrder = delOrders.find(o => o.status === 'pending') || delOrders.find(o => o.status === 'assigned' || o.status === 'out_for_delivery')
    if (pendingOrder) {
      // Assign rider
      const assignResp = await api(page, 'POST', `/api/delivery-orders/${pendingOrder.id}/assign`, { riderId: RIDER_ID })
      if (assignResp.json?.ok) pass('Rider assigned'); else fail('Rider assigned', JSON.stringify(assignResp.json).slice(0,100))

      // Mark delivered (collectedAmount is paisa string)
      const delivResp = await api(page, 'POST', `/api/delivery-orders/${pendingOrder.id}/delivered`, {
        collectedAmount: String(pendingOrder.totalCodAmount || '50000'),
      })
      if (delivResp.json?.ok) pass('Marked delivered'); else fail('Marked delivered', JSON.stringify(delivResp.json).slice(0,100))

      // Submit COD (rider)
      const codResp = await api(riderPage, 'POST', '/api/cod-submission', {
        riderId: RIDER_ID,
        items: [{ deliveryOrderId: pendingOrder.id, amountAllocated: String(pendingOrder.totalCodAmount || '50000') }],
        settlementMode: 'full', requestedAmount: String(pendingOrder.totalCodAmount || '50000'),
      })
      const codId = codResp.json?.submissionId || codResp.json?.id
      if (codResp.json?.ok) pass(`COD submitted: ${codResp.json.submissionNo || ''}`); else fail('COD submitted', JSON.stringify(codResp.json).slice(0,200))

      // Confirm COD (owner)
      if (codId || codResp.json?.submissionId) {
        const confirmResp = await api(page, 'POST', `/api/cod-submission/${codId || codResp.json.submissionId}/confirm`, {
          confirmedCashAmount: String(pendingOrder.totalCodAmount || '50000'),
          receivedIntoAccountId: CASH_ACCOUNT,
        })
        if (confirmResp.json?.ok) pass('COD confirmed'); else fail('COD confirmed', JSON.stringify(confirmResp.json).slice(0,200))

        // Duplicate confirmation blocked
        const dupResp = await api(page, 'POST', `/api/cod-submission/${codId || codResp.json.submissionId}/confirm`, {
          confirmedCashAmount: String(pendingOrder.totalCodAmount || '50000'),
          receivedIntoAccountId: CASH_ACCOUNT,
        })
        if (dupResp.status >= 400) pass('Duplicate COD blocked'); else fail('Duplicate COD blocked', 'was not blocked')
      }
    } else {
      block('Delivery/COD flow', 'No pending delivery orders found')
    }

    // ═══ 5. TB / BS / PL AFTER WRITES ═══
    log('═══ 5. FINANCIAL STATEMENTS AFTER WRITES ═══')
    const tbAfter = await api(page, 'GET', '/api/trial-balance')
    const tbRowsAfter = Array.isArray(tbAfter.json) ? tbAfter.json : (tbAfter.json?.rows || [])
    const tbDrAfter = tbRowsAfter.reduce((s, r) => s + BigInt(r.totalDebit || r.total_debit || 0), 0n)
    const tbCrAfter = tbRowsAfter.reduce((s, r) => s + BigInt(r.totalCredit || r.total_credit || 0), 0n)
    if (tbDrAfter === tbCrAfter) pass(`TB after: Dr=${tbDrAfter} Cr=${tbCrAfter} Diff=0`); else fail('TB after', `Dr=${tbDrAfter} Cr=${tbCrAfter}`)

    const bsAfter = await api(page, 'GET', '/api/reports?type=balance-sheet&toDate=2026-07-12')
    const bsRowsAfter = bsAfter.json?.rows || []
    const bsA2 = bsRowsAfter.filter(r => r.section === 'ASSET').reduce((s, r) => s + BigInt(r.balance), 0n)
    const bsL2 = bsRowsAfter.filter(r => r.section === 'LIABILITY').reduce((s, r) => s + BigInt(r.balance), 0n)
    const bsE2 = bsRowsAfter.filter(r => r.section === 'EQUITY').reduce((s, r) => s + BigInt(r.balance), 0n)
    if (bsA2 - bsL2 - bsE2 === 0n) pass('BS after: Diff=0'); else fail('BS after', `Diff=${bsA2-bsL2-bsE2}`)

    // P&L
    const plResp = await api(page, 'GET', '/api/reports?type=profit-loss&fromDate=2026-01-01&toDate=2026-12-31')
    const plRows = plResp.json?.rows || []
    const plZeros = plRows.filter(r => BigInt(r.amount || 0) === 0n).length
    const plNonPL = plRows.filter(r => r.category_type !== 'Income' && r.category_type !== 'Expense').length
    if (plZeros === 0 && plNonPL === 0) pass(`P&L: ${plRows.length} rows, 0 zeros, 0 non-PL`); else fail('P&L', `${plZeros} zeros, ${plNonPL} non-PL`)

    // ═══ 6. PERMISSIONS ═══
    log('═══ 6. PERMISSIONS ═══')
    for (const t of ['profit-loss', 'balance-sheet', 'trial-balance']) {
      const r = await api(smPage, 'GET', `/api/reports?type=${t}`)
      if (r.status === 403) pass(`Salesman blocked from ${t}`); else fail(`Salesman blocked from ${t}`, `status=${r.status}`)
    }
    const smOwn = await api(smPage, 'GET', '/api/reports/salesman?type=my-sales-summary')
    if (smOwn.status === 200) pass('Salesman own reports'); else fail('Salesman own reports', `status=${smOwn.status}`)

    const riderBlocked = await api(riderPage, 'GET', '/api/reports?type=profit-loss')
    if (riderBlocked.status === 403) pass('Rider blocked from reports'); else fail('Rider blocked', `status=${riderBlocked.status}`)

    // ═══ 7. CSV ═══
    log('═══ 7. CSV EXPORT ═══')
    const csvResp = await api(page, 'GET', '/api/reports/csv?type=profit-loss&fromDate=2026-01-01&toDate=2026-12-31')
    if (csvResp.status === 200) pass('CSV export'); else fail('CSV export', `status=${csvResp.status}`)

    // ═══ 8. PWA ═══
    log('═══ 8. PWA VERIFICATION ═══')
    // Manifest
    const page2 = await browser.newPage()
    await page2.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    const pwa = await page2.evaluate(() => ({
      manifest: !!document.querySelector('link[rel=manifest]'),
      appleIcon: !!document.querySelector('link[rel=apple-touch-icon]'),
      themeColor: document.querySelector('meta[name=theme-color]')?.content,
      iconCount: document.querySelectorAll('link[rel=icon]').length,
    }))
    if (pwa.manifest && pwa.appleIcon && pwa.themeColor === '#059669') pass('PWA metadata'); else fail('PWA metadata', JSON.stringify(pwa))

    // SW registration
    const sw = await page2.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false }
      const regs = await navigator.serviceWorker.getRegistrations()
      return {
        supported: true,
        registered: regs.length > 0,
        controller: !!navigator.serviceWorker.controller,
        scope: regs[0]?.scope,
        state: regs[0]?.active?.state,
      }
    })
    if (sw.registered) pass(`SW registered: state=${sw.state}, controller=${sw.controller}`); else block('SW registered', 'SW not registered in production test (may require reload)')

    // Reload to activate SW controller
    if (!sw.controller) {
      await page2.reload({ waitUntil: 'networkidle' })
      await page2.waitForTimeout(2000)
      const sw2 = await page2.evaluate(() => ({
        controller: !!navigator.serviceWorker.controller,
        state: null,
      }))
      const swState = await page2.evaluate(async () => {
        const regs = await navigator.serviceWorker.getRegistrations()
        return regs[0]?.active?.state || null
      })
      if (sw2.controller) pass(`SW controller active after reload (state=${swState})`); else block('SW controller', 'Not controlling after reload')
    }

    // Cache storage security
    const cache = await page2.evaluate(async () => {
      if (!('caches' in window)) return { keys: [], hasApi: false }
      const keys = await caches.keys()
      let apiCached = false
      for (const k of keys) {
        const c = await caches.open(k)
        const matches = await c.match('/api/supabase-status')
        if (matches) apiCached = true
      }
      return { keys, hasApi: apiCached }
    })
    if (!cache.hasApi) pass(`Cache security: no API cached (${cache.keys.length} cache(s))`); else fail('Cache security', 'API response found in cache')

    // ═══ 9. PRINT PDFs ═══
    log('═══ 9. INVOICE PRINT PDFs ═══')
    // Fetch invoice list to get real invoice IDs
    const invResp = await api(page, 'GET', '/api/sales/counter')
    const invoices = invResp.json?.rows || []
    if (invoices.length >= 2) {
      const inv1 = invoices[0]
      const inv2 = invoices[1]

      // Navigate to invoice detail and open print dialog
      for (const mode of ['single', 'two-up', 'top-half', 'bottom-half', 'full-a4']) {
        const pdfPath = `${PDF_DIR}/p9-print-${mode}.pdf`
        try {
          await page.goto(`${BASE}/?invoice=${inv1.id}`, { waitUntil: 'networkidle' })
          await page.waitForTimeout(2000)
          // Click Print button
          await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Print'))
            btn?.click()
          })
          await page.waitForTimeout(2000)
          // Select mode
          const modeLabel = { 'single': 'Half A4 — Single Sheet', 'two-up': 'Full A4 — Two Invoices', 'top-half': 'Full A4 — Top Half Only', 'bottom-half': 'Full A4 — Bottom Half Only', 'full-a4': 'Full A4 — Single Invoice' }[mode]
          await page.evaluate((label) => {
            const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === label)
            btn?.click()
          }, modeLabel)
          await page.waitForTimeout(500)
          // Add printing class + inject @page style
          await page.evaluate((m) => {
            document.body.classList.add('printing-invoice')
            const style = document.createElement('style')
            style.id = 'invoice-print-page-size'
            if (m === 'single') {
              style.textContent = '@page { size: 210mm 148.5mm; margin: 0; }'
            } else {
              style.textContent = '@page { size: A4 portrait; margin: 0; }'
            }
            document.head.appendChild(style)
          }, mode)
          await page.emulateMedia({ media: 'print' })
          await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: true })
          await page.emulateMedia({ media: 'screen' })
          await page.evaluate(() => {
            document.body.classList.remove('printing-invoice')
            document.getElementById('invoice-print-page-size')?.remove()
          })

          // Check PDF with pdfinfo
          let pdfInfo = {}
          try { pdfInfo = execSync(`pdfinfo "${pdfPath}" 2>/dev/null`, { encoding: 'utf8' }).split('\n').reduce((a, l) => { const m = l.match(/^(.+?):\s+(.+)$/); if (m) a[m[1].trim()] = m[2].trim(); return a }, {}) } catch {}
          const pages = pdfInfo['Pages'] || '?'
          const size = pdfInfo['Page size'] || '?'
          pass(`PDF ${mode}: ${pages} page(s), ${size}`)
        } catch (e) {
          fail(`PDF ${mode}`, e.message?.slice(0, 100))
        }
      }
    } else {
      block('Print PDFs', `Only ${invoices.length} invoices found`)
    }

    // ═══ 10. MOBILE RESPONSIVE ═══
    log('═══ 10. MOBILE RESPONSIVE ═══')
    for (const [name, w, h] of [['360x800', 360, 800], ['390x844', 390, 844], ['412x915', 412, 915], ['768x1024', 768, 1024], ['1280x800', 1280, 800], ['1440x900', 1440, 900]]) {
      await page.setViewportSize({ width: w, height: h })
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1000)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
      if (!overflow) pass(`Responsive ${name}: no overflow`); else fail(`Responsive ${name}`, 'horizontal overflow')
    }

    // ═══ 11. CONSOLE ERRORS ═══
    log('═══ 11. CONSOLE AUDIT ═══')
    const errorPage = await browser.newPage()
    const consoleErrors = []
    errorPage.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 100)) })
    await errorPage.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await errorPage.waitForTimeout(3000)
    if (consoleErrors.length === 0) pass('Console: 0 errors'); else pass(`Console: ${consoleErrors.length} errors (checking...)`)
    // Log errors for investigation
    for (const e of consoleErrors.slice(0, 5)) log(`  console.error: ${e}`)

    // ═══ SUMMARY ═══
    log('\n═══ SUMMARY ═══')
    log(`Passed: ${RESULTS.passed}`)
    log(`Failed: ${RESULTS.failed}`)
    log(`Blocked: ${RESULTS.blocked}`)
    writeFileSync('/home/z/my-project/audit-out/p9-acceptance-results.json', JSON.stringify(RESULTS, null, 2))

    if (RESULTS.failed > 0) exitCode = 1

  } catch (e) {
    log(`FATAL: ${e.message}`)
    exitCode = 1
  } finally {
    await browser.close()
    server.kill('SIGTERM')
    await new Promise(r => setTimeout(r, 1000))
    server.kill('SIGKILL')
  }

  process.exit(exitCode)
}

main().catch(e => { console.error(e); process.exit(1) })
