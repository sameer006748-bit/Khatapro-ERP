# KhataPro ERP — Client Requirements Source of Truth

**Recovered:** 2026-07-23 (Asia/Karachi)
**Authority:** client/UAT wording preserved in `Current-Summary-Updated-21-Jul-2026(1).txt` and `Remaining-Task-Updated-21-Jul-2026(1).txt`; graph relationships in `graphify-out/graph.json` and `graphify-out/GRAPH_REPORT.md`; current branch `fix/backend-stock-recovery`.
**Status rule:** this is a requirements baseline, not a completion claim. A requirement is COMPLETE only after UI, navigation, backend, correct data/accounting/permissions, and authenticated runtime evidence all exist.

## Corrections to the historical handoff

The July handoff is historical input, not proof of completion. Existing Counter, Online and OFC screens predate the client change request and do **not** satisfy a newly requested fourth screen. The requirement is explicit in both historical files (Current Summary lines 120–126 and 251–258; Remaining Task lines 41–47 and 197–208).

### R-OTHER-SALE — separate fourth sale screen

Exact recovered business wording:

> Add a fourth sale category named “Other Sale”. It is a customer-account/credit sale for cases where the customer takes goods now and pays later. Customer selection is mandatory. Paid amount may be zero or partial. The unpaid amount creates/updates customer receivable. Later receipts must be linked to the customer and preferably to the specific Other Sale bill.

Other Sale must use the shared sale invoice sequence and the same linked-return, per-product commission, readable identity, reporting and print rules as Counter, Online and OFC. Where applicable it must support negative stock and temporary products. It must integrate with stock, customer balance, seller attribution, payment and accounting. No final rules beyond the quoted wording were invented; the detailed acceptance choices still undocumented are the exact temporary-product fields and the precise receipt-to-bill allocation UX.

## Confirmed requirements baseline

| ID | Requirement | Recovered source |
|---|---|---|
| R01 | Home summary: Today, Last 3 Days, Last 7 Days, This Month and Custom Range; one period controls activity KPIs; current balances remain distinct; Purchases, money-in/out and pending activity are visible. | Current Summary 228–238; Remaining Task priority 4 |
| R02 | Existing Counter, Online and OFC sale workflows remain real, not merely screens. | Current Summary 120–125; Remaining Task 197–200 |
| R03 | **Other Sale** is a separate fourth credit-sale screen as defined above. | Current Summary 251–258; Remaining Task 41–47 |
| R04 | Sale/return net workflow: negative line references original invoice/line; original stays immutable; stock, balance, revenue, COGS and commission reverse exactly once. | Current Summary 239–249 |
| R05 | Per-product whole-rupee, per-piece salesman/Owner commission accrues on sale/return; later settlement; no duplicates; Owner is Commission Expense plus Owner Commission Payable. | Current Summary 260–284; Remaining Task 220–239 |
| R06 | Owner sale attribution is explicit and not mixed with Drawings. | Current Summary 270–284; approved decisions |
| R07 | Online sale assigns one rider; rider sees only assigned orders and has a simple mobile workflow. | Remaining Task priority 6 |
| R08 | Partial delivery/return preserves only the delivered/returned quantity and is audited. | Remaining Task priority 6 |
| R09 | Rider COD delivery/settlement records actor/time, batch identity, expected/received/remaining COD; delivery and settlement accounting are exact and idempotent. | Remaining Task 49–58 and priority 6 |
| R10 | Every transactional entry has a readable, concurrency-safe identity shown in UI, reports, print and audit. | Remaining Task priority 7 |
| R11 | Real editable account parent categories and one-level subcategories preserve reporting classification and audit/permissions. | Remaining Task priority 8 |
| R12 | One **Contra & Transfers** screen supports atomic multi-row Internal Transfer, Owner Drawing and Capital Introduced with the specified postings. | Remaining Task priority 9 |
| R13 | Capital and Drawings use their true equity postings; Drawing is never fake cash-to-cash Contra. | Remaining Task priority 9 |
| R14 | Professional print documents: Counter, Online, OFC, Other Sale, sale/purchase return, purchase bill, receipt/payment and Contra where applicable; half-A4 and two-up A4. | Current Summary 365–371; Remaining Task 413–432 |
| R15 | Setup cards and sidebar entries are useful, navigate, save/reload, enforce permission and persist through real backend/database operations. | Client correction in audit brief |
| R16 | Configurable Owner/Admin, Accountant, Salesman and Rider permissions; server-side role boundaries. | Remaining Task priority 11 |
| R17 | Customer ledger, vendor ledger, Trial Balance, General Ledger, P&L, Balance Sheet, accounts/balances and petty cash are real business-scoped accounting views. | Client audit brief; Remaining Task priority 11 |
| R18 | Opening balances and opening stock are correct, idempotent and production-verified. | Remaining Task priorities 1 and 11 |
| R19 | Purchase/purchase return; stock in/out/adjustment; negative stock and temporary products work without double mutation. | Current Summary 128–136; Remaining Task priority 11 |
| R20 | KhataPro AI is read-only, business/role/period grounded, labels unsupported numbers safely and never invents or mixes data. | Client correction in audit brief; Remaining Task priority 2 |

## Non-negotiable invariants

- All business reads/writes are scoped to the session business; restricted roles fail closed.
- Posted financial mutations are idempotent; debit equals credit; stock and balances mutate once.
- Client-facing figures must state their period. Current Cash, Bank, Receivables, Payables and Stock are snapshots unless a genuine as-of computation exists.
- No front-end money arithmetic substitutes for server/RPC accounting calculations.
- Runtime browser evidence is required before calling any requirement COMPLETE.

## Requirement index decision

No separate maintained requirements index exists in the graph-linked project files. This document is therefore the authoritative index. The two July files remain unchanged as historical evidence so their prior wording and omission can be audited.
