# KhataPro UAT Batch 1 — Professional Invoice Design and Half-A4 Printing

## Graphify scope used

Used `graphify-out/graph.json` and `graphify-out/GRAPH_REPORT.md` first. The directly related graph modules were:

- `src/components/invoice/invoice-print-dialog.tsx`
- `src/components/invoice/print-invoice-button.tsx`
- `src/components/erp/views/invoice-detail-view.tsx`
- `src/components/erp/views/sales-list-view.tsx`
- `src/lib/sales/data-access.ts` and `src/app/api/sales/[id]/route.ts` for read-only invoice-data confirmation

## Files changed

- `src/components/invoice/invoice-print-dialog.tsx`
- `src/components/invoice/print-invoice-button.tsx`
- `src/components/erp/views/sales-list-view.tsx`
- `tests/invoice-print.test.ts`

## Shared template and print modes

- Kept one shared template for Counter, Online, and OFC invoice data.
- The title is now type-specific: Sale Invoice, Online Order, or OFC Invoice.
- Half-A4 prints on the **top half of an A4 portrait page**; the lower half is blank and reusable. This makes the browser print boundary and cut position explicit.
- Two-up A4 requires exactly two selected invoices. It never repeats the first invoice into the second half.
- Full A4 remains the controlled fallback for long invoices.
- The print dialog is the print preview. It exposes only Print Half A4, Print Two Invoices on A4, and Print Full A4.

## Print safety and content

- Added dedicated print CSS in physical units (`mm`, `@page`, `148.5mm`) with separate top/bottom blocks, a `CUT HERE` divider, print isolation, compact black/white borders, and `break-inside`/`page-break-inside` guards.
- Rendered-height checking warns for long invoices and blocks half-A4/two-up output when it would overflow; Full A4 is offered instead.
- Totals, paid/outstanding, optional contact fields, payment summary, and existing returned/cancelled status stay conditional. No unavailable tax, rider, delivery, or return amount is invented.

## Verification

- Focused invoice-print tests: **9/9 passed**.
- Targeted lint: passed.
- `git diff --check`: passed.
- `tsc --noEmit`: only the known four baseline diagnostics in `products/data-access.ts` and `rpc-compatibility.ts`; no invoice-print diagnostic was introduced.
- Build classification: external Google Fonts download availability only. The first sandboxed build reported `next/font: error: Failed to fetch Geist` and `Failed to fetch Geist Mono` from `fonts.googleapis.com`; two approval reviews then timed out before the approved command could start. One subsequent approved retry completed successfully (`Compiled successfully in 16.9s`) with no invoice task-caused build error.
- Browser print automation was not callable in this environment, so no visual PDF/browser-preview claim is made. The existing local-print script was not run because it depends on local credentials/data and this task must not create invoices.

## Scope confirmation and remaining risk

No sales posting, payment/tax/discount calculations, stock, returns, commission, rider COD, permissions, APIs, schema, migrations, or accounting formulas changed. No migration was applied, no deployment occurred, and no production data was touched.

Highest remaining risk: browser/printer scaling remains pending manual local preview. Operators must retain 100% scale and A4 portrait in the final local print preview.
