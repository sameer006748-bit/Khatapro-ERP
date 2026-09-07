# KhataPro ERP — Roadmap

Last reconciled: **2026-09-08**

This roadmap is dependency-driven. It does not assign arbitrary dates and it does not imply that every listed idea is already approved for implementation.

Read `docs/PROJECT_MEMORY.md` for the complete A-to-Z handoff before using this roadmap.

## Release boundary
KhataPro development is intentionally split into two product versions:

- **Version 1:** finish, stabilize, professionalize, hand over and obtain client approval for the current ERP.
- **Version 2:** only after Version 1 approval, evolve KhataPro toward the intelligent/proactive product vision in `docs/VISION.md`.

Do not begin Version 2 intelligence work until explicit client approval of Version 1.

---

# Version 1 — Client UAT / Handover

## Objective
Deliver a dependable, responsive, financially trustworthy and professionally presented ERP that a real client can use without known P0/P1 workflow, accounting, performance, print, role/mobile, or data-integrity blockers.

## Current reality
Earlier release closeout and live recovery fixed several serious production defects, including Rider assignment, invoice reads, AI configuration/connectivity, and permission-denial response behavior.

The deep-UAT recovery cycle is complete and user manual verification passed for final AI and print fixes. Version 1 is now in **Client UAT / Handover**, tagged `v1.0.0-client-uat`; it is not final client-approved. Client feedback may receive bounded V1 hotfixes only—no V1 feature expansion during the freeze.

## Phase V1-A — Deterministic correctness / trust

### Deliverables
- resolve/explain Trial Balance **Rs 2,505.00** difference from actual ledger/posting/report evidence,
- fix AI money-unit/paisa→rupee scaling so observed ~100× errors cannot occur,
- verify AI period scoping with explicit deterministic period/unit metadata,
- verify apparent Cash/Bank cross-screen difference is either intentional semantics or a real defect before changing accounting,
- preserve deterministic ERP/accounting truth as authoritative.

### Exit criteria
- Trial Balance/report truth is explainably consistent,
- AI receives exact normalized values/units and does not multiply money accidentally,
- period semantics are explicit and tested,
- no cosmetic force-balancing or LLM guessing is used.

## Phase V1-B — Performance / perceived quality recovery

### Deliverables
- measure click-to-usable timings across representative major screens,
- capture browser network waterfall and slow API timings,
- separate client rendering, Vercel function TTFB, Supabase query/RPC time, serial waterfalls, refetches and region latency,
- optimize heavy/common server readers and repeated shared-data requests,
- use cache/prefetch where financially safe,
- eliminate false-empty loading states (including Riders list race),
- use progressive/skeleton loading instead of blank or misleading states,
- verify realistic performance on the stable production alias.

### Infrastructure decision gate
Do **not** migrate Supabase/hosting to Hostinger/VPS by assumption.

Before infrastructure migration, prove with measurements whether the bottleneck is:
- client/render architecture,
- server/API orchestration,
- database/query performance,
- region/network latency,
- serverless cold starts/free-tier resource limits,
- or a combination.

A domain purchase is not a performance fix.

### Exit criteria
- routine navigation feels responsive,
- common cached/safe screens are near-instant where practical,
- routine server-backed screens no longer routinely take several seconds,
- heavy reports have measured/understood latency rather than unexplained 5–6 second waits,
- no false authoritative empty state while data is still loading.

## Phase V1-C — AI UX / text-quality cleanup

### Deliverables
- Roman Urdu selection reliably controls fresh and retried answers,
- retry/timeout states are bounded and clearly communicated,
- no duplicate requests caused by retry UI,
- mojibake/encoding strings removed (`â€¦`, `â€™`, etc.),
- existing AI connectivity remains stable (`gemini-3.5-flash` live path unless deliberately changed with evidence).

### Exit criteria
- selected language is honored,
- transient provider failures degrade clearly,
- UI text renders clean UTF-8,
- no return to `AI_NOT_CONFIGURED`/decryption/model-access failures.

## Phase V1-D — Print isolation and professional documents

### Deliverables
- remove visible background/modal ghosting around `window.print()`,
- isolate printable DOM cleanly from application/sidebar/backdrop,
- preserve shared deterministic invoice print serialization,
- redesign sale invoices into one professional document identity across Counter / Online / OFC / Other,
- support Half A4, Two-up A4, Full A4, and 80mm with consistent brand/document hierarchy,
- professional business header, customer/Bill To block, ruled item table, totals, payments/status, footer, and optional signature/terms where appropriate,
- customer copies never expose internal commission/accounting,
- preview represents the real final document more faithfully.

### Exit criteria
- no print transition glitch,
- all four formats visually approved by the user,
- invoices look like professional business documents rather than ERP UI output,
- printed figures match deterministic invoice detail data.

## Phase V1-E — Final role/mobile/data handover

### Deliverables
- final Owner/Admin, Accountant, Salesman, Rider desktop/mobile smoke,
- final sale → invoice → Sales List → print paths,
- final Rider assignment/delivery/COD smoke,
- safe QA/demo record archive/deactivation,
- reset/retire test credentials through supported flow,
- verify intended Ready deployment serves `https://khatapro-erp.vercel.app`,
- client handover checklist and approval.

### Version 1 exit criteria
- no known P0/P1 client workflow/accounting blocker,
- current deep-UAT issues resolved or explicitly accepted by the user/client,
- Owner/Admin, Accountant, Salesman, Rider role flows verified,
- core posting/reporting workflows work on production,
- performance is acceptable for real daily use,
- final print formats are visually approved,
- no unsafe test/demo data exposed to client,
- production stable alias and intended `main` commit are in sync,
- handover credentials/role access confirmed,
- **client receives Version 1 and approves it for Version 2.**

### Hard gate
Until these exit criteria and client approval are reached:
- do not start Version 2 proactive/intelligence work,
- do not destabilize accepted ERP workflows for future architecture,
- prioritize deterministic correctness, performance, print professionalism, bug fixing, cleanup and handover.

---

# Version 2 — Intelligent ERP evolution

The following phases begin only after Version 1 is accepted. They implement the long-term vision progressively without replacing deterministic accounting truth.

## Version 2 — Phase 2: ERP truth consolidation
### Objective
Make deterministic business facts consistently available through stable server/data-access contracts.

### Deliverables
- resolve remaining schema-debt decisions only when needed,
- document authoritative readers for sales, collections, expenses, returns, stock, receivables, payables, cash, Rider COD, commission,
- remove unsafe fallbacks and duplicate calculation paths,
- strengthen audit/source traceability,
- improve performance of commonly reused business summaries.

### Exit criteria
A future intelligence layer can request business facts without inventing accounting logic or scraping UI behavior.

## Version 2 — Phase 3: Reliable natural-language business answers
### Objective
Make AI a trustworthy read/explain layer over deterministic facts.

### Deliverables
- map natural-language intents to bounded deterministic tools/readers,
- support Roman Urdu / conversational business questions,
- return source-aware answers,
- distinguish fact from interpretation,
- handle missing/uncertain data explicitly,
- enforce role and tenant permissions in every AI request.

### Exit criteria
The owner can ask common business questions naturally and receive answers derived from verified ERP facts.

## Version 2 — Phase 4: Explanations, comparisons, and owner summaries
### Objective
Move from single-answer lookup toward useful business interpretation.

### Deliverables
- period comparisons,
- verified morning/evening summaries,
- explanations for deterministic changes,
- evidence links/drill-downs to underlying records,
- confidence and unsupported-data handling.

### Exit criteria
KhataPro can explain what changed and why without becoming the accounting engine.

## Version 2 — Phase 5: Anomaly and exception detection
### Objective
Detect meaningful deviations that deserve attention.

### Deliverables
Potentially, where data supports them:
- unusual returns,
- unusual expense movement,
- delayed receivables,
- Rider cash/settlement exceptions,
- collection-vs-sales weakness,
- duplicate/suspicious entries,
- stock/sales mismatches.

Use deterministic/statistical signals first; AI may explain the signal.

### Exit criteria
Alerts have measurable thresholds/evidence and an acceptable false-positive rate.

## Version 2 — Phase 6: Proactive owner intelligence
### Objective
Surface a small number of prioritized attention items without requiring the owner to search.

### Deliverables
- attention ranking by impact, urgency, abnormality, confidence, actionability,
- concise proactive summaries,
- drill-back to evidence,
- alert deduplication/noise control,
- notification policy appropriate to business importance.

### Exit criteria
The system consistently answers “what matters now?” without overwhelming the owner.

## Version 2 — Phase 7: Controlled AI-assisted actions
### Objective
Allow AI to prepare or recommend actions while preserving human control.

### Maturity path
OBSERVE → UNDERSTAND → EXPLAIN → RECOMMEND → PREPARE → HUMAN APPROVAL → EXECUTE

### Possible deliverables
- draft reminders,
- prepare reports,
- suggest corrections,
- prepare low-risk entries/workflows,
- approval-gated execution.

Financial writes remain policy- and permission-controlled.

### Exit criteria
Every AI-assisted mutation is explicit, auditable, reversible where appropriate, permission-safe, and never relies on LLM-generated financial truth.

## Version 2 — Phase 8: Productization and pilot scale
### Objective
Make KhataPro repeatable across real customers.

### Deliverables
- onboarding quality,
- tenant isolation review,
- support/recovery procedures,
- performance baselines,
- backup/recovery strategy where applicable,
- AI cost/failure controls,
- observability,
- pilot feedback loops,
- deployment/runbook maturity.

### Exit criteria
KhataPro can be operated and supported as a product, not only as a single custom implementation.

## Roadmap rules
- Version 1 client approval is the gate before Version 2 starts.
- Correctness/trust precedes performance polish when they conflict, but performance is a real Version 1 requirement.
- Do not migrate infrastructure based on guesswork; profile first.
- Do not start a later phase merely because it is more exciting.
- Trustworthy ERP data precedes AI interpretation.
- AI read/explain precedes proactive alerts.
- Proactive alerts precede controlled action execution.
- A roadmap item is not “complete” because code/tests exist; live validation/deployment state matters.
- Update this roadmap only when phase reality or sequencing meaningfully changes.
