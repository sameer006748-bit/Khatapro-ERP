import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const DATA_ACCESS = readFile('src/lib/sales/data-access.ts', 'utf8')
const PRISMA_SCHEMA = readFile('prisma/schema.prisma', 'utf8')
const MIGRATIONS = readFile('supabase/migrations/00014_phase1_foundation.sql', 'utf8')

test('postSaleViaPrisma allocates invoice numbers via IdentitySequence', async () => {
  const src = await DATA_ACCESS
  assert.ok(src.includes('identitySequence'), 'Prisma path must use identitySequence')
  assert.ok(!src.includes("findFirst({ where: { businessId: input.businessId }, orderBy: { invoiceNo: 'desc' } })"),
    'Unsafe last-row+1 allocation must be removed from postSaleViaPrisma')
})

test('IdentitySequence model exists with businessId+prefix uniqueness', async () => {
  const schema = await PRISMA_SCHEMA
  assert.match(schema, /model IdentitySequence/)
  assert.match(schema, /@@unique\(\[businessId, prefix\]\)/)
  assert.match(schema, /lastSeq\s+Int/)
})

test('production identity_sequences table exists in migration 00014', async () => {
  const sql = await MIGRATIONS
  assert.ok(sql.includes('identity_sequences'), 'identity_sequences table must exist')
  assert.ok(sql.includes('business_id'), 'identity_sequences must have business_id')
  assert.ok(sql.includes('prefix'), 'identity_sequences must have prefix')
  assert.ok(sql.includes('last_seq'), 'identity_sequences must have last_seq')
})

test('PostSaleInput accepts future Other Sale invoice type', async () => {
  const src = await DATA_ACCESS
  assert.ok(!src.includes("invoiceType: 'COUNTER' | 'ONLINE' | 'OFC'"),
    'invoiceType union restriction must be widened')
  assert.match(src, /businessId: string; invoiceType: string; invoiceDate: Date/)
})
