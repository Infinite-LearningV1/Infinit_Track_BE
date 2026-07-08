# Design Spec — INF-234 FAHP Discipline Matrix Rebalance

## Issue

Linear: INF-234 — Rebalance FAHP Discipline matrix so lateness and work-focus criteria do not collapse to zero

URL: https://linear.app/infinite-track-palu/issue/INF-234/rebalance-fahp-discipline-matrix-so-lateness-and-work-focus-criteria

## Background

Research attendance trigger data now contains discipline variation:

- `ontime`
- `late`
- `early`
- `alpha`

The FAHP Discipline UI still shows criteria weights:

```text
Disiplin Kehadiran      1.000
Tingkat Keterlambatan   0.000
Frekuensi Keterlambatan 0.000
Fokus Kerja             0.000
```

Runtime evidence from Docker:

```json
{
  "alpha_rate": 1,
  "lateness_severity": 0,
  "lateness_frequency": 0,
  "work_focus": 0,
  "consistency_ratio": 0.07889627296412856
}
```

This means late/frequency/work-focus data exists, but has no impact on ranking because the FAHP Discipline weights collapse to `[1, 0, 0, 0]`.

## Current Technical Cause

The current `DISC_PAIRWISE_TFN` in `src/analytics/config.fahp.js` is too dominant toward `alpha_rate` for Chang's Extent Analysis:

```js
export const DISC_PAIRWISE_TFN = [
  [TFN.EQUAL, TFN.STRONG, TFN.STRONG, TFN.MODERATE],
  [invTFN(TFN.STRONG), TFN.EQUAL, TFN.MODERATE, TFN.EQUAL],
  [invTFN(TFN.STRONG), invTFN(TFN.MODERATE), TFN.EQUAL, TFN.EQUAL],
  [invTFN(TFN.MODERATE), invTFN(TFN.EQUAL), invTFN(TFN.EQUAL), TFN.EQUAL]
];
```

Computed synthetic extents:

```text
alpha_rate extent          [0.3729, 0.5585, 0.8160]
lateness_severity extent   [0.1412, 0.2074, 0.3000]
lateness_frequency extent  [0.0819, 0.1011, 0.1320]
work_focus extent          [0.1102, 0.1330, 0.1680]
```

Because `alpha_rate` lower bound is greater than the upper bound of every other criterion, the degree of possibility for the other criteria against alpha becomes `0`. The resulting vector is:

```text
d = [1, 0, 0, 0]
weights = [1, 0, 0, 0]
```

CR remains acceptable:

```text
CR = 0.079 < 0.10
```

But CR consistency does not guarantee healthy non-zero weights for all criteria under Chang's Extent Analysis.

## Goal

Rebalance only the FAHP Discipline pairwise matrix so that:

1. `alpha_rate` remains the dominant criterion.
2. `alpha_rate` target weight is between `0.50` and `0.70`.
3. `lateness_severity`, `lateness_frequency`, and `work_focus` all have non-zero weights.
4. CR remains below `0.10`.
5. Discipline ranking can be affected by lateness severity, lateness frequency, and work-hour consistency.

Target weight envelope:

```text
alpha_rate          0.50–0.70
lateness_severity   0.10–0.25
lateness_frequency  0.10–0.20
work_focus          0.05–0.15
```

## Non-Goals

Do not change:

- research attendance trigger endpoints
- generated attendance data semantics
- scheduler/cron behavior
- auth/session/API unrelated behavior
- WFA matrix
- Smart Auto Checkout matrix
- FAHP threshold (`CR_THRESHOLD`)
- generic Chang's Extent implementation unless matrix-only fix cannot satisfy acceptance criteria

## Proposed Design

### Approach A — Matrix-only rebalance (recommended)

Update `DISC_PAIRWISE_TFN` so alpha is still strongest, but not so dominant that other extents lose all overlap.

Recommended direction:

- `alpha_rate > lateness_severity`: reduce from `STRONG` to `MODERATE` or `MODERATE_PLUS`.
- `alpha_rate > lateness_frequency`: reduce from `STRONG` to `MODERATE` or `MODERATE_PLUS`.
- `alpha_rate > work_focus`: keep moderate but validate overlap.
- `lateness_severity > lateness_frequency`: keep mild/moderate because lateness minutes and frequency both matter.
- `lateness_severity > work_focus`: slight or moderate preference.
- `lateness_frequency > work_focus`: slight preference or equal depending on CR/weights.

The final matrix must be chosen empirically by computing:

- Chang extent weights
- CR on defuzzified crisp matrix
- all weights > 0
- alpha in target range

### Approach B — Add fallback/minimum weight guard (not recommended initially)

If matrix-only rebalance cannot produce healthy weights, add a discipline-specific fallback or minimum epsilon guard. This is not first choice because it changes weighting behavior beyond pairwise judgment and may be less academically clean.

## Acceptance Criteria

1. `fuzzyEngine.getDisciplineAhpWeights()` returns all non-zero weights:

```text
alpha_rate > 0
lateness_severity > 0
lateness_frequency > 0
work_focus > 0
```

2. `alpha_rate` is dominant and between `0.50` and `0.70`.
3. CR is `< 0.10`.
4. Existing WFA and Smart Auto Checkout weights are not changed.
5. Tests prove the discipline matrix does not collapse to `[1, 0, 0, 0]`.
6. Tests prove alpha remains dominant.
7. Tests prove lateness/work-focus metrics can affect score when alpha is equal.
8. Rationale comments in `config.fahp.js` match the new matrix.

## Test Design

Add focused tests around FAHP Discipline weights, preferably in an existing FAHP/discipline test file or a new focused test file.

Minimum test cases:

1. `getDisciplineAhpWeights()` returns:
   - all four weights finite
   - all four weights > 0
   - sum approximately 1
   - alpha in `[0.50, 0.70]`
   - CR < 0.10

2. Lateness affects score when alpha is equal:
   - user A metrics: alpha 0, lateness 0, frequency 0, consistency 100
   - user B metrics: alpha 0, lateness > 0, frequency > 0, consistency 100
   - scores differ in the expected direction

3. Work-hour consistency affects score when alpha/lateness are equal:
   - user A consistency 100
   - user B consistency lower
   - scores differ in the expected direction

## Risk

This touches FAHP matrix/theory, which is a high-risk area in repo governance.

Risks:

- A matrix may pass CR but still generate poor weights.
- Changing matrix changes dashboard/research ranking semantics.
- Too much rebalance can underweight alpha, which conflicts with product/research intent.

Mitigations:

- Keep alpha dominant.
- Bound alpha target to 0.50–0.70.
- Preserve CR < 0.10.
- Add tests that fail on zero-weight collapse.
- Document the rationale.

## Docs / ADR Note

`DOCS/ADR UPDATE REQUIRED`

Reason:

- FAHP Discipline matrix is a theory/algorithm artifact.
- Changing it affects ranking semantics and dashboard output.

Documentation can be a short ADR/doc note explaining:

- prior collapse `[1,0,0,0]`
- why the matrix was rebalanced
- target weight envelope
- final measured weights and CR

## Verification Plan

Required:

```bash
npm run lint
npm test
```

Focused:

```bash
npm test -- --runInBand --testPathPattern=fahp
npm test -- --runInBand --testPathPattern=discipline
```

Runtime check:

```bash
node --input-type=module -e "
import fuzzyEngine from './src/utils/fuzzyAhpEngine.js';
console.log(fuzzyEngine.getDisciplineAhpWeights());
"
```

Expected runtime shape:

```json
{
  "alpha_rate": 0.5xx,
  "lateness_severity": 0.xxx,
  "lateness_frequency": 0.xxx,
  "work_focus": 0.xxx,
  "consistency_ratio": "< 0.10"
}
```

## Open Questions

None for initial plan. User decision already made: use matrix rebalance with alpha target `50%–70%`.
