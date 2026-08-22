# INF-272 WFA Facility Scoring Design — 2026-08-02

Branch: `feature/inf-272-wfa-facility-scoring`

Linear: `INF-272 — Backend: Fix WFA facility scoring with Geoapify Place Details and canonical FAHP pipeline`

Integration target: `develop`

Design status: approved for implementation planning.

## Goal

Replace fabricated or inferred WFA facility scoring with explicit Geoapify Place Details evidence, a separate versioned facility FAHP matrix, and one canonical `WfaRecommendationService` shared by recommendations, dedicated WFA analysis, and booking suitability.

The change must remove the canonical `amenity_score = 50` fallback, preserve candidates whose facility data is incomplete, and clearly distinguish ranked results from insufficient-data and provider-failure results.

## Current repository facts

- The backend is Node.js ESM, Express, Sequelize, and MySQL.
- Business date/time semantics use `Asia/Jakarta`.
- `GET /api/wfa/recommendations` currently validates only `lat` and `lng`, calls Geoapify Places directly from `wfa.controller.js`, and fabricates multiple response fields that the engine does not produce.
- `GET /api/analysis/fuzzy-ahp/wfa` currently uses `fuzzyAhpAnalysis.service.js`, derives an amenity score without Place Details, and has no schedule date.
- `POST /api/bookings` currently performs a separate nearest-place lookup and returns suitability `50` when provider data is absent or fails.
- `fuzzyAhpEngine.calculateWfaScore()` currently defaults missing amenity data to `50`.
- The main WFA matrix currently names its third criterion `amenity_score`.
- Booking `suitability_score` and `suitability_label` columns are nullable, so no schema migration is required for truthful unknown suitability.
- The legacy combined `/api/analysis/fuzzy-ahp?type=wfa` route builds historical location rankings with fixed amenity and distance values.
- Existing auth/session and RBAC behavior remains authoritative and unchanged.

## Locked product and architecture decisions

1. Use one canonical `WfaRecommendationService` within the existing layer-first repository architecture.
2. Keep controllers limited to HTTP validation, service invocation, and response/error mapping.
3. Keep Geoapify response mapping outside the FAHP engine.
4. Use a focused Geoapify client, facility-scoring service, eligibility service, and opening-hours evaluator rather than a generic provider framework.
5. `GET /api/wfa/recommendations` requires `lat`, `lng`, and `schedule_date`.
6. `GET /api/analysis/fuzzy-ahp/wfa` requires `lat`, `lon`, and `schedule_date`; `radius_meters` remains optional with its existing bounds/default.
7. The dedicated analysis endpoint evaluates schedule-dependent scoring but does not apply employee duplicate-booking checks.
8. Recommendations and booking creation share strict future-date and duplicate pending/approved eligibility rules.
9. Facility FAHP uses a static, versioned equal-importance matrix for the five confirmed criteria. Its expected consistency ratio is exactly `0`.
10. Unknown facility values are excluded and known-field weights are renormalized.
11. At least two of five facility fields must be known before a final WFA score is produced.
12. Confidence is a gate only; it never multiplies the facility or final score.
13. No score is inferred from place name, category, website, rating, reviews, popularity, or assumptions about a place type.
14. Preliminary score exists only to shortlist candidates and is never exposed as a final recommendation score.
15. Provider failure is not equivalent to a facility being unavailable.
16. The deprecated combined WFA analysis must stop producing fabricated rankings and return a typed move response.
17. OpenAPI and relevant Postman/documentation contracts are part of this change.

## Chosen architecture

```text
Route
→ existing auth / role guard / validator
→ thin controller
→ WfaRecommendationService
   → shared WFA eligibility/date policy
   → Geoapify Places discovery
   → preliminary location/distance ranking
   → top-30 Place Details enrichment
   → facility normalization and opening-hours evaluation
   → facility FAHP
   → final WFA FAHP
   → deterministic result mapping
→ HTTP response
```

The service exposes focused public entry points backed by one internal pipeline:

```text
recommendForUser({ userId, latitude, longitude, scheduleDate })
analyze({ latitude, longitude, scheduleDate, radiusMeters })
scoreBookingLocation({ userId, latitude, longitude, scheduleDate })
```

The public methods select eligibility and candidate-selection behavior, but they do not implement separate scoring algorithms.

### Consumer behavior

| Consumer | Date validation | Duplicate check | Candidate selection | Output |
| --- | --- | --- | --- | --- |
| Recommendations | strict future WIB date | yes | discover, preliminary rank, top 30 | candidate list |
| Dedicated WFA analysis | strict future WIB date | no | discover, preliminary rank, top 30 | analysis/ranking payload |
| Booking suitability | strict future WIB date | yes | selected-coordinate nearest valid candidate | one suitability result |

`fuzzyAhpAnalysis.service.js` delegates dedicated WFA analysis to the canonical service. Discipline and Smart AC analysis remain unchanged.

## File boundaries

Expected focused additions:

```text
src/services/wfaRecommendation.service.js
src/services/geoapifyWfa.client.js
src/services/wfaFacility.service.js
src/services/wfaEligibility.service.js
src/utils/wfaOpeningHours.js
```

Responsibilities:

- `wfaRecommendation.service.js`: pipeline orchestration, preliminary shortlist, candidate status, final ordering, and consumer projections.
- `geoapifyWfa.client.js`: API-key resolution, redacted diagnostics, Places discovery, Place Details calls, retry classification, and provider-error normalization.
- `wfaFacility.service.js`: explicit provider-value normalization, known-field counting, confidence, renormalized facility FAHP, and facility evidence mapping.
- `wfaEligibility.service.js`: strict date parsing, WIB future-only policy, and pending/approved duplicate lookup helpers.
- `wfaOpeningHours.js`: evaluate an OpenStreetMap `opening_hours` expression over the complete configured check-in window.

Expected modifications remain bounded to:

```text
src/controllers/wfa.controller.js
src/controllers/booking.controller.js
src/controllers/analysis.controller.js
src/services/fuzzyAhpAnalysis.service.js
src/utils/fuzzyAhpEngine.js
src/analytics/config.fahp.js
src/middlewares/validator.js
src/routes/wfa.routes.js
docs/openapi.yaml
relevant tests and Postman/docs contracts
package.json
package-lock.json
```

No generic adapter, repository, module, base-controller, or v2 API architecture is introduced.

## Request contracts

### Recommendations

```http
GET /api/wfa/recommendations?lat=-0.895&lng=119.872&schedule_date=2026-08-10
Authorization: Bearer <token>
```

Required:

```text
lat
lng
schedule_date
```

Rules:

- coordinates must be finite and within latitude/longitude bounds;
- `schedule_date` must be a real calendar date in exact `YYYY-MM-DD` form;
- only a date after the current WIB date is eligible;
- same-day and past dates are rejected;
- a pending or approved booking for the authenticated user on the same date is rejected.

### Dedicated WFA analysis

```http
GET /api/analysis/fuzzy-ahp/wfa?lat=-0.895&lon=119.872&schedule_date=2026-08-10&radius_meters=5000
Authorization: Bearer <admin-or-management-token>
```

Rules:

- `lat`, `lon`, and `schedule_date` are required;
- `radius_meters` keeps the current integer default and bounds;
- the schedule date follows the same strict future-date rules used by recommendations;
- no duplicate-booking check is applied because the endpoint is an Admin/Management analysis surface.

### Booking suitability

`POST /api/bookings` keeps its existing request body. The existing `schedule_date`, user identity, request reason, server radius, and duplicate rules remain authoritative. Suitability is calculated through the same canonical service before the write transaction begins.

The duplicate pending/approved check is repeated inside the write transaction before persistence to reduce the race window. Existing database constraints remain an additional final guard.

## Candidate discovery and preliminary shortlist

1. Query Geoapify Places with the existing approved WFA categories and configured search radius.
2. Reject features without a stable `place_id`, valid coordinates, or a finite distance.
3. Deduplicate by `place_id`; use normalized name plus rounded coordinates only as a defensive fallback key.
4. Calculate preliminary score using only normalized location type and distance factor.
5. Sort deterministically by preliminary score descending, distance ascending, stable place ID ascending.
6. Keep at most 30 candidates for Place Details enrichment.

Preliminary score is internal metadata. It must not populate `final_score`, `suitability_score`, or any externally named recommendation score.

## Geoapify Place Details

Use:

```http
GET https://api.geoapify.com/v2/place-details?id=<place_id>&features=details&apiKey=<redacted>
```

The client selects the returned feature whose `properties.feature_type` is `details`. Missing details features are treated as insufficient provider evidence, not as five negative facilities.

Only these Place Details properties contribute to facility evidence:

```text
internet_access
air_conditioning
toilets
opening_hours
wheelchair
```

The canonical API renames `wheelchair` to `wheelchair_accessibility` in facility evidence.

## Facility normalization

Canonical facility keys:

```text
internet_access
air_conditioning
toilets
opening_hours
wheelchair_accessibility
```

Normalized values:

```text
available   → 1
unavailable → 0
unknown     → null
```

Provider values are trimmed and matched case-insensitively.

Explicit available values:

```text
true
yes
available
limited
customers
designated
```

Explicit unavailable values:

```text
false
no
unavailable
```

All missing, unsupported, empty, malformed, or unrecognized values become `null`. Objects such as `internet_access_details` and `wheelchair_details` may be returned as evidence metadata but cannot independently convert an unknown primary field into available.

## Opening-hours evaluation

The evaluation window is the complete configured interval from:

```text
attendance.checkin.start_time
attendance.checkin.end_time
```

Rules:

- construct the interval on `schedule_date` in `Asia/Jakarta`;
- preserve the full configured window without shrinking or rounding it;
- use the `opening_hours` package, locked by `package-lock.json`, to evaluate OpenStreetMap syntax;
- return `1` only if one or more open intervals continuously cover the entire configured window without a gap;
- opening late, closing early, or a split interval returns `0`;
- missing or unparseable provider schedules return `null`;
- missing or invalid attendance check-in settings produce `WFA_CONFIG_UNAVAILABLE`, not an assumed default window.

## Facility FAHP

Add a separate versioned matrix in `src/analytics/config.fahp.js` with criteria ordered as:

```text
internet_access
air_conditioning
toilets
opening_hours
wheelchair_accessibility
```

The approved initial expert judgment is equal importance. Every matrix cell uses `TFN.EQUAL`; the crisp representation is:

```text
[
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1]
]
```

The implementation uses the repository's canonical TFN/Chang-extent path rather than an arithmetic shortcut. Expected derived weights are `0.20` each and expected `CR = 0`.

For each candidate:

```text
known_fields = count(value is 0 or 1)
facility_confidence = known_fields / 5 * 100
```

Unknown criteria are removed, and weights for known criteria are renormalized to sum to `1` before calculating `facility_score`.

Examples:

- five known values: each contributes weight `0.20`;
- two known values: each contributes weight `0.50`;
- one known value: it contributes weight `1.00`, but confidence remains `20%` and final scoring is blocked.

Confidence never multiplies a score.

## Main WFA FAHP

Rename the third main criterion from `amenity_score` to `facility_score`:

```text
location_type
distance_factor
facility_score
```

The existing versioned main WFA pairwise judgments remain unchanged except for the semantic rename. The engine accepts an explicit numeric facility score and never supplies a default.

If fewer than two facility fields are known, the main engine is not called and `final_score` remains `null`.

The main engine must propagate typed invalid-input failures to the service rather than converting scoring errors into a plausible score of `0`.

## Candidate statuses and response

Allowed statuses:

```text
ranked
insufficient_facility_data
facility_enrichment_failed
```

Canonical candidate example:

```json
{
  "place_id": "geoapify-place-id",
  "name": "Example Cafe",
  "address": "Example address",
  "latitude": -0.895,
  "longitude": 119.872,
  "status": "ranked",
  "distance_meters": 420,
  "location_type": "cafe",
  "facility_score": 75,
  "facility_confidence": 80,
  "facilities": {
    "internet_access": 1,
    "air_conditioning": 1,
    "toilets": 0,
    "opening_hours": 1,
    "wheelchair_accessibility": null
  },
  "final_score": 82.4,
  "final_label": "Sangat Direkomendasikan"
}
```

Status rules:

- `ranked`: at least two known facilities, valid facility score, and valid final score;
- `insufficient_facility_data`: enrichment completed, but fewer than two facilities are known; a facility score may exist when one field is known, while final score/label are `null`;
- `facility_enrichment_failed`: Place Details failed after retry policy; facility score, facility confidence, final score, and label are `null`.

The `facilities` object always contains all five keys. Unknown values are `null`, never `false` or `0` by omission.

Remove canonical response fields that fabricate engine/provider evidence, including the current `real_data_analysis`, default ratings/reviews, workspace assumptions, and inferred amenity collections.

## Deterministic result ordering

1. `ranked` candidates first, ordered by final score descending, distance ascending, and place ID ascending.
2. `insufficient_facility_data` candidates next, ordered by facility confidence descending, distance ascending, and place ID ascending.
3. `facility_enrichment_failed` candidates last, ordered by distance ascending and place ID ascending.

No candidate without a valid final score receives a numeric rank. The response may provide list position separately if needed, but `rank` is reserved for final-score ranking.

## Provider retry and concurrency

Each Geoapify request has at most two attempts: the initial attempt and one retry.

Retry once for:

```text
timeout
connection error
HTTP 429
HTTP 5xx
```

Do not retry:

```text
HTTP 400
HTTP 401
HTTP 403
other classified non-transient 4xx
```

Place Details enrichment uses a bounded worker pool with maximum concurrency `5`.

Failure semantics:

- Places discovery failure fails the whole request with a typed provider error because no candidate set exists;
- one Place Details failure affects only that candidate;
- all Place Details calls failing still returns the candidate list with `facility_enrichment_failed` statuses for recommendations and analysis;
- provider failures are logged with the API key redacted.

## Booking behavior

Booking suitability uses the same facility and final scoring implementation.

- A systemic provider failure while resolving the selected location returns `503 WFA_SCORING_UNAVAILABLE`; no booking or location row is written.
- A successful discovery response with no matching place is treated as insufficient facility data, so the pending booking may proceed with nullable suitability.
- A successful provider response with fewer than two known facility fields permits a pending booking with `suitability_score = null` and `suitability_label = null`.
- A successfully ranked selected location persists its canonical final score and label.
- No provider/error/no-place path persists `50` or another fallback.
- External provider calls occur before the Sequelize write transaction.
- The duplicate pending/approved lookup is repeated inside the transaction immediately before persistence.

The create response reports the scoring status alongside existing booking data so clients can distinguish an unknown suitability from a zero suitability. No new database column is added for the transient scoring status in this issue.

## Error contract

Preserve the existing response envelope and use stable codes:

```text
INVALID_SCHEDULE_DATE
PAST_DATE_NOT_ALLOWED
SAME_DAY_NOT_ALLOWED
DUPLICATE_BOOKING
WFA_PROVIDER_UNAVAILABLE
WFA_SCORING_UNAVAILABLE
WFA_CONFIG_UNAVAILABLE
```

Validation errors retain field-level entries. Provider/configuration errors include no secret-bearing request parameters.

## Legacy and compatibility behavior

### Combined analysis endpoint

`GET /api/analysis/fuzzy-ahp?type=wfa` must stop producing fixed amenity/distance rankings. It returns:

```http
410 Gone
```

```json
{
  "success": false,
  "code": "WFA_ANALYSIS_MOVED",
  "message": "Use /api/analysis/fuzzy-ahp/wfa with lat, lon, and schedule_date."
}
```

Legacy combined discipline and Smart AC behavior remains unchanged.

### WFA config/test endpoints

`GET /api/wfa/ahp-config` and `POST /api/wfa/test-ahp` use `facility_score` in input/output. They do not expose or accept `amenity_score` as an alias because the old term described a different, inference-based criterion.

### Documentation

Update:

```text
docs/openapi.yaml
Postman WFA/FAHP examples and evidence docs used by contract tests
route/contract documentation that lists the legacy combined endpoint
```

Document example candidates for all three statuses and explicitly state that preliminary score is not returned.

## Testing strategy

### Eligibility and request validation

- missing schedule date;
- wrong format;
- invalid calendar date;
- past date in WIB;
- same-day date in WIB;
- valid future date;
- duplicate pending booking;
- duplicate approved booking;
- rejected booking does not trigger the pending/approved duplicate policy;
- analysis skips duplicate checks.

### Discovery and shortlist

- invalid features are removed;
- stable place-ID deduplication;
- fallback deduplication for malformed provider records;
- preliminary score uses only location and distance;
- at most 30 Place Details calls;
- preliminary score is absent from public response;
- deterministic shortlist tie-breaking.

### Facility normalization and FAHP

- every approved positive representation;
- every approved negative representation;
- missing, empty, malformed, and unsupported values become unknown;
- details objects cannot invent primary availability;
- equal facility weights and `CR = 0`;
- known-field renormalization;
- confidence values at `0`, `20`, `40`, and `100` percent;
- confidence does not multiply score;
- one known field blocks final score;
- two known fields permit final score;
- main criteria use `facility_score` and contain no fallback `50`.

### Opening hours

- continuously open for the whole check-in window;
- opens late;
- closes early;
- split interval with a gap;
- schedule crossing midnight where supported by configuration;
- missing expression;
- unparseable expression;
- WIB date/window construction;
- missing/invalid attendance configuration.

### Provider behavior

- one retry for timeout;
- one retry for connection error;
- one retry for `429`;
- one retry for `5xx`;
- no retry for `400`, `401`, or `403`;
- no third attempt;
- concurrency never exceeds five;
- one failed candidate does not fail other candidates;
- discovery failure maps to a top-level provider error;
- API key remains redacted.

### Consumer contracts

- recommendations emit ranked, insufficient, and failed candidates truthfully;
- dedicated analysis requires schedule date and uses the same ranking output;
- booking provider outage writes nothing and returns `503`;
- booking insufficient data persists nullable suitability;
- booking ranked data persists canonical final score/label;
- transaction-level duplicate recheck;
- legacy combined WFA returns `410 WFA_ANALYSIS_MOVED`;
- WFA config/test endpoints use `facility_score`;
- OpenAPI matches runtime request/response/error behavior.

### Regression coverage

- discipline FAHP;
- Smart AC FAHP;
- auth/session and Admin/Management RBAC;
- booking approval/rejection;
- WFA projection/read paths with nullable suitability;
- nightly WFA resolver behavior;
- architecture-layer rules.

## Verification gates

Required local gates:

```bash
npm run lint
npm test
git diff --check
```

Required PR evidence:

```text
focused test commands and red/green evidence
full lint/test counts
facility and main FAHP CR values
example response for ranked candidate
example response for insufficient_facility_data candidate
example response for facility_enrichment_failed candidate
legacy 410 contract example
```

Runtime Geoapify/authenticated smoke, migration status, container proof, and deployment proof remain separate. Mark them `Needs Verification` when credentials or a suitable environment are unavailable.

## Risks and mitigations

### Provider credit and latency amplification

Up to 30 Place Details calls are added per recommendation request.

Mitigation:

- shortlist before enrichment;
- hard limit 30;
- concurrency limit 5;
- one bounded retry only;
- do not request optional expensive Place Details features.

### Sparse or outdated OpenStreetMap evidence

Geoapify exposes OSM-backed fields that may be absent or stale.

Mitigation:

- represent missing values as unknown;
- expose facility confidence;
- require at least two known fields for final scoring;
- never infer from unrelated metadata.

### Opening-hours parser complexity

The OSM syntax is too broad for a safe custom parser.

Mitigation:

- use the maintained `opening_hours` package;
- lock the resolved version;
- treat parse failure as unknown;
- cover full-window and gap cases in tests.

### Breaking API semantics

The new response removes fabricated fields, renames amenity semantics, and moves legacy combined WFA analysis.

Mitigation:

- treat this as an explicit API-significant change;
- update OpenAPI and Postman examples in the same PR;
- provide stable typed errors and three explicit candidate statuses;
- call out required client migration in PR notes.

### Booking transaction race

Scoring outside the write transaction reduces lock time but creates time between the first duplicate check and persistence.

Mitigation:

- perform an early eligibility check before provider work;
- repeat duplicate lookup inside the write transaction;
- preserve database constraints as the final guard.

## Out of scope

```text
generic provider abstraction
new repository/module architecture
new WFA database tables or suitability-status columns
runtime-editable FAHP matrices
client UI changes
attendance final-state changes
scheduler/job behavior changes
historical score backfill
Geoapify response caching
alternative location providers
production deployment
```

## Acceptance criteria

- [ ] Recommendations require valid future `schedule_date` and share booking eligibility rules.
- [ ] Dedicated WFA analysis requires `schedule_date` without a duplicate-booking check.
- [ ] Candidate enrichment is limited to a maximum of 30 places.
- [ ] Preliminary score uses only location type and distance and is not exposed as final suitability.
- [ ] Place Details provides the five confirmed facility criteria.
- [ ] Missing facility data is unknown, not false or zero.
- [ ] No default facility/amenity score `50` remains in the canonical pipeline.
- [ ] A separate equal-importance facility FAHP matrix exists with `CR = 0`.
- [ ] Known-field weights are renormalized when fields are unknown.
- [ ] At least two known facility fields are required for final scoring.
- [ ] Confidence is a gate only.
- [ ] Opening hours covers the complete configured check-in window in WIB.
- [ ] One retry is applied only to transient failures.
- [ ] Partial enrichment failure preserves successful candidates.
- [ ] The canonical service is used by recommendations, dedicated analysis, and booking suitability.
- [ ] Fabricated response fields and fallbacks are removed from canonical contracts.
- [ ] Booking provider failure writes nothing; insufficient data persists nullable suitability.
- [ ] Legacy combined WFA analysis returns `410 WFA_ANALYSIS_MOVED`.
- [ ] OpenAPI and relevant documentation match runtime behavior.
- [ ] Focused tests, full tests, lint, and diff checks pass with evidence.
