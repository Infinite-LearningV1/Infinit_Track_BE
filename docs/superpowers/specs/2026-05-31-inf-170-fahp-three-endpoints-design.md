# INF-170 FAHP Three Real-Data Endpoints Design — 2026-05-31

Branch: `feature/inf-170-fahp-three-endpoints` (implementation target; current isolated worktree branch will be aligned before push)  
Issue: INF-170 — Backend FAHP: split `GET /api/analysis/fuzzy-ahp` into dedicated discipline, wfa, and smart-ac endpoints  
Design status: approved direction from user, pending final user review before implementation plan.

## Goal

Add three dedicated FAHP analysis endpoints that return **real runtime data** while keeping the legacy combined endpoint alive for compatibility during migration.

The new endpoints must:

- reuse the canonical FAHP runtime already hardened in INF-129 / INF-168,
- avoid re-implementing FAHP formulas,
- preserve WIB (`Asia/Jakarta`) response semantics,
- keep `AHP_CR_THRESHOLD` fixed at `0.10`,
- refuse fabricated WFA and Smart AC outputs,
- avoid changes to attendance final-state logic, jobs, or unrelated RBAC behavior.

## Current facts

- Legacy combined endpoint exists at `GET /api/analysis/fuzzy-ahp`.
- `src/routes/analysis.routes.js` currently mounts only the legacy combined endpoint.
- `src/controllers/analysis.controller.js` currently validates `type` and `period`, computes a simple monthly/weekly window, and dispatches to analysis services.
- `src/services/fuzzyAhpAnalysis.service.js` currently exports:
  - `buildDisciplineAnalysis({ startAt, endAt })`
  - `buildWfaAnalysis(...)`
  - `buildSmartAcAnalysis({ startAt, endAt })`
- Current Discipline analysis already reads real attendance data from the database.
- Current WFA analysis is **not acceptable for INF-170** because it uses static location catalog rows plus fabricated assumptions (`amenity_score: 50`, `distance: 1000`).
- Current Smart AC analysis partially reuses canonical attendance/location-event sources, but its response shape is still a generic FAHP ranking contract rather than the dedicated runtime contract required by INF-170.
- `src/controllers/wfa.controller.js` already contains a live Geoapify Places pipeline that can be minimally extracted/reused rather than reimplemented.
- `src/utils/fuzzyAhpEngine.js` already provides the canonical FAHP weighting path through:
  - `extentWeightsTFN(...)`
  - `defuzzifyMatrixTFN(...)`
  - `computeCR(...)`
  - `WFA_PAIRWISE_TFN`, `DISC_PAIRWISE_TFN`, `SMART_AC_PAIRWISE_TFN`
- `docs/openapi.yaml` currently documents the legacy combined endpoint and must be extended to describe the three new additive routes.

References:

- INF-129 / INF-168 merged baseline: recent commit `43497ed`
- Existing FAHP design reference: `docs/superpowers/specs/2026-04-23-inf-129-fuzzy-ahp-analysis-design.md`
- Boundary contract doc: `docs/reporting-analytics-boundary.md`

## User-approved decisions

1. Use an additive split approach; keep the legacy combined endpoint alive and unchanged in this PR.
2. Do not touch endpoint `GET /api/analysis/fuzzy-ahp` except for regression verification.
3. Do not touch INF-172 evidence-script scope:
   - `scripts/run-fahp-report.js`
   - `tests/runFahpReport.test.js`
   - `docs/fahp-evidence/`
   - `reports/fahp/`
4. Do not change attendance final-state logic, scheduler jobs, or middleware behavior beyond mounting new guarded routes and adding validators.
5. Reuse the canonical runtime and existing FAHP services/analytics code; do not re-implement FAHP formulas.
6. Keep consistency threshold fixed at `0.10`.
7. WFA must use Geoapify live data only; provider failure must surface explicitly as `503 AUTH_OR_PROVIDER_UNAVAILABLE`.
8. Smart AC must return canonical runtime predictions only; no placeholder `predicted_time_out` or fabricated evidence summaries.
9. Discipline may legitimately return an empty ranking when the database has no data in the selected window; empty output must be honest, not seeded.
10. Local runtime smoke verification with real data is mandatory before claiming completion.

## API contract

### Additive endpoints

```http
GET /api/analysis/fuzzy-ahp/discipline
GET /api/analysis/fuzzy-ahp/wfa
GET /api/analysis/fuzzy-ahp/smart-ac
```

### Compatibility endpoint

```http
GET /api/analysis/fuzzy-ahp
```

The compatibility endpoint remains temporarily supported and must not be removed or behaviorally changed in this issue.

## Endpoint contract details

### 1. Discipline endpoint

```http
GET /api/analysis/fuzzy-ahp/discipline
```

Auth:

- Bearer token required
- `Admin` or `Management` only

Query:

- `period=weekly|monthly|custom` (default `monthly`)
- `from=YYYY-MM-DD` and `to=YYYY-MM-DD` required when `period=custom`
- `from <= to`
- max custom range: 365 days

Response contract:

- `success=true`
- `data.type = "discipline"`
- `data.period`
- `data.requested_window`
- `data.executed_window`
- `data.timezone = "Asia/Jakarta"`
- `data.weights = { criteria, values, method: "Chang's Extent Analysis" }`
- `data.consistency = { CR, CI, lambda_max, threshold, is_consistent, verdict }`
- `data.distribution`
- `data.ranking[]`

Real-data rule:

- Ranking must be derived from real attendance rows in the selected WIB date window.
- If no attendance rows exist in the selected window, return zero distribution plus `ranking: []`.
- No seeding or fabricated fallback is allowed.

### 2. WFA endpoint

```http
GET /api/analysis/fuzzy-ahp/wfa
```

Auth:

- Bearer token required
- `Admin` or `Management` only

Query:

- `lat` required, float `-90..90`
- `lon` required, float `-180..180`
- `radius_meters` optional, integer `100..50000`, default `5000`

Response contract:

- `success=true`
- `data.type = "wfa"`
- `data.data_source = "geoapify_live"`
- `data.timezone = "Asia/Jakarta"`
- `data.weights = { criteria, values, method: "Chang's Extent Analysis" }`
- `data.consistency = { CR, CI, lambda_max, threshold, is_consistent, verdict }`
- `data.distribution`
- `data.ranking[]`

Each ranking item must contain:

- `place_id`
- `name`
- `score`
- `label`
- `breakdown = { location_type, distance_m, amenity_score }`

Real-data rule:

- Nearby places must come from a live Geoapify Places request for the provided coordinates/radius.
- `distance_m` must come from provider data or a real haversine fallback.
- `amenity_score` must be derived from real place features, not a static `50` fallback.
- If Geoapify returns no candidate places, return `200` with:
  - zero distribution
  - `ranking: []`
  - `empty_real: true`
- If Geoapify is unavailable, times out, rejects auth, or exhausts quota, return:

```json
{
  "success": false,
  "code": "AUTH_OR_PROVIDER_UNAVAILABLE",
  "provider": "geoapify",
  "reason": "<short>"
}
```

with status `503`.

No fabricated WFA recommendation is allowed.

### 3. Smart AC endpoint

```http
GET /api/analysis/fuzzy-ahp/smart-ac
```

Auth:

- Bearer token required
- `Admin` or `Management` only

Query:

- none

Behavior:

- Default target date is **today in WIB**.
- Controller computes the WIB execution window and passes it to the existing canonical Smart AC service path.

Response contract:

- `success=true`
- `data.type = "smart_ac"`
- `data.target_date` (`YYYY-MM-DD` WIB)
- `data.executed_window`
- `data.timezone = "Asia/Jakarta"`
- `data.weights = { criteria: ['HIST','CHECKIN','CONTEXT','TRANSITION'], values, method: "Chang's Extent Analysis" }`
- `data.consistency = { CR, CI, lambda_max, threshold, is_consistent, verdict }`
- `data.ranking[]`

Each ranking item must contain:

- `user_id`
- `name`
- `predicted_time_out` (`HH:mm` WIB or `null`)
- `evidence_summary`
- `needs_data`

Real-data rule:

- Prediction must reuse the existing deterministic runtime source chain:
  - latest attendance row,
  - expected location from WFO or approved WFA booking,
  - latest matching `EXIT` `LocationEvent` within the bounded target-day window.
- If the user has insufficient real evidence:
  - keep the user entry,
  - set `needs_data = true`,
  - set `predicted_time_out = null`,
  - include only truthful evidence markers in `evidence_summary`.
- If evidence is sufficient:
  - set `needs_data = false`,
  - set `predicted_time_out` from the canonical weighted prediction path,
  - expose real evidence markers only.

No fabricated `predicted_time_out` or fake evidence basis is allowed.

## Backend design

### `src/routes/analysis.routes.js`

Keep the existing route and add three new additive mounts:

- `GET /fuzzy-ahp` → unchanged compatibility route
- `GET /fuzzy-ahp/discipline`
- `GET /fuzzy-ahp/wfa`
- `GET /fuzzy-ahp/smart-ac`

All new routes keep existing security composition:

- `verifyToken`
- `roleGuard(['Admin', 'Management'])`

Validation chain:

- Discipline route uses `disciplineFahpValidation`
- WFA route uses `wfaFahpValidation`
- Smart AC route uses no query validator

No changes are allowed to `authJwt.js` or `roleGuard.js` beyond reusing them.

### `src/middlewares/validator.js`

Add:

#### `disciplineFahpValidation`

Validation rules:

- `period` optional, defaults to `monthly`
- allowed values: `weekly`, `monthly`, `custom`
- `from` and `to` optional unless `period=custom`
- for `custom`:
  - both required
  - both valid `YYYY-MM-DD`
  - `from <= to`
  - window length `<= 365` days

Recommended implementation pattern:

- follow the existing query-validator style used by `dashboardAnalyticsValidation`
- centralize the cross-field checks in a single `query().custom(...)` block
- terminate with existing `validate` middleware

#### `wfaFahpValidation`

Validation rules:

- `lat` required, float `-90..90`
- `lon` required, float `-180..180`
- `radius_meters` optional, integer `100..50000`, default `5000`

The Smart AC endpoint intentionally has no query validator because it accepts no query params in this issue.

### `src/controllers/analysis.controller.js`

Keep `getFuzzyAhpAnalysis` unchanged for compatibility.

Add three new handlers:

- `getDisciplineFahp`
- `getWfaFahp`
- `getSmartAcFahp`

Controller responsibilities only:

- read already-validated query values,
- compute requested/executed WIB windows,
- call the corresponding service helper,
- shape the endpoint-specific response payload,
- translate provider failures for WFA into explicit `503` responses.

The new handlers must not “clean up” or refactor the legacy combined handler in this issue.

### `src/services/fuzzyAhpAnalysis.service.js`

This remains the canonical analysis service file. The implementation should be an **in-place minimal refactor**, not a new parallel FAHP engine.

#### Discipline service behavior

`buildDisciplineAnalysis({ startAt, endAt })` remains the discipline source but should be tightened so the ranking is truthfully based on attendance rows inside the selected WIB date range.

Implementation expectations:

- query attendance rows in the selected WIB date window,
- group rows by user,
- compute metrics from real attendance only,
- build ranking only from users with relevant rows,
- return zero distribution plus empty ranking when no relevant rows exist.

#### WFA service behavior

`buildWfaAnalysis(...)` must be refactored away from static location-catalog assumptions.

Implementation target:

```js
buildWfaAnalysis({ lat, lon, radiusMeters })
```

Design requirements:

- minimally extract/reuse the Geoapify request/scoring pipeline that already exists in `src/controllers/wfa.controller.js`,
- preserve canonical FAHP weights via existing fuzzy engine helpers,
- derive consistency using the canonical WFA pairwise TFN matrix,
- map provider places into the dedicated analysis response shape,
- remove fabricated fallback assumptions from the analysis path.

Important scope rule:

- The extraction must be minimal and must not redesign the existing `/api/wfa` endpoint contract.
- If extraction turns into a large unrelated refactor, stop and re-evaluate scope before proceeding.

#### Smart AC service behavior

`buildSmartAcAnalysis({ startAt, endAt })` remains the Smart AC source but must return the dedicated runtime contract instead of the generic ranking-breakdown shape.

Implementation expectations:

- preserve the deterministic source chain already present in the service,
- keep target-day matching bounded to the selected WIB date,
- derive prediction only when the canonical evidence chain is sufficient,
- expose `predicted_time_out`, `needs_data`, and truthful `evidence_summary` fields.

Recommended evidence summary shape:

- `has_latest_attendance`
- `has_checkin_time`
- `has_history_checkout`
- `has_expected_location`
- `has_transition_exit_event`
- `basis_used` (only real bases actually used)

Exact field names can be refined during implementation, but the payload must remain factual and non-fabricated.

### Consistency threshold handling

For INF-170, endpoint consistency threshold must be fixed at `0.10`.

Implementation design:

- replace env-driven threshold behavior for these endpoint outputs with a local hardcoded constant,
- keep all endpoint consistency payloads explicit about:
  - `threshold: 0.10`
  - `is_consistent`
  - `verdict`

This keeps the runtime aligned with INF-141.

## Testing design

### TDD sequence

Implementation must follow test-first order.

### Phase A — route validation tests

Create:

- `tests/analysisFuzzyAhpDisciplineRoute.test.js`
- `tests/analysisFuzzyAhpWfaRoute.test.js`

Coverage:

- 401 unauthenticated
- 403 authenticated non-Admin/Management
- 400 invalid discipline `period`
- 400 discipline custom window missing `from` / `to`
- 400 discipline custom `from > to`
- 400 discipline custom range > 365 days
- 400 WFA missing `lat`
- 400 WFA missing `lon`
- 400 WFA invalid `radius_meters`

These tests must be run first and observed failing for the correct reason.

### Phase B — endpoint contract tests

Create:

- `tests/analysisFuzzyAhpDisciplineContract.test.js`
- `tests/analysisFuzzyAhpWfaContract.test.js`
- `tests/analysisFuzzyAhpSmartAcContract.test.js`

Coverage:

- `response.success === true` on happy paths
- WIB timestamps use `+07:00`
- `data.weights.method === "Chang's Extent Analysis"`
- `data.consistency.threshold === 0.10`
- Discipline returns an array ranking and honest empty output when data is absent
- WFA returns `data_source === 'geoapify_live'`
- WFA explicit provider failure path returns `503 AUTH_OR_PROVIDER_UNAVAILABLE`
- Smart AC sets `needs_data` consistently with available evidence
- Smart AC never fabricates `predicted_time_out`

### Phase C — regression guard

Keep and rerun legacy tests covering `GET /api/analysis/fuzzy-ahp` so this issue cannot silently drift the compatibility endpoint.

## OpenAPI and documentation design

### `docs/openapi.yaml`

Add three new paths:

- `/api/analysis/fuzzy-ahp/discipline`
- `/api/analysis/fuzzy-ahp/wfa`
- `/api/analysis/fuzzy-ahp/smart-ac`

Documentation requirements:

- include auth requirements,
- include query parameter validation,
- include realistic example payloads,
- explicitly document that the combined endpoint remains temporarily supported,
- ensure WFA examples show real-style `distance_m` and non-placeholder `amenity_score` semantics.

### `docs/reporting-analytics-boundary.md`

Extend the document with a `Fuzzy AHP Endpoints Contract` section describing:

- the legacy combined endpoint as temporary compatibility,
- the three dedicated new endpoints,
- their distinct data-source responsibilities,
- the no-fabrication rule.

### ADR

Create a new ADR file in `docs/adr/` describing:

- split into three dedicated endpoints,
- hardcoded threshold `0.10`,
- Smart AC defaulting to today WIB,
- WFA using Geoapify live with explicit `503` provider boundary,
- legacy combined endpoint retained temporarily for compatibility.

### Linear sync draft

Create:

- `docs/linear-sync/INF-170-three-endpoints-2026-05-31.md`

It must contain paste-ready updates for:

- INF-170 progress and evidence summary,
- INF-129 compatibility note,
- INF-141 threshold reminder,
- INF-168 extent-analysis continuity,
- INF-160 frontend migration heads-up.

## Verification design

Implementation is not complete until all of the following exist:

1. `npm run lint` passes.
2. The required targeted Jest commands pass.
3. `npx jest --testPathPattern=fahp --runInBand` passes.
4. `npx jest tests/clientCriticalOpenApiContract.test.js --runInBand` passes.
5. `npm test` passes.
6. Real-data local smoke verification passes for:
   - Discipline default monthly
   - Discipline weekly
   - Discipline custom valid window
   - Discipline invalid range > 365 days
   - WFA happy path with Geoapify live
   - WFA missing lat
   - WFA invalid radius
   - Smart AC default today WIB
   - 401 sanity
   - 403 sanity with Employee token

Smoke evidence must be sanitized before reporting:

- redact tokens,
- redact emails,
- redact full names where needed,
- redact photo URLs,
- reduce coordinate precision.

## Out of scope

- Removing or deprecating the legacy combined endpoint in runtime code
- FE migration work for INF-160 / INF-166
- INF-172 read-only evidence script work
- Changing `src/jobs/*`
- Changing auth/session middleware semantics
- Re-implementing FAHP formulas or pairwise logic
- Introducing new scheduler or attendance final-state behavior

## Risks and mitigations

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| WFA extraction grows into a large refactor | Could spill into `/api/wfa` behavior | Keep extraction minimal and service-focused; stop if unrelated redesign becomes necessary |
| Service payload drift breaks dashboard analytics | Existing internal consumers may rely on old helper shapes | Prefer additive response shaping at controller level and review internal helper consumers before finalizing payload changes |
| Smart AC evidence gets beautified into fiction | Violates issue intent and auditability | Restrict response to factual evidence markers only |
| Threshold still reads env in practice | Violates INF-141 expectation | Lock endpoint consistency payloads to local hardcoded `0.10` |
| Endpoint compat route changes accidentally | Violates explicit user scope | Keep route/controller legacy path untouched and rerun regression coverage |

## Implementation readiness summary

The recommended implementation path is:

1. Add route-level validators for Discipline and WFA.
2. Add dedicated controller handlers while leaving the combined handler untouched.
3. Refactor the analysis service minimally:
   - tighten Discipline empty-real behavior,
   - replace WFA static assumptions with a reusable Geoapify live path,
   - reshape Smart AC output around canonical real evidence.
4. Sync OpenAPI and boundary docs.
5. Add ADR and Linear-sync drafts.
6. Verify with lint, focused tests, full tests, and real-data runtime smoke.

This issue is safe to implement as an additive API change **only if** the WFA live-data reuse stays minimal and the legacy combined endpoint remains behaviorally unchanged.
