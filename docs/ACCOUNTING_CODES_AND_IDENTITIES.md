# KhataPro ERP — Accounting Code Words and Entry Identities

Last updated: 2026-08-28

This file defines the naming policy for human-readable transaction identities and account/category/subcategory code words.

Agents working on accounting, setup, accounts, vouchers, invoices, purchases, expenses, payments, receipts, contra, returns, stock, commission, rider settlement, or reporting must read this file first.

## 1. Two Different Coding Systems

KhataPro must maintain both:

1. **Transaction identity prefixes** — sequential entry references such as `INV-0001`.
2. **Account/category/subcategory code words** — readable semantic identifiers such as `EXP-COMM`.

Numeric Chart of Accounts codes such as `1010`, `1020`, `2010` may remain as accounting numbers where needed, but they are NOT a replacement for readable code words.

## 2. Transaction Identity Format

Preferred format:

`PREFIX-0001`

Rules:
- prefix is uppercase;
- prefix is stable once introduced;
- sequence is business-scoped;
- numbering must be monotonic per business + entry type;
- IDs must be generated transactionally;
- duplicate submissions must not consume/create duplicate business entries;
- the same identity must appear in list view, detail view, print, ledger reference, related commission/payment/return references, and audit history.

## 3. Required Transaction Prefix Registry

This is the baseline registry. Existing database naming may be mapped internally, but customer-facing/business references should follow one stable convention.

| Business Entry | Prefix | Example |
|---|---|---|
| Sales Invoice | `INV` | `INV-0001` |
| Purchase Bill | `PUR` | `PUR-0001` |
| Expense | `EXP` | `EXP-0001` |
| Receipt / Money Received | `REC` | `REC-0001` |
| Payment / Money Paid | `PAY` | `PAY-0001` |
| Contra | `CON` | `CON-0001` |
| Sales Return | `SRT` | `SRT-0001` |
| Purchase Return | `PRT` | `PRT-0001` |
| Journal Voucher | `JRV` | `JRV-0001` |
| Debit Note | `DBN` | `DBN-0001` |
| Credit Note | `CRN` | `CRN-0001` |
| Stock Adjustment | `STA` | `STA-0001` |
| Stock Transfer / Movement Document | `STM` | `STM-0001` |
| Opening Stock | `OPS` | `OPS-0001` |
| Rider Settlement | `RDS` | `RDS-0001` |
| Commission Settlement / Payable Event Group | `COM` | `COM-0001` |

### Prefix implementation rule
Before implementing a new prefix, check the existing identity-sequence implementation and data already in production. Do not rename historical identifiers destructively. Add a compatibility mapping/migration where necessary.

## 4. Account / Category / Subcategory Code Words

Readable code words are separate from transaction references.

Format recommendations:

- top-level category: `CATEGORY`
- subcategory: `CATEGORY-SUBTYPE`
- institution-specific account: `CATEGORY-INSTITUTION`
- deeper level only when necessary: `CATEGORY-SUBTYPE-DETAIL`

Examples:
- `CASH`
- `PETTY-CASH`
- `BANK-MZN`
- `BANK-JAZZ`
- `EXP-SALARY`
- `EXP-COMM`
- `EXP-DELIVERY`
- `ASSET-STOCK`
- `LIAB-PAYABLE`
- `DRAW-OWNER`

## 5. Baseline Readable Code Registry

This is a starting controlled vocabulary, not a hard-coded database seed that users cannot change.

### Assets

| Category / Subcategory | Code Word |
|---|---|
| Cash | `CASH` |
| Petty Cash | `PETTY-CASH` |
| Bank | `BANK` |
| Meezan Bank | `BANK-MZN` |
| JazzCash | `BANK-JAZZ` |
| Easypaisa | `BANK-EASY` |
| Accounts Receivable | `AR` |
| Inventory / Stock | `ASSET-STOCK` |
| Fixed Assets | `ASSET-FIXED` |
| Advances Given | `ADV-GIVEN` |

### Liabilities

| Category / Subcategory | Code Word |
|---|---|
| Accounts Payable | `LIAB-PAYABLE` |
| Supplier Payable | `LIAB-SUPPLIER` |
| Rider Payable / Settlement Balance | `LIAB-RIDER` |
| Commission Payable | `LIAB-COMM` |
| Advances Received | `ADV-RECEIVED` |

### Income

| Category / Subcategory | Code Word |
|---|---|
| Sales Income | `INC-SALES` |
| Counter Sales | `INC-COUNTER` |
| Online Sales | `INC-ONLINE` |
| OFC Sales | `INC-OFC` |
| Other Sales | `INC-OTHER` |
| Delivery / Service Income | `INC-DELIVERY` |
| Other Income | `INC-OTHER-GEN` |

### Expenses

| Category / Subcategory | Code Word |
|---|---|
| General Expense | `EXP-GENERAL` |
| Salary | `EXP-SALARY` |
| Sales Commission | `EXP-COMM` |
| Delivery Expense | `EXP-DELIVERY` |
| Rent | `EXP-RENT` |
| Utilities | `EXP-UTILITY` |
| Transport | `EXP-TRANSPORT` |
| Packaging | `EXP-PACKING` |
| Bank Charges | `EXP-BANK` |
| Miscellaneous | `EXP-MISC` |

### Equity / Owner

| Category / Subcategory | Code Word |
|---|---|
| Owner Capital | `CAP-OWNER` |
| Owner Drawings | `DRAW-OWNER` |
| Retained Earnings | `EQUITY-RETAINED` |

## 6. User-Defined Category Rules

Users must be able to create categories/subcategories with readable code words.

Required validation:
- code word required for accounting-relevant category/subcategory;
- uppercase normalization;
- letters, numbers and hyphens only;
- no leading/trailing hyphen;
- no duplicate code word inside the same business;
- recommended maximum length: 32 characters;
- code word remains stable after transactions reference it;
- changing display name must not silently change historical code word;
- destructive code-word changes require explicit guarded workflow.

Example:

Display name: `Facebook Ads`
Code word: `EXP-FB-ADS`

## 7. Category/Subcategory Hierarchy

A category may contain subcategories. The UI should show both display name and code word.

Example:

- Expenses (`EXP` conceptual family)
  - Sales Commission (`EXP-COMM`)
  - Delivery (`EXP-DELIVERY`)
  - Salary (`EXP-SALARY`)

The code word must be available in:
- account/category setup;
- selectors;
- reports;
- ledger references where useful;
- exports;
- audit views.

Do not replace user-friendly names with codes. Show both where appropriate, e.g.:

`Sales Commission · EXP-COMM`

## 8. Business Account Codes

User-managed payment/business accounts should have readable identifiers independent of their numeric CoA account number.

Examples:
- Cash — `CASH`
- Meezan Bank — `BANK-MZN`
- JazzCash — `BANK-JAZZ`
- Easypaisa — `BANK-EASY`

A UI label may render:

`Meezan Bank · BANK-MZN`

If the legacy numeric CoA code is useful, it can appear secondarily:

`Meezan Bank · BANK-MZN · 1020`

Never make `1020` the only meaningful business identifier.

## 9. Contra References

Each Contra document gets its own entry identity, e.g. `CON-0001`.

A single Contra document may contain multiple internal-transfer rows. Each row should retain:
- from account;
- to account;
- amount;
- note/reference;
- optional row sequence;
- parent Contra identity.

Example:

`CON-0042`
- Cash → Petty Cash
- Meezan Bank → Cash
- Cash → Owner Drawings

Do not generate a separate Contra identity for every row unless a business rule explicitly requires separate documents.

## 10. Returns and Original References

Return identities must not destroy the original sale/purchase reference.

Example:
- Original invoice: `INV-0123`
- Return document: `SRT-0021`
- Return line stores original `INV-0123` + original invoice item ID.

Likewise:
- Original purchase: `PUR-0088`
- Purchase return: `PRT-0010`

## 11. Commission References

Commission must retain invoice-level and item-level references.

Commission events should store or resolve:
- invoice identity (`INV-xxxx`);
- invoice item;
- seller;
- product;
- sold qty;
- returned qty;
- net eligible qty;
- per-piece rate;
- commission amount;
- collection/payment reference when earned.

If a commission settlement document is introduced, use `COM-xxxx` while retaining the underlying `INV-xxxx` references.

## 12. Migration / Compatibility Rules

- Do not destructively rename existing production IDs.
- Do not reset sequences.
- Seed sequence state from the highest existing number when introducing a prefix to existing data.
- Identity creation must be atomic.
- New code-word columns/constraints should be additive and backfilled safely.
- Existing numeric CoA codes may remain for accounting compatibility.
- Readable code words must be introduced alongside them, not by erasing them.

## 13. Current Implementation Status

As of 2026-08-28:
- `INV-xxxx` identity behavior exists and was manually observed with `INV-0002` locally.
- identity sequence foundation exists;
- complete prefix coverage across all accounting-relevant entries is NOT yet verified;
- readable category/subcategory code words are NOT yet implemented end-to-end;
- current UI can still show numeric account codes such as `Cash (1010)`; this does not satisfy the final requirement.

See `docs/CLIENT_REQUIREMENTS.md` and `docs/CURRENT_IMPLEMENTATION_STATUS.md` before implementation.