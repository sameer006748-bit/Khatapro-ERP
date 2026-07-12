// Phase 9 — Production installability audit via Playwright + Lighthouse
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // Navigate to the app
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Check PWA installability criteria manually:
  // 1. Manifest with required fields
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel=manifest]');
    if (!link) return null;
    const r = await fetch(link.href);
    return r.json();
  });

  // 2. Service worker registered
  const swStatus = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const regs = await navigator.serviceWorker.getRegistrations();
    return {
      supported: true,
      registered: regs.length > 0,
      scope: regs[0]?.scope,
      scriptURL: regs[0]?.active?.scriptURL,
    };
  });

  // 3. HTTPS or localhost (localhost is treated as secure)
  const isSecure = page.url().startsWith('https://') || page.url().startsWith('http://localhost');

  // 4. beforeinstallprompt event (Chrome only, indicates installability)
  // We can't easily test this in headless, but we can check if the manifest is valid.

  // 5. Manifest validation
  const manifestValid = manifest &&
    manifest.name &&
    manifest.short_name &&
    manifest.start_url &&
    manifest.display === 'standalone' &&
    manifest.icons?.some(i => i.sizes === '192x192' || i.sizes === '512x512') &&
    manifest.icons?.some(i => i.purpose?.includes('maskable'));

  // 6. Fetch test for manifest, sw.js, icons
  const fetchTests = {};
  for (const path of ['/manifest.json', '/sw.js', '/icon-192.png', '/icon-512.png', '/maskable-512.png', '/apple-touch-icon.png', '/offline']) {
    const r = await page.evaluate(async (p) => {
      const resp = await fetch(p);
      return { status: resp.status, type: resp.headers.get('content-type') };
    }, path);
    fetchTests[path] = r;
  }

  // 7. Check that SW does NOT cache API
  await page.evaluate(async () => {
    // Trigger an API call
    await fetch('/api/supabase-status');
  });
  await page.waitForTimeout(1000);

  const cacheKeys = await page.evaluate(async () => {
    if (!('caches' in window)) return [];
    const keys = await caches.keys();
    return keys;
  });

  const apiCached = await page.evaluate(async () => {
    if (!('caches' in window)) return false;
    const keys = await caches.keys();
    for (const k of keys) {
      const cache = await caches.open(k);
      const matches = await cache.match('/api/supabase-status');
      if (matches) return true;
    }
    return false;
  });

  await browser.close();

  const result = {
    timestamp: new Date().toISOString(),
    url: BASE,
    isSecure,
    manifest: manifest ? {
      name: manifest.name,
      short_name: manifest.short_name,
      start_url: manifest.start_url,
      display: manifest.display,
      theme_color: manifest.theme_color,
      background_color: manifest.background_color,
      iconsCount: manifest.icons?.length,
      has192: manifest.icons?.some(i => i.sizes === '192x192'),
      has512: manifest.icons?.some(i => i.sizes === '512x512'),
      hasMaskable: manifest.icons?.some(i => i.purpose?.includes('maskable')),
    } : null,
    manifestValid,
    serviceWorker: swStatus,
    fetchTests,
    cacheKeys,
    apiCached,
    installable: isSecure && manifestValid && swStatus.registered,
  };

  writeFileSync('/home/z/my-project/audit-out/p9-installability.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log(`\n=== INSTALLABLE: ${result.installable ? 'YES' : 'NO'} ===`);
}

main().catch(e => { console.error(e); process.exit(1); });
