# KhataPro UAT Batch 1 — Phase 2 Return and Commission Report

## Scope

Migration `00016_phase2_returns_commission.sql` adds linked, line-level sale
returns and invoice-specific collection commission on the verified production
model: invoices, customers, payments, products, invoice_items,
sale_return_documents, sale_return_lines, and commission_events.

## UAT sequence

1. Post a partial return using invoice-item IDs; verify the document reference,
   `returned_qty`, stock, customer debit/credit, and `Partially Returned`.
2. Repeat the same key; verify the same return reference is returned.
3. Attempt a cumulative quantity above sold quantity; expect rejection.
4. Post a final return; verify `Returned` status and one stock restoration only.
5. Test CREDIT mode (no payment row) and CASH/BANK modes (one `Paid` refund row).
6. Collect a partial invoice payment and then the balance; verify proportional
   commission and final rounding residue. Owner-only events remain reporting-only.

## Operational controls

Do not apply this migration automatically. Do not deploy as part of UAT. Run the
focused tests and inspect the generated migration diff before scheduling a
controlled database change.
