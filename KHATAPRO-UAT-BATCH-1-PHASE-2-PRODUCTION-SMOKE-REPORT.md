# KhataPro UAT Batch 1 — Phase 2 Production Smoke Report

## Run metadata

- Date/time: 2026-07-22 (Asia/Karachi)
- Branch: `fix/backend-stock-recovery`
- Local commit: `706d2276d858b593c1e03c56e685970aca72505d`
- Supabase project: `ebcebxwpddltiwrqybqc`

## Verdict: FAIL

Execution was blocked before the first production request: no authenticated app
browser session was available. No credentials, tokens, cookies, customer data,
or direct SQL were used. Consequently, no disposable product, invoice, return,
payment, or commission event was created.

| Case | Result | Non-sensitive evidence |
| --- | --- | --- |
| Product commission setup/reload | Blocked | No authenticated application session. |
| Partial Phase 2 sale | Blocked | No invoice reference created. |
| Duplicate sale idempotency | Blocked | No sale request sent. |
| Partial invoice payment/idempotency | Blocked | No payment request sent. |
| Partial linked return/idempotency | Blocked | No return reference created. |
| Over-return rejection | Blocked | No prior disposable sale exists. |
| Final-payment rounding | Blocked | No invoice exists. |
| Unauthorized/mismatched-business request | Blocked | No safe restricted test user was available. |

## Safe operator steps to resume

1. In the normal production app, sign in as an active Owner/Admin profile.
2. Create a product named `PHASE2-SMOKE-YYYYMMDD` and set a non-zero commission
   rate; reopen it to confirm the rate.
3. Use Counter Sale to sell quantity three or more with a partial payment and a
   unique retry key. Record only its invoice/reference IDs.
4. From invoice detail, collect a partial invoice payment, create a Credit-mode
   partial return for the displayed invoice-item ID, replay each request once,
   then attempt an over-return. Use the same keys only for the replay.
5. Collect the exact remaining due and compare only counts, statuses, and the
   generated references. A restricted existing test user may then attempt a
   mismatched-business request; do not create users, businesses, or permissions.

## Controls and remaining risk

No migration was applied, no deployment occurred, and no direct SQL data
mutation was performed. The highest remaining risk is unverified live behavior
of the applied RPCs under authenticated concurrency and restricted-role access.
