# KhataPro ERP Documentation Index

Last reconciled: **2026-09-08**

## Read these first

The canonical project-memory set is now led by the comprehensive handoff file:

1. [`PROJECT_MEMORY.md`](PROJECT_MEMORY.md) — **read first**; A-to-Z handoff covering product boundary, repository/production facts, important history, settled migrations, major completed work, latest live UAT findings, performance/hosting position, print/invoice direction, current priorities, workflow rules, and future path.
2. [`VISION.md`](VISION.md) — durable product direction and AI philosophy.
3. [`ARCHITECTURE.md`](ARCHITECTURE.md) — current architecture and invariants.
4. [`CURRENT_STATE.md`](CURRENT_STATE.md) — concise factual snapshot of what exists now.
5. [`CURRENT_WORK.md`](CURRENT_WORK.md) — exact active Version 1 phase, blockers, priorities, and next decision/task.
6. [`ROADMAP.md`](ROADMAP.md) — dependency-ordered path from stable Version 1 to proactive Version 2 intelligence.

Task-specific authoritative policies may also live in dedicated files such as:
- [`CLIENT_REQUIREMENTS.md`](CLIENT_REQUIREMENTS.md)
- [`ACCOUNTING_CODES_AND_IDENTITIES.md`](ACCOUNTING_CODES_AND_IDENTITIES.md)

## Current release reality

Version 1 is in **Client UAT / Handover** at the `v1.0.0-client-uat` checkpoint. The deep-UAT recovery blockers are closed and final AI/print manual verification passed; this is not final client approval. Client feedback may receive bounded V1 hotfixes only, and Version 2 remains deferred until explicit approval.

Do not use an older "manual UAT only / no code blockers" note as the current state.

## Historical documents

Older status summaries, audit reports, closeout notes, and `CURRENT_IMPLEMENTATION_STATUS.md` contain valuable historical evidence but may include stale branch, migration, release-readiness, or implementation claims.

They are **not** allowed to override verified repository/database reality or the canonical project-memory/current-state/current-work files.

## Precedence when documents conflict

1. Running production code/database/browser evidence.
2. Verified migrations/schema/RPCs/runtime logs.
3. `PROJECT_MEMORY.md` + `ARCHITECTURE.md` + `CURRENT_STATE.md`.
4. `CURRENT_WORK.md`.
5. `ROADMAP.md`.
6. Historical summaries/notes.

`VISION.md` is authoritative for product direction, not implementation status.

## Future-agent bootstrap

Before meaningful work:
1. read `PROJECT_MEMORY.md`,
2. read `VISION.md`,
3. read `ARCHITECTURE.md`,
4. read `CURRENT_STATE.md`,
5. read `CURRENT_WORK.md`,
6. read the relevant `ROADMAP.md` section,
7. inspect task-specific code/docs,
8. inspect recent Git history only as needed.

Do not start with a broad repository audit simply to rediscover settled project facts.

## Runtime-sensitive completion rule

Previous sessions proved that green source/unit tests can coexist with real production failures. For runtime-sensitive work use:

**observe live → capture evidence → root cause → bounded fix → tests/gates → push/deploy → verify stable alias → retest live.**

The stable client URL is:

`https://khatapro-erp.vercel.app`

A Vercel preview/deployment URL is not the final verification target unless it is also confirmed to be serving the stable alias.

## Documentation completion rule

No meaningful task is complete until implementation/checks are done **and** the relevant canonical docs reflect the new reality.

- Update `PROJECT_MEMORY.md` when overall project reality changes.
- Update `CURRENT_STATE.md` when factual status changes.
- `CURRENT_WORK.md` must always identify the exact active/next task or decision.
- Update `ROADMAP.md` only when sequencing/phase reality changes.
