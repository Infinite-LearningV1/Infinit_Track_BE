# INF-272 WFA Facility Scoring Design

**Linear:** INF-272 — Backend: Fix WFA facility scoring with Geoapify Place Details and canonical FAHP pipeline  
**GitHub issue:** #134  
**Repository:** `Infinite-LearningV1/Infinit_Track_BE`  
**Integration branch:** `develop`  
**Feature branch:** `feature/inf-272-wfa-facility-scoring`  
**Status:** Approved design; implementation has not started.

## Goal

Make WFA recommendation scores truthful and deterministic by replacing the current generic/fallback amenity score with facility evidence explicitly returned by Geoapify Place Details.

The change must remain bounded:

- preserve the existing Node/Express/Sequelize architecture;
- preserve Chang's Extent Analysis as the canonical FAHP method;
- add one canonical `WfaRecommendationService` rather than introducing a parallel scoring path;
- do not change attendance final-state, geofence, authentication, or unrelated booking behavior;
- do not add a database migration.

## Current behavior and defect

The current WFA recommendation path performs Geoapify Places discovery in `wfa.controller.js`, scores every discovered candidate, sorts the results, and returns at most 30 places.

The score is not a reliable facility score because:

1. `calculateWfaScore()` expects `properties.amenity_score` and falls back to `50` when it is absent.
2. Geoapify Places is used without Place Details enrichment.
3. The controller projects `data_quality`, `workspace_analysis`, and internet-related fields that the FAHP engine does not produce, then fills them with `0`, empty arrays, or `UNKNOWN`.
4. WFA recommendation, WFA analysis, and booking suitability use different orchestration and fallback rules.
5. Category evidence can influence both location type and amenity inference, which double-counts the same signal.

The result can look precise while being based on fabricated or duplicated evidence.

## Locked product decisions

| Area | Decision |
|---|---|
| Places discovery | Keep the current discovery cap of 50 candidates. |
| Place Details enrichment | Enrich at most **30** shortlisted candidates. |
| Preliminary score | Use only `location_type` and `distance_factor`; it is never a final score. |
| Facility criteria | `internet_access`, `opening_hours`, `toilets`, `air_conditioning`, `wheelchair_accessibility`. |
| Provider evidence | Use explicit provider values only. No inference from name, category, address, rating, reviews, website, phone, or popularity. |
| Missing evidence | Represent as `unknown`; never coerce to false, zero, or default 50. |
| Facility minimum evidence | At least 2 of 5 fields known (`facility_confidence >= 40`). |
| Confidence | Eligibility gate and metadata only; never multiply a score. |
| Facility weighting | Separate static/versioned FAHP matrix with computed `CR <= 0.10`. |
| Canonical orchestration | One `WfaRecommendationService`. |
| Recommendation date | `schedule_date` is required and must be a future WIB calendar date eligible for WFA booking. |
| Opening-hours window | Entire `attendance.checkin.start_time` through `attendance.checkin.end_time`. |
| Place Details retry | One retry for transient provider failures. |
| Partial failure | Keep the candidate, but do not issue a final score. |

## API contracts

### Employee recommendation

```http
GET /api/wfa/recommendations?lat=-0.8917&lng=119.8707&schedule_date=2026-08-05
Authorization: Bearer <token>
```

Required query parameters:

- `lat`: finite number in `-90..90`;
- `lng`: finite number in `-180..180`;
- `schedule_date`: strict calendar-valid `YYYY-MM-DD`.

Schedule rules use `Asia/Jakarta`:

- past date: reject with the existing past-date code;
- same-day date: reject with the existing same-day code;
- future date: eligible for further checks;
- an existing pending or approved booking for the same user/date: reject with the existing duplicate-booking contract;
- weekend/holiday behavior must not diverge from `POST /api/bookings`. This issue does not invent an independent recommendation-only calendar rule.

### WFA analysis

`GET /api/analysis/fuzzy-ahp/wfa` must delegate to the same canonical service. Its adapter may keep its route-specific envelope and authorization, but it must provide an explicit target `schedule_date` to the canonical pipeline. No analysis response may use the old category-based amenity heuristic or a static 50.

### Booking suitability

`POST /api/bookings` keeps the current request contract and passes its already-required `schedule_date` and selected coordinates into the canonical service.

If selected-location evidence is insufficient or enrichment fails:

- booking creation behavior remains controlled by existing booking policy;
- stored `suitability_score` and `suitability_label` are `null` rather than fabricated;
- provider failure must not be recorded as poor facilities.

## Canonical pipeline

```text
validate coordinates and WFA schedule eligibility
→ read attendance check-in window
→ Geoapify Places discovery (maximum 50)
→ deduplicate candidates
→ preliminary score from location type and distance
→ shortlist maximum 30
→ Geoapify Place Details enrichment
→ normalize five facility fields
→ facility confidence gate
→ facility FAHP score
→ final WFA FAHP score
→ truthful response mapping and ordering
```

### Preliminary ranking

Reuse the existing main WFA weights for `location_type` and `distance_factor`, exclude the third main criterion, and renormalize the two retained weights to sum to 1.

The preliminary value exists only to choose and internally order the 30 enrichment candidates. It must not be returned as `final_score`, `suitability_score`, or a recommendation label.

### Final ranking

The main WFA criteria are:

```text
location_type
distance_factor
facility_score
```

The existing main WFA pairwise judgments remain unchanged; only the third criterion's semantic name changes from generic `amenity_score` to `facility_score` in the canonical path.

A final score is computed only when `facility_score` is eligible.

## Facility evidence model

The normalizer produces one tri-state entry per criterion:

```js
{
  status: 'available' | 'unavailable' | 'unknown',
  value: 1 | 0 | null,
  rawValue: unknown,
  source: 'geoapify_place_details' | 'not_available'
}
```

Explicit positive values:

```text
true
yes
available
limited
customers
designated
```

Explicit negative values:

```text
false
no
unavailable
```

Normalization is case-insensitive for strings. Missing, empty, unsupported, or unrecognized values become `unknown`.

The response may expose simplified booleans/null for clients, but the service keeps raw evidence for analysis/tests and must never turn `unknown` into `false`.

## Opening-hours evaluation

The required work window comes from:

```text
attendance.checkin.start_time
attendance.checkin.end_time
```

The repository's current attendance-settings fallback remains available when rows are absent; this issue does not create a second settings mechanism.

`opening_hours = available` only when an explicit provider schedule for the weekday of `schedule_date` continuously covers the full configured interval.

For an `08:00–18:00` window:

| Provider schedule | Normalized value |
|---|---:|
| `07:00–20:00` | 1 |
| `08:00–18:00` | 1 |
| `09:00–20:00` | 0 |
| `08:00–12:00, 13:00–20:00` | 0 |
| explicitly closed | 0 |
| missing or unsupported syntax | unknown |

The initial parser supports explicit weekday selectors and same-day `HH:mm-HH:mm` intervals. Overnight ranges, public-holiday exceptions, free text, or unsupported complex expressions are `unknown`, not guessed.

## Facility FAHP model

Fixed criterion order:

```text
internet_access
opening_hours
toilets
air_conditioning
wheelchair_accessibility
```

Static expert-judgment matrix:

```js
export const WFA_FACILITY_PAIRWISE_TFN = [
  [TFN.EQUAL, TFN.WEAK, TFN.MODERATE, TFN.MODERATE, TFN.MODERATE_PLUS],
  [invTFN(TFN.WEAK), TFN.EQUAL, TFN.WEAK, TFN.WEAK, TFN.MODERATE],
  [invTFN(TFN.MODERATE), invTFN(TFN.WEAK), TFN.EQUAL, TFN.EQUAL, TFN.WEAK],
  [invTFN(TFN.MODERATE), invTFN(TFN.WEAK), TFN.EQUAL, TFN.EQUAL, TFN.WEAK],
  [invTFN(TFN.MODERATE_PLUS), invTFN(TFN.MODERATE), invTFN(TFN.WEAK), invTFN(TFN.WEAK), TFN.EQUAL]
];
```

Using the repository's defuzzification and `computeCR()` implementation, the matrix currently computes approximately:

```text
lambda_max = 5.158981
CI         = 0.039745
CR         = 0.035487
```

The test must compute the real CR and assert `CR <= 0.10`; production code must not hardcode the calculated result.

Facility weights are computed through the existing Chang extent implementation and cached using the same pattern as other FAHP weights.

## Facility score and confidence

```text
facility_confidence = known_fields / 5 × 100
```

Unknown fields are excluded from both numerator and denominator of the facility weighted sum. Known criterion weights are renormalized to sum to 1.

```text
known_fields = 0 or 1
→ facility_score = null
→ final_score = null
→ status = insufficient_facility_data

known_fields >= 2
→ facility_score = weighted known binary values × 100
→ final_score = main WFA weighted score
→ status = ranked
```

Confidence is never multiplied into `facility_score` or `final_score`.

## Candidate states and ordering

Canonical states:

```text
ranked
insufficient_facility_data
facility_enrichment_failed
```

Ordering:

1. `ranked`, descending `final_score`, deterministic tie-break by preliminary order and `place_id`;
2. `insufficient_facility_data`, preserving preliminary order;
3. `facility_enrichment_failed`, preserving preliminary order.

Only `ranked` candidates receive `final_rank` and `final_label`.

## Geoapify behavior

### Places discovery

A discovery-level failure fails the request using the existing provider-error boundary. No candidates can be produced without discovery.

### Place Details enrichment

Enrich at most 30 candidates using bounded concurrency of 5.

Retry exactly once after a 500 ms delay for:

- timeout/abort;
- `ECONNRESET`, `ENOTFOUND`, `EAI_AGAIN`, or equivalent connection-unavailable codes;
- HTTP `429`;
- HTTP `5xx`.

Do not retry HTTP `400`, `401`, or `403`.

A candidate that still fails is retained as:

```js
{
  status: 'facility_enrichment_failed',
  facilityScore: null,
  facilityConfidence: 0,
  finalScore: null
}
```

This failure does not fail successful candidates and never becomes five unavailable facilities.

## Architecture and ownership

```text
Route + existing auth/RBAC + validation
→ thin controller adapter
→ WfaRecommendationService
   ├── WFA booking-date policy
   ├── Geoapify provider client
   ├── candidate deduplication/preliminary ranker
   ├── facility evidence normalizer
   ├── facility FAHP scorer
   └── final WFA scorer/result mapper
```

### Proposed focused modules

- `src/services/wfaBookingPolicy.service.js`
  - strict schedule validation;
  - pending/approved duplicate check;
  - shared by booking and recommendation.

- `src/services/wfaRecommendation.service.js`
  - public canonical orchestration;
  - candidate limit and ordering;
  - analysis and booking adapters call this service.

- `src/services/geoapifyWfa.client.js`
  - Places and Place Details HTTP calls;
  - redaction, timeouts, retry classification;
  - no FAHP rules.

- `src/utils/wfaFacilityEvidence.js`
  - pure facility tri-state normalization;
  - simple opening-hours parser/evaluator;
  - no network/database access.

- `src/utils/fuzzyAhpEngine.js`
  - facility weight and score functions;
  - main scorer consumes `facility_score` explicitly;
  - no provider mapping.

Controllers remain HTTP adapters. DI/config does not make business decisions.

## Response contract

Representative employee response:

```json
{
  "success": true,
  "data": {
    "schedule_date": "2026-08-05",
    "timezone": "Asia/Jakarta",
    "work_window": {
      "start_time": "08:00:00",
      "end_time": "18:00:00"
    },
    "recommendations": [
      {
        "place_id": "geoapify-place-id",
        "name": "Example Cafe",
        "address": "Example address",
        "latitude": -0.8917,
        "longitude": 119.8707,
        "distance_meters": 450,
        "place_type": "cafe",
        "status": "ranked",
        "final_rank": 1,
        "final_score": 82.4,
        "final_label": "Sangat Tinggi",
        "facility_score": 75,
        "facility_confidence": 80,
        "facilities": {
          "internet_access": true,
          "opening_hours": false,
          "toilets": true,
          "air_conditioning": true,
          "wheelchair_accessibility": null
        }
      }
    ]
  },
  "meta": {
    "discovered_candidates": 50,
    "enriched_candidates": 30,
    "ranked_candidates": 20,
    "insufficient_data_candidates": 8,
    "enrichment_failed_candidates": 2
  }
}
```

Remove or deprecate fabricated controller projections such as workspace score, power outlets, seating quality, noise estimate, and data reliability when they have no canonical producer.

## Error handling

- Validation errors preserve stable field-level codes where they already exist.
- Provider credentials/auth failures are explicit provider/config failures, not empty recommendations.
- Discovery failure is request-level.
- Details failure is candidate-level.
- Missing provider evidence is `unknown`, not an error.
- A matrix with `CR > 0.10` is a test/configuration failure and must not be silently accepted.

## Test strategy

TDD is required. Coverage must include:

1. schedule policy: invalid calendar date, past, same-day, future, duplicate pending, duplicate approved;
2. facility matrix: computed `CR <= 0.10`, stable criterion order, non-negative weights summing to 1;
3. normalization: all accepted positive/negative values and unknown values;
4. opening hours: full coverage, late opening, early close, split interval, closed, missing, unsupported;
5. facility scoring: 0/1/2/5 known fields, known-weight renormalization, confidence not multiplied;
6. preliminary shortlist: only location/distance, deterministic top 30, no preliminary value exposed as final;
7. retries: transient retry once, permanent errors no retry, partial failures retained;
8. controller contract: required `schedule_date`, truthful states, no fabricated response fields;
9. WFA analysis: delegates to the canonical service;
10. booking suitability: delegates to the canonical service and stores null rather than fallback 50 when no valid score;
11. OpenAPI and API-contract inventory drift guards.

## Out of scope

- Redis or persistent provider cache;
- database schema changes;
- new Android/Web UI;
- runtime-editable FAHP matrices;
- changing the Chang extent implementation;
- adding complex third-party opening-hours parsing;
- changing weekend/holiday policy independently from booking;
- unrelated controller or architecture rewrites;
- attendance/geofence behavior changes.

## Acceptance criteria

- [ ] Recommendation requires `schedule_date` and uses the shared WFA booking policy.
- [ ] Discovery remains capped at 50 and Place Details enrichment at 30.
- [ ] Preliminary scoring uses only location type and distance.
- [ ] Five facility fields use explicit Place Details evidence.
- [ ] Unknown evidence never becomes false, zero, or default 50.
- [ ] Separate facility matrix computes `CR <= 0.10` through repository utilities.
- [ ] Known-field weights are renormalized.
- [ ] Fewer than two known fields produces no final score.
- [ ] Confidence is a gate only.
- [ ] Opening hours covers the complete configured check-in window.
- [ ] Place Details retries once only for transient failures.
- [ ] Partial failures preserve candidates without final scores.
- [ ] Recommendation, analysis, and booking suitability delegate to `WfaRecommendationService`.
- [ ] Fabricated response fields and fallback scores are removed from the canonical path.
- [ ] OpenAPI and API-contract inventory match runtime behavior.
- [ ] Focused tests, full Jest suite, lint, and authenticated runtime smoke evidence are reported in the PR.
