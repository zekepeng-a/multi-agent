# Super Agent Constitution Challenge Review — Round 2

**Status:** INTERNAL ADVERSARIAL REVIEW — ROUND 2  
**Date:** 2026-10-01  
**Subject:** `SUPER_AGENT_CONSTITUTION.md` Revision 2  
**Important limitation:** this review is produced by the same ChatGPT workstream that drafted the proposal. It is an adversarial consistency check, **not independent external authority**.

## 1. Review target

Round 1 found that the first proposal:
- over-froze a module decomposition;
- embedded the current Project Control OS package too strongly;
- treated execution patterns as a false total order;
- was too Git-specific about durable truth;
- lacked a competitive baseline;
- needed explicit evaluation-vs-acceptance separation.

Revision 2 claims to fix these.

## 2. Resolution of Round-1 findings

- **C1 module decomposition:** RESOLVED — composition is now explicitly a non-authoritative hypothesis.
- **C2 named Project Control implementation:** RESOLVED — Control Authority is semantic; current Project Control OS is a strong implemented candidate, not an immutable package boundary.
- **C3 false complexity ladder:** RESOLVED — changed to execution pattern spectrum.
- **C4 Git as universal truth store:** RESOLVED — governance Git and authoritative runtime stores are separated.
- **C5 undefined baseline:** RESOLVED IN PRINCIPLE — same control/task contract and strong single-agent baseline are explicit; evaluation protocol still needs anti-gaming refinements.
- **C6 unfalsifiable superiority:** RESOLVED — product objective is framed in measurable dimensions.
- **C7 provider independence too strict:** RESOLVED — provider-specific optimizations are allowed behind explicit contracts.
- **C8 evaluation becoming acceptance:** RESOLVED — S-17 explicitly separates telemetry/evaluation from acceptance authority.
- **C9 human babysitting:** RESOLVED — S-18 makes unnecessary human intervention a measured optimization target.
- **C10 KEEP implying code reuse:** RESOLVED — S-19 forbids that inference.

## 3. New attack surface

### R2-1 — Benchmark gaming / weak baseline

A complex strategy can appear superior if:
- the single-agent baseline gets weaker prompts/tools;
- budgets differ;
- only favorable tasks are selected;
- failed runs disappear from reporting;
- benchmark tasks leak into prompts/memory;
- one strategy receives manual intervention not counted as cost.

**Required evaluation refinement:** competitive baselines, pinned budgets, versioned/holdout tasks, repeated trials where stochasticity matters, intervention accounting and negative-result reporting.

### R2-2 — Adaptive routing can become hidden authority

An execution router may decide “this needs a team,” “change plan,” or “switch provider.” These are legitimate execution decisions, but may accidentally alter project meaning.

**Boundary:** routing may choose execution strategy/capability within the authorized Task/Run/Attempt. It may not silently alter Goal, Task contract, Acceptance, Project Decision, Policy or accepted state.

No new constitutional principle is required; this is a direct consequence of S-06 and existing Project Control boundaries.

### R2-3 — Planning remains ambiguous

The constitution correctly refuses to make Planner a permanent authority, but future architecture still needs to distinguish:
- project planning/roadmap authority;
- task decomposition;
- attempt-local execution planning;
- model scratch/todo planning.

This is an architecture question, not a constitutional blocker.

### R2-4 — “Strongest practical single agent” is time-varying

The baseline will change as models improve.

**Boundary:** benchmark reports must pin model/runtime/tool versions and should preserve historical results rather than rewriting them.

### R2-5 — Benchmark success cannot define product truth

Even a benchmark winner can fail a real project, and benchmark optimization can overfit.

**Boundary:** benchmarks authorize architecture choices only within demonstrated scope. Real-project Evidence/Acceptance remains separate.

## 4. Project Control compatibility review

Revision 2 remains compatible with the existing Project Control invariants.

Key mappings:
- S-03/S-04/S-14/S-17 align with Evidence/Verification/Acceptance separation.
- S-06 aligns with Runtime != Project Control and Agent cannot directly mutate Project State.
- S-08 aligns with runtime replaceability.
- S-09 aligns with Memory source/validity and Reality > Memory.
- S-10 aligns with Effect UNKNOWN/reconciliation and distinct state semantics.
- S-11 aligns with durable persistence/recovery goals.
- S-13 keeps Workflow/Team inside execution.

No I-01..I-45 change is required to accept the Super Agent product direction.

## 5. Constitution verdict

**PASS FOR HUMAN CONSIDERATION.**

No remaining issue requires another constitution rewrite before the Human can accept/reject/revise it.

Open questions remain for later architecture work:
- exact planning layers;
- routing mechanism;
- durable execution implementation versus external framework;
- execution pattern interfaces;
- provider integration shape;
- benchmark task corpus.

These are intentionally not constitutional facts.

## 6. SA0 remaining gate

Before SA0 can close:
1. refine evaluation baseline against benchmark gaming;
2. record an SA0 acceptance packet with evidence and open questions;
3. Human explicitly accepts/revises the constitution and authorizes architecture work.

Optional but valuable:
- recover legacy local GPT↔DSH reports for drift forensics;
- obtain an independent external/model review as additional evidence, never as authority.

## 7. Later governance annotation — 2026-10-02

Sections 1–6 above remain the historical internal R2 review, including its verdict. Its PASS FOR HUMAN CONSIDERATION predates the subsequent independent Codex review and is **not the final review outcome or Human acceptance**.

The subsequent independent review returned PASS WITH REQUIRED REVISIONS. The Human-authorized [SA0 Convergence Record](SA0_CONVERGENCE_RECORD.md) records the three P1 and three P2 revisions, Constitution/Evaluation R3 and the two later audit/design artifacts. Current gate: READY FOR FINAL HUMAN ACCEPT / REVISE; not accepted, no implementation authorization. Applying revisions is not another independent PASS.
