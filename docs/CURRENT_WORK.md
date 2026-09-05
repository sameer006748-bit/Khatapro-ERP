# KhataPro ERP — Current Work

Last updated: 2026-09-05

## Current version
**Version 1 — final client stabilization and handover.**

The intelligent/proactive product vision is intentionally deferred to **Version 2**, which starts only after the client receives and approves Version 1.

## Current phase
**Manual user UAT + client approval.**

## Current objective
**Manual user UAT + client approval.** All Version 1 code work is complete, committed to `main` and deployed. What remains is not code: the user manually verifies the client paths in a real browser and on mobile, completes production data setup, and hands the system to the client for approval.

## Why this is next
Every known code blocker is closed and every gate is green. Continuing to audit the codebase cannot advance the release — only manual verification and the client's approval can. Do not open a new audit pass to answer "is it ready?"; the answer is recorded below.

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
- mobile `More` navigation and Online Sale → View Invoice hotfix (`e9a7a93`), deployed and verified,
- Version 1 closeout batch (`088128a`): product-creation production blocker fixed, shell-navigation primitive, permission/lineage/print/AI test coverage, dead-spec retirement, AI model alignment,
- latest full regression gate: 784/784 tests passing.

## Closed — do not reopen
The navigation/invoice hotfix (`e9a7a93`) and the Version 1 closeout batch (`088128a`) are both complete, committed, pushed and deployed. Their findings are settled; re-auditing them does not change release readiness.

Settled facts, verified by read-only production introspection on 2026-09-05:
- Migrations `00037`, `00038`, `00039`, `00040`, `00041`, `00042` and the business-account identity migration are **applied** to production. Do not re-verify, do not re-apply.
- Migration `00012` opening stock is **not applied**; `post_opening_stock` and `post_opening_stock_ledger` are both absent. This is an accepted Version 1 limitation, not an open task: opening quantity at product creation is refused with a message pointing to Stock Entry, and `create_stock_movement` is present, so the workaround is real.
- The rider workflow is **schema-complete** on production: all 11 rider RPCs and all 5 rider tables the app uses exist. Earlier notes claiming otherwise were wrong. What remains is data, not schema.
- Accepted Version 1 limitations, all failing closed with clear messages: sale discounts refused, mixed same-bill returns refused, opening stock at product creation refused, no in-app user deactivation.

## Validation posture
Agent-side browser automation is intentionally **not** used. Browser, mobile and print verification is manual and user-owned.

Code gates on `088128a`, all green: full regression 784/784, `npx tsc --noEmit`, changed-file ESLint, `npm run build`, `git diff --check`.

## Version 1 exit gate
Version 1 is not considered closed until:
- known P0/P1 client blockers are resolved,
- manual user browser checks pass,
- final production data/role/print/handover checks are complete,
- the client receives the system,
- and the client approves the delivered Version 1.

Only then should `CURRENT_WORK.md` be advanced to a Version 2 phase from `ROADMAP.md`.

## Known blockers / data realities
Nothing in the code blocks handover. What remains is owner-side work:
- **Rider data.** A real Rider login must be linked to the intended `riders` row (Delivery → Riders → Connect Account), and at least one real delivery order must exist for meaningful delivery-outcome UAT. Do not fabricate delivery data.
- **QA/demo records.** `QA TEST FABRIC 01`, `QA TEST TEMP ITEM 01` and `QA TEST VENDOR 01` carry posted `INV-0001` / `PUR-0001`. Deactivate them; never delete posted history, and never delete by name without inspecting references first.
- **Credentials.** The four `*@test.local` logins are reset through Setup → Users → Reset Password. Version 1 has no in-app user deactivation, so a password reset is the supported way to retire a test login.
- **AI.** The Owner enters a Gemini API key in Settings, runs Test Connection, and asks one question. Not a release blocker.
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
**Manual user UAT + client approval.**

Manual UAT order (start with the first item — it is the bug that was just fixed):
1. Add a product.
2. One sale per channel (Counter, Online, OFC, Other), one return, invoice detail from Sales List.
3. Print one invoice in all four modes: Half A4, Two-on-A4, Full A4, 80mm. Confirm no internal commission/accounting data appears on a customer copy.
4. Mobile navigation for Owner/Admin, Accountant, Salesman: every `More` item opens the page it names; Rider navigation stays exactly Home / Deliveries / Cash / Profile.
5. Link the Rider account, run one delivery and one COD submission.
6. AI assistant: enter key, Test Connection, ask one question.
7. Reset the four test-account passwords.

No further code audits before client approval. After client approval, move to the first approved Version 2 phase in `ROADMAP.md`.

## Future agent bootstrap
Before meaningful work, read:
1. `docs/VISION.md`
2. `docs/ARCHITECTURE.md`
3. `docs/CURRENT_STATE.md`
4. this file
5. relevant section of `docs/ROADMAP.md`
6. task-specific code/docs and recent Git history only as needed.

After every meaningful task, update whichever canonical docs changed in reality before declaring the task complete.
