# KhataPro ERP Documentation Index

## Read these first
These five files are the canonical project-memory set:

1. [`VISION.md`](VISION.md) — durable product direction and AI philosophy.
2. [`ARCHITECTURE.md`](ARCHITECTURE.md) — current architecture and invariants.
3. [`CURRENT_STATE.md`](CURRENT_STATE.md) — concise factual snapshot of what exists now.
4. [`CURRENT_WORK.md`](CURRENT_WORK.md) — exact active phase, blocker, next task, and handoff.
5. [`ROADMAP.md`](ROADMAP.md) — dependency-ordered path from stable ERP to proactive intelligence.

Task-specific authoritative policies may also live in dedicated files such as:
- [`CLIENT_REQUIREMENTS.md`](CLIENT_REQUIREMENTS.md)
- [`ACCOUNTING_CODES_AND_IDENTITIES.md`](ACCOUNTING_CODES_AND_IDENTITIES.md)

## Historical documents
Older status summaries, audit reports, closeout notes, and `CURRENT_IMPLEMENTATION_STATUS.md` contain valuable historical evidence but may include stale branch, migration, or implementation claims.

They are **not** allowed to override verified repository/database reality or the canonical current-state/current-work files.

## Precedence when documents conflict
1. Running code and production/database reality.
2. Verified migrations/schema/RPCs.
3. `ARCHITECTURE.md` + `CURRENT_STATE.md`.
4. `CURRENT_WORK.md`.
5. `ROADMAP.md`.
6. Historical summaries/notes.

`VISION.md` is authoritative for product direction, not implementation status.

## Future-agent bootstrap
Before meaningful work:
1. read `VISION.md`,
2. read `ARCHITECTURE.md`,
3. read `CURRENT_STATE.md`,
4. read `CURRENT_WORK.md`,
5. read the relevant `ROADMAP.md` section,
6. inspect task-specific code/docs,
7. inspect recent Git history only as needed.

## Completion rule
No meaningful task is complete until implementation/checks are done **and** the relevant canonical docs reflect the new reality. `CURRENT_WORK.md` must always end with the exact next task.
