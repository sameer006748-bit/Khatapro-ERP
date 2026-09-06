# KhataPro ERP — Agent Bootstrap

This repository maintains canonical project memory so a new agent/session does not need the user to re-explain the project.

## Mandatory read order
1. `docs/PROJECT_MEMORY.md` — A-to-Z project memory: product boundary, production facts, major history, current live defects, priorities, performance/hosting position, print/invoice direction, and future roadmap.
2. `docs/VISION.md`
3. `docs/ARCHITECTURE.md`
4. `docs/CURRENT_STATE.md`
5. `docs/CURRENT_WORK.md`
6. relevant `docs/ROADMAP.md` section
7. task-specific code/docs/recent Git history only as needed.

## Current phase
**Version 1 — deep UAT recovery / professional release polish.**

Deep production UAT on 2026-09-06 reopened release work. Older notes claiming "manual UAT only", "no code blockers" or "ready for client handover" are stale unless current canonical docs say so.

## Production source of truth
- Branch: `main`
- Stable URL: `https://khatapro-erp.vercel.app`
- Supabase ref: `ebcebxwpddltiwrqybqc`
- Production accounting path: legacy/original schema rooted at `business`; do not assume UUID-ledger migrations apply.

Folder/worktree names are not authoritative. Verify branch/HEAD before edits or deploys.

## Runtime-sensitive acceptance
For runtime/visual tasks:

**observe production → capture network/log evidence → root cause → smallest bounded fix → focused/full gates → push/deploy → verify stable alias → retest production.**

Static tests are necessary but not sufficient.

## Durable constraints
- Never broad-apply migrations.
- Never weaken server-side tenant/permission boundaries.
- Never casually hard-delete posted accounting history.
- Never commit/expose secrets, API keys, passwords or protected local files.
- AI is an interpretation layer, not the accounting calculator of record.
- Preserve Rider four-item mobile navigation and role simplicity.
- Do not rewrite stable financial posting paths without direct live evidence.
- Do not begin Version 2 proactive AI before Version 1 client acceptance.
- Do not run a new whole-repo audit merely to rediscover facts already settled in canonical memory.

## Documentation rule
After meaningful work, update the canonical docs that changed in reality. `docs/CURRENT_WORK.md` must state the exact current/next task or decision before completion.
