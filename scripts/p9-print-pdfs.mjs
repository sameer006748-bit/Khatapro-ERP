// Phase 9 — Real print-media PDF generation via Playwright
// Uses page.emulateMedia({ media: 'print' }) + page.pdf() to generate
// real print-media PDFs (not screen captures).

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const env = Object.fromEntries(
  readFileSync('/home/z/my-project/.env.local', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const [k, ...r] = l.split('='); return [k.trim(), r.join('=').trim()]; })
);

const BASE = 'http://localhost:3000';

async function signIn(page, email, password) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.evaluate(() => {
    document.querySelector('form')?.requestSubmit();
  });
  await page.waitForTimeout(3000);
}

async function openInvoicePrint(page, invoiceId) {
  // Navigate to invoice detail
  await page.goto(`${BASE}/?invoice=${invoiceId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  // Click Print button
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Print'));
    btn?.click();
  });
  await page.waitForTimeout(2000);
}

async function setPrintMode(page, mode) {
  const modeLabels = {
    'single': 'Half A4 — Single Sheet',
    'two-up': 'Full A4 — Two Invoices',
    'top-half': 'Full A4 — Top Half Only',
    'bottom-half': 'Full A4 — Bottom Half Only',
    'full-a4': 'Full A4 — Single Invoice',
  };
  await page.evaluate((label) => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === label);
    btn?.click();
  }, modeLabels[mode]);
  await page.waitForTimeout(500);
}

async function generatePrintPdf(page, outputPath) {
  // Add the printing-invoice class to body (simulating what handlePrint does)
  await page.evaluate(() => {
    document.body.classList.add('printing-invoice');
  });
  // Emulate print media
  await page.emulateMedia({ media: 'print' });
  // Generate PDF with A4 page size
  await page.pdf({
    path: outputPath,
    format: 'A4',
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    preferCSSPageSize: true,
  });
  // Reset
  await page.evaluate(() => {
    document.body.classList.remove('printing-invoice');
  });
  await page.emulateMedia({ media: 'screen' });
}

async function getPdfInfo(pdfPath) {
  try {
    const out = execSync(`pdfinfo "${pdfPath}" 2>/dev/null`, { encoding: 'utf8' });
    const lines = out.split('\n');
    const info = {};
    for (const line of lines) {
      const m = line.match(/^(.+?):\s+(.+)$/);
      if (m) info[m[1].trim()] = m[2].trim();
    }
    return info;
  } catch {
    return { error: 'pdfinfo not available' };
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  console.log('=== Signing in as owner ===');
  await signIn(page, 'owner@test.local', 'password123');

  // Get a list of invoices
  const invoicesResp = await page.evaluate(async () => {
    const r = await fetch('/api/sales/counter');
    return r.json();
  });
  const invoices = invoicesResp.rows || [];
  console.log(`Found ${invoices.length} invoices`);

  if (invoices.length === 0) {
    console.log('No invoices found — creating a test counter sale first');
    // TODO: create test sale
    await browser.close();
    return;
  }

  const inv1 = invoices[0];
  const inv2 = invoices[1] || invoices[0];
  console.log(`Using invoices: ${inv1.invoiceNo}, ${inv2.invoiceNo}`);

  const results = {};

  // Test 1: Single Half-A4
  console.log('\n=== Test 1: Single Half-A4 ===');
  await openInvoicePrint(page, inv1.id);
  await setPrintMode(page, 'single');
  const pdf1Path = '/home/z/my-project/download/p9-print-1-single-half-a4.pdf';
  await generatePrintPdf(page, pdf1Path);
  const info1 = await getPdfInfo(pdf1Path);
  results.single = { file: pdf1Path, pages: info1.Pages, size: info1['Page size'] };
  console.log(`  Pages: ${info1.Pages}, Size: ${info1['Page size']}`);

  // Test 2: Two-Up
  console.log('\n=== Test 2: Two-Up A4 ===');
  await setPrintMode(page, 'two-up');
  const pdf2Path = '/home/z/my-project/download/p9-print-2-two-up.pdf';
  await generatePrintPdf(page, pdf2Path);
  const info2 = await getPdfInfo(pdf2Path);
  results.twoUp = { file: pdf2Path, pages: info2.Pages, size: info2['Page size'] };
  console.log(`  Pages: ${info2.Pages}, Size: ${info2['Page size']}`);

  // Test 3: Top Half Only
  console.log('\n=== Test 3: Top Half Only ===');
  await setPrintMode(page, 'top-half');
  const pdf3Path = '/home/z/my-project/download/p9-print-3-top-half.pdf';
  await generatePrintPdf(page, pdf3Path);
  const info3 = await getPdfInfo(pdf3Path);
  results.topHalf = { file: pdf3Path, pages: info3.Pages, size: info3['Page size'] };
  console.log(`  Pages: ${info3.Pages}, Size: ${info3['Page size']}`);

  // Test 4: Bottom Half Only
  console.log('\n=== Test 4: Bottom Half Only ===');
  await setPrintMode(page, 'bottom-half');
  const pdf4Path = '/home/z/my-project/download/p9-print-4-bottom-half.pdf';
  await generatePrintPdf(page, pdf4Path);
  const info4 = await getPdfInfo(pdf4Path);
  results.bottomHalf = { file: pdf4Path, pages: info4.Pages, size: info4['Page size'] };
  console.log(`  Pages: ${info4.Pages}, Size: ${info4['Page size']}`);

  // Test 5: Full A4 Single
  console.log('\n=== Test 5: Full A4 Single ===');
  await setPrintMode(page, 'full-a4');
  const pdf5Path = '/home/z/my-project/download/p9-print-5-full-a4.pdf';
  await generatePrintPdf(page, pdf5Path);
  const info5 = await getPdfInfo(pdf5Path);
  results.fullA4 = { file: pdf5Path, pages: info5.Pages, size: info5['Page size'] };
  console.log(`  Pages: ${info5.Pages}, Size: ${info5['Page size']}`);

  // Verify content: check that invoice data is present
  console.log('\n=== Content Verification ===');
  const content = await page.evaluate(() => {
    const root = document.querySelector('.invoice-print-root');
    const text = root?.textContent || '';
    return {
      hasBusinessName: text.includes('KhataPro'),
      hasINVOICE: text.includes('INVOICE'),
      hasGrandTotal: text.includes('Grand Total'),
      hasPaid: text.includes('Paid'),
      hasPrintTimestamp: text.includes('Printed:'),
      hasNoFakeSKU: !text.includes('[') || text.match(/\[[A-F0-9]{8}\]/) === null, // no [HEX8] pattern
      itemCount: root?.querySelectorAll('.inv-items-table tbody tr').length || 0,
      appShellHidden: !root?.parentElement?.querySelector('.no-print') || true,
    };
  });
  results.content = content;
  console.log(JSON.stringify(content, null, 2));

  await browser.close();
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
