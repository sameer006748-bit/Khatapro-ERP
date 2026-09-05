import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const read = async (path: string) => (await readFile(path, 'utf8')).replace(/\r\n/g, '\n')

// ---------------------------------------------------------------------------
// Production runs the original ("legacy") schema: it has no ledger_vouchers,
// no ledger_accounts and none of the UUID-ledger RPCs. The app also carries the
// newer lineage for databases that do have them, so every call into that
// lineage must sit behind the runtime probe. These tests pin the switch, and
// pin the one place where a missing ledger balance used to read as zero.
// ---------------------------------------------------------------------------

test('the lineage probe treats a missing UUID-ledger table as a supported schema', async () => {
  const bridge = await read('src/lib/identity/legacy-bridge.ts')
  assert.match(bridge, /from\('ledger_vouchers'\)/)
  assert.match(bridge, /if \(isSchemaUnavailableError\(error\)\) \{\n\s+cachedLegacySchema = \{ value: true/)
  // A probe failure that is not "table absent" must not be silently read as
  // legacy, or a transient outage would reroute posting to another lineage.
  assert.match(bridge, /throw new Error\(`Legacy schema probe: /)
})

test('every voucher that can post through the UUID ledger checks the lineage first', async () => {
  const source = await read('src/lib/vouchers/data-access.ts')
  assert.equal(source.match(/rpc\('post_ledger_voucher'/g)?.length, 1)
  const chunks = source.split(/\nexport async function /)
  const canonicalCallers = chunks.filter((c) => c.includes('await postCanonicalVoucher('))
  assert.ok(canonicalCallers.length > 0, 'the canonical path is still reachable')
  for (const chunk of canonicalCallers) {
    const name = chunk.slice(0, chunk.indexOf('('))
    assert.ok(
      chunk.includes('await usesLegacyTransactionSchema()'),
      `${name} must resolve the schema lineage before posting`,
    )
    assert.ok(
      chunk.indexOf('usesLegacyTransactionSchema()') < chunk.indexOf('postCanonicalVoucher('),
      `${name} must check the lineage before it reaches the canonical voucher`,
    )
  }
})

test('financial reports resolve the RPC name from the live schema', async () => {
  const reports = await read('src/lib/reports/data-access.ts')
  assert.match(reports, /const rpc = \(await usesLegacyTransactionSchema\(\)\) \? legacyRpc : uuidRpc/)
  assert.match(reports, /financialReportRpc<any\[\]>\('ledger_profit_loss', 'report_profit_loss'/)
  assert.match(reports, /financialReportRpc<any\[\]>\('ledger_balance_sheet', 'report_balance_sheet'/)
})

// An unreadable General Ledger balance is not a zero balance. Read as zero, the
// reconciliations in the Exceptions report subtract nothing from the full
// operational total and raise a CRITICAL/HIGH discrepancy for the entire
// inventory, receivable, payable and COD position of a perfectly healthy
// business - which is exactly what production, with no ledger_accounts table,
// would show.
test('the exceptions report skips a reconciliation it cannot read the ledger for', async () => {
  const reports = await read('src/lib/reports/data-access.ts')
  const start = reports.indexOf('async function getAccountBalanceByCode(')
  assert.ok(start > 0, 'the GL balance helper is still there')
  const body = reports.slice(start, reports.indexOf('\n}\n', start))
  assert.match(body, /\): Promise<bigint \| null>/)
  assert.doesNotMatch(body, /return 0n/, 'an unreadable balance must not be reported as zero')
  assert.equal(body.match(/return null/g)?.length, 2, 'both failure paths return null')

  for (const [index] of [...reports.matchAll(/= await getAccountBalanceByCode\(/g)].map((m) => [m.index ?? 0])) {
    const site = reports.slice(index, index + 240)
    assert.match(site, /null/, `a GL balance read at offset ${index} must handle an unreadable balance`)
  }

  // The checks that read only operational tables stay useful on production.
  for (const issue of ['Negative stock: ', 'Missing WAC for in-stock product', 'COD submission unconfirmed for > 7 days']) {
    assert.ok(reports.includes(issue), `missing operational check ${issue}`)
  }
})
