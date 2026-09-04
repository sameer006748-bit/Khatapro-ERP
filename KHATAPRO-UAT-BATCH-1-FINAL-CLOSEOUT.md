# KhataPro ERP — Client UAT Batch 1 Final Closeout

**Date/time:** 2026-07-23, Asia/Karachi
**Branch / HEAD:** `fix/backend-stock-recovery` / `81c2c4fb2339c1e47fdbbe8235a85f6803adb200`
**Production project ref:** `ebcebxwpddltiwrqybqc`
**Verdict:** **PASS WITH BLOCKED RUNTIME CHECKS**

## Evidence boundary

No production SQL, migration, deployment, merge, direct table mutation, or production data creation occurred. Runtime evidence below is marked separately from focused static/inspection evidence. No safe disposable Owner/Rider/restricted-user browser session was available through this environment, and no credentials, cookies, headers, or secrets were inspected.

## Verification matrix

| Area | Evidence | Result |
|---|---|---|
| Worktree / expected commits | Branch, HEAD, 15-commit log; only `graphify-out/` untracked | PASS |
| Required migrations | `00014`, `00016`, `00017`, `00018` present; no current migration diff | PASS |
| Home date range | Focused static tests validate presets, shared range, current labels, mobile behavior and permission preservation | PASS (8 assertions); 1 legacy migration-baseline assertion blocked |
| Account subcategories | Focused static tests validate eight parents, one level, filtering, no balance mutation, mobile and access boundaries | PASS (8 assertions); 1 legacy migration-baseline assertion blocked |
| Phase 2 returns / commission | Phase 1/2 focused migration, idempotency, type, authorization and catalog tests | PASS (static/inspection) |
| Phase 3 Rider COD | Focused RPC/security/idempotency/oldest-first/static tests | PASS (static/inspection) |
| Contra / capital / drawings | 10 focused balance, idempotency, concurrency, P&L, permission and mobile assertions | PASS (static/inspection) |
| Invoice printing | 9 focused shared-template, half-A4, two-up, cut line, overflow, mobile and print-isolation assertions | PASS (static) |
| Production normal-flow smoke | Disposable sale/payment/return/commission, Rider COD, Contra/equity and restricted-role calls | BLOCKED — no safe callable production browser/session or disposable test identities |
| Browser print/mobile preview | Actual Counter/Online/OFC preview, 100% scale, responsive widths | BLOCKED — no callable browser runtime in this session |
| Runtime security checks | Cross-business, inactive/restricted user and Rider identity checks | BLOCKED — no safe test sessions; static RPC/profile checks passed |

## Automated checks

- Graph-identified focused suites: **104/106 passed**.
- The two failures are non-product regression-harness scope assertions in `home-date-range.test.ts` and `account-subcategories.test.ts`. They compare against commits before the later, expected `00018_contra_drawings` migration and therefore flag its committed history. `git diff --name-only -- supabase/migrations` is empty for the current worktree; migrations were not changed by closeout.
- Targeted lint across changed Batch 1 TypeScript/TSX files: passed.
- `git diff --check`: passed.
- Production build: passed (`Compiled successfully in 17.5s`).
- `tsc --noEmit`: no new task-caused diagnostic. The documented baseline remains three `TS2741` diagnostics in `src/lib/products/data-access.ts` (lines 235, 401, 456) and one `TS2367` in `src/lib/supabase/rpc-compatibility.ts:194`.

## Mobile and print result

Static mobile-safe layout assertions pass for Home ranges, Money subcategories, Contra/Capital forms, and invoice dialog scrolling. The invoice print template uses A4 physical units, bounded `148.5mm` halves, cut line, print isolation, exact-two two-up protection, and full-A4 overflow fallback. Actual device/browser preview remains blocked.

## Defects

No Batch 1 product defect was proven or fixed in closeout. Low-severity test-harness drift was identified: two historical no-migration tests must eventually compare from their feature baseline or current `HEAD`, not before valid later migrations. It was not changed in this closeout-only task.

## Readiness recommendation

Do **not** merge or deploy solely from this closeout: complete the one disposable normal-flow production smoke and browser/mobile preview first. The branch is code/static-check ready, but final operational acceptance remains conditional on the blocked runtime checks.

## Post-deploy / pre-merge smoke checklist

1. Use a disposable Owner session and `UAT BATCH 1` labels only.
2. Verify Home presets/custom invalid range and current-balance labels on desktop/mobile.
3. Verify subcategory filter is presentation-only.
4. Exercise one idempotent partial sale, payment, credit return, duplicate replay and over-return rejection.
5. With a safe Rider, verify COD delivery has no receipt/commission until idempotent settlement.
6. Verify idempotent Contra, Capital and Drawings plus a restricted-role denial.
7. Preview Counter, Online and OFC invoices at 100% A4 portrait: half top, two independent halves, cut line, long-invoice fallback and mobile controls.
8. Stop immediately on any unexplained accounting or authorization result; preserve evidence without exposing sensitive data.

## Highest production risks

Runtime accounting/authorization behavior and printer-driver scaling remain unverified in this environment. Browser print must remain A4 portrait at 100% scale, and production smoke must use only disposable labelled data.
