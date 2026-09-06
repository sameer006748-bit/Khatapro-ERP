import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

const reportsApi = await source('src/app/api/reports/route.ts')
const counter = await source('src/components/erp/views/counter-sale-view.tsx')
const online = await source('src/components/erp/views/online-sale-view.tsx')
const ofc = await source('src/components/erp/views/ofc-sale-view.tsx')
const other = await source('src/components/erp/views/other-sale-view.tsx')
const inventory = await source('src/components/erp/views/inventory-view.tsx')

test('financial reports run the report RPC and its classification overlay in parallel', () => {
  // Rows still come straight from the RPC; only the label overlay is joined in
  // the same parallel step so it never serializes behind the heavy report read.
  assert.match(reportsApi, /Promise\.all\(\[\s*reportProfitLoss\(bid, fromDate, toDate\)/)
  assert.match(reportsApi, /Promise\.all\(\[\s*reportBalanceSheet\(bid, toDate\)/)
  assert.match(reportsApi, /Promise\.all\(\[\s*reportExpenseSummary\(bid, fromDate, toDate\)/)
})

test('products master data is cached for longer across sale and inventory screens', () => {
  // Products are shared master data; a longer staleTime skips refetches on plain
  // navigation revisits. Correctness is preserved because every mutation that
  // changes stock invalidates the shared ['products'] key.
  for (const src of [counter, online, ofc, other, inventory]) {
    assert.match(src, /queryKey: \['products'\][\s\S]{0,200}staleTime: 300_000/)
  }
})

test('stock correctness is preserved because posting a sale still invalidates products', () => {
  assert.match(counter, /invalidateQueries\(\{ queryKey: \['products'\] \}\)/)
  assert.match(online, /invalidateQueries\(\{ queryKey: \['products'\] \}\)/)
  assert.match(ofc, /invalidateQueries\(\{ queryKey: \['products'\] \}\)/)
  assert.match(other, /invalidateQueries\(\{ queryKey: \['products'\] \}\)/)
})
