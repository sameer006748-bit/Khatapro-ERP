# KhataPro ERP — Current Work

Last updated: 2026-09-05

## Current version
**Version 1 — final client stabilization and handover.**

The intelligent/proactive product vision is intentionally deferred to **Version 2**, which starts only after the client receives and approves Version 1.

## Current phase
**Final release stabilization / client handover.**

## Current objective
Close the last verified client-facing navigation regressions, then complete final release cleanup and handover without destabilizing the accounting/rider work that already passed regression gates.

## Why this is next
The ERP is substantially implemented and deployed. The highest-value work now is not adding new product features; it is removing known release blockers and proving the client paths work on real production/mobile usage.

## Version 1 rule
Until client handover and approval:
- fix bugs before adding features,
- do not begin Version 2 AI/intelligence implementation,
- do not refactor accepted workflows solely for future architecture,
- do not expand scope beyond production correctness, cleanup, role/mobile/print verification and handover readiness unless the client requests it.

## Already complete in this phase
- verified release branch merged to `main`,
- production money-account identity persistence applied and verified,
- Cash/Bank business-account simplification,
- legacy money-account bridge,
- simple user account categories + auto-linked ledgers,
- Expense Batch simplification/posting recovery,
- Rider session identity recovery,
- Rider thumb-first UX,
- Rider account relinking UI,
- latest Rider hotfix deployed to production,
- latest reported Rider regression gate: 678/678 full tests.

## Active hotfix
A separate implementation agent is currently fixing two video-confirmed regressions:

1. **Non-Rider mobile `More` navigation**
   - Owner/Admin, Accountant, and Salesman can open `More`, but selected items may leave My Profile rendered instead of the chosen page.
   - Primary bottom navigation works; shared `More` selection/routing synchronization is the suspected seam.
   - Rider four-item navigation must not regress.

2. **Desktop Online Sale → View Invoice**
   - Online Sale posts successfully.
   - Clicking `View Invoice` after the success screen can end in `Invoice not found`.
   - Sale posting itself must not be changed; fix the identifier/navigation contract.

## Validation for the active hotfix
Agent-side browser automation is intentionally **not required** for this task. The user will do manual browser verification.

Required code gates:
- focused navigation tests,
- focused sales/invoice tests,
- Rider navigation regression tests,
- full regression,
- `npx tsc --noEmit`,
- changed-file ESLint,
- `npm run build`,
- `git diff --check`,
- commit/push/deploy report.

## Definition of done for active hotfix
- Mobile `More` selection renders the selected permitted page for Owner/Admin, Accountant, Salesman.
- My Profile no longer remains stale after `More` navigation.
- Rider nav remains exactly Home / Deliveries / Cash / Profile.
- Online Sale success → View Invoice opens the exact created invoice.
- Sales List → invoice detail still works.
- No posting/accounting/permission regression.
- Production deployment is on the hotfix commit.
- User manually verifies the browser behavior.

## Immediately after the hotfix
Run **one final Version 1 closeout batch** rather than many small feature tasks. It should cover:
- QA/demo production data cleanup with reference inspection before delete/deactivate,
- Rider real-data mapping / assigned-order UAT status,
- opening-stock `00012` reality check (no blind apply),
- stale/obsolete test/spec cleanup where proven stale,
- Owner/Admin, Accountant, Salesman, Rider permission/deep-link audit,
- mobile regression sweep,
- print source/runtime checklist and manual print UAT instructions,
- audit/delete/reversal safety final review,
- production schema/app/main/Vercel sync verification,
- final client credentials / test-account handover readiness,
- stable client URL and explicit remaining blockers.

**Do not assign browser automation to that final closeout agent. Browser verification remains manual/user-owned unless the user explicitly changes this.**

## Version 1 exit gate
Version 1 is not considered closed until:
- known P0/P1 client blockers are resolved,
- manual user browser checks pass,
- final production data/role/print/handover checks are complete,
- the client receives the system,
- and the client approves the delivered Version 1.

Only then should `CURRENT_WORK.md` be advanced to a Version 2 phase from `ROADMAP.md`.

## Known blockers / data realities
- Rider code supports mapping, but a real Rider login must be linked to the intended Rider row and real delivery orders must exist for meaningful delivery-outcome UAT.
- Production QA/demo records must never be blind-deleted; inspect references first.
- Historical docs contain stale branch/migration claims. Use canonical docs + current repository/database reality.

## Do not touch / do not regress
- Do not broad-apply migrations.
- Do not move production toward the incompatible UUID-ledger architecture casually.
- Do not change sales posting while fixing invoice navigation.
- Do not disturb Rider four-item navigation or thumb-first UX.
- Do not weaken server permissions to fix UI navigation.
- Do not remove audit history for posted/used records.
- Do not replace readable account identities with numeric ledger codes.
- Do not let AI become the authoritative accounting calculator.
- Do not start Version 2 intelligence work before Version 1 client approval.

## Exact next task
**Finish the current navigation/invoice hotfix, collect its final report, manually verify the affected browser paths, then run the single final Version 1 closeout/handover batch described above.**

After client approval, move to the first approved Version 2 phase in `ROADMAP.md`.

## Future agent bootstrap
Before meaningful work, read:
1. `docs/VISION.md`
2. `docs/ARCHITECTURE.md`
3. `docs/CURRENT_STATE.md`
4. this file
5. relevant section of `docs/ROADMAP.md`
6. task-specific code/docs and recent Git history only as needed.

After every meaningful task, update whichever canonical docs changed in reality before declaring the task complete.
