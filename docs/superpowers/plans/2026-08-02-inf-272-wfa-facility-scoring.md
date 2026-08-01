# INF-272 WFA Facility Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Produce truthful WFA recommendations from confirmed Geoapify Place Details using a separate facility FAHP matrix and one canonical recommendation service.

**Architecture:** Extract WFA date policy and provider orchestration from controllers. Put discovery, top-30 enrichment, facility normalization, facility FAHP, and final ranking behind `WfaRecommendationService`; keep FAHP mathematics in the existing analytics/engine modules and keep controllers as HTTP adapters.

**Tech Stack:** Node.js ESM, Express, express-validator, Sequelize, Axios, Jest, Supertest, existing Chang's Extent Analysis utilities, Geoapify Places and Place Details.

## Global Constraints

- Integration branch: `develop`.
- Implementation branch: `feature/inf-272-wfa-facility-scoring`.
- Geoapify Places discovery limit: `50`.
- Geoapify Place Details enrichment limit: `30`.
- Place Details concurrency: `5`.
- Transient Place Details retry: exactly `1` retry after `500 ms`.
- Business timezone: `Asia/Jakarta`.
- Facility criteria order: `internet_access`, `opening_hours`, `toilets`, `air_conditioning`, `wheelchair_accessibility`.
- Minimum facility evidence: `2` known fields (`40%`).
- Facility matrix consistency threshold: `CR <= 0.10`.
- No fabricated score, facility, or provider evidence.
- No database migration.
- Preserve existing auth/RBAC middleware and booking transaction behavior.
- Each task follows RED → minimal GREEN → focused regression → commit.

## Local Worktree Setup

```bash
git fetch origin feature/inf-272-wfa-facility-scoring
git worktree add .worktrees/inf-272-wfa-facility-scoring \
  -b feature/inf-272-wfa-facility-scoring \
  origin/feature/inf-272-wfa-facility-scoring
cd .worktrees/inf-272-wfa-facility-scoring
npm install
npm test -- --runInBand
```

When the local branch already exists, omit `-b` and use:

```bash
git worktree add .worktrees/inf-272-wfa-facility-scoring feature/inf-272-wfa-facility-scoring
```

Do not start implementation when the baseline suite fails without first recording whether the failure reproduces on `origin/develop`.

## File Map

| File | Responsibility |
|---|---|
| `src/services/wfaBookingPolicy.service.js` | Shared strict date and active-booking policy. |
| `src/services/geoapifyWfa.client.js` | Places/Place Details HTTP calls, redaction, transient retry, bounded concurrency. |
| `src/services/wfaRecommendation.service.js` | Canonical discovery, shortlist, enrichment, scoring, ordering. |
| `src/utils/wfaFacilityEvidence.js` | Pure tri-state normalization and opening-hours evaluation. |
| `src/analytics/config.fahp.js` | Static facility pairwise TFN matrix. |
| `src/utils/fuzzyAhpEngine.js` | Facility weights/CR, known-weight renormalization, canonical final score. |
| `src/middlewares/validator.js` | Recommendation and analysis query validation. |
| `src/controllers/wfa.controller.js` | Thin employee HTTP adapter and config projection. |
| `src/services/fuzzyAhpAnalysis.service.js` | WFA analysis adapter over canonical service. |
| `src/controllers/booking.controller.js` | Booking suitability adapter over canonical service. |
| `docs/openapi.yaml` | Public request/response/error contract. |
| `docs/architecture/api-contract-inventory.md` | Runtime ownership and drift record. |

---

### Task 1: Extract the shared WFA schedule policy

**Files:**

- Create: `src/services/wfaBookingPolicy.service.js`
- Create: `tests/wfaBookingPolicy.test.js`
- Modify: `src/controllers/booking.controller.js`
- Modify: `src/middlewares/validator.js`
- Modify: `src/routes/wfa.routes.js`
- Modify: `tests/wfaControllerContract.test.js`

**Interfaces:**

```js
validateWfaScheduleDate(scheduleDate, { todayDate })
// returns normalized YYYY-MM-DD or throws typed error synchronously

assertNoActiveWfaBooking({ userId, scheduleDate, transaction })
// resolves undefined or throws DUPLICATE_BOOKING asynchronously

assertWfaScheduleEligibility({ userId, scheduleDate, todayDate, transaction })
// combines both functions and resolves normalized YYYY-MM-DD
```

- [ ] **Step 1: Write failing pure date-policy tests**

```js
import { validateWfaScheduleDate } from '../src/services/wfaBookingPolicy.service.js';

it.each([
  [undefined, 'INVALID_SCHEDULE_DATE'],
  ['2026-02-30', 'INVALID_SCHEDULE_DATE'],
  ['2026-08-01', 'PAST_DATE_NOT_ALLOWED'],
  ['2026-08-02', 'SAME_DAY_NOT_ALLOWED']
])('rejects %p with %s', (scheduleDate, code) => {
  expect(() =>
    validateWfaScheduleDate(scheduleDate, { todayDate: '2026-08-02' })
  ).toThrow(expect.objectContaining({ code }));
});

it('accepts a strict future date', () => {
  expect(validateWfaScheduleDate('2026-08-03', { todayDate: '2026-08-02' }))
    .toBe('2026-08-03');
});
```

- [ ] **Step 2: Write failing duplicate-policy tests**

Mock `Booking.findOne` and assert the exact query:

```js
expect(Booking.findOne).toHaveBeenCalledWith({
  where: {
    user_id: 7,
    schedule_date: '2026-08-03',
    status: { [Op.in]: [1, 3] }
  },
  transaction
});
```

Assert an existing status `1` or `3` throws `{ status: 409, code: 'DUPLICATE_BOOKING' }`.

- [ ] **Step 3: Run the new test and confirm RED**

```bash
npm test -- --runInBand tests/wfaBookingPolicy.test.js
```

Expected: FAIL because `wfaBookingPolicy.service.js` does not exist.

- [ ] **Step 4: Implement strict date validation and duplicate checking**

Use the same stable booking codes already exposed by `createBooking()`:

```text
INVALID_SCHEDULE_DATE
PAST_DATE_NOT_ALLOWED
SAME_DAY_NOT_ALLOWED
DUPLICATE_BOOKING
```

Create errors with `status`, `code`, and `details: [{ field: 'schedule_date', code }]`.

- [ ] **Step 5: Add `wfaRecommendationValidation`**

Append this chain in `src/middlewares/validator.js`:

```js
export const wfaRecommendationValidation = [
  query('lat')
    .exists({ values: 'falsy' }).withMessage('lat is required')
    .bail()
    .isFloat({ min: -90, max: 90 }).withMessage('lat must be a valid latitude'),
  query('lng')
    .exists({ values: 'falsy' }).withMessage('lng is required')
    .bail()
    .isFloat({ min: -180, max: 180 }).withMessage('lng must be a valid longitude'),
  query('schedule_date')
    .exists({ values: 'falsy' })
    .withMessage({ code: 'INVALID_SCHEDULE_DATE', message: 'schedule_date is required' })
    .bail()
    .isString()
    .bail()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage({ code: 'INVALID_SCHEDULE_DATE', message: 'schedule_date must use YYYY-MM-DD' }),
  validate
];
```

Mount it on `GET /recommendations` after `verifyToken` and before the controller.

- [ ] **Step 6: Replace booking-controller date/duplicate duplication**

Inside the existing transaction, call:

```js
const formattedScheduleDate = await assertWfaScheduleEligibility({
  userId,
  scheduleDate: schedule_date,
  todayDate: getJakartaDateString(),
  transaction
});
```

Preserve rollback and response mapping. Do not alter reason, location, radius, or status rules.

- [ ] **Step 7: Update recommendation characterization tests**

Add missing/invalid/past/same-day/future and duplicate pending/approved cases. Assert Geoapify is not called for rejected dates.

- [ ] **Step 8: Run focused regression**

```bash
npm test -- --runInBand \
  tests/wfaBookingPolicy.test.js \
  tests/wfaControllerContract.test.js \
  tests/bookingPolicyContract.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/services/wfaBookingPolicy.service.js \
  src/controllers/booking.controller.js \
  src/middlewares/validator.js \
  src/routes/wfa.routes.js \
  tests/wfaBookingPolicy.test.js \
  tests/wfaControllerContract.test.js
git commit -m "refactor(INF-272): share WFA schedule eligibility policy"
```

---

### Task 2: Add the facility FAHP matrix and canonical scoring functions

**Files:**

- Modify: `src/analytics/config.fahp.js`
- Modify: `src/utils/fuzzyAhpEngine.js`
- Create: `tests/wfaFacilityFahp.test.js`
- Modify: `tests/configContract.test.js`

**Interfaces:**

```js
getWfaFacilityAhpWeights()
// returns named weights plus consistency_ratio

calculateWfaFacilityScore(facilities, weights?)
// returns { score, confidence, known_fields, total_fields, weights_used }

calculateCanonicalWfaScore({ locationScore, distanceScore, facilityScore }, weights?)
// returns { score, label, breakdown, weights, CR }

getWfaLocationScore(place)
getWfaDistanceScore(distanceMeters)
```

- [ ] **Step 1: Write the matrix consistency test**

```js
const crisp = defuzzifyMatrixTFN(WFA_FACILITY_PAIRWISE_TFN);
const consistency = computeCR(crisp);

expect(WFA_FACILITY_PAIRWISE_TFN).toHaveLength(5);
expect(consistency.CR).toBeLessThanOrEqual(0.1);
expect(consistency.CR).toBeCloseTo(0.035487, 5);
```

Also assert reciprocal dimensions and the fixed criterion order.

- [ ] **Step 2: Write failing score tests**

Use deterministic weights in unit tests:

```js
const weights = {
  internet_access: 0.4,
  opening_hours: 0.25,
  toilets: 0.15,
  air_conditioning: 0.12,
  wheelchair_accessibility: 0.08,
  consistency_ratio: 0.03
};
```

Required assertions:

```text
0 known → score null, confidence 0
1 known → score null, confidence 20
2 known → score computed, confidence 40
unknown weights excluded and known weights renormalized
confidence does not multiply score
```

Example:

```js
const result = calculateWfaFacilityScore({
  internet_access: 1,
  opening_hours: null,
  toilets: 0,
  air_conditioning: null,
  wheelchair_accessibility: null
}, weights);

expect(result.confidence).toBe(40);
expect(result.score).toBeCloseTo((0.4 / 0.55) * 100, 2);
```

- [ ] **Step 3: Confirm RED**

```bash
npm test -- --runInBand tests/wfaFacilityFahp.test.js
```

Expected: FAIL because the matrix and functions do not exist.

- [ ] **Step 4: Add `WFA_FACILITY_PAIRWISE_TFN`**

Use the exact matrix recorded in the design document. Do not add env or DB configuration.

- [ ] **Step 5: Implement cached facility weights**

Follow existing `getWfaAhpWeights()` memoization:

```js
return {
  internet_access: weights[0],
  opening_hours: weights[1],
  toilets: weights[2],
  air_conditioning: weights[3],
  wheelchair_accessibility: weights[4],
  consistency_ratio: CR
};
```

- [ ] **Step 6: Extract location and distance scoring helpers**

Move the current location-category and distance normalization rules into exported pure helpers without changing their numeric behavior. Existing legacy `calculateWfaScore()` calls those helpers so characterization tests remain valid.

- [ ] **Step 7: Implement facility and final scoring**

`calculateWfaFacilityScore` must:

1. select only values equal to `0` or `1`;
2. count known fields;
3. return `score: null` below 2 known fields;
4. divide each known weight by the known-weight sum;
5. return a `0..100` score rounded to two decimals.

`calculateCanonicalWfaScore` must reject/null short-circuit when `facilityScore` is not finite. It uses the existing main WFA weights, reading the third weight as `facility_score` in the canonical result.

- [ ] **Step 8: Keep compatibility explicit**

`getWfaAhpWeights()` may temporarily expose `amenity_score` as a compatibility alias, but must also expose `facility_score`. No canonical service code may read the alias.

- [ ] **Step 9: Run focused tests**

```bash
npm test -- --runInBand \
  tests/wfaFacilityFahp.test.js \
  tests/configContract.test.js \
  tests/wfaControllerContract.test.js
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/analytics/config.fahp.js \
  src/utils/fuzzyAhpEngine.js \
  tests/wfaFacilityFahp.test.js \
  tests/configContract.test.js
git commit -m "feat(INF-272): add facility FAHP scoring"
```

---

### Task 3: Normalize facility evidence and evaluate opening hours

**Files:**

- Create: `src/utils/wfaFacilityEvidence.js`
- Create: `tests/wfaFacilityEvidence.test.js`

**Interfaces:**

```js
normalizeExplicitFacilityValue(rawValue)
parseSimpleOpeningHours(rawValue)
evaluateOpeningHours({ rawValue, scheduleDate, startTime, endTime })
normalizeGeoapifyFacilityEvidence({ properties, scheduleDate, workWindow })
```

- [ ] **Step 1: Write tri-state normalization tests**

```js
it.each([true, 'true', 'yes', 'available', 'limited', 'customers', 'designated'])(
  'maps %p to available',
  (raw) => expect(normalizeExplicitFacilityValue(raw)).toEqual({ status: 'available', value: 1 })
);

it.each([false, 'false', 'no', 'unavailable'])(
  'maps %p to unavailable',
  (raw) => expect(normalizeExplicitFacilityValue(raw)).toEqual({ status: 'unavailable', value: 0 })
);

it.each([undefined, null, '', 'maybe', 1, 0, {}])(
  'maps %p to unknown',
  (raw) => expect(normalizeExplicitFacilityValue(raw)).toEqual({ status: 'unknown', value: null })
);
```

- [ ] **Step 2: Write opening-hours tests**

For Wednesday `2026-08-05`, window `08:00:00–18:00:00`:

```text
We 07:00-20:00                    → available
We 08:00-18:00                    → available
We 09:00-20:00                    → unavailable
We 08:00-17:00                    → unavailable
We 08:00-12:00,13:00-20:00        → unavailable
We off                             → unavailable
Mo-Fr 08:00-18:00                 → available
missing / malformed / overnight   → unknown
```

Also test weekday isolation: a Tuesday interval must not satisfy Wednesday.

- [ ] **Step 3: Confirm RED**

```bash
npm test -- --runInBand tests/wfaFacilityEvidence.test.js
```

Expected: FAIL because the utility does not exist.

- [ ] **Step 4: Implement the simple parser**

Support semicolon-separated rules with:

```text
Mo Tu We Th Fr Sa Su
Mo-Fr
HH:mm-HH:mm
comma-separated intervals
off / closed
```

Reject unsupported free text, overnight intervals where end is earlier than start, and malformed ranges by returning an unknown parse result.

- [ ] **Step 5: Implement continuous-window evaluation**

A single interval must satisfy:

```js
interval.startMinutes <= required.startMinutes &&
interval.endMinutes >= required.endMinutes
```

Two separated intervals never combine across a gap.

- [ ] **Step 6: Normalize top-level Geoapify fields only**

Map:

```js
properties.internet_access
properties.opening_hours
properties.toilets
properties.air_conditioning
properties.wheelchair
```

Do not read `properties.amenities`, categories, rating, contact, website, or name.

Return raw evidence and a simplified numeric map:

```js
{
  evidence: { /* status/value/rawValue/source */ },
  values: {
    internet_access: 1,
    opening_hours: 0,
    toilets: 1,
    air_conditioning: null,
    wheelchair_accessibility: null
  }
}
```

- [ ] **Step 7: Run tests**

```bash
npm test -- --runInBand tests/wfaFacilityEvidence.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/utils/wfaFacilityEvidence.js tests/wfaFacilityEvidence.test.js
git commit -m "feat(INF-272): normalize confirmed WFA facility evidence"
```

---

### Task 4: Create the Geoapify WFA client with bounded enrichment

**Files:**

- Create: `src/services/geoapifyWfa.client.js`
- Create: `tests/geoapifyWfaClient.test.js`

**Interfaces:**

```js
fetchWfaPlaces({ latitude, longitude, radiusMeters })
fetchWfaPlaceDetails({ placeId })
enrichWfaPlaces({ places, concurrency = 5 })
```

- [ ] **Step 1: Write Places request tests**

Assert:

```js
expect(axios.get).toHaveBeenCalledWith(
  'https://api.geoapify.com/v2/places',
  expect.objectContaining({
    params: expect.objectContaining({
      categories: 'catering,accommodation,office,education',
      filter: 'circle:119.87,-0.89,5000',
      limit: 50,
      apiKey: 'test-key'
    }),
    timeout: 30000
  })
);
```

Assert logs never include the raw API key.

- [ ] **Step 2: Write Place Details and retry tests**

Assert the request uses:

```text
GET https://api.geoapify.com/v2/place-details?id=<place_id>&apiKey=<redacted>
```

Cases:

```text
timeout then success → 2 calls
HTTP 429 then success → 2 calls
HTTP 503 twice → failed result after 2 calls
HTTP 400/401/403 → 1 call only
```

Use fake timers and advance exactly `500 ms` for the retry.

- [ ] **Step 3: Write bounded-concurrency test**

Create 12 pending detail promises, track active workers, release them in groups, and assert:

```js
expect(maxObservedConcurrency).toBeLessThanOrEqual(5);
```

- [ ] **Step 4: Confirm RED**

```bash
npm test -- --runInBand tests/geoapifyWfaClient.test.js
```

Expected: FAIL because the client does not exist.

- [ ] **Step 5: Implement API-key resolution and safe diagnostics**

Prefer `GEOAPIFY_API_KEY`; retain the current logged legacy fallback for `GEOAPIFY_KEY`. Throw an explicit provider/config error when neither exists.

- [ ] **Step 6: Implement retry classification**

Retry only:

```text
ECONNABORTED, ETIMEDOUT, ECONNRESET, ENOTFOUND, EAI_AGAIN
HTTP 429
HTTP 500..599
```

Do not retry HTTP `400`, `401`, `403`.

- [ ] **Step 7: Implement `enrichWfaPlaces`**

Return one result per input, preserving input index:

```js
{
  place,
  details: responseFeatureOrProperties,
  enrichmentError: null,
  preliminaryIndex
}
```

or:

```js
{
  place,
  details: null,
  enrichmentError: { code, status },
  preliminaryIndex
}
```

Do not throw the whole batch for one candidate failure.

- [ ] **Step 8: Run tests**

```bash
npm test -- --runInBand tests/geoapifyWfaClient.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/services/geoapifyWfa.client.js tests/geoapifyWfaClient.test.js
git commit -m "feat(INF-272): add bounded Geoapify Place Details client"
```

---

### Task 5: Build the canonical `WfaRecommendationService`

**Files:**

- Create: `src/services/wfaRecommendation.service.js`
- Create: `tests/wfaRecommendationService.test.js`

**Interfaces:**

```js
getWfaRecommendations({
  userId,
  latitude,
  longitude,
  scheduleDate,
  radiusMeters,
  transaction = null
})

getWfaAnalysis({ latitude, longitude, scheduleDate, radiusMeters })

scoreWfaBookingLocation({ latitude, longitude, scheduleDate })
```

All three public methods use the same private discovery/enrichment/scoring functions. `getWfaAnalysis` changes only projection metadata; it does not implement a second scoring path.

- [ ] **Step 1: Write shortlist tests**

Create 35 deterministic candidates and mock main WFA weights. Assert:

- discovery receives maximum 50 from the client;
- exactly 30 candidates are sent to enrichment;
- preliminary ordering uses location score and distance only;
- changing facility fields before enrichment cannot change preliminary order;
- ties resolve by provider `place_id`, then original discovery index.

- [ ] **Step 2: Write final-state tests**

Cases:

```text
2+ known fields → ranked with final score
0/1 known fields → insufficient_facility_data and null scores
details failure → facility_enrichment_failed and null scores
```

Assert ordering groups ranked first, insufficient second, failed third. Only ranked entries receive `finalRank` and `finalLabel`.

- [ ] **Step 3: Write metadata tests**

Assert:

```js
expect(result.meta).toEqual({
  discovered_candidates: 35,
  enriched_candidates: 30,
  ranked_candidates: expect.any(Number),
  insufficient_data_candidates: expect.any(Number),
  enrichment_failed_candidates: expect.any(Number)
});
```

- [ ] **Step 4: Write truthfulness tests**

Assert the serialized recommendation does not contain:

```text
workspace_score
power_outlets
seating_quality
noise_level
data_reliability
amenity_score
preliminary_score
```

- [ ] **Step 5: Confirm RED**

```bash
npm test -- --runInBand tests/wfaRecommendationService.test.js
```

Expected: FAIL because the service does not exist.

- [ ] **Step 6: Implement candidate identity and deduplication**

Use provider `place_id` first. Fallback only when absent:

```js
`${normalizedName}|${lat.toFixed(4)},${lng.toFixed(4)}`
```

Keep the first candidate for a duplicate identity.

- [ ] **Step 7: Implement preliminary scoring**

Read main weights and compute:

```js
const denominator = weights.location_type + weights.distance_factor;
const preliminaryScore =
  (weights.location_type / denominator) * locationScore +
  (weights.distance_factor / denominator) * distanceScore;
```

Store this value internally only.

- [ ] **Step 8: Implement the 30-candidate enrichment and final score**

Read work window through `getAttendanceSettings()` once per request. Normalize details, call `calculateWfaFacilityScore`, then call `calculateCanonicalWfaScore` only when facility score is finite.

- [ ] **Step 9: Implement booking-location scoring**

Use the selected coordinates to discover the nearest candidate, enrich that candidate with the same client/normalizer/scorer, and return:

```js
{
  finalScore: number | null,
  finalLabel: string | null,
  status,
  facilityScore: number | null,
  facilityConfidence: number
}
```

Do not return or synthesize 50.

- [ ] **Step 10: Run tests**

```bash
npm test -- --runInBand \
  tests/wfaRecommendationService.test.js \
  tests/wfaFacilityFahp.test.js \
  tests/wfaFacilityEvidence.test.js \
  tests/geoapifyWfaClient.test.js
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/services/wfaRecommendation.service.js tests/wfaRecommendationService.test.js
git commit -m "feat(INF-272): add canonical WFA recommendation service"
```

---

### Task 6: Thin the employee recommendation controller and response

**Files:**

- Modify: `src/controllers/wfa.controller.js`
- Modify: `src/routes/wfa.routes.js`
- Modify: `tests/wfaControllerContract.test.js`
- Modify: `tests/wfaRouteExposure.test.js`

**Interfaces consumed:**

```js
getWfaRecommendations({ userId, latitude, longitude, scheduleDate, radiusMeters })
```

- [ ] **Step 1: Rewrite controller contract tests against the service boundary**

Mock `wfaRecommendation.service.js`, not Axios or the FAHP engine. Assert the controller passes:

```js
{
  userId: req.user.id,
  latitude: Number(req.query.lat),
  longitude: Number(req.query.lng),
  scheduleDate: req.query.schedule_date,
  radiusMeters: configuredRadius
}
```

- [ ] **Step 2: Add response-state tests**

Assert the HTTP response retains:

```text
schedule_date
timezone
work_window
recommendations
meta
```

and maps `ranked`, `insufficient_facility_data`, and `facility_enrichment_failed` without fallback scores.

- [ ] **Step 3: Confirm RED**

```bash
npm test -- --runInBand tests/wfaControllerContract.test.js tests/wfaRouteExposure.test.js
```

Expected: FAIL while the controller still owns Axios/scoring.

- [ ] **Step 4: Replace controller orchestration with one service call**

Remove from `getWfaRecommendations`:

- direct Axios Places calls;
- retry loop;
- candidate scoring loop;
- dedupe loop;
- response fabrication for data quality/workspace/internet.

Keep request parsing, configured search-radius lookup, service call, and HTTP mapping.

- [ ] **Step 5: Update `getWfaAhpConfig`**

Expose `facility_score` as the third main criterion and add facility weights/consistency. Keep a compatibility field only when required by an existing documented consumer and mark it deprecated in OpenAPI.

- [ ] **Step 6: Run focused tests**

```bash
npm test -- --runInBand \
  tests/wfaControllerContract.test.js \
  tests/wfaRouteExposure.test.js \
  tests/routeAuthorizationMatrix.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/controllers/wfa.controller.js \
  src/routes/wfa.routes.js \
  tests/wfaControllerContract.test.js \
  tests/wfaRouteExposure.test.js
git commit -m "refactor(INF-272): delegate WFA recommendations to canonical service"
```

---

### Task 7: Make WFA analysis consume the canonical service

**Files:**

- Modify: `src/middlewares/validator.js`
- Modify: `src/controllers/analysis.controller.js`
- Modify: `src/services/fuzzyAhpAnalysis.service.js`
- Modify: `tests/analysisFuzzyAhpWfaRoute.test.js`
- Modify: `tests/analysisFuzzyAhpWfaContract.test.js`

**Interface consumed:**

```js
getWfaAnalysis({ latitude, longitude, scheduleDate, radiusMeters })
```

- [ ] **Step 1: Add failing route tests for required analysis date**

Extend `wfaFahpValidation` expectations:

```text
missing schedule_date → 400
invalid calendar date → 400
past or same-day date → 400 through policy/controller
valid future date → service invoked
```

The route keeps `lat`, `lon`, and `radius_meters`; the adapter maps `lon` to canonical `longitude`.

- [ ] **Step 2: Add failing contract tests**

Assert analysis ranking uses canonical fields:

```text
facility_score
facility_confidence
status
```

and no longer exposes category-derived `amenity_score`.

- [ ] **Step 3: Confirm RED**

```bash
npm test -- --runInBand \
  tests/analysisFuzzyAhpWfaRoute.test.js \
  tests/analysisFuzzyAhpWfaContract.test.js
```

- [ ] **Step 4: Extend `wfaFahpValidation`**

Add strict required `schedule_date` validation and append `validate` if the current route does not already append it separately.

- [ ] **Step 5: Replace `deriveGeoapifyAmenityScore` and direct Places logic**

Delete the WFA-specific category/contact/rating heuristic from `fuzzyAhpAnalysis.service.js`. Delegate to `getWfaAnalysis` and map the canonical result into the established analysis envelope containing weights, consistency, distribution, and ranking.

- [ ] **Step 6: Preserve provider failure semantics**

Discovery-level provider failure remains the existing explicit WFA analysis provider response. Candidate-level detail failures remain ranking entries with null final scores and `facility_enrichment_failed`.

- [ ] **Step 7: Run focused regression**

```bash
npm test -- --runInBand \
  tests/analysisFuzzyAhpWfaRoute.test.js \
  tests/analysisFuzzyAhpWfaContract.test.js \
  tests/analysisFuzzyAhpDisciplineContract.test.js \
  tests/analysisFuzzyAhpSmartAcContract.test.js
```

Expected: PASS; discipline and Smart AC remain unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/middlewares/validator.js \
  src/controllers/analysis.controller.js \
  src/services/fuzzyAhpAnalysis.service.js \
  tests/analysisFuzzyAhpWfaRoute.test.js \
  tests/analysisFuzzyAhpWfaContract.test.js
git commit -m "refactor(INF-272): unify WFA analysis scoring"
```

---

### Task 8: Make booking suitability consume the canonical service

**Files:**

- Modify: `src/controllers/booking.controller.js`
- Create: `tests/bookingWfaSuitabilityContract.test.js`
- Modify: relevant existing booking controller/contract tests

**Interface consumed:**

```js
scoreWfaBookingLocation({ latitude, longitude, scheduleDate })
```

- [ ] **Step 1: Write failing delegation tests**

Assert `createBooking()` calls:

```js
scoreWfaBookingLocation({
  latitude: Number(latitude),
  longitude: Number(longitude),
  scheduleDate: schedule_date
});
```

- [ ] **Step 2: Write no-fallback tests**

Cases:

```text
ranked result → stores returned score/label
insufficient evidence → stores suitability_score null, suitability_label null
enrichment/provider failure → stores null/null and preserves booking transaction
```

Assert `50` is never written as an external-provider fallback.

- [ ] **Step 3: Confirm RED**

```bash
npm test -- --runInBand tests/bookingWfaSuitabilityContract.test.js
```

Expected: FAIL while `getSuitabilityScoreForCustomLocation()` still owns Axios and fallback 50.

- [ ] **Step 4: Remove direct Geoapify/FAHP logic from booking controller**

Replace `getSuitabilityScoreForCustomLocation()` internals with the canonical service. On provider exceptions, log a redacted warning and return null score/label so booking availability remains consistent with existing behavior without fabricating quality.

- [ ] **Step 5: Preserve source-of-truth boundaries**

Do not change:

- authenticated `userId` ownership;
- radius resolution/snapshot;
- reason validation;
- location creation/lookup;
- pending status;
- transaction commit/rollback.

- [ ] **Step 6: Run booking regression**

```bash
npm test -- --runInBand \
  tests/bookingWfaSuitabilityContract.test.js \
  tests/bookingPolicyContract.test.js \
  tests/wfaBookingPolicy.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/controllers/booking.controller.js \
  tests/bookingWfaSuitabilityContract.test.js
git commit -m "refactor(INF-272): use canonical WFA booking suitability"
```

---

### Task 9: Publish contracts and run complete verification

**Files:**

- Modify: `docs/openapi.yaml`
- Modify: `docs/architecture/api-contract-inventory.md`
- Modify: OpenAPI contract tests such as `tests/clientCriticalOpenApiContract.test.js`
- Modify: any findings/contract guard that pins the removed fallback behavior

- [ ] **Step 1: Update OpenAPI**

Document:

```text
GET /api/wfa/recommendations
- required lat, lng, schedule_date
- future-date and duplicate errors
- work_window
- three candidate statuses
- null-score semantics
- facility_score and facility_confidence
- max 30 enrichment behavior as implementation metadata, not client input
```

Update `GET /api/analysis/fuzzy-ahp/wfa` with required `schedule_date` and canonical facility fields.

- [ ] **Step 2: Update the API contract inventory**

Record:

- `WfaRecommendationService` as canonical owner;
- Geoapify Places vs Place Details roles;
- booking and analysis delegation;
- fallback 50 and fabricated workspace/data-quality fields removed;
- runtime smoke remains required.

- [ ] **Step 3: Update contract tests and confirm focused docs gate**

```bash
npm test -- --runInBand \
  tests/clientCriticalOpenApiContract.test.js \
  tests/openApiRuntimeDriftContract.test.js \
  tests/findingsRegisterGuard.test.js
```

Expected: PASS.

- [ ] **Step 4: Run the full focused INF-272 matrix**

```bash
npm test -- --runInBand \
  tests/wfaBookingPolicy.test.js \
  tests/wfaFacilityFahp.test.js \
  tests/wfaFacilityEvidence.test.js \
  tests/geoapifyWfaClient.test.js \
  tests/wfaRecommendationService.test.js \
  tests/wfaControllerContract.test.js \
  tests/analysisFuzzyAhpWfaRoute.test.js \
  tests/analysisFuzzyAhpWfaContract.test.js \
  tests/bookingWfaSuitabilityContract.test.js
```

Expected: PASS with zero failures.

- [ ] **Step 5: Run repository verification**

```bash
npm run lint
npm test -- --runInBand
git diff --check origin/develop...HEAD
git status --short
```

Required evidence:

```text
lint exit 0
full Jest exit 0 and exact suite/test counts recorded
no whitespace errors
working tree clean after commit
```

- [ ] **Step 6: Run authenticated runtime smoke**

Using a non-production test account and safe coordinates, capture redacted responses for:

```text
valid future recommendation
invalid/same-day date
ranked candidate
insufficient-facility candidate
simulated/controlled detail failure when feasible
WFA analysis with schedule_date
booking creation proving no fallback 50
```

Do not log or attach the Geoapify API key, bearer token, or sensitive user data.

- [ ] **Step 7: Commit documentation and contract updates**

```bash
git add docs/openapi.yaml \
  docs/architecture/api-contract-inventory.md \
  tests/clientCriticalOpenApiContract.test.js \
  tests/openApiRuntimeDriftContract.test.js \
  tests/findingsRegisterGuard.test.js
git commit -m "docs(INF-272): publish canonical WFA facility contract"
```

- [ ] **Step 8: Final review before PR**

```bash
git log --oneline origin/develop..HEAD
git diff --stat origin/develop...HEAD
git diff origin/develop...HEAD -- \
  src/controllers/wfa.controller.js \
  src/controllers/booking.controller.js \
  src/services/wfaRecommendation.service.js \
  src/services/fuzzyAhpAnalysis.service.js
```

Confirm:

- controllers contain no provider retry/scoring loops;
- canonical path contains no default 50;
- no unknown facility becomes false;
- top-30 cap is covered by tests;
- no unrelated attendance/geofence behavior changed.

## PR Requirements

Open one bounded PR into `develop` linked to INF-272 and GitHub #134. The PR must answer:

- Which responsibilities moved from controller to service?
- Where is facility evidence normalized?
- What is the computed facility matrix CR?
- How is unknown data represented?
- How is the top-30 limit enforced?
- How do recommendation, analysis, and booking share the canonical service?
- What focused/full-test, lint, and runtime evidence was collected?
- Which runtime scenarios remain `Needs Verification`, if any?
