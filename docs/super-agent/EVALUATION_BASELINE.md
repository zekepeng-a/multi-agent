# Super Agent Evaluation Baseline

**Status:** PROPOSED EVALUATION PROTOCOL — REVISION 3 — NO BENCHMARK RESULTS YET  
**Purpose:** prevent architectural complexity from being justified by narrative confidence or benchmark gaming.

## 1. Core rule

A more complex execution strategy is not “better” because it uses more planning, agents, reviews, or orchestration.

It must demonstrate incremental value over a competitive simpler baseline on the **same task and control contract**.

## 2. Competitive baseline

For candidate strategy X:

```text
Goal / Task / Acceptance / Workspace / Policy
                 held constant
                       ↓
     Strategy A: strong single-agent baseline
                       vs
     Strategy X: candidate added complexity
```

Baseline fairness requires, where applicable:
- same model/provider when isolating orchestration effects;
- same tool and workspace permissions;
- comparable task context and evidence access;
- pinned time/token/cost budgets;
- baseline prompt/harness tuned competently rather than intentionally weakened.

Separate experiments may test provider substitution after orchestration effects are isolated. If different provider/model choices cannot be controlled or isolated, label the result a whole-system comparison; do not claim causal orchestration improvement.

## 3. Evaluation dimensions

### Outcome quality
- acceptance-contract pass rate;
- regression defects after acceptance;
- completeness of required deliverables;
- external Reality correctness.

### Drift
- original-goal retention;
- unauthorized scope expansion;
- contradiction with accepted Decisions/constraints;
- stale-memory reliance.

### Efficiency
- wall-clock latency;
- model tokens/cost;
- tool calls;
- duplicated work;
- number of attempts/replans;
- context growth/offloading.

### Reliability
- recovery after controlled interruption;
- malformed/partial output handling;
- provider failure handling;
- UNKNOWN external-effect behavior;
- reproducibility across reruns.

### Human burden
- approvals required;
- corrective interventions;
- manual evidence gathering;
- prompt rewriting / babysitting.

### Auditability
- evidence coverage;
- traceability from outcome to actions/sources;
- ability to explain why a strategy/agent was selected;
- separation of model claim from observed fact.

## 4. Benchmark task families

No single benchmark represents “large complex projects.”

The suite should include at least:

1. **Single-file bounded coding task** — should usually favor simple execution.
2. **Multi-file implementation with tests** — dependency/workspace correctness.
3. **Repository-scale feature** — architecture reading, implementation, verification.
4. **Research + implementation task** — external evidence before code decisions.
5. **Parallelizable task** — delegation/DAG latency benefit versus integration defects.
6. **Long-horizon interrupted task** — controlled restart and continuation.
7. **Ambiguous/failure-injected task** — provider failure, malformed output, test failure or uncertain effect.
8. **Change-of-requirement task** — stale work/contract revision handling.

## 5. Anti-gaming discipline

Benchmark design must prevent the architecture from grading itself.

Required controls:
- version the benchmark corpus;
- keep a holdout subset not used while tuning prompts/routing;
- never remove failed runs from aggregate reporting;
- record skipped/unavailable runs explicitly;
- use repeated trials when model stochasticity materially affects results;
- report dispersion/variance, not only the best run;
- count human intervention as part of cost/burden;
- record architecture-specific tuning given to every strategy;
- do not inject a strategy's own historical benchmark answer into Memory/context;
- preserve negative results and regressions.

Where feasible, evaluators should be blinded to which strategy produced an artifact.

### Trial preregistration — freeze before the experiment

A versioned evaluation profile must freeze:
- primary success metric, required meaningful gain, permitted degradation by metric, and correctness/safety/recovery floors;
- tuning opportunity for each strategy, permitted tuning data and tuning budgets; competent baseline tuning must not be intentionally restricted;
- isolated holdout corpus, access controls and no holdout-informed prompt/routing changes;
- trial count, repetition policy, stopping rule and treatment of aborted trials; no optional stopping after favorable results;
- failure denominator and inclusion rules: started trials, errors, timeouts and failed/aborted trials remain visible; unavailable/skipped trials are reported separately and never silently removed;
- environment reset protocol: repository/workspace revision, generated artifacts, caches, provider sessions and residual Workspace state;
- Human intervention accounting: approvals, corrections, evidence gathering, prompt edits, timing and all costs;
- shared Memory/context isolation and provenance; no prior benchmark answer or candidate output leaking into either strategy;
- cross-strategy answer isolation, including shared artifacts, transcripts and outputs;
- cleanup/reset checks for residual Workspace contamination before each trial.

Separate development/tuning data from holdout. Record reset failures and contamination; contaminated trials cannot support an uncontaminated performance claim and remain in reporting under the frozen inclusion rule. Deviations require a versioned amendment and separately labeled results, not retrospective changes that improve the reported outcome.

## 6. Budget modes

At least two comparison modes are useful:

### Equal-budget
Strategies receive comparable cost/time/tool budgets.

Question: does added orchestration produce better outcomes for the same resource envelope?

### Best-practical
Each strategy uses a realistic configuration within a declared ceiling.

Question: what is the best result a user would reasonably deploy?

Do not mix conclusions across modes without stating which was used.

## 7. Experimental identity

Each run should pin or record:
- repository revision;
- Goal/Task/Acceptance revision;
- benchmark case version;
- model/runtime/provider version where observable;
- tool/capability set;
- workspace conditions;
- time/cost budget;
- prompt/harness/config revision;
- stochastic settings where controllable;
- human interventions.

## 8. Promotion rule

Authority, permission, Acceptance and UNKNOWN-effect safety are **non-tradeable constraints**, not weighted metrics. A strategy violating them is ineligible for default promotion; better cost, latency or average benchmark score cannot offset the violation.

A complex strategy may become a **default** only if:
1. before trials, a versioned profile declares the primary success metric(s), meaningful gain criteria, permitted degradation on other dimensions, and correctness/safety/recovery floors;
2. results prove the declared primary benefit over a competitive simpler baseline on the tested task family;
3. results satisfy every declared floor and stay within all allowed degradation limits, while preserving the non-tradeable constraints;
4. failure modes, operational cost, variance and Human intervention are measured under the preregistered protocol;
5. a simpler strategy remains available where complexity adds no value, and the claim is scoped to tested task families/configurations/versions;
6. evidence and independent review support a separate authorized default-setting decision; the benchmark or strategy never promotes itself.

Numerical thresholds live in the evaluation profile and must be frozen before trials. No current profile results or default promotion are claimed.

Required Verification is not optional orchestration. It cannot be removed because an extra Reviewer/Planner/Agent mechanism lacks demonstrated incremental benefit. An optional mechanism may be omitted only while the current Contract and all mandatory Verification/control checks remain satisfied.

A strategy may exist as an optional capability without becoming default; that status does not authorize implementation or unsafe use.

## 9. Model-judge restriction

LLM-as-judge may provide analysis, but cannot be the sole metric when objective evidence is available.

Priority:
1. executable tests / Reality observations;
2. contract-specific deterministic checks;
3. independent evidence inspection;
4. model evaluation for irreducibly qualitative criteria.

Model agreement is not ground truth.

## 10. Benchmark versus Project Acceptance

Benchmark scores are **architecture-development evidence**.

They do not directly accept a Project Task/Goal and do not replace Project Control Evidence/Verification/Acceptance.

## 11. Current status

No benchmark results have been produced yet.

Therefore SA0 makes **no claim** that:
- multi-agent outperforms a single strong agent;
- a planner improves project success;
- DSH is superior/inferior to Codex or Claude;
- any proposed execution pattern should be default.

## 12. Revision provenance

R2 is the historical protocol reviewed before the independent Codex findings. R3 resolves P1-01 (non-tradeable promotion floors) and P1-03 (preregistration/fairness) under Human-authorized governance convergence. See [SA0 Convergence Record](SA0_CONVERGENCE_RECORD.md). No benchmark or production capability was added.
