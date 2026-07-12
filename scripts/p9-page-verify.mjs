// Phase 9 — Page-by-page mobile verification
// Opens each page at 390x844, checks for overflow + console errors.

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('/home/z/my-project/.env.local', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const [k, ...r] = l.split('='); return [k.trim(), r.join('=').trim()]; })
);

const BASE = 'http://localhost:3000';

const PAGES = [
  { name: 'Dashboard', nav: 'home', perm: 'owner' },
  { name: 'Products', nav: 'products', perm: 'owner' },
  { name: 'Sales List', nav: 'sales-list', perm: 'owner' },
  { name: 'Counter Sale', nav: 'counter-sale', perm: 'owner' },
  { name: 'Online Sale', nav: 'online-sale', perm: 'owner' },
  { name: 'OFC Sale', nav: 'ofc-sale', perm: 'owner' },
  { name: 'Purchases', nav: 'purchases', perm: 'owner' },
  { name: 'Reports', nav: 'reports', perm: 'owner' },
  { name: 'Accounts', nav: 'accounts', perm: 'owner' },
  { name: 'Setup', nav: 'setup', perm: 'owner' },
  { name: 'Users', nav: 'users', perm: 'owner' },
  { name: 'Permissions', nav: 'permissions', perm: 'owner' },
  { name: 'Audit Logs', nav: 'audit-log', perm: 'owner' },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  // Collect console errors
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Sign in as owner
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', 'owner@test.local');
  await page.fill('input[type=password]', 'password123');
  await page.evaluate(() => document.querySelector('form')?.requestSubmit());
  await page.waitForTimeout(3000);

  const results = [];

  for (const p of PAGES) {
    console.log(`Testing: ${p.name} (nav=${p.nav})`);
    const errorsBefore = consoleErrors.length;

    // Navigate via URL param
    await page.goto(`${BASE}/?nav=${p.nav}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Check overflow
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      hasContent: document.querySelector('main')?.children.length > 0,
    }));

    const newErrors = consoleErrors.slice(errorsBefore);
    results.push({
      page: p.name,
      nav: p.nav,
      overflow: overflow.overflow,
      hasContent: overflow.hasContent,
      errors: newErrors.length,
      errorSamples: newErrors.slice(0, 2),
    });
    console.log(`  overflow: ${overflow.overflow}, errors: ${newErrors.length}, content: ${overflow.hasContent}`);
  }

  // Test salesman pages
  console.log('\n=== Salesman pages ===');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Sign out');
    btn?.click();
  });
  await page.waitForTimeout(2000);
  await page.fill('input[type=email]', 'salesman@test.local');
  await page.fill('input[type=password]', 'password123');
  await page.evaluate(() => document.querySelector('form')?.requestSubmit());
  await page.waitForTimeout(3000);

  const smPages = [
    { name: 'Salesman Dashboard', nav: 'home' },
    { name: 'Salesman Inventory', nav: 'products' },
    { name: 'Salesman Sales', nav: 'sales-list' },
    { name: 'My Reports', nav: 'my-reports' },
  ];

  for (const p of smPages) {
    const errorsBefore = consoleErrors.length;
    await page.goto(`${BASE}/?nav=${p.nav}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      hasContent: document.querySelector('main')?.children.length > 0,
    }));
    const newErrors = consoleErrors.slice(errorsBefore);
    results.push({ page: p.name, nav: p.nav, overflow: overflow.overflow, hasContent: overflow.hasContent, errors: newErrors.length });
    console.log(`  ${p.name}: overflow=${overflow.overflow}, errors=${newErrors.length}`);
  }

  await browser.close();

  // Summary
  const failures = results.filter(r => r.overflow || r.errors > 0 || !r.hasContent);
  console.log('\n=== SUMMARY ===');
  console.log(`Total pages tested: ${results.length}`);
  console.log(`Failures: ${failures.length}`);
  if (failures.length > 0) {
    console.log('Failed pages:');
    for (const f of failures) console.log(`  - ${f.page}: overflow=${f.overflow}, errors=${f.errors}, content=${f.hasContent}`);
  }
  console.log('\nAll results:');
  for (const r of results) console.log(`  ${r.page}: overflow=${r.overflow}, errors=${r.errors}, content=${r.hasContent}`);

  // Write full results
  const { writeFileSync } = await import('node:fs');
  writeFileSync('/home/z/my-project/audit-out/p9-page-verification.json', JSON.stringify({ results, totalConsoleErrors: consoleErrors.length, allConsoleErrors: consoleErrors.slice(0, 10) }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
