# KhataPro ERP — Roadmap

This roadmap is dependency-driven. It does not assign arbitrary dates and it does not imply that every listed idea is already approved for implementation.

## Release boundary
KhataPro development is intentionally split into two product versions:

- **Version 1:** finish, stabilize, hand over and obtain client approval for the current ERP.
- **Version 2:** only after Version 1 approval, evolve KhataPro toward the intelligent/proactive product vision in `docs/VISION.md`.

Do not begin Version 2 intelligence work while Version 1 still has unresolved client-facing bugs or handover tasks.

## Version 1 — Phase 1: Release correctness and client handover
### Objective
Deliver a stable ERP that a real client can use without known navigation, posting, role, mobile, print, or data-integrity blockers.

### Why it matters
The client must receive a dependable Version 1 before broader product evolution begins.

### Major deliverables
- close current navigation / invoice-detail regressions,
- finish role-specific mobile and desktop smoke,
- verify Rider real-data mapping / assignment path,
- safely clean QA/demo data,
- verify production/main/deployment commit sync,
- validate print outputs,
- prepare final client credentials and handover checklist.

### Exit criteria
- no known P0/P1 client workflow blocker,
- Owner/Admin, Accountant, Salesman, Rider role flows manually verified,
- core posting workflows work on production,
- final print formats visually approved,
- no unsafe test/demo data exposed to client,
- production URL and `main` are in sync,
- handover credentials and role access confirmed,
- **client receives Version 1 and approves it for the next phase.**

### Hard gate
Until the Version 1 exit criteria and client approval are reached:
- do not start the Version 2 AI roadmap,
- do not destabilize accepted ERP workflows for future architecture,
- prioritize bug fixing, correctness, cleanup, handover and client feedback only.

---

# Version 2 — Intelligent ERP evolution

The following phases begin only after Version 1 is accepted. They implement the long-term vision progressively without replacing deterministic accounting truth.

## Version 2 — Phase 2: ERP truth consolidation
### Objective
Make deterministic business facts consistently available through stable server/data-access contracts.

### Deliverables
- resolve remaining schema-debt decisions only when needed,
- document authoritative readers for sales, collections, expenses, returns, stock, receivables, payables, cash, rider COD, commission,
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
- rider cash/settlement exceptions,
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
- Do not start a later phase merely because it is more exciting.
- Trustworthy ERP data precedes AI interpretation.
- AI read/explain precedes proactive alerts.
- Proactive alerts precede controlled action execution.
- A roadmap item is not “complete” because code exists; validation/deployment state matters.
- Update this roadmap only when phase reality or sequencing meaningfully changes.
