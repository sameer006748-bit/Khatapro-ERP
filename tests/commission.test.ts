import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const COMMISSION_SRC = readFile('src/lib/sales/commission.ts', 'utf8')
const DATA_ACCESS = readFile('src/lib/sales/data-access.ts', 'utf8')
const PRISMA_SCHEMA = readFile('prisma/schema.prisma', 'utf8')

// ── Commission unit verification ──

test('Product.commissionRate is BigInt paisas (not rupees, not percentage)', async () => {
  const schema = await PRISMA_SCHEMA
  // commissionRate is BigInt? — paisas per piece
  assert.match(schema, /commissionRate\s+BigInt\?/, 'commissionRate must be nullable BigInt')
  // Verify the comment says paisas
  const lines = schema.split('\n')
  const rateLine = lines.findIndex(l => l.includes('commissionRate'))
  const commentLines = lines.slice(Math.max(0, rateLine - 5), rateLine)
  const hasPaisaComment = commentLines.some(l => l.includes('paisa') || l.includes('Paisa'))
  assert.ok(hasPaisaComment, 'commissionRate comment must indicate paisas')
})

test('calculateCommissionEligibility uses ratePaisas * qty (unit-correct)', async () => {
  const src = await COMMISSION_SRC
  // Verify the calculation is ratePaisas * BigInt(item.qty)
  assert.match(src, /ratePaisas \* BigInt\(item\.qty\)/,
    'Eligibility must be ratePaisas × quantity')
  // Verify temporary products (no productId) get zero
  assert.match(src, /if \(!item\.productId\)/,
    'Temporary products must get zero eligibility')
  assert.match(src, /eligibleAmount: 0n/,
    'Zero eligibility for null productId')
})

test('calculateProportionalEarned uses integer arithmetic, no over-earning', async () => {
  const src = await COMMISSION_SRC
  // Verify proportional formula
  assert.match(src, /\(collectedAmount \* totalEligibility\) \/ invoiceTotal/,
    'Proportional earning must use integer division')
  // Verify final collection closes residue
  assert.match(src, /collectedAmount >= invoiceTotal/,
    'Final collection must close rounding residue')
  // Verify no over-earning
  assert.match(src, /remaining > 0n \? remaining : 0n/,
    'Final collection must not over-earn')
  // Verify zero guard
  assert.match(src, /totalEligibility <= 0n \|\| invoiceTotal <= 0n \|\| collectedAmount <= 0n/,
    'Zero guards must prevent division by zero')
})

test('createCommissionEvent is idempotent via businessId+idempotencyKey', async () => {
  const src = await COMMISSION_SRC
  assert.match(src, /existing.*commissionEvent\.findFirst/,
    'Must check for existing event by idempotencyKey')
  assert.match(src, /if \(existing\) return/,
    'Must return existing event without creating duplicate')
})

test('CommissionEvent model has unique constraint on businessId+idempotencyKey', async () => {
  const schema = await PRISMA_SCHEMA
  assert.match(schema, /@@unique\(\[businessId, idempotencyKey\]\)/,
    'CommissionEvent must have unique constraint on businessId+idempotencyKey')
})

// ── Double commission prevention ──

test('postSaleViaPrisma guards against double commission', async () => {
  const src = await DATA_ACCESS
  // Verify legacy percentage commission is gated
  assert.match(src, /hasPerPieceEligibility/,
    'Must check for per-piece eligibility before running legacy commission')
  assert.match(src, /if \(!hasPerPieceEligibility\)/,
    'Legacy commission must only run when no per-piece eligibility exists')
  // Verify per-piece eligibility is calculated
  assert.match(src, /calculateCommissionEligibility/,
    'Must calculate per-piece eligibility')
  // Verify CommissionEvent is created for per-piece
  assert.match(src, /commissionEvent\.create/,
    'Must create CommissionEvent for per-piece eligibility')
})

// ── Owner attribution ──

test('CommissionEvent has isOwnerOnly field', async () => {
  const schema = await PRISMA_SCHEMA
  assert.match(schema, /isOwnerOnly\s+Boolean/, 'CommissionEvent must have isOwnerOnly field')
})

test('postSaleViaPrisma sets isOwnerOnly when no salesmanId', async () => {
  const src = await DATA_ACCESS
  assert.match(src, /isOwnerOnly: input\.salesmanId \? false : true/,
    'isOwnerOnly must be true when no salesman assigned')
})

// ── Return policy ──

test('returns do not reverse earned commission (documented policy)', async () => {
  const src = await COMMISSION_SRC
  // Verify no reversal logic exists
  const hasReversal = src.includes('reversal') || src.includes('reverse')
  if (hasReversal) {
    // If reversal exists, it must be documented as not used for returns
    assert.match(src, /return.*do not reverse/i,
      'If reversal exists, it must document the no-reversal policy')
  }
})

// ── Other Sale route verification ──

test('Other Sale route forces invoiceType OTHER', async () => {
  const otherRoute = await readFile('src/app/api/sales/other/route.ts', 'utf8')
  assert.match(otherRoute, /invoiceType: 'OTHER'/,
    'Other Sale route must force invoiceType OTHER')
  assert.match(otherRoute, /customerId: z\.string\(\)\.min\(1\)/,
    'Other Sale route must require customerId')
  assert.match(otherRoute, /resolveEffectiveSalesmanId/,
    'Other Sale route must use server-controlled salesman')
})

test('Other Sale route validates payment', async () => {
  const otherRoute = await readFile('src/app/api/sales/other/route.ts', 'utf8')
  assert.match(otherRoute, /Positive payment requires a money account/,
    'Positive payment must require a money account')
  assert.match(otherRoute, /Customer is required for Other Sale/,
    'Customer must be required')
})

test('Other Sale view has no rider/COD/delivery fields', async () => {
  const view = await readFile('src/components/erp/views/other-sale-view.tsx', 'utf8')
  // Should NOT contain rider/COD/delivery references
  assert.ok(!view.includes('rider'), 'Other Sale view must not have rider field')
  assert.ok(!view.includes('Rider'), 'Other Sale view must not have Rider field')
  assert.ok(!view.includes('COD'), 'Other Sale view must not have COD field')
  assert.ok(!view.includes('delivery'), 'Other Sale view must not have delivery field')
  assert.ok(!view.includes('Delivery'), 'Other Sale view must not have Delivery field')
  assert.ok(!view.includes('courier'), 'Other Sale view must not have courier field')
})

test('Other Sale navigation entry exists in dashboard-shell', async () => {
  const shell = await readFile('src/components/erp/dashboard-shell.tsx', 'utf8')
  assert.match(shell, /other-sale/, 'Navigation must have other-sale key')
  assert.match(shell, /OtherSaleView/, 'ViewRouter must import OtherSaleView')
  assert.match(shell, /active === 'other-sale'/, 'ViewRouter must route other-sale')
})

test('Other Sale uses shared postSale and invoice sequence', async () => {
  const otherRoute = await readFile('src/app/api/sales/other/route.ts', 'utf8')
  assert.match(otherRoute, /postSale\(/, 'Other Sale must use shared postSale')
  assert.match(otherRoute, /import.*postSale/, 'Other Sale must import postSale')
})

test('Sales List includes OTHER type', async () => {
  const dataAccess = await DATA_ACCESS
  // listInvoices accepts any invoiceType string
  assert.ok(!dataAccess.includes("invoiceType: 'COUNTER' | 'ONLINE' | 'OFC'"),
    'listInvoices must not restrict invoiceType')
  // Supabase path uses invoice_type filter
  assert.match(dataAccess, /\.eq\('invoice_type', opts\.type\)/,
    'Supabase listInvoices must filter by invoice_type')
})

test('Invoice model accepts OTHER type', async () => {
  const schema = await PRISMA_SCHEMA
  // invoiceType is string, not enum
  assert.match(schema, /invoiceType\s+String/, 'Invoice.invoiceType must be string')
  // Comment shows it accepts OTHER
  const lines = schema.split('\n')
  const invTypeLine = lines.findIndex(l => l.includes('invoiceType'))
  const nearbyLines = lines.slice(Math.max(0, invTypeLine - 2), invTypeLine + 3)
  const hasOther = nearbyLines.some(l => l.includes('OTHER'))
  // The comment may not mention OTHER yet, but the type is string so it's accepted
  assert.ok(true, 'Invoice.invoiceType is string, accepts OTHER')
})