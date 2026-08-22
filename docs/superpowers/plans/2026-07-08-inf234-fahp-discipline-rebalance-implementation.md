# Implementation Plan — INF-234 FAHP Discipline Matrix Rebalance

## Issue

Linear: INF-234 — Rebalance FAHP Discipline matrix so lateness and work-focus criteria do not collapse to zero

Design spec:

```text
docs/superpowers/specs/2026-07-08-inf234-fahp-discipline-rebalance-design.md
```

## Worktree / Branch

Isolated worktree:

```text
C:\Users\Febriyadi\.claude\worktrees\Infinit_Track_BE-inf234-fahp-discipline-rebalance
```

Branch:

```text
feature/inf-234-fahp-discipline-rebalance
```

Base:

```text
develop @ a462663
```

## Scope

Rebalance only the FAHP Discipline pairwise matrix so discipline criteria do not collapse to zero.

In scope:

- `src/analytics/config.fahp.js`
- tests for discipline FAHP weights and scoring behavior
- optional small docs/ADR note

Out of scope:

- research trigger endpoints
- attendance generated data
- scheduler/jobs
- auth/session
- WFA matrix
- Smart Auto Checkout matrix
- CR threshold
- generic FAHP algorithm unless matrix-only fix cannot satisfy acceptance criteria

## Task 0 — Preflight

1. Confirm isolated worktree branch:
   ```bash
   git status --branch --short
   ```
2. Read:
   - `CLAUDE.md`
   - `.claude/rules/10-high-risk-areas.md`
   - `src/analytics/config.fahp.js`
   - `src/analytics/fahp.extent.js`
   - `src/utils/fuzzyAhpEngine.js`
3. Confirm no writes occur in main `develop` tree.

Expected output:

```text
branch = feature/inf-234-fahp-discipline-rebalance
```

## Task 1 — Add Baseline Failing Test

Goal: lock the current failure before changing the matrix.

Find an existing FAHP/discipline test file. If none is suitable, create a focused test file such as:

```text
tests/fahpDisciplineWeights.test.js
```

Test current expected acceptance criteria:

```js
const weights = fuzzyEngine.getDisciplineAhpWeights();

expect(weights.alpha_rate).toBeGreaterThanOrEqual(0.5);
expect(weights.alpha_rate).toBeLessThanOrEqual(0.7);
expect(weights.lateness_severity).toBeGreaterThan(0);
expect(weights.lateness_frequency).toBeGreaterThan(0);
expect(weights.work_focus).toBeGreaterThan(0);
expect(weights.consistency_ratio).toBeLessThan(0.1);
```

Also assert approximate sum:

```js
const sum = weights.alpha_rate + weights.lateness_severity + weights.lateness_frequency + weights.work_focus;
expect(sum).toBeCloseTo(1, 5);
```

Run focused test and confirm it fails on current matrix with collapse `[1,0,0,0]`.

Verification:

```bash
npm test -- --runInBand --testPathPattern=fahpDisciplineWeights
```

## Task 2 — Create Weight Exploration Script (Temporary / Non-committed Preferred)

Use a temporary node command or scratch script to try candidate matrices.

Purpose:

- compute Chang extent weights
- compute CR from defuzzified matrix
- inspect all weights > 0
- keep alpha 0.50–0.70

Do not commit scratch scripts unless useful as a documented test fixture.

Recommended exploration command shape:

```bash
node --input-type=module -e "
import { TFN } from './src/analytics/config.fahp.js';
import { invTFN, defuzzifyMatrixTFN, computeCR } from './src/analytics/fahp.js';
import { extentWeightsTFN } from './src/analytics/fahp.extent.js';
const matrix = [ /* candidate */ ];
console.log(extentWeightsTFN(matrix));
console.log(computeCR(defuzzifyMatrixTFN(matrix)));
"
```

Candidate directions:

1. Start by reducing alpha dominance:
   - alpha vs lateness severity: `MODERATE` or `MODERATE_PLUS`
   - alpha vs lateness frequency: `MODERATE` or `MODERATE_PLUS`
   - alpha vs work focus: `WEAK` or `MODERATE`

2. Keep lateness severity slightly above lateness frequency.
3. Keep work focus lower but not zero.

Stop when:

```text
alpha_rate 0.50–0.70
all other weights > 0
CR < 0.10
```

## Task 3 — Update Discipline Matrix and Rationale

Edit:

```text
src/analytics/config.fahp.js
```

Update only:

```js
DISC_PAIRWISE_TFN
```

and its rationale comments.

Do not change:

- `WFA_PAIRWISE_TFN`
- `SMART_AC_PAIRWISE_TFN`
- `TFN` constants
- FAHP algorithm
- CR threshold

Rationale comments must explain:

- alpha remains dominant because absence is the strongest discipline signal
- lateness severity and frequency remain meaningful
- work focus remains lower but non-zero
- matrix is rebalanced to avoid Chang extent collapse

## Task 4 — Add Score Behavior Tests

Add tests proving non-alpha criteria affect score.

Suggested tests:

### Lateness affects score when alpha is equal

```js
const clean = await fuzzyEngine.calculateDisciplineIndex({
  alpha_rate: 0,
  avg_lateness_minutes: 0,
  lateness_frequency: 0,
  work_hour_consistency: 100
});

const late = await fuzzyEngine.calculateDisciplineIndex({
  alpha_rate: 0,
  avg_lateness_minutes: 30,
  lateness_frequency: 50,
  work_hour_consistency: 100
});

expect(late.score).not.toBe(clean.score);
```

Use the correct score direction based on current normalization/label semantics after inspecting existing behavior.

### Work focus affects score when alpha/lateness are equal

```js
const consistent = await fuzzyEngine.calculateDisciplineIndex({
  alpha_rate: 0,
  avg_lateness_minutes: 0,
  lateness_frequency: 0,
  work_hour_consistency: 100
});

const inconsistent = await fuzzyEngine.calculateDisciplineIndex({
  alpha_rate: 0,
  avg_lateness_minutes: 0,
  lateness_frequency: 0,
  work_hour_consistency: 50
});

expect(inconsistent.score).not.toBe(consistent.score);
```

Important: current scoring semantics may label higher score as better or worse depending normalization and label mapping. Test for meaningful difference first; if asserting direction, verify with existing conventions.

## Task 5 — Optional Docs / ADR Note

Because this changes FAHP theory/matrix, add a short note if the repo has an appropriate docs location.

Possible location:

```text
docs/fahp-discipline-matrix-rebalance.md
```

or update an existing FAHP docs file if one exists.

Minimum content:

- previous collapse `[1,0,0,0]`
- root cause: synthetic extents did not overlap
- new measured weights
- CR value
- rationale for alpha target 50–70%
- verification commands

If docs are ignored by `.gitignore`, decide whether to force-add or document in PR body. Follow repository convention.

## Task 6 — Verification

Run focused tests:

```bash
npm test -- --runInBand --testPathPattern=fahp
npm test -- --runInBand --testPathPattern=discipline
```

Run full verification:

```bash
npm run lint
npm test
```

Runtime check:

```bash
node --input-type=module -e "
import fuzzyEngine from './src/utils/fuzzyAhpEngine.js';
console.log(JSON.stringify(fuzzyEngine.getDisciplineAhpWeights(), null, 2));
"
```

Expected:

```text
alpha_rate between 0.50 and 0.70
all other weights > 0
CR < 0.10
```

## Task 7 — PR Package

Prepare final PR notes using backend required format:

1. Fact
2. Assumption
3. Mismatch / Needs Verification
4. Risk
5. Files/area terdampak
6. Verification evidence
7. Docs/ADR update note
8. PR/review note

Include:

- final weights
- final CR
- tests run
- explicit note that WFA/Smart AC matrices were not changed
- `DOCS/ADR UPDATE REQUIRED`

## Acceptance Criteria

- Discipline weights no longer collapse to `[1,0,0,0]`.
- `alpha_rate` remains dominant and within `0.50–0.70`.
- `lateness_severity`, `lateness_frequency`, and `work_focus` are all > 0.
- `consistency_ratio < 0.10`.
- Tests cover non-collapse and scoring impact.
- Full lint/test evidence exists or failures are reported as `Needs Verification`.

## Stop Conditions

Stop and ask if:

- no candidate matrix can satisfy alpha 0.50–0.70 and CR < 0.10
- fixing this appears to require changing generic Chang extent algorithm
- score direction conflicts with existing dashboard semantics
- tests reveal broader FAHP engine behavior changes outside discipline
