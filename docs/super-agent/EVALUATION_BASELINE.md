# Super Agent Evaluation Baseline

**Status:** PROPOSED EVALUATION PROTOCOL — NO BENCHMARK RESULTS YET  
**Purpose:** prevent architectural complexity from being justified by narrative confidence.

## 1. Core rule

A more complex execution strategy is not “better” because it uses more planning, agents, reviews, or orchestration.

It must demonstrate incremental value over a simpler baseline on the **same task and control contract**.

## 2. Initial baseline

For a candidate execution strategy X, compare:

```text
Control / Goal / Task / Acceptance / Workspace
                 held constant
                       ↓
         Strategy A: strongest practical single agent
                       vs
         Strategy X: candidate added complexity
```

Examples of X:
- explicit workflow;
- planner;
- specialist delegation;
- parallel DAG;
- reviewer loop;
- dynamic multi-agent team.

Where possible:
- use the same model/provider when isolating orchestration effects;
- then repeat with provider substitution to test robustness.

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

SA0 should define a small suite containing at least:

1. **Single-file bounded coding task**
   - expected to favor direct/single-agent execution.
2. **Multi-file implementation with tests**
   - tests dependency handling and workspace correctness.
3. **Repository-scale feature**
   - requires architecture reading, implementation and verification.
4. **Research + implementation task**
   - requires external evidence before code decisions.
5. **Parallelizable task**
   - tests whether delegation/DAG reduces latency without increasing integration defects.
6. **Long-horizon interrupted task**
   - deliberately restart process/runtime and measure continuation/recovery.
7. **Ambiguous/failure-injected task**
   - provider failure, malformed output, test failure or uncertain effect.
8. **Change-of-requirement task**
   - contract revision tests whether stale work is rejected/replanned instead of silently accepted.

## 5. Experimental discipline

Each comparison should pin:
- repository revision;
- task/acceptance revision;
- model/runtime version where observable;
- tool/capability set;
- workspace conditions;
- time/cost budget;
- random/temperature settings where controllable.

Results must record:
- successes and failures;
- skipped/unavailable capabilities;
- human interventions;
- evidence artifacts;
- known confounders.

## 6. Promotion rule

A complex strategy may become a **default** only if:
1. it shows reproducible improvement on a task family that actually needs it;
2. the improvement matters on at least one declared product metric;
3. added failure modes and operational cost are measured;
4. a simpler strategy remains available for tasks where complexity adds no value.

A strategy may still exist as an optional capability without becoming default.

## 7. Model-judge restriction

LLM-as-judge may provide analysis, but cannot be the sole metric when objective evidence is available.

Priority:
1. executable tests / reality observations;
2. contract-specific deterministic checks;
3. independent evidence inspection;
4. model evaluation for irreducibly qualitative criteria.

Model agreement is not ground truth.

## 8. Current status

No benchmark results have been produced yet.

Therefore SA0 makes **no claim** that:
- multi-agent outperforms a single strong agent;
- a planner improves project success;
- DSH is superior/inferior to Codex or Claude;
- any proposed execution pattern should be default.
