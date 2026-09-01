import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const shell = await readFile('src/components/erp/dashboard-shell.tsx', 'utf8')
const vouchers = await readFile('src/components/erp/views/vouchers-view.tsx', 'utf8')
const productRoute = await readFile('src/app/api/products/[id]/route.ts', 'utf8')
const businessAccountRoute = await readFile('src/app/api/setup/business-accounts/[id]/route.ts', 'utf8')
const auditRoute = await readFile('src/app/api/audit-logs/route.ts', 'utf8')
const permissions = await readFile('src/lib/auth/permissions.ts', 'utf8')

test('voucher workspace reuses the supported forms and preserves deep links', () => {
  assert.match(shell, /key: 'vouchers'/)
  assert.match(shell, /LEGACY_VOUCHER_PAGES/)
  for (const form of ['JournalVoucherView', 'ReceiptVoucherView', 'PaymentVoucherView', 'ContraEntryView']) assert.match(vouchers, new RegExp(form))
  assert.match(vouchers, /tab === 'contra'/)
})

test('audit storage and read projection exclude credential-like metadata', () => {
  assert.match(permissions, /AUDIT_SECRET_KEY/)
  assert.match(permissions, /filter\(\(\[key\]\) => !AUDIT_SECRET_KEY\.test\(key\)\)/)
  assert.match(permissions, /const safeDetails = args\.details \? sanitizeAuditDetails/)
  assert.match(auditRoute, /SECRET_DETAIL_KEY/)
  assert.match(auditRoute, /details/)
})

test('product edits and business-account deletion retain safe audit evidence', () => {
  assert.match(productRoute, /before: \{ name: existing\.name/)
  assert.match(productRoute, /action = parsed\.data\.isActive === false \? 'DEACTIVATE'/)
  assert.match(productRoute, /writeAudit/)
  assert.match(businessAccountRoute, /ACCOUNT_IN_USE/)
  assert.match(businessAccountRoute, /details: \{ name: existing\.name, type: existing\.type/)
  assert.match(businessAccountRoute, /Deactivate it instead/)
})
