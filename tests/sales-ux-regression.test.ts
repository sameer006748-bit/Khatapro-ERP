import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

const counter = await readFile("src/components/erp/views/counter-sale-view.tsx", "utf8")
const online = await readFile("src/components/erp/views/online-sale-view.tsx", "utf8")
const ofc = await readFile("src/components/erp/views/ofc-sale-view.tsx", "utf8")
const other = await readFile("src/components/erp/views/other-sale-view.tsx", "utf8")
const paymentPanel = await readFile("src/components/erp/sales/payment-panel.tsx", "utf8")

test("sales UX regression: compact item column headers across Online/OFC views", () => {
  // Online and OFC use span-based compact row headers
  for (const name of [online, ofc]) {
    assert.match(name, /Compact column headers/, "compact headers comment present")
    assert.match(name, />Product</)
    assert.match(name, />Qty</)
    assert.match(name, />Price \(Rs\)</)
    assert.match(name, />Remove</)
  }
  // Counter uses table-based <th> headers (different pattern, still present)
  assert.match(counter, />Product</)
  assert.match(counter, />Qty</)
  assert.match(counter, />Total</)
  // Other has no item headers (cart-based layout)
  assert.doesNotMatch(other, />Product</)
})

test("sales UX regression: PaymentPanel has onPayFull in all four sale views", () => {
  for (const src of [counter, online, ofc, other]) {
    assert.match(src, /onPayFull/, "onPayFull prop wired in sale view")
  }
  assert.match(paymentPanel, /onPayFull/, "PaymentPanel accepts onPayFull prop")
})

test("sales UX regression: Online sale view has rider selector wired to assign API", () => {
  assert.match(online, /ridersQ/)
  assert.match(online, /activeRiders/)
  assert.match(online, /Assign Rider/)
  assert.match(online, /delivery-orders.*assign/)
  assert.match(online, /form\.riderId/)
  assert.match(online, /async \(j\)/)
})

test("sales UX regression: change-to-return highlight uses amber in Online view", () => {
  assert.match(online, /bg-amber-50/)
  assert.match(online, /Change to Return/)
  assert.match(online, /text-amber-700/)
})

test("sales UX regression: OFC sale view has onPayFull (no rider selector needed)", () => {
  assert.match(ofc, /onPayFull/)
  assert.doesNotMatch(ofc, /ridersQ/)
  assert.doesNotMatch(ofc, /Assign Rider/)
})

test("sales UX regression: Other sale view has onPayFull (no rider selector needed)", () => {
  assert.match(other, /onPayFull/)
  assert.doesNotMatch(other, /ridersQ/)
  assert.doesNotMatch(other, /Assign Rider/)
})
