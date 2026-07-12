// Phase 9 — Phase 1-8 regression (quick critical-path checks)
// Does NOT modify data — only reads and verifies key flows.

import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const results = {};

  // 1. Login/logout
  console.log('=== 1. Login ===');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', 'owner@test.local');
  await page.fill('input[type=password]', 'password123');
  await page.evaluate(() => document.querySelector('form')?.requestSubmit());
  await page.waitForTimeout(3000);
  const meResp = await page.evaluate(async () => {
    const r = await fetch('/api/me');
    return r.json();
  });
  results.login = { ok: !!meResp.user, email: meResp.user?.email };
  console.log(`  Login: ${results.login.ok ? 'PASS' : 'FAIL'} (${results.login.email})`);

  // 2. Trial Balance
  console.log('=== 2. Trial Balance ===');
  const tb = await page.evaluate(async () => {
    const r = await fetch('/api/trial-balance');
    return r.json();
  });
  const tbRows = tb.rows || tb || [];
  let totalDr = 0n, totalCr = 0n;
  for (const r of tbRows) {
    totalDr += BigInt(r.total_debit || r.debit || 0);
    totalCr += BigInt(r.total_credit || r.credit || 0);
  }
  results.trialBalance = { rows: tbRows.length, totalDr: totalDr.toString(), totalCr: totalCr.toString(), balanced: totalDr === totalCr };
  console.log(`  TB: ${tbRows.length} rows, Dr=${totalDr.toString()}, Cr=${totalCr.toString()}, balanced=${totalDr === totalCr}`);

  // 3. P&L
  console.log('=== 3. P&L ===');
  const pl = await page.evaluate(async () => {
    const r = await fetch('/api/reports?type=profit-loss&fromDate=2026-01-01&toDate=2026-12-31');
    return r.json();
  });
  const plRows = pl.rows || [];
  const hasZeroRows = plRows.some(r => BigInt(r.amount || 0) === 0n);
  const hasNonPL = plRows.some(r => r.category_type !== 'Income' && r.category_type !== 'Expense');
  results.profitLoss = { rows: plRows.length, hasZeroRows, hasNonPLRows: hasNonPL };
  console.log(`  P&L: ${plRows.length} rows, zeroRows=${hasZeroRows}, nonPLRows=${hasNonPL}`);

  // 4. Balance Sheet
  console.log('=== 4. Balance Sheet ===');
  const bs = await page.evaluate(async () => {
    const r = await fetch('/api/reports?type=balance-sheet&toDate=2026-07-12');
    return r.json();
  });
  const bsRows = bs.rows || [];
  const assets = bsRows.filter(r => r.section === 'ASSET');
  const liabs = bsRows.filter(r => r.section === 'LIABILITY');
  const equity = bsRows.filter(r => r.section === 'EQUITY');
  const ta = assets.reduce((s, r) => s + BigInt(r.balance), 0n);
  const tl = liabs.reduce((s, r) => s + BigInt(r.balance), 0n);
  const te = equity.reduce((s, r) => s + BigInt(r.balance), 0n);
  results.balanceSheet = { assets: ta.toString(), liabilities: tl.toString(), equity: te.toString(), diff: (ta - tl - te).toString() };
  console.log(`  BS: A=${ta.toString()}, L=${tl.toString()}, E=${te.toString()}, Diff=${(ta-tl-te).toString()}`);

  // 5. Products list
  console.log('=== 5. Products ===');
  const products = await page.evaluate(async () => {
    const r = await fetch('/api/products');
    return r.json();
  });
  results.products = { count: products.rows?.length || 0 };
  console.log(`  Products: ${results.products.count}`);

  // 6. Sales list
  console.log('=== 6. Sales ===');
  const sales = await page.evaluate(async () => {
    const r = await fetch('/api/sales/counter');
    return r.json();
  });
  results.sales = { count: sales.rows?.length || 0 };
  console.log(`  Sales: ${results.sales.count}`);

  // 7. Purchases list
  console.log('=== 7. Purchases ===');
  const purchases = await page.evaluate(async () => {
    const r = await fetch('/api/purchases');
    return r.json();
  });
  results.purchases = { count: purchases.rows?.length || 0 };
  console.log(`  Purchases: ${results.purchases.count}`);

  // 8. Vouchers list
  console.log('=== 8. Vouchers ===');
  const vouchers = await page.evaluate(async () => {
    const r = await fetch('/api/vouchers');
    return r.json();
  });
  results.vouchers = { count: vouchers.rows?.length || 0 };
  console.log(`  Vouchers: ${results.vouchers.count}`);

  // 9. CSV export
  console.log('=== 9. CSV Export ===');
  const csv = await page.evaluate(async () => {
    const r = await fetch('/api/reports/csv?type=profit-loss&fromDate=2026-01-01&toDate=2026-12-31');
    const text = await r.text();
    return { status: r.status, contentType: r.headers.get('content-type'), bom: text.charCodeAt(0) === 0xFEFF, lines: text.split('\n').length };
  });
  results.csv = csv;
  console.log(`  CSV: status=${csv.status}, BOM=${csv.bom}, lines=${csv.lines}`);

  // 10. Salesman restriction
  console.log('=== 10. Salesman Restriction ===');
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Sign out');
    btn?.click();
  });
  await page.waitForTimeout(2000);
  await page.fill('input[type=email]', 'salesman@test.local');
  await page.fill('input[type=password]', 'password123');
  await page.evaluate(() => document.querySelector('form')?.requestSubmit());
  await page.waitForTimeout(3000);
  const smBlocked = await page.evaluate(async () => {
    const tests = ['/api/reports?type=profit-loss', '/api/reports?type=balance-sheet', '/api/reports?type=trial-balance'];
    const results = [];
    for (const t of tests) {
      const r = await fetch(t);
      results.push(r.status);
    }
    return results;
  });
  results.salesmanBlocked = { statuses: smBlocked, allBlocked: smBlocked.every(s => s === 403) };
  console.log(`  Salesman blocked: ${results.salesmanBlocked.allBlocked} (${smBlocked.join(', ')})`);

  // 11. Salesman own reports
  const smOwn = await page.evaluate(async () => {
    const r = await fetch('/api/reports/salesman?type=my-sales-summary');
    return r.status;
  });
  results.salesmanOwnReports = { status: smOwn };
  console.log(`  Salesman own reports: ${smOwn}`);

  await browser.close();

  writeFileSync('/home/z/my-project/audit-out/p9-regression.json', JSON.stringify(results, null, 2));
  console.log('\n=== REGRESSION SUMMARY ===');
  const allPass = results.login.ok && results.trialBalance.balanced && !results.profitLoss.hasZeroRows && !results.profitLoss.hasNonPLRows && results.balanceSheet.diff === '0' && results.csv.status === 200 && results.salesmanBlocked.allBlocked && results.salesmanOwnReports.status === 200;
  console.log(`All critical checks pass: ${allPass}`);
}

main().catch(e => { console.error(e); process.exit(1); });
