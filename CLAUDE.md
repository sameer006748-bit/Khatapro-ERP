# KhataPro ERP — Claude Bootstrap

Before doing meaningful work in this repository, read the canonical project memory in this exact order:

1. `docs/PROJECT_MEMORY.md` — **A-to-Z project handoff: past, current production reality, active defects, priorities, and future path.**
2. `docs/VISION.md`
3. `docs/ARCHITECTURE.md`
4. `docs/CURRENT_STATE.md`
5. `docs/CURRENT_WORK.md`
6. relevant section of `docs/ROADMAP.md`
7. task-specific code/docs and recent Git history only as needed.

## Current release boundary
KhataPro is still in **Version 1 deep UAT recovery / professional release polish**. Do not start Version 2 proactive/intelligent expansion before client approval.

Deep production UAT on 2026-09-06 reopened release work. Do not rely on older notes saying "manual UAT only / no code blockers" or "ready for handover". The canonical docs list the current accounting/AI/performance/loading/encoding/print/invoice issues.

## Production
- Production branch: `main`
- Stable client URL: `https://khatapro-erp.vercel.app`
- Supabase production ref: `ebcebxwpddltiwrqybqc`
- Live production uses the legacy/original `business`-rooted schema, not the newer UUID-ledger architecture.

Always verify Git branch/HEAD. Local folder names such as "Rider Hotfix" are not source-of-truth.

## Runtime-sensitive workflow
Previous green tests repeatedly missed real production failures. For runtime/visual work use:

**OBSERVE LIVE → CAPTURE NETWORK/LOG EVIDENCE → ROOT CAUSE → BOUNDED FIX → TEST/GATES → PUSH/DEPLOY → VERIFY STABLE ALIAS → RETEST LIVE.**

Do not call an item PASS only because tests or static analysis pass.

## Do not regress
- No broad migration application.
- No casual UUID-ledger migration of production.
- No weakening server permissions.
- No hard-delete of posted accounting history.
- No secrets/passwords/API keys in code/docs/logs/commits.
- No AI-generated authoritative accounting truth.
- Do not break Rider four-item navigation.
- Do not rewrite stable posting paths without live root-cause evidence.
- Do not start whole-repo audits merely to rediscover settled facts.

## Completion rule
After every meaningful task, update the canonical docs that changed in reality. `docs/CURRENT_WORK.md` must reflect the exact next task/decision before the task is declared complete.
