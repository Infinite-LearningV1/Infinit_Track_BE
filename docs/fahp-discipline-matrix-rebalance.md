# FAHP Discipline Matrix Rebalance — INF-234

## Context

The Discipline FAHP matrix previously produced runtime weights:

```json
{
  "alpha_rate": 1,
  "lateness_severity": 0,
  "lateness_frequency": 0,
  "work_focus": 0,
  "consistency_ratio": 0.07889627296412856
}
```

This happened even when research attendance data contained late, early, and alpha rows. The data was present, but the zero weights prevented lateness and work-hour consistency from affecting the Discipline ranking.

## Root Cause

The previous `DISC_PAIRWISE_TFN` made `alpha_rate` too dominant for Chang's Extent Analysis. Its synthetic extent did not overlap with the other criteria:

```text
alpha_rate extent          [0.3729, 0.5585, 0.8160]
lateness_severity extent   [0.1412, 0.2074, 0.3000]
lateness_frequency extent  [0.0819, 0.1011, 0.1320]
work_focus extent          [0.1102, 0.1330, 0.1680]
```

The resulting possibility vector was:

```text
d = [1, 0, 0, 0]
weights = [1, 0, 0, 0]
```

The matrix was consistent (`CR = 0.079`), but consistency did not guarantee useful non-zero weights.

## Rebalanced Matrix Target

INF-234 target:

```text
alpha_rate          0.50–0.70
lateness_severity   > 0
lateness_frequency  > 0
work_focus          > 0
CR                  < 0.10
```

The rebalanced Discipline matrix keeps absence as the dominant signal while preserving non-zero influence for lateness severity, lateness frequency, and work-hour consistency.

## Result

Runtime weights after rebalance:

```json
{
  "alpha_rate": 0.5128812499692939,
  "lateness_severity": 0.2477192702838649,
  "lateness_frequency": 0.11486769150110643,
  "work_focus": 0.1245317882457348,
  "consistency_ratio": 0.07732121780209075
}
```

All criteria now have non-zero weights, alpha remains dominant, and CR remains below `0.10`.

## Verification

Focused test:

```bash
npm test -- --runInBand tests/fahpDisciplineWeights.test.js
```

Expected assertions:

- alpha remains between `0.50` and `0.70`
- all criteria weights are greater than zero
- weights sum to approximately `1`
- CR remains below `0.10`
- lateness metrics affect Discipline score when alpha is equal
- work-hour consistency affects Discipline score when alpha/lateness are equal

## Governance Note

This is a FAHP theory/matrix change.

```text
DOCS/ADR UPDATE REQUIRED
```

The change is intentionally scoped to `DISC_PAIRWISE_TFN`; WFA and Smart Auto Checkout matrices are not changed.
