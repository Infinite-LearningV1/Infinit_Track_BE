# INF-272 Canonical WFA Facility Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one truthful WFA recommendation pipeline that enriches Geoapify candidates with explicit facility evidence, gates final scoring on data confidence, and is shared by recommendations, dedicated analysis, and booking suitability.

**Architecture:** Keep the repository's layer-first structure. Thin controllers delegate to `WfaRecommendationService`; focused eligibility, Geoapify, facility, and opening-hours units feed numeric component scores into the canonical FAHP engine. Provider failures and unknown facilities remain explicit and never become fallback scores.

**Tech Stack:** Node.js ESM, Express, Sequelize/MySQL, Axios, Jest ESM, express-validator, repository FAHP/Chang-extent utilities, `opening_hours@3.14.0`.

## Global Constraints

- Work only in `E:\test\Infinit_Track_BE\.worktrees\inf-272-wfa-facility-scoring` on `feature/inf-272-wfa-facility-scoring`.
- Business timezone is `Asia/Jakarta`; strict dates use exact `YYYY-MM-DD` and real calendar validation.
- Recommendations and booking reject past, same-day, and duplicate pending/approved bookings; dedicated analysis does not perform duplicate checks.
- Geoapify Place Details evidence is limited to `internet_access`, `air_conditioning`, `toilets`, `opening_hours`, and `wheelchair`.
- Missing/unrecognized provider values map to `null`, never `0` or `false` by omission.
- Facility FAHP is a static equal-importance five-criterion TFN matrix with expected weights `0.20` and `CR = 0`.
- Unknown facility weights are removed and known weights are renormalized; confidence is a gate only.
- At least two known facilities are required for a final WFA score.
- Preliminary score uses only location type and distance, shortlists at most 30, and is never exposed as final suitability.
- Each Geoapify request gets one retry only for timeout, connection errors, `429`, or `5xx`; details concurrency is capped at five.
- Do not infer facilities from names, categories, websites, ratings, reviews, or popularity.
- Do not introduce module/repository/adapter/base-controller/v2 architecture or change attendance final-state and scheduler behavior.
- Use TDD for every behavior change: observe the targeted test fail for the intended reason before production edits.
- Every task ends with focused green tests, `git diff --check`, and an isolated commit.

---

## File and Interface Map

### New production files

```text
src/services/wfaEligibility.service.js
src/services/geoapifyWfa.client.js
src/services/wfaFacility.service.js
src/services/wfaRecommendation.service.js
src/utils/wfaOpeningHours.js
```

### New focused tests

```text
tests/wfaEligibilityService.test.js
tests/wfaOpeningHours.test.js
tests/wfaFacilityService.test.js
tests/geoapifyWfaClient.test.js
tests/wfaRecommendationService.test.js
```

### Locked public interfaces

```js
// src/services/wfaEligibility.service.js
parseStrictScheduleDate(value) => string
assertFutureWibScheduleDate(value, { today = getJakartaDateString() } = {}) => string
findActiveDuplicateBooking({ userId, scheduleDate, transaction = null }) => Booking|null
assertWfaEligibility({ userId, scheduleDate, checkDuplicate = true, transaction = null }) => Promise<string>

// src/utils/wfaOpeningHours.js
evaluateOpeningHoursCoverage({ expression, scheduleDate, startTime, endTime }) => 0|1|null

// src/services/wfaFacility.service.js
normalizeFacilityValue(value) => 0|1|null
readStrictWfaCheckinWindow({ transaction = null } = {}) => Promise<{ startTime, endTime }>
scoreFacilityEvidence({ detailsProperties, scheduleDate, checkinWindow, weights })
  => { facilities, knownFields, facilityConfidence, facilityScore, facilityCr }

// src/services/geoapifyWfa.client.js
createGeoapifyWfaClient({ httpClient = axios, sleep = defaultSleep, apiKeyResolver = resolveGeoapifyApiKey } = {})
  => { searchPlaces, fetchPlaceDetails }
mapWithConcurrency(items, limit, worker) => Promise<Array>

// src/services/wfaRecommendation.service.js
createWfaRecommendationService(dependencies = {})
  => { recommendForUser, analyze, scoreBookingLocation }
recommendForUser({ userId, latitude, longitude, scheduleDate }) => Promise<RecommendationPayload>
analyze({ latitude, longitude, scheduleDate, radiusMeters = 5000 }) => Promise<AnalysisPayload>
scoreBookingLocation({ userId, latitude, longitude, scheduleDate }) => Promise<BookingScoreResult>
```

Candidate result shape shared by recommendation and analysis:

```js
{
  place_id: String,
  name: String,
  address: String|null,
  latitude: Number,
  longitude: Number,
  status: 'ranked'|'insufficient_facility_data'|'facility_enrichment_failed',
  distance_meters: Number,
  location_type: String,
  facility_score: Number|null,
  facility_confidence: Number|null,
  facilities: {
    internet_access: 0|1|null,
    air_conditioning: 0|1|null,
    toilets: 0|1|null,
    opening_hours: 0|1|null,
    wheelchair_accessibility: 0|1|null
  },
  final_score: Number|null,
  final_label: String|null,
  rank: Number|null
}
```

---

### Task 1: Shared WIB Eligibility Policy and Query Validators

**Files:**
- Create: `src/services/wfaEligibility.service.js`
- Create: `tests/wfaEligibilityService.test.js`
- Modify: `src/middlewares/validator.js:35-54,658-675`
- Test: `tests/bookingWfaPolicyContract.test.js`
- Test: `tests/analysisFuzzyAhpWfaRoute.test.js`

**Interfaces:**
- Consumes: `Booking`, Sequelize `Op`, `getJakartaDateString()`, `AppError`.
- Produces: the four eligibility exports in the File and Interface Map plus `wfaRecommendationValidation` and an updated `wfaFahpValidation`.

- [ ] **Step 1: Write failing strict-date and duplicate-policy tests**

Create table-driven tests with a fixed WIB today:

```js
describe('assertFutureWibScheduleDate', () => {
  test.each(['', '2026/08/10', '2026-02-30', '2026-8-10', null])(
    'rejects invalid date %p',
    (value) => {
      expect(() => assertFutureWibScheduleDate(value, { today: '2026-08-02' }))
        .toThrow(expect.objectContaining({ code: 'INVALID_SCHEDULE_DATE', status: 400 }));
    }
  );

  test.each([
    ['2026-08-01', 'PAST_DATE_NOT_ALLOWED'],
    ['2026-08-02', 'SAME_DAY_NOT_ALLOWED']
  ])('rejects %s with %s', (value, code) => {
    expect(() => assertFutureWibScheduleDate(value, { today: '2026-08-02' }))
      .toThrow(expect.objectContaining({ code }));
  });

  test('returns a future date unchanged', () => {
    expect(assertFutureWibScheduleDate('2026-08-03', { today: '2026-08-02' }))
      .toBe('2026-08-03');
  });
});
```

Mock `Booking.findOne` and prove query status is `{ [Op.in]: [1, 3] }`, the authenticated `user_id` is used, and `checkDuplicate: false` never queries Booking.

- [ ] **Step 2: Run the new test and observe RED**

Run:

```powershell
npm test -- --runInBand tests/wfaEligibilityService.test.js
```

Expected: FAIL because `src/services/wfaEligibility.service.js` does not exist.

- [ ] **Step 3: Implement minimal typed policy**

Use `AppError` with field details:

```js
const wfaError = (message, code, status = 400, field = 'schedule_date') =>
  new AppError(message, {
    code,
    status,
    details: field ? [{ field, code }] : []
  });

export const parseStrictScheduleDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw wfaError('Tanggal WFA harus menggunakan format YYYY-MM-DD.', 'INVALID_SCHEDULE_DATE');
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw wfaError('Tanggal WFA tidak valid.', 'INVALID_SCHEDULE_DATE');
  }
  return value;
};
```

Implement future comparison and duplicate lookup exactly through the locked interfaces.

- [ ] **Step 4: Add recommendation and analysis query validators**

Add reusable strict date validation and these arrays:

```js
export const wfaRecommendationValidation = [
  query('lat').exists().bail().isFloat({ min: -90, max: 90 }),
  query('lng').exists().bail().isFloat({ min: -180, max: 180 }),
  strictFutureScheduleDateQuery('schedule_date')
];

export const wfaFahpValidation = [
  query('lat').exists().bail().isFloat({ min: -90, max: 90 }),
  query('lon').exists().bail().isFloat({ min: -180, max: 180 }),
  strictFutureScheduleDateQuery('schedule_date'),
  query('radius_meters').default(5000).isInt({ min: 100, max: 50000 })
];
```

The validator must use the same parser export rather than copying calendar logic.

- [ ] **Step 5: Verify GREEN and regressions**

Run:

```powershell
npm test -- --runInBand tests/wfaEligibilityService.test.js tests/bookingWfaPolicyContract.test.js tests/analysisFuzzyAhpWfaRoute.test.js
git diff --check
```

Expected: focused tests pass; existing route tests may need only fixture dates updated to future dates, not behavior weakening.

- [ ] **Step 6: Commit**

```powershell
git add src/services/wfaEligibility.service.js src/middlewares/validator.js tests/wfaEligibilityService.test.js tests/bookingWfaPolicyContract.test.js tests/analysisFuzzyAhpWfaRoute.test.js
git commit -m "feat(inf-272): share WFA eligibility policy"
```

---

### Task 2: Versioned Facility Matrix and Pure Main WFA Scoring Inputs

**Files:**
- Modify: `src/analytics/config.fahp.js:25-41`
- Modify: `src/utils/fuzzyAhpEngine.js:64-205,357-365`
- Modify: `tests/wfa.test.js`
- Modify: `tests/fahp.test.js`
- Create: `tests/wfaFacilityMatrix.test.js`

**Interfaces:**
- Consumes: existing `selectWeights`, `defuzzifyMatrixTFN`, `computeCR`, and label helpers.
- Produces: `FACILITY_CRITERIA`, `FACILITY_PAIRWISE_TFN`, `getFacilityAhpWeights()`, `getLocationTypeScore(place)`, `getDistanceFactorScore(distanceMeters)`, and `calculateWfaScore({ locationTypeScore, distanceScore, facilityScore }, weights?)`.

- [ ] **Step 1: Write failing matrix and pure-input tests**

```js
test('facility matrix produces equal weights and CR zero', () => {
  const result = fuzzyEngine.getFacilityAhpWeights();
  expect(result.criteria).toEqual([
    'internet_access',
    'air_conditioning',
    'toilets',
    'opening_hours',
    'wheelchair_accessibility'
  ]);
  expect(result.values).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
  expect(result.consistency_ratio).toBe(0);
});

test('main WFA score requires facility_score and exposes renamed breakdown', async () => {
  const result = await fuzzyEngine.calculateWfaScore({
    locationTypeScore: 100,
    distanceScore: 80,
    facilityScore: 60
  });
  expect(result.breakdown).toEqual({
    location_type: 100,
    distance_factor: 80,
    facility_score: 60
  });
  expect(result.breakdown).not.toHaveProperty('amenity_score');
});

test('main WFA score rejects missing facility evidence', async () => {
  await expect(fuzzyEngine.calculateWfaScore({ locationTypeScore: 100, distanceScore: 80 }))
    .rejects.toThrow('facility_score must be numeric');
});
```

- [ ] **Step 2: Run and observe RED**

```powershell
npm test -- --runInBand tests/wfaFacilityMatrix.test.js tests/wfa.test.js
```

Expected: FAIL on missing exports and the old `amenity_score` interface.

- [ ] **Step 3: Add the equal TFN matrix and cached weights**

```js
export const FACILITY_CRITERIA = Object.freeze([
  'internet_access',
  'air_conditioning',
  'toilets',
  'opening_hours',
  'wheelchair_accessibility'
]);

export const FACILITY_PAIRWISE_TFN = FACILITY_CRITERIA.map(() =>
  FACILITY_CRITERIA.map(() => TFN.EQUAL)
);
```

Return copied arrays from `getFacilityAhpWeights()` to prevent caller mutation.

- [ ] **Step 4: Refactor main scoring to explicit component inputs**

Keep current location-category rules in `getLocationTypeScore(place)` and distance min/max normalization in `getDistanceFactorScore(distanceMeters)`. Make `calculateWfaScore` validate each numeric `0..100` input, weight `[location_type, distance_factor, facility_score]`, and throw on invalid data instead of returning score `0`.

Update WFA tests to call the explicit interface:

```js
const componentsFor = (place, facilityScore) => ({
  locationTypeScore: fuzzyEngine.getLocationTypeScore(place),
  distanceScore: fuzzyEngine.getDistanceFactorScore(place.properties.distance),
  facilityScore
});
```

- [ ] **Step 5: Verify GREEN and legacy FAHP regressions**

```powershell
npm test -- --runInBand tests/wfaFacilityMatrix.test.js tests/wfa.test.js tests/fahp.test.js tests/api.test.js
git diff --check
```

Expected: all selected suites pass, both facility/main CR values are valid, and no engine test expects fallback `50`.

- [ ] **Step 6: Commit**

```powershell
git add src/analytics/config.fahp.js src/utils/fuzzyAhpEngine.js tests/wfaFacilityMatrix.test.js tests/wfa.test.js tests/fahp.test.js tests/api.test.js
git commit -m "feat(inf-272): add facility FAHP scoring inputs"
```

---

### Task 3: Strict Opening-Hours Evaluation and Facility Evidence Scoring

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/utils/wfaOpeningHours.js`
- Create: `src/services/wfaFacility.service.js`
- Create: `tests/wfaOpeningHours.test.js`
- Create: `tests/wfaFacilityService.test.js`

**Interfaces:**
- Consumes: `opening_hours@3.14.0`, `Settings`, `AppError`, and `getFacilityAhpWeights()`.
- Produces: opening-hours and facility interfaces from the File and Interface Map.

- [ ] **Step 1: Install the exact parser dependency**

```powershell
npm install --save-exact opening_hours@3.14.0
```

Verify `package.json` contains exactly `"opening_hours": "3.14.0"` and retain only dependency changes caused by that command.

- [ ] **Step 2: Write failing opening-window tests**

Set `process.env.TZ = 'Asia/Jakarta'` before importing the evaluator and restore the previous value after the suite. Cover concrete cases:

```js
test.each([
  ['Mo-Su 07:00-18:00', 1],
  ['Mo-Su 09:00-18:00', 0],
  ['Mo-Su 07:00-16:00', 0],
  ['Mo-Su 07:00-10:00,11:00-18:00', 0],
  [null, null],
  ['not-valid-opening-hours', null]
])('evaluates full configured window for %p', (expression, expected) => {
  expect(evaluateOpeningHoursCoverage({
    expression,
    scheduleDate: '2026-08-03',
    startTime: '08:00:00',
    endTime: '17:00:00'
  })).toBe(expected);
});
```

Add an overnight test using `Mo 20:00-02:00` with a configured `21:00:00` to `01:00:00` window.

- [ ] **Step 3: Run opening-hours tests and observe RED**

```powershell
npm test -- --runInBand tests/wfaOpeningHours.test.js
```

Expected: FAIL because the evaluator file does not exist.

- [ ] **Step 4: Implement continuous-coverage evaluation**

```js
import OpeningHours from 'opening_hours';

const WIB_OFFSET = '+07:00';
const buildInstant = (date, time) => new Date(`${date}T${time}${WIB_OFFSET}`);

export const evaluateOpeningHoursCoverage = ({ expression, scheduleDate, startTime, endTime }) => {
  if (typeof expression !== 'string' || expression.trim() === '') return null;
  try {
    const start = buildInstant(scheduleDate, startTime);
    let end = buildInstant(scheduleDate, endTime);
    if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    const intervals = new OpeningHours(expression).getOpenIntervals(start, end);
    return intervals.some(([from, to]) => from <= start && to >= end) ? 1 : 0;
  } catch (_error) {
    return null;
  }
};
```

If the library returns adjacent intervals, merge only intervals whose boundaries are exactly contiguous before testing full coverage; never bridge a gap.

- [ ] **Step 5: Write failing facility normalization/scoring tests**

Use concrete table cases for every approved representation and assert unknown values:

```js
test.each([true, 'true', 'yes', 'available', 'limited', 'customers', 'designated'])(
  'normalizes %p as available',
  (value) => expect(normalizeFacilityValue(value)).toBe(1)
);
test.each([false, 'false', 'no', 'unavailable'])(
  'normalizes %p as unavailable',
  (value) => expect(normalizeFacilityValue(value)).toBe(0)
);
test.each([undefined, null, '', 'unknown', {}, []])(
  'normalizes %p as unknown',
  (value) => expect(normalizeFacilityValue(value)).toBeNull()
);
```

Assert one known field returns confidence `20`, a numeric facility score, but no final decision; two known fields return confidence `40`; and details objects do not invent availability.

- [ ] **Step 6: Implement strict settings read and renormalized score**

Query only the two attendance keys and reject missing/invalid `HH:mm:ss` values:

```js
const REQUIRED_KEYS = [
  'attendance.checkin.start_time',
  'attendance.checkin.end_time'
];
```

Throw `new AppError('Konfigurasi jam check-in WFA belum tersedia.', { code: 'WFA_CONFIG_UNAVAILABLE', status: 500 })` on missing/invalid settings. Compute:

```js
const knownEntries = FACILITY_CRITERIA
  .map((criterion, index) => ({ criterion, value: facilities[criterion], weight: weights.values[index] }))
  .filter(({ value }) => value !== null);
const knownWeight = knownEntries.reduce((sum, item) => sum + item.weight, 0);
const facilityScore = knownEntries.length
  ? round2(knownEntries.reduce((sum, item) => sum + item.value * (item.weight / knownWeight), 0) * 100)
  : null;
```

- [ ] **Step 7: Verify GREEN**

```powershell
npm test -- --runInBand tests/wfaOpeningHours.test.js tests/wfaFacilityService.test.js tests/wfaFacilityMatrix.test.js
git diff --check
```

- [ ] **Step 8: Commit**

```powershell
git add package.json package-lock.json src/utils/wfaOpeningHours.js src/services/wfaFacility.service.js tests/wfaOpeningHours.test.js tests/wfaFacilityService.test.js
git commit -m "feat(inf-272): score explicit facility evidence"
```

---

### Task 4: Geoapify Places and Place Details Client

**Files:**
- Create: `src/services/geoapifyWfa.client.js`
- Create: `tests/geoapifyWfaClient.test.js`
- Modify: `tests/configContract.test.js`

**Interfaces:**
- Consumes: Axios, logger, `GEOAPIFY_API_KEY`, compatibility `GEOAPIFY_KEY`, and `AppError`.
- Produces: injectable client and bounded-concurrency helper from the File and Interface Map.

- [ ] **Step 1: Write failing request/retry/redaction tests**

Use an injected fake `httpClient.get`, a no-op `sleep`, and fixed API key. Assert exact endpoints/params:

```js
expect(httpClient.get).toHaveBeenCalledWith(
  'https://api.geoapify.com/v2/place-details',
  expect.objectContaining({
    params: { id: 'place-1', features: 'details', apiKey: 'secret-key' },
    timeout: 30000
  })
);
```

Table-drive retry behavior:

```js
const transient = [
  { code: 'ECONNABORTED' },
  { code: 'ETIMEDOUT' },
  { code: 'ECONNRESET' },
  { response: { status: 429 } },
  { response: { status: 500 } }
];
const permanent = [
  { response: { status: 400 } },
  { response: { status: 401 } },
  { response: { status: 403 } }
];
```

Transient cases call exactly twice; permanent cases call once; two transient failures never trigger a third call. Assert logged metadata contains `[REDACTED]` and not the key.

- [ ] **Step 2: Write failing concurrency test**

Use deferred promises, increment an `active` counter in the worker, and assert `maxActive <= 5` while preserving output order.

- [ ] **Step 3: Run and observe RED**

```powershell
npm test -- --runInBand tests/geoapifyWfaClient.test.js
```

- [ ] **Step 4: Implement the injectable client**

Core retry loop:

```js
const requestWithRetry = async (request, { sleep }) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      if (attempt === 1 || !isTransientGeoapifyError(error)) throw error;
      await sleep(250);
    }
  }
  throw new Error('unreachable');
};
```

`searchPlaces` returns `response.data.features ?? []`. `fetchPlaceDetails` finds `feature.properties.feature_type === 'details'` and returns that feature or `null`. Map discovery failures to `AppError` code `WFA_PROVIDER_UNAVAILABLE`, status `503`; let details errors retain classified metadata so the pipeline can mark one candidate failed.

- [ ] **Step 5: Verify GREEN and env compatibility**

```powershell
npm test -- --runInBand tests/geoapifyWfaClient.test.js tests/configContract.test.js
git diff --check
```

- [ ] **Step 6: Commit**

```powershell
git add src/services/geoapifyWfa.client.js tests/geoapifyWfaClient.test.js tests/configContract.test.js
git commit -m "feat(inf-272): add bounded Geoapify details client"
```

---

### Task 5: Canonical Recommendation Pipeline

**Files:**
- Create: `src/services/wfaRecommendation.service.js`
- Create: `tests/wfaRecommendationService.test.js`

**Interfaces:**
- Consumes: Tasks 1-4 locked interfaces, `Settings` search-radius read, geofence distance utility, and fuzzy engine.
- Produces: `createWfaRecommendationService()` and the three public consumer methods.

- [ ] **Step 1: Write failing shortlist tests**

Create 35 deterministic candidates with stable IDs and injected dependency fakes. Assert:

```js
expect(geoapifyClient.fetchPlaceDetails).toHaveBeenCalledTimes(30);
expect(result.candidates).toHaveLength(30);
expect(result.candidates[0]).not.toHaveProperty('preliminary_score');
expect(fuzzyEngine.calculateWfaScore).toHaveBeenCalledWith(
  expect.objectContaining({ facilityScore: expect.any(Number) }),
  expect.anything()
);
```

Add invalid-coordinate, missing-place-ID, and duplicate-place-ID cases. Assert preliminary sorting uses location score descending, distance score descending, then stable ID.

Lock the preliminary calculation to the renormalized first two main WFA weights:

```js
const denominator = wfaWeights.location_type + wfaWeights.distance_factor;
const preliminaryScore =
  locationTypeScore * (wfaWeights.location_type / denominator) +
  distanceScore * (wfaWeights.distance_factor / denominator);
```

Sort by `preliminaryScore` descending, raw distance ascending, then stable place ID ascending.

- [ ] **Step 2: Write failing status and deterministic-order tests**

Fixture three candidates:

```js
const ranked = { place_id: 'ranked', facilityConfidence: 80, facilityScore: 75 };
const insufficient = { place_id: 'insufficient', facilityConfidence: 20, facilityScore: 100 };
const failed = { place_id: 'failed', enrichmentError: new Error('details failed') };
```

Assert statuses, nullable fields, all five facility keys, numeric rank only for ranked candidates, and order `ranked`, `insufficient`, `failed`. Add equal-score tie cases to prove distance/place-ID ordering.

- [ ] **Step 3: Write failing consumer-policy tests**

Assert:

- `recommendForUser` calls `assertWfaEligibility({ checkDuplicate: true })`;
- `analyze` calls `assertWfaEligibility({ checkDuplicate: false })`;
- `scoreBookingLocation` calls the same eligibility and returns one of:

```js
{ status: 'ranked', suitabilityScore: 82.4, suitabilityLabel: '...', candidate }
{ status: 'insufficient_facility_data', suitabilityScore: null, suitabilityLabel: null, candidate: null|Object }
```

Provider failure in booking mode rejects with `AppError` code `WFA_SCORING_UNAVAILABLE`, status `503`.

- [ ] **Step 4: Run and observe RED**

```powershell
npm test -- --runInBand tests/wfaRecommendationService.test.js
```

- [ ] **Step 5: Implement the dependency-injected service**

Dependency defaults:

```js
const defaults = {
  geoapifyClient: createGeoapifyWfaClient(),
  eligibility: { assertWfaEligibility },
  facility: { readStrictWfaCheckinWindow, scoreFacilityEvidence },
  fuzzyEngine,
  calculateDistance,
  readSearchRadius
};
```

Use one private `runPipeline({ ..., candidateLimit })`; `recommendForUser` and `analyze` pass `30`, while `scoreBookingLocation` uses the nearest valid candidate. Enrich via `mapWithConcurrency(shortlist, 5, worker)`.

Do not catch `WFA_CONFIG_UNAVAILABLE`. Catch details errors per candidate only. For booking mode, translate a selected-candidate enrichment error to `WFA_SCORING_UNAVAILABLE`.

- [ ] **Step 6: Verify GREEN with lower-level suites**

```powershell
npm test -- --runInBand tests/wfaRecommendationService.test.js tests/geoapifyWfaClient.test.js tests/wfaFacilityService.test.js tests/wfaEligibilityService.test.js
git diff --check
```

- [ ] **Step 7: Commit**

```powershell
git add src/services/wfaRecommendation.service.js tests/wfaRecommendationService.test.js
git commit -m "feat(inf-272): add canonical WFA recommendation pipeline"
```

---

### Task 6: Recommendations Route and WFA Config/Test Contract

**Files:**
- Modify: `src/controllers/wfa.controller.js:1-455`
- Modify: `src/routes/wfa.routes.js:1-24`
- Modify: `tests/wfaControllerContract.test.js`
- Modify: `tests/wfaRouteExposure.test.js`
- Modify: `tests/api.test.js`
- Modify: `tests/configContract.test.js`

**Interfaces:**
- Consumes: `recommendForUser`, `wfaRecommendationValidation`, `validate`, and renamed engine weights.
- Produces: thin `GET /api/wfa/recommendations`, facility-named `/ahp-config`, and facility-named `/test-ahp`.

- [ ] **Step 1: Rewrite controller contract tests first**

Mock the service rather than Axios/Settings/engine in controller tests. Assert:

```js
expect(mockRecommendForUser).toHaveBeenCalledWith({
  userId: 7,
  latitude: -0.895,
  longitude: 119.872,
  scheduleDate: '2099-08-10'
});
expect(response.body.data.recommendations[0]).toEqual(
  expect.objectContaining({ status: 'ranked', facility_score: 75, final_score: 82.4 })
);
expect(response.body.data.recommendations[0]).not.toHaveProperty('real_data_analysis');
expect(response.body.data.recommendations[0]).not.toHaveProperty('suitability_score');
```

Add request cases for missing/malformed/nonfuture date. Update config/test endpoint expectations from `amenity_score` to `facility_score`; assert legacy amenity input returns validation failure.

- [ ] **Step 2: Run and observe RED**

```powershell
npm test -- --runInBand tests/wfaControllerContract.test.js tests/wfaRouteExposure.test.js tests/api.test.js
```

- [ ] **Step 3: Replace recommendation orchestration with thin mapping**

```js
export const getWfaRecommendations = async (req, res, next) => {
  try {
    const data = await recommendForUser({
      userId: req.user.id,
      latitude: Number(req.query.lat),
      longitude: Number(req.query.lng),
      scheduleDate: req.query.schedule_date
    });
    return res.status(200).json({
      success: true,
      data: { recommendations: data.candidates, search_criteria: data.searchCriteria, fahp_methodology: data.methodology },
      message: 'Rekomendasi WFA berhasil diambil.'
    });
  } catch (error) {
    next(error);
  }
};
```

Delete controller-local Geoapify request/retry/scoring/fallback logic. Keep unrelated endpoints bounded and update only their criterion name/interface.

- [ ] **Step 4: Wire validators on the route**

```js
router.get('/recommendations', wfaRecommendationValidation, validate, getWfaRecommendations);
```

- [ ] **Step 5: Verify GREEN and contract regressions**

```powershell
npm test -- --runInBand tests/wfaControllerContract.test.js tests/wfaRouteExposure.test.js tests/api.test.js tests/configContract.test.js tests/routeAuthorizationMatrix.test.js
git diff --check
```

- [ ] **Step 6: Commit**

```powershell
git add src/controllers/wfa.controller.js src/routes/wfa.routes.js tests/wfaControllerContract.test.js tests/wfaRouteExposure.test.js tests/api.test.js tests/configContract.test.js tests/routeAuthorizationMatrix.test.js
git commit -m "feat(inf-272): expose truthful WFA recommendations"
```

---

### Task 7: Dedicated WFA Analysis and Legacy Move Contract

**Files:**
- Modify: `src/controllers/analysis.controller.js:29-50,86-120`
- Modify: `src/services/fuzzyAhpAnalysis.service.js:137-262,434-629,934-1015`
- Modify: `tests/analysisFuzzyAhpWfaContract.test.js`
- Modify: `tests/analysisFuzzyAhpWfaRoute.test.js`
- Modify: `tests/analysisFuzzyAhpContract.test.js`
- Modify: `tests/analysisFuzzyAhpDashboardRecapRoute.test.js`

**Interfaces:**
- Consumes: `analyze({ latitude, longitude, scheduleDate, radiusMeters })`.
- Produces: canonical dedicated analysis payload and `410 WFA_ANALYSIS_MOVED` for combined `type=wfa`.

- [ ] **Step 1: Write failing dedicated-analysis delegation tests**

Assert `getWfaFahp` forwards numeric coordinates/radius and exact schedule date. Mock service result with ranked/insufficient/failed candidates and prove response passes the truthful statuses without amenity fields.

Add route validation cases:

```text
missing schedule_date → 400
2026-02-30 → 400
today/past → 400
future date → service invoked
```

- [ ] **Step 2: Write failing legacy 410 test**

```js
const response = await request(app)
  .get('/api/analysis/fuzzy-ahp?type=wfa&period=monthly')
  .set('Authorization', 'Bearer test-token')
  .expect(410);
expect(response.body).toEqual({
  success: false,
  code: 'WFA_ANALYSIS_MOVED',
  message: 'Use /api/analysis/fuzzy-ahp/wfa with lat, lon, and schedule_date.'
});
```

Retain passing discipline and Smart AC combined cases.

- [ ] **Step 3: Run and observe RED**

```powershell
npm test -- --runInBand tests/analysisFuzzyAhpWfaContract.test.js tests/analysisFuzzyAhpWfaRoute.test.js tests/analysisFuzzyAhpContract.test.js
```

- [ ] **Step 4: Delegate dedicated analysis and remove old WFA builders**

`getWfaFahp` calls the canonical service. Remove Geoapify-specific WFA helpers and fixed `buildWfaAnalysis` ranking from `fuzzyAhpAnalysis.service.js` only after all remaining imports are remapped. When dashboard recap receives `type=wfa`, its controller returns the same `410 WFA_ANALYSIS_MOVED` body instead of calling fixed-score history; discipline/Smart AC recap remains unchanged.

In combined controller switch:

```js
case 'wfa':
  return res.status(410).json({
    success: false,
    code: 'WFA_ANALYSIS_MOVED',
    message: 'Use /api/analysis/fuzzy-ahp/wfa with lat, lon, and schedule_date.'
  });
```

- [ ] **Step 5: Verify GREEN and analysis regressions**

```powershell
npm test -- --runInBand tests/analysisFuzzyAhpWfaContract.test.js tests/analysisFuzzyAhpWfaRoute.test.js tests/analysisFuzzyAhpContract.test.js tests/analysisFuzzyAhpDashboardRecapRoute.test.js tests/analysisFuzzyAhpDisciplineContract.test.js tests/analysisFuzzyAhpSmartAcContract.test.js
git diff --check
```

- [ ] **Step 6: Commit**

```powershell
git add src/controllers/analysis.controller.js src/services/fuzzyAhpAnalysis.service.js tests/analysisFuzzyAhpWfaContract.test.js tests/analysisFuzzyAhpWfaRoute.test.js tests/analysisFuzzyAhpContract.test.js tests/analysisFuzzyAhpDashboardRecapRoute.test.js
git commit -m "feat(inf-272): canonicalize WFA analysis"
```

---

### Task 8: Booking Suitability Integration and Transaction Boundary

**Files:**
- Modify: `src/controllers/booking.controller.js:117-388`
- Modify: `tests/bookingWfaPolicyContract.test.js`
- Modify: `tests/bookingsReadinessContract.test.js`
- Modify: `tests/bookingWfaProjectionContract.test.js`
- Modify: `tests/resolveWfaBookingsJobIdempotency.test.js`

**Interfaces:**
- Consumes: `scoreBookingLocation`, `assertWfaEligibility`, existing reason/radius services, Sequelize transaction.
- Produces: no fallback booking suitability, `503 WFA_SCORING_UNAVAILABLE`, nullable insufficient-data persistence, and response `suitability_status`.

- [ ] **Step 1: Write failing provider-outage transaction test**

```js
mockScoreBookingLocation.mockRejectedValue(
  new AppError('Penilaian lokasi WFA tidak tersedia.', {
    code: 'WFA_SCORING_UNAVAILABLE',
    status: 503
  })
);

await request(app).post('/api/bookings').send(validPayload).expect(503);
expect(mockLocationCreate).not.toHaveBeenCalled();
expect(mockBookingCreate).not.toHaveBeenCalled();
expect(mockTransaction).not.toHaveBeenCalled();
```

This forces provider scoring before starting the write transaction.

- [ ] **Step 2: Write failing insufficient/ranked persistence tests**

Insufficient:

```js
mockScoreBookingLocation.mockResolvedValue({
  status: 'insufficient_facility_data',
  suitabilityScore: null,
  suitabilityLabel: null,
  candidate: null
});
expect(mockBookingCreate).toHaveBeenCalledWith(
  expect.objectContaining({ suitability_score: null, suitability_label: null }),
  expect.anything()
);
expect(response.body.data.suitability_status).toBe('insufficient_facility_data');
```

Ranked uses the exact service score/label. Add a successful discovery/no-place fixture that follows the insufficient path.

- [ ] **Step 3: Write failing transaction duplicate-recheck test**

Mock the early check as clear, then transaction-level `Booking.findOne` as pending/approved. Assert response `409 DUPLICATE_BOOKING`, no `Booking.create`, and rollback called. Also assert the second lookup receives the transaction object.

- [ ] **Step 4: Run and observe RED**

```powershell
npm test -- --runInBand tests/bookingWfaPolicyContract.test.js tests/bookingsReadinessContract.test.js
```

- [ ] **Step 5: Refactor booking orchestration**

Remove `getSuitabilityScoreForCustomLocation`. Perform this order:

```text
strict shared eligibility (early duplicate check)
read server radius and active reason for early validation
scoreBookingLocation outside write transaction
begin transaction
call readWfaRequestConfig(transaction) and resolveActiveWfaRequestReason(..., transaction) again for the authoritative write
repeat duplicate pending/approved lookup inside transaction
create/reuse location
create booking with numeric or null suitability
commit
```

Do not return fallback labels such as `Lokasi tidak terdaftar`. Include `suitability_status` in create response without adding a database column.

- [ ] **Step 6: Verify GREEN and booking/job regressions**

```powershell
npm test -- --runInBand tests/bookingWfaPolicyContract.test.js tests/bookingsReadinessContract.test.js tests/bookingWfaProjectionContract.test.js tests/bookingWfaRejectionContract.test.js tests/resolveWfaBookingsJobIdempotency.test.js
git diff --check
```

- [ ] **Step 7: Commit**

```powershell
git add src/controllers/booking.controller.js tests/bookingWfaPolicyContract.test.js tests/bookingsReadinessContract.test.js tests/bookingWfaProjectionContract.test.js tests/resolveWfaBookingsJobIdempotency.test.js
git commit -m "feat(inf-272): use canonical booking suitability"
```

---

### Task 9: OpenAPI and Documentation Contract Migration

**Files:**
- Modify: `docs/openapi.yaml:300-1045,3736-3820,7240-7560`
- Modify: `tests/clientCriticalOpenApiContract.test.js`
- Modify: `tests/openApiMountedRoutesContract.test.js`
- Modify: `tests/openApiRuntimeDriftContract.test.js`
- Modify: `tests/postmanFahpDedicatedWfaProof.test.js`
- Modify: `tests/postmanFahpThesisEvidenceContract.test.js`
- Modify: `tests/postmanFahpLegacySamplesContract.test.js`
- Modify: `tests/postmanFuzzyAhpDocumentationContract.test.js`
- Modify: `postman/README.fahp-thesis-hybrid.md`
- Modify: `postman/fahp-thesis-hybrid.request-map.json`
- Modify: `postman/samples/legacy-wfa-monthly.json`

**Interfaces:**
- Consumes: final runtime request/response/error shapes from Tasks 6-8.
- Produces: OpenAPI and examples matching runtime exactly.

- [ ] **Step 1: Write failing OpenAPI contract assertions**

Assert recommendation parameters include `lat`, `lng`, `schedule_date` and dedicated analysis includes `lat`, `lon`, `schedule_date`, optional `radius_meters`. Assert candidate schema contains:

```js
[
  'place_id', 'status', 'distance_meters', 'location_type',
  'facility_score', 'facility_confidence', 'facilities',
  'final_score', 'final_label'
]
```

Assert nullable score fields, three status enum values, five facility properties, no `amenity_score`, and legacy combined WFA `410 WFA_ANALYSIS_MOVED`.

- [ ] **Step 2: Run documentation tests and observe RED**

```powershell
npm test -- --runInBand tests/clientCriticalOpenApiContract.test.js tests/openApiRuntimeDriftContract.test.js tests/postmanFahpDedicatedWfaProof.test.js tests/postmanFahpThesisEvidenceContract.test.js tests/postmanFuzzyAhpDocumentationContract.test.js
```

- [ ] **Step 3: Update OpenAPI operations and schemas**

Document examples for:

```text
ranked candidate with numeric scores
insufficient_facility_data with final score/label null
facility_enrichment_failed with facility confidence/scores/final null
booking insufficient data with nullable suitability and status
provider/config/date/duplicate errors
legacy combined WFA 410 response
```

Remove fabricated `real_data_analysis`, workspace/rating/review defaults, and amenity examples from the canonical WFA operations.

- [ ] **Step 4: Update Postman/evidence docs**

Change dedicated WFA sample URLs to include `schedule_date`. Mark combined WFA requests as `410` migration checks and point to the dedicated endpoint. Use `facility_score` throughout new WFA examples.

- [ ] **Step 5: Verify GREEN**

```powershell
npm test -- --runInBand tests/clientCriticalOpenApiContract.test.js tests/openApiMountedRoutesContract.test.js tests/openApiRuntimeDriftContract.test.js tests/postmanFahpDedicatedWfaProof.test.js tests/postmanFahpThesisEvidenceContract.test.js tests/postmanFahpLegacySamplesContract.test.js tests/postmanFuzzyAhpDocumentationContract.test.js
git diff --check
```

- [ ] **Step 6: Commit**

```powershell
git add docs/openapi.yaml tests/clientCriticalOpenApiContract.test.js tests/openApiMountedRoutesContract.test.js tests/openApiRuntimeDriftContract.test.js tests/postmanFahpDedicatedWfaProof.test.js tests/postmanFahpThesisEvidenceContract.test.js tests/postmanFahpLegacySamplesContract.test.js tests/postmanFuzzyAhpDocumentationContract.test.js postman/README.fahp-thesis-hybrid.md postman/fahp-thesis-hybrid.request-map.json postman/samples/legacy-wfa-monthly.json
git commit -m "docs(inf-272): document facility scoring contract"
```

---

### Task 10: Whole-Branch Verification and PR Evidence

**Files:**
- Modify only files required to correct failures caused by Tasks 1-9.
- Do not add feature behavior during this task.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: verified branch and evidence summary for PR preparation.

- [ ] **Step 1: Search for forbidden canonical fallbacks and fabricated fields**

```powershell
rg -n "amenity_score|amenityScore|suitability_score:\s*50|facility_score:\s*50|real_data_analysis|workspace_analysis" src tests docs/openapi.yaml
```

Expected:

- no canonical WFA recommendation/analysis/booking implementation uses `amenity_score` or fallback `50`;
- any remaining occurrence is an explicit legacy-migration assertion or unrelated historical document, reviewed individually;
- no canonical response mapping fabricates `real_data_analysis` or workspace evidence.

- [ ] **Step 2: Run all focused WFA/FAHP/booking suites**

```powershell
npm test -- --runInBand tests/wfaEligibilityService.test.js tests/wfaOpeningHours.test.js tests/wfaFacilityService.test.js tests/geoapifyWfaClient.test.js tests/wfaRecommendationService.test.js tests/wfaControllerContract.test.js tests/analysisFuzzyAhpWfaContract.test.js tests/analysisFuzzyAhpWfaRoute.test.js tests/bookingWfaPolicyContract.test.js tests/bookingsReadinessContract.test.js tests/clientCriticalOpenApiContract.test.js
```

Expected: all focused suites pass with no failed tests.

- [ ] **Step 3: Run repository gates**

```powershell
npm run lint
npm test
git diff --check
```

Expected: lint exit `0`, all test suites pass, diff check exit `0`.

- [ ] **Step 4: Inspect whole-branch scope**

```powershell
git status --short --branch
git diff --stat refs/remotes/origin/develop...HEAD
git diff --name-status refs/remotes/origin/develop...HEAD
git log --oneline refs/remotes/origin/develop..HEAD
```

Confirm changes stay within INF-272 design boundaries and no unrelated main-checkout files appear.

- [ ] **Step 5: Record PR evidence**

Prepare a concise evidence block containing:

```text
facility criteria and equal weights
facility CR and main WFA CR
top-30 and concurrency-5 proof
retry classification proof
focused and full test counts
lint/diff results
ranked response example
insufficient response example
enrichment-failed response example
legacy 410 example
Geoapify authenticated smoke: Needs Verification unless credentials/environment were exercised
deployment/runtime proof: Needs Verification
```

- [ ] **Step 6: Route failures back to the owning task**

If a gate fails, identify which Task 1-9 introduced the failing behavior, add a failing regression test in that task's focused test file, apply the minimal fix, rerun that task's focused command, and amend only that task before rerunning Steps 1-5. Do not create a generic verification commit and do not weaken an assertion to obtain green output.

---

## Plan Self-Review Coverage Map

| Spec requirement | Implemented by |
| --- | --- |
| Strict future date and duplicate policy | Tasks 1, 6, 8 |
| Analysis schedule date without duplicate check | Tasks 1, 5, 7 |
| Preliminary location/distance shortlist and top 30 | Task 5 |
| Geoapify Place Details and five explicit fields | Tasks 3, 4, 5 |
| Unknown semantics and no inference | Tasks 3, 5, 10 |
| Equal facility matrix, renormalization, confidence gate | Tasks 2, 3 |
| Full-window opening hours in WIB | Task 3 |
| One transient retry, no permanent retry, concurrency five | Task 4 |
| Partial enrichment and deterministic status ordering | Task 5 |
| Thin recommendation controller | Task 6 |
| Dedicated analysis canonical; legacy WFA 410 | Task 7 |
| Booking provider failure/no fallback/nullable insufficient data | Task 8 |
| OpenAPI and Postman alignment | Task 9 |
| Full regression and evidence gates | Task 10 |
