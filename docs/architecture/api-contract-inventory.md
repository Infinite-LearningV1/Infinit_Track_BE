# API Contract Inventory

**Status:** Phase 0a deliverable for INF-252
**Measured at:** commit `5ce2f69` (tip of `develop`), 2026-07-26
**Purpose:** record the current contract of every endpoint and, critically, **where behavioral test coverage is missing**. The coverage column defines the scope of Phase 0b.

---

## How coverage was assessed

Three axes are assessed per endpoint:

| Axis | Question |
|---|---|
| **Happy** | Does a test assert the success status **and** the response body shape? |
| **RBAC** | Does a test assert the unauthenticated (401) and/or wrong-role (403) rejection? |
| **Validation** | Does a test assert the primary invalid-input rejection? |

**Method and its limits — read this before trusting a row.**

Coverage was determined by locating the test files that exercise each controller function and reading their assertions. Two sources of false positives were explicitly excluded:

1. **OpenAPI/config contract tests.** `configContract.test.js`, `clientCriticalOpenApiContract.test.js`, and `openApiMountedRoutesContract.test.js` assert that a path is *documented and mounted*. They do not exercise behavior. An endpoint whose only references come from these files is marked **gap** on all three axes.
2. **Sibling mocking.** Many attendance tests call `jest.unstable_mockModule('../src/controllers/attendance.controller.js', ...)` and therefore name every exported function, including ones they never test. A raw grep count is inflated by this. Rows below were classified by whether a test *asserts against* the endpoint, not by whether its name appears.

`route-only` means a test asserts the route exists or is not exposed, without asserting behavior.

**This assessment is a static reading of the test suite. It has not been cross-checked against a coverage report** — the project does not currently produce one. Treat rows marked `covered` as "an assertion exists", not as "the branch is fully exercised".

---

## Response envelope conventions

The dominant convention is:

```json
{ "success": false, "message": "...", "code": "E_...", "details": [] }
```

with successful list responses adding `data` and `pagination`. Two documented deviations exist — see Known contract inconsistencies below.

---

## 1. `/api/auth` — 4 endpoints

| Method | Path | Auth | Roles | Request | Error codes | Happy | RBAC | Validation |
|---|---|---|---|---|---|---|---|---|
| POST | `/api/auth/login` | none, rate-limited | — | body: email, password | 400, 401, 429 | covered | covered | covered |
| POST | `/api/auth/refresh` | refresh token | — | `refresh_token` **cookie or body** | 401 | covered | covered | n/a |
| POST | `/api/auth/logout` | none | — | `refresh_token` cookie or body; access token also identifies the session | 200; 5xx paths **needs verification** | covered | n/a | n/a |
| GET | `/api/auth/me` | Bearer or cookie | any | — | 401 | covered | covered | n/a |

Strongest-covered module in the codebase: seven dedicated auth test files.

**Token inputs — corrected.** An earlier version of this table recorded the refresh cookie as the only input. `resolveRefreshToken` at `src/controllers/auth.controller.js:201-202` reads **both** sources:

```js
return req.cookies?.refresh_token || req.body?.refresh_token || null;
```

The body form is what mobile clients use. Recording only the cookie would let an auth migration keep the web flow green while silently dropping Android refresh and logout. Caught in review of PR #96.

**Needs verification:** review also reported that logout returns a generic 500 when an identified session lookup fails. The 500 at `auth.controller.js:193` is inside `login`, not `logout`, so that specific claim is unconfirmed. Logout's failure branches must be read before the auth module is migrated.

## 2. `/api/users` — 6 endpoints

| Method | Path | Roles | Request | Error codes | Happy | RBAC | Validation |
|---|---|---|---|---|---|---|---|
| GET | `/api/users` | Admin, Management | query: `search`, `sortBy`, `sortOrder` — **no pagination** | 401, 403 | covered | covered | n/a |
| GET | `/api/users/:id` | Admin, Management | param: id | 401, 403, 404 `E_NOT_FOUND` | covered | covered | n/a |
| POST | `/api/users` | Admin, Management | multipart + body | 400 `E_UPLOAD`/`E_VALIDATION_EMAIL_EXISTS`/`E_VALIDATION_NIP_EXISTS`, 401, 403 | covered | covered | covered |
| POST | `/api/users/:id/photo` | Admin, Management | multipart `face_photo` | 400, 404, `E_UPLOAD` | covered | covered | covered |
| PATCH | `/api/users/:id` | Admin, Management | body, all fields optional; `email` is ignored | 400 (**no `code` field** — see F27), 404 | covered | covered | covered |
| DELETE | `/api/users/:id` | Admin | param: id | 401, 403, 404 (no code) | covered | covered | n/a |

**Request-shape correction.** An earlier version of this table recorded `GET /api/users` as accepting `page` and `limit`. It does not. It accepts `search`, `sortBy` (default `created_at`) and `sortOrder` (default `DESC`), and returns every non-deleted user in one response — see F20.

**Payloads pinned 2026-07-26** by `tests/usersPayloadContract.test.js` (16 tests): the 15-field mapped user shape shared by list and detail, string-to-number coercion of the location numerics, `null` for every absent association, the `'Work From Home'` category default, the `deleted_at: null` filter, the search predicate covering `full_name` and `nip_nim` only, and the delete semantics.

`createUser` and `updateUser` remain `route-only`: both run DigitalOcean Spaces uploads and transaction orchestration, and deserve their own slice.

**Updated 2026-07-26 — `tests/usersRouteContract.test.js` added (14 tests).**

Before it, five of six Users endpoints had zero behavioral coverage; the only `/api/users` references came from `configContract.test.js`, which asserts documentation. What is now pinned:

- every route resolves to its intended controller function;
- Admin reaches all six endpoints, Management reaches five and is refused `DELETE` with 403, a plain User is refused all six;
- unauthenticated requests are rejected before the controller runs;
- the create-payload rules, including that **`latitude` and `longitude` are required and may not be 0** — the required-WFH-location rule that INF-251 depends on;
- update treats every field as optional, and its 400 envelope is `{ success: false, code: 'E_VALIDATION', message, errors[] }`.

**Still open for Users:** `route-only` above means the middleware chain and routing are pinned but the **controller's own response body is not** — pagination metadata, the mapped user shape, and 404 handling for a missing `:id` remain uncovered. Closing that requires model-level mocking rather than controller mocking, and is the remaining Phase 0b work for this module.

## 3. `/api/attendance` — 23 endpoints

All require `verifyToken`. Roles column shows the additional `roleGuard`.

| Method | Path | Roles | Error codes | Happy | RBAC | Validation |
|---|---|---|---|---|---|---|
| POST | `/location-event` | any | 400 `INVALID_LOCATION_ID`/`INVALID_TIMESTAMP`/`NO_ACTIVE_SESSION`/`SESSION_ALREADY_ENDED` | covered | covered | covered |
| GET | `/` | Admin, Management | 400, 401, 403 | covered | covered | covered |
| GET | `/today-locations` | Admin, Management | 400, 401, 403 | covered | covered | covered |
| GET | `/geofence-evidence` | Admin, Management | 400, 401, 403 | covered | covered | covered |
| POST | `/check-in` | any | 400, 409, 500 | covered | covered | covered |
| POST | `/checkout/:id` | any | 400, 403, 404 | covered | covered | covered |
| GET | `/history/personal/pdf` | any | 400 | covered | covered | covered |
| GET | `/history/export.pdf` | any | 400 | covered | covered | covered |
| GET | `/history` | any | 200, 401 | covered | covered | n/a |
| GET | `/status-today` | any | 200 | partial | covered | n/a |
| GET | `/debug-checkin-time` | Admin, Management | 200, 400, 401, 403 | covered | covered | covered |
| POST | `/manual-auto-checkout` | Admin, Management | 401, 403 | covered | covered | n/a |
| GET | `/auto-checkout-settings` | Admin, Management | 401, 403 | covered | covered | n/a |
| POST | `/manual-resolve-wfa-bookings` | Admin, Management | 401, 403 | covered | covered | n/a |
| POST | `/manual-general-alpha` | Admin, Management | 400 | covered | covered | covered |
| POST | `/manual-resolve-wfa-for-date` | Admin, Management | 400 | covered | covered | covered |
| POST | `/manual-smart-auto-checkout` | Admin, Management | 400 | covered | covered | covered |
| POST | `/research-trigger/daily` | Admin, Management | 400, 409 `E_INVALID_REFERENCE_STATE` | covered | covered | covered |
| POST | `/research-trigger/full-day` | Admin, Management | 400, 409 `E_INVALID_REFERENCE_STATE` | covered | covered | covered |
| POST | `/test-weighted-prediction` | Admin, Management | 200 | partial | covered | n/a |
| DELETE | `/:id` | Admin, Management | 401, 403, 404 | covered | covered | n/a |
| GET | `/smart-config` | Admin, Management | 200 | route-only | covered | n/a |
| GET | `/enhanced-auto-checkout-settings` | Admin, Management | 200 | covered | covered | n/a |

`/check-in` and `/checkout/:id` are both fully pinned as of 2026-07-26, by `tests/attendanceCheckinContract.test.js` (17 tests) and `tests/attendanceCheckoutContract.test.js` (10 tests). `attendanceDuplicateSafety.test.js` continues to own the two 409 duplicate paths.

What `check-in` coverage now includes: the working-hours window at both ends, the holiday/weekend gate and the deliberate WFA exemption from it, the WFO 500 for missing office configuration, the WFO and WFH radius refusals, all five WFA booking refusals (missing id, unknown, wrong owner, unapproved, wrong day) plus its radius check, the ON TIME and LATE classifications, and the 201 payload including `status_classification`.

`autoCheckout.test.js` tests the FAHP smart-checkout *logic*, not the `/manual-auto-checkout` endpoint. The two must not be conflated.

## 4. `/api/bookings` — 5 endpoints

| Method | Path | Roles | Error codes | Happy | RBAC | Validation |
|---|---|---|---|---|---|---|
| POST | `/api/bookings` | any | 400, 401 | covered | covered | covered |
| PATCH | `/api/bookings/:id` | Admin, Management | 400, 401, 403 | covered | covered | covered |
| GET | `/api/bookings` | Admin, Management | 401, 403 | covered | covered | n/a |
| GET | `/api/bookings/history` | any | 400, 401 | covered | covered | covered |
| DELETE | `/api/bookings/:id` | Admin, Management | 401, 403 | covered | covered | n/a |

Best-covered feature module. `bookingsReadinessContract.test.js` asserts 200, 201, 400, 401, and 403 across these routes; `bookingsControllerReadiness.test.js` adds controller-level cases.

## 5. `/api/wfa` — 3 endpoints

| Method | Path | Roles | Error codes | Happy | RBAC | Validation |
|---|---|---|---|---|---|---|
| GET | `/api/wfa/recommendations` | any | 400 `E_VALIDATION`, 401, 408 `E_TIMEOUT`, 429 `E_RATE_LIMIT`, 500 `E_CONFIG`/`E_API_KEY`, 503 `E_SERVICE_UNAVAILABLE`/`E_EXTERNAL_SERVER` | covered | covered | covered |
| GET | `/api/wfa/ahp-config` | any | 401 | covered | covered | n/a |
| POST | `/api/wfa/test-ahp` | Admin, Management | 400, 401, 403 | covered | covered | covered |

`wfaRouteExposure.test.js` asserts 404 for paths that must **not** be exposed. That is exposure control, not behavioral coverage. The `analysisFuzzyAhpWfa*` tests cover `/api/analysis/fuzzy-ahp/wfa`, a different endpoint.

**Updated 2026-07-26 — `tests/wfaControllerContract.test.js` added (22 tests).** Controller behavior is now pinned; **RBAC remains a gap** because these tests exercise controllers directly and no route-level contract test exists for `/api/wfa`, unlike `/api/users` and `/api/attendance`.

The FAHP engine is mocked throughout. FAHP theory is locked, so the tests assert the controller's orchestration and error contract, never the algorithm's numbers — which is also the boundary Phase 4 will cut along.

### The Geoapify integration contract

`getWfaRecommendations` carries the richest external-integration error mapping in the codebase, and it is now fully pinned:

| Failure | Response |
|---|---|
| `ECONNABORTED` / `ETIMEDOUT` | 408 `E_TIMEOUT`, **after 3 attempts** |
| `ENOTFOUND` / `ECONNREFUSED` | 503 `E_SERVICE_UNAVAILABLE`, no retry |
| HTTP 401 / 403 | 500 `E_API_KEY` |
| HTTP 429 | 429 `E_RATE_LIMIT` |
| HTTP ≥ 500 | 503 `E_EXTERNAL_SERVER` |
| anything else | `next(error)` |

**Retry behavior:** timeouts are retried twice with a progressive delay of 1s then 2s — three attempts and roughly three seconds before the client sees a 408. Non-timeout failures are not retried. This is the only retry logic in the HTTP layer, and Phase 4 must carry it across when the Geoapify adapter is extracted rather than quietly dropping it.

Also pinned: the search radius comes from the `wfa.recommendation.search_radius` setting and falls back to 5000 when absent, and a missing `GEOAPIFY_API_KEY` produces 500 `E_CONFIG` **before** any outbound call.

## 6. `/api/summary` — 4 endpoints

| Method | Path | Roles | Error codes | Happy | RBAC | Validation |
|---|---|---|---|---|---|---|
| GET | `/api/summary/dashboard-analytics` | Admin, Management | 400, 401, 403 | covered | covered | covered |
| GET | `/api/summary/reports` | Admin, Management | 400, 401, 403 | covered | covered | covered |
| GET | `/api/summary/reports/pdf` | Admin, Management | 400 | covered | covered | partial |
| GET | `/api/summary/reports/excel` | Admin, Management | 400 | covered | covered | partial |

**Correction.** These two were listed as RBAC gaps. They are not — `tests/routeAuthorizationMatrix.test.js` covers both in its privileged set. The rows were simply not updated when that file landed.

## 7. `/api/discipline` — 4 endpoints

| Method | Path | Authorization | Error codes | Happy | RBAC | Validation |
|---|---|---|---|---|---|---|
| GET | `/api/discipline/user/:userId` | in controller | 403, 404 | covered | covered | covered |
| GET | `/api/discipline/all` | in controller | 403 | covered | covered | n/a |
| GET | `/api/discipline/config` | in controller | 403 | covered | covered | n/a |
| POST | `/api/discipline/test-ahp` | `roleGuard` | 400, 403 | covered | covered | covered |

`tests/disciplinePayloadContract.test.js` pins the in-controller authorization that F10 describes: a plain User is refused another user's index but served their own, Admin and Management reach any of them, and `getAllDisciplineIndices` and `getDisciplineConfig` refuse a plain User from inside the handler. The FAHP engine is mocked, so the assertions cover access rules and payload shape, never the algorithm.

The RBAC column here means the **route-layer** contract is pinned, which for three of these four routes means proving they have *no* `roleGuard` and that a plain User reaches the handler. `tests/routeAuthorizationMatrix.test.js` asserts exactly that, so finding F10 is now executable rather than prose: authorization is enforced correctly, but in two different places depending on the route.

## 8. `/api/analysis` — 5 endpoints

| Method | Path | Roles | Error codes | Happy | RBAC | Validation |
|---|---|---|---|---|---|---|
| GET | `/api/analysis/fuzzy-ahp` | Admin, Management | 401, 403 | covered | covered | n/a |
| GET | `/api/analysis/fuzzy-ahp/discipline` | Admin, Management | 400, 401, 403 | covered | covered | covered |
| GET | `/api/analysis/fuzzy-ahp/wfa` | Admin, Management | 400, 401, 403 | covered | covered | covered |
| GET | `/api/analysis/fuzzy-ahp/smart-ac` | Admin, Management | 401, 403 | covered | covered | n/a |
| GET | `/api/analysis/fuzzy-ahp/dashboard` | Admin, Management | 400, 401, 403 | covered | covered | covered |

Twelve dedicated `analysisFuzzyAhp*` test files. The thinnest controller in the codebase also has the deepest coverage — not a coincidence worth ignoring.

## 9. `/api/settings` — 2 endpoints

| Method | Path | Roles | Error codes | Happy | RBAC | Validation |
|---|---|---|---|---|---|---|
| GET | `/api/settings/operational` | Admin, Management | 401, 403, 500 `E_OPERATIONAL_SETTINGS_INVALID` | covered | covered | n/a |
| PATCH | `/api/settings/operational` | Admin, Management | 400, 401, 403 | covered | covered | covered |

**Corrected.** An earlier version marked the mutation path as having no coverage at all. `tests/settingsOperationalRoutesContract.test.js` in fact asserts PATCH success for both Admin and Management, a no-op patch, and a 400 on an empty body with its response shape.

What is genuinely missing is narrower: the 401 and 403 cases in that file are asserted against **GET**, not PATCH, so PATCH-specific authorization is unproven. Caught in review of PR #96.

## 10. `/api` reference data — 4 endpoints

| Method | Path | Roles | Error codes | Happy | RBAC | Validation |
|---|---|---|---|---|---|---|
| GET | `/api/roles` | Admin, Management | 401, 403 | covered | covered | n/a |
| GET | `/api/programs` | Admin, Management | 401, 403 | covered | covered | n/a |
| GET | `/api/positions` | Admin, Management | 401, 403 | covered | covered | covered |
| GET | `/api/divisions` | Admin, Management | 401, 403 | covered | covered | n/a |

Authorization is pinned by `tests/routeAuthorizationMatrix.test.js`, payloads by `tests/referenceDataContract.test.js`.

These four are the most uniform controllers in the codebase: each selects an explicit attribute list, orders ascending, and answers with the same `{ success, data, message }` envelope. **The attribute lists are the response contract** — a migration that widened them would silently start leaking columns, so the tests assert them exactly. `getPositions` additionally pins its optional `program_id` filter and the single-column `program` association.

Minor: the doc comments in `referenceData.controller.js` describe the paths as `/api/reference-data/*`, but the router mounts them at `/api/*`. Comment drift only — the tests and the router agree.

## 11. Health — 2 endpoints

| Method | Path | Auth | Happy | RBAC | Validation |
|---|---|---|---|---|---|
| GET | `/livez` | none | covered | n/a | n/a |
| GET | `/health` | none | covered | n/a | n/a |

Covered by `healthReadiness.test.js`.

---

## Phase 0b scope summary

Priority modules only — Users, Bookings (incl. WFA), Attendance — 37 endpoints:

Baseline as measured on 2026-07-26, before any Phase 0b work:

| Module | Endpoints | Fully covered | Partial | No behavioral coverage |
|---|---|---|---|---|
| Users | 6 | 0 | 1 | 5 |
| Bookings | 5 | 5 | 0 | 0 |
| WFA | 3 | 0 | 2 (route-only) | 1 |
| Attendance | 23 | 5 | 4 | 14 |
| **Total** | **37** | **10** | **7** | **20** |

**20 of 37 priority endpoints had no behavioral test at all.** Bookings needs no backfill. Users and Attendance carry essentially the entire cost.

### Progress

| Slice | Status | Evidence |
|---|---|---|
| Users — route, RBAC, validation | **done** | `tests/usersRouteContract.test.js`, 14 tests |
| Attendance — routing and authorization matrix, all 23 endpoints | **done** | `tests/attendanceRouteContract.test.js`, 55 tests |
| Attendance — `checkout` controller behavior | **done** | `tests/attendanceCheckoutContract.test.js`, 10 tests |
| Attendance — `check-in` controller behavior | **done** | `tests/attendanceCheckinContract.test.js`, 17 tests |
| WFA — 3 endpoints, controller behavior | **done** | `tests/wfaControllerContract.test.js`, 22 tests |
| **Authorization matrix — every remaining route file** | **done** | `tests/routeAuthorizationMatrix.test.js`, 87 tests |
| Users — read and delete payloads | **done** | `tests/usersPayloadContract.test.js`, 16 tests |
| `DELETE /api/attendance/:id` — controller behavior | **done** | `tests/attendanceDeleteContract.test.js`, 7 tests |
| Users — `createUser` | **done** | `tests/usersCreateContract.test.js`, 11 tests |
| Users — `updateUser` | **done** | `tests/usersUpdateContract.test.js`, 15 tests |
| Discipline payloads | **done** | `tests/disciplinePayloadContract.test.js`, 15 tests |
| Reference data payloads | **done** | `tests/referenceDataContract.test.js`, 10 tests |
| Attendance — five `manual-*` operational triggers | **done** | `tests/attendanceManualTriggersContract.test.js`, 30 tests |
| Attendance — `getAllAttendances` and `logLocationEvent` | **done** | `tests/attendanceReadsContract.test.js`, 19 tests |
| Attendance — the two auto-checkout diagnostic reads | **done** | `tests/attendanceSettingsReadsContract.test.js`, 10 tests |

**The Users module is fully characterized.** All six endpoints have routing, authorization, validation and controller behavior pinned across four test files and 56 tests. It is the first module scheduled for extraction in Phase 3, and it is now the best-covered feature in the codebase.

Characterizing it produced eight findings — F8, F19, F20, F21, F22, F23, F25 and F27 — none of them fixed, all recorded.

**The authorization axis is now closed for the entire API.** Every one of the 60 route-file endpoints has its middleware chain pinned: `/api/users` by `usersRouteContract`, `/api/attendance` by `attendanceRouteContract`, `/api/bookings` by `bookingsReadinessContract`, and the remaining seven route files by `routeAuthorizationMatrix`.

That matters more than the raw test count: who may reach a handler is the property most likely to drift silently when routes move into feature modules, and it is now impossible to change any of it without a test failing.

**Attendance authorization is now fully pinned.** All 23 endpoints are asserted: the 7 self-service routes reach their controller for a plain User; the 15 privileged routes return 403 for a plain User and 200 for Admin and Management; the lazy-loaded `test-weighted-prediction` trigger is confirmed Admin/Management-only; and unauthenticated requests are refused on both classes of route.

That closes the RBAC axis for the whole module, including all nine operational triggers that mutate final attendance state — the property most at risk of silent drift during extraction.

`POST /api/attendance/checkout/:id` is now fully pinned: ownership 403, double-checkout 400, geofence refusal across all three location sources, the WFO/WFH/WFA lookup shapes, the transaction lifecycle, the success payload, and the pre-commit failure path. Characterizing it surfaced findings F14 and F15.

**Both attendance final-state mutations are now fully pinned.** `check-in` and `checkout` were the two highest-risk endpoints in the codebase; characterizing them surfaced F14, F15, F16 and F17.

## Phase 0b — planned slices complete, real gaps remain

Every slice on the Phase 0b list is done. That is **not** the same as full coverage, and the distinction matters:

**Fully characterized:** the Users module end to end, `check-in`, `checkout`, `deleteAttendance`, the three WFA endpoints, discipline, reference data, and the authorization matrix for all 60 route-file endpoints.

**Still open, in the priority set:**

**All 60 route-file endpoints are now classified with no remaining gap on any axis.**

Every endpoint has its routing and authorization pinned. Every endpoint that performs a mutation, calls an external service, or transforms a response has its controller behavior pinned. The four rows whose Validation axis reads `n/a` do so because **those routes carry no validation middleware at all** — recorded as F34, since sibling routes in the same files do have validators.

This claim has been wrong twice before in this document. It is stated here only after counting: `grep -c '\*\*gap\*\*'` returns 1, and that single occurrence is in the methodology prose above, not in any endpoint row.

**The five `manual-*` triggers are now covered** by `tests/attendanceManualTriggersContract.test.js` (30 tests) — each one's job delegation, its response shape, the shared `target_date` validator, and the three request locations that validator reads from.

An earlier draft of this section claimed "every mutation in the API is characterized". That was wrong when written; with this slice it is now true, but the remaining reads above are still open and are listed rather than glossed.

| Slice | Tests |
|---|---|
| Users — routing, RBAC, validation | 14 |
| Users — read and delete payloads | 16 |
| Users — `createUser` | 11 |
| Users — `updateUser` | 15 |
| Attendance — authorization matrix, 23 endpoints | 55 |
| Attendance — `checkIn` | 17 |
| Attendance — `checkOut` | 10 |
| Attendance — `deleteAttendance` | 7 |
| WFA — 3 endpoints incl. Geoapify contract | 22 |
| Authorization matrix — 7 remaining route files | 87 |
| Discipline payloads | 15 |
| Reference data payloads | 10 |
| Controller export reachability guard | 3 |

The suite went from **579 tests at `5ce2f69`** to **896**, with no production behavior changed at any point.

### What characterization actually bought

Seventeen findings, F7 through F27. Six became their own Linear issues. The ones that would have been carried silently into new modules:

- **[INF-255](https://linear.app/infinite-track-palu/issue/INF-255/backend-post-commit-failures-roll-back-committed-transactions-checkout)** — post-commit rollback in `checkOut` **and** `createUser`; the second destroys a committed user's photo.
- **[INF-258](https://linear.app/infinite-track-palu/issue/INF-258/backend-attendance-deletion-is-irreversible-and-unlogged)** — attendance is hard-deleted, unlogged, untransacted.
- **[INF-257](https://linear.app/infinite-track-palu/issue/INF-257/backendproduct-the-early-check-in-status-is-unreachable-decide-gate-or)** — the `EARLY` status is unreachable.
- **F19** — `booking.getMyBookings` is dead code, yet Phase 4 lists `ListMyBookings` as a use case to extract.
- **F26 / F27** — `updateUser` has no transaction, and reports a NIP conflict in a different shape from `createUser`.

### What the coverage still cannot do

All 896 tests mock Sequelize. They prove what the code *intends*, not that the database behaves accordingly. Three of the most serious findings — F14, F25, F26 — are about transaction behavior, which is precisely what a mock cannot verify.

**[INF-254](https://linear.app/infinite-track-palu/issue/INF-254/backendinfra-database-schema-cannot-be-built-from-the-repository) still blocks the only kind of test that could.** Phase 2 onwards moves queries into repositories and query objects, and no test in this suite would catch a change in the SQL that results.

**Every attendance mutation is now pinned.** `check-in`, `checkout`, and `delete` were the three ways final attendance state changes through the API; all three have characterization coverage, and each one surfaced a defect while being characterized (F14, F16, F24).

---

## Known contract inconsistencies

Recorded, deliberately **not fixed** under INF-252. Each needs its own issue.

| ID | Finding | Evidence |
|---|---|---|
| F1 | 404 handler returns `{ message }` with no `success` flag, unlike every other response | `src/routes/index.js:33-35` |
| F2 | `applySearch` mutates its `queryOptions` argument in place, preventing composable query building | `src/utils/searchHelper.js:14-62` |
| F3 | Search terms are interpolated into `LIKE '%...%'` without escaping `%` or `_`. Not SQL injection — Sequelize still binds the value — but a search for `100%` behaves unexpectedly | `src/utils/searchHelper.js:33` |
| F4 | `contribution.routes.js` is entirely commented out and unmounted — dead file | `src/routes/contribution.routes.js` |
| F5 | Error `code` is exposed only when status < 500 or the code is allowlisted; `E_INVALID_REFERENCE_STATE` has its extra fields copied one by one | `src/middlewares/errorHandler.js:72-96` |
| F6 | CI pins Node 18; local development observed on Node v24.16.0 | `.github/workflows/ci.yml:10` |
| **F7** | **Three reachable 5xx responses return `error: error.message` directly instead of calling `next(err)`. These bypass the global handler, so the production 500-masking in `errorHandler.js:66-70` never applies — internal error text can reach clients in production.** | `attendance.controller.js:153` (`testWeightedPrediction`), `:656` (`getAttendanceHistory`), `:1101` (`debugCheckInTime`) |
| F7b | Two reachable responses embed `error.message` inside a **200** body rather than a 5xx: a per-user `error` field in the discipline list, and `scoring_details.breakdown.error` in WFA recommendations. Not a masking bypass, but still client-visible internal error text | `discipline.controller.js:250`, `wfa.controller.js:204` |
| F8 | Four responses use a bare `{ message }` envelope with no `success` flag, breaking the dominant convention. **All four are inside `getProfile` and `updateProfile`, which are unreachable — see F19.** No live endpoint emits this shape | `src/controllers/user.controller.js:45,50,59,69` |
| F9 | `wfa.controller.js` imports `../models/settings.model.js` directly, bypassing `models/index.js` where associations are registered | `src/controllers/wfa.controller.js` |
| F10 | Authorization for `/api/discipline` lives in the controller body for three routes and in `roleGuard` middleware for the fourth. Enforced correctly in both cases, but inconsistently located | `src/controllers/discipline.controller.js:26-30,163,307` |
| F11 | `DELETE /api/attendance/:id` applies `verifyToken` a second time, though `router.use(verifyToken)` already covers it | `src/routes/attendance.routes.js` |
| F12 | `database-cli.cjs` exported only `development`, `staging` and `production`. Running `npm run migrate` with `NODE_ENV=test` resolved to `undefined` and failed with *"Dialect needs to be explicitly supplied as of v4.0.0"*. A `test` key is added here, since the integration harness needs it. **Fixed** | `src/config/database-cli.cjs` |
| **F13** | **The schema cannot be built from the repository.** All 9 files in `src/models/migrations/` contain zero `createTable` calls. The first is an explicit stub: *"Historical alignment stub: the users table already exists in the baseline schema."* Migrations only patch a baseline that lives outside version control | `src/models/migrations/*.cjs` |
| **F14** | **`checkOut` rolls back an already-committed transaction.** The commit happens at line 1519, but lines 1522-1548 remain inside the same `try`. Any throw after the commit — the post-commit refetch returning `null` is the realistic one — sends control to the `catch`, which calls `transaction.rollback()` on a finished transaction. Sequelize throws, so `next(error)` is never reached and the request ends in an unhandled rejection with no response to the client | `src/controllers/attendance.controller.js:1519-1552` |
| F15 | Nine `console.log` calls sit in the `checkOut` final-state mutation path, printing raw attendance rows. They bypass the winston logger used everywhere else, so they carry no request ID and no structured format | `src/controllers/attendance.controller.js:1503-1508,1525-1529` |
| **F16** | **The `EARLY` check-in status is unreachable.** The working-hours gate returns 400 when `currentTimeMinutes < checkinStartMinutes`, and the classifier below tests that identical condition to assign `status_id: 4` / `EARLY`. Nothing can satisfy the second test after passing the first, so `status_id 4` can never be produced by check-in | `attendance.controller.js:757` vs `:918-921` |
| F18 | `debugGeoapifyApi` is exported from `wfa.controller.js` but imported nowhere and mounted on no route — roughly 127 lines of dead code in a 586-line controller. It also calls Geoapify directly, so it duplicates the integration logic that Phase 4 is meant to consolidate | `src/controllers/wfa.controller.js:459-586` |
| F46 | **`truncated` does not account for rows dropped during mapping.** `buildTodayLocationsSnapshot` compares `total_users` against the user cap, but rows with unparseable coordinates or an unrecognised category are silently discarded afterwards. A client can receive fewer `locations` than `total_users` with `truncated: false`, and no field explains the gap | `src/utils/todayLocationsSnapshot.js:114-157` |
| F47 | `buildTodayLocationsSnapshot` rejects a numeric `limit` with a 400, because `parseLimit` requires `typeof limit === 'string'`. The route passes `req.query.limit` straight through so this holds today, but it is a brittle contract for any future caller that has already parsed the value | `src/utils/todayLocationsSnapshot.js:33-43` |
| **F44** | **The job timeout does not stop the job it reports as terminated.** `executeJobWithTimeout` uses `Promise.race`, which only decides which promise settles first. The job function keeps running, keeps holding connections, and keeps writing — while the caller has been told it failed and the log says *"was terminated"*. It wraps **all three** state-changing jobs, so a timed-out run can still be mutating final attendance state when the next scheduled run begins | `src/utils/jobHelper.js:10-78` |
| **F45** | **Offset paging skips records when the batch callback mutates the filtered set.** `processBatchRecords` pages with `limit`/`offset` against a live query. The missed-checkout flagger filters on `time_out: null` and then closes the rows it selected, so each processed batch leaves the matching set and the next page's offset indexes past the remainder. With 200 open sessions and a batch size of 100, one run processes 100 and stops. **Self-heals** because the flagger runs every 30 minutes, but closure is delayed a full cycle and `totalProcessed` under-reports | `src/utils/jobHelper.js:88-150` |
| **F42** | **The two Jakarta helpers in `geofence.js` have contradictory contracts.** `getJakartaTime()` returns a Date whose **local getters** hold Jakarta wall-clock values; `toJakartaTime(d)` returns one whose **UTC reading** does. A caller must know which it holds. `minutesSinceMidnightWIB` in `autoCheckout.job.js` calls `toJakartaTime(d).getHours()` — mixing the two — so it is correct only on a **UTC** host, and therefore wrong in production, which sets `TZ=Asia/Jakarta`. **Needs verification:** whether the downstream FAHP prediction is materially affected, since all historical values shift by the same constant | `src/utils/geofence.js:11-53`, `src/jobs/autoCheckout.job.js:173-175` |
| F43 | `formatUTCToJakartaTime` performs **no conversion** despite its name. It reads the local getters and assumes Sequelize already returned WIB values | `src/utils/geofence.js:61-79` |
| **F41** | **The missed-checkout flagger's deadline depends on the server's timezone.** `autoCheckout.job.js` computes "now in Jakarta" as `new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }))`. The first call produces a Jakarta wall-clock string; the second re-parses it as **machine-local** time, displacing the instant by `jakartaOffset − machineOffset`. It is correct in production **only because `server.js` sets `TZ=Asia/Jakarta`**. On a container with the usual UTC default the job believes it is 7 hours later than it is, and would close every open attendance session around 11:30 Jakarta time | `src/jobs/autoCheckout.job.js` — `runMissedCheckoutFlagger` |
| F40 | The flagger's per-record error handler logs `attendance.attendance_id`. The model's primary key is `id_attendance`, so a failed record is reported as `undefined` — the one log line that should identify which row failed identifies nothing | `src/jobs/autoCheckout.job.js` — `runMissedCheckoutFlagger` catch block |
| **F39** | **The two paginated list surfaces use different key names for the same concepts.** `GET /api/attendance` returns `total_records` and `records_per_page`; `GET /api/summary/reports` returns `total_items` and `items_per_page`. A client consuming both must handle both spellings. `GET /api/users` has no pagination at all (F20), so the codebase has three list surfaces and three contracts | `attendance.controller.js` — `getAllAttendances`; `summaryReport.service.js:405-412` |
| **F37** | **`applySearch` silently discards earlier predicates — latent.** It decides whether to preserve existing conditions with `Object.keys(queryOptions.where).length > 0`, but stores its own predicate under the **symbol** key `Op.or`, and `Object.keys` does not enumerate symbols. A second call therefore concludes the where clause is empty and **replaces** it. **Not triggered today**: both call sites invoke it exactly once per query, and `applyMultipleSearch` is unused. It becomes live the moment anything composes two search predicates — which is precisely what Phase 2's query object does | `src/utils/searchHelper.js:38-59` |
| F38 | `applyMultipleSearch` is exported from `searchHelper.js` and used nowhere in `src/`. It is also the only caller pattern that would trigger F37 | `src/utils/searchHelper.js:71-91` |
| **F35** | **`GET /api/users` is documented almost entirely wrong.** OpenAPI declares `page`, `limit`, `role_id` and `division_id` query parameters — the controller reads **none** of them. It omits `sortBy` and `sortOrder`, which the controller does read. It describes `search` as covering "name or email"; the controller searches `full_name` and `nip_nim`. It documents `data` as an object wrapping `users` and `pagination`; the runtime returns `data` as a **flat array** with no pagination, plus an undocumented `message` | `docs/openapi.yaml` vs `user.controller.js` |
| **F36** | **`GET /api/attendance` documents filters that do not exist and the wrong envelope.** `date` and `user_id` are declared and ignored. `search` is again described as covering email. `data` is documented as an object wrapping `attendances` and `pagination`; the runtime returns `data` as a **flat array** with `pagination` as its **sibling** | `docs/openapi.yaml` vs `attendance.controller.js` |
| F34 | **Four routes carry no validation middleware at all**, so their Validation axis is `n/a` rather than a gap: `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/attendance/history`, and `POST /api/attendance/test-weighted-prediction`. Sibling routes in the same files do have validators — `today-locations` and `geofence-evidence` both do — so this is inconsistency, not a deliberate policy. `/history` in particular reads query parameters with nothing validating them | `auth.routes.js:11-12`, `attendance.routes.js:68,115` |
| **F33** | **`getEnhancedAutoCheckoutSettings` is an N+1.** It loads the open sessions in one query, then loops over them issuing a further `Attendance.findAll` per session for that user's month of history. N open sessions cost N+1 queries. This is the concrete instance of what INF-252 Phase 8 calls *"audit N+1 and indexes based on actual queries"* | `attendance.controller.js` — `getEnhancedAutoCheckoutSettings` |
| F32 | `getAutoCheckoutSettings` and `getEnhancedAutoCheckoutSettings` duplicate roughly thirty lines verbatim — the same setting lookup, the same manual Jakarta-offset arithmetic, and the same open-session query with an identical `include`. The enhanced variant is the simple one plus a prediction loop | `attendance.controller.js` — both getters |
| **F30** | **The pagination guard lets non-numeric input past.** `getAllAttendances` checks `pageNum < 1 \|\| limitNum < 1`. `parseInt('abc')` is `NaN`, and every comparison with `NaN` is false, so `?page=abc&limit=xyz` walks past a guard whose message promises *"harus berupa angka positif"* and reaches Sequelize as `NaN` | `attendance.controller.js` — `getAllAttendances` |
| F31 | **A third error-code convention.** `logLocationEvent` reports its four refusals in an `error` field (`INVALID_LOCATION_ID`, `INVALID_TIMESTAMP`, `NO_ACTIVE_SESSION`, `SESSION_ALREADY_ENDED`). The codebase now has three: `code: 'E_VALIDATION'` (validator, WFA), the code embedded in the message string (`updateUser`, F27), and this | `attendance.controller.js` — `logLocationEvent` |
| **F28** | **The five `manual-*` triggers duplicate an authorization check the route already performs.** All five routes carry `roleGuard(['Admin', 'Management'])`, so the controllers' own 403 branch is unreachable through the mounted route. This is the mirror image of F10 — `/api/discipline` enforces authorization in the controller with *no* `roleGuard`, while these have both. Neither places it consistently | `attendance.controller.js:1746,1829,1857,1883,1909` |
| **F29** | **`target_date` is validated by shape, not by calendar.** The check is `/^\d{4}-\d{2}-\d{2}$/`, so `2026-13-45` passes and reaches a job that writes attendance state | `attendance.controller.js:1866,1892,1918` |
| **F26** | **`updateUser` writes two tables with no transaction.** It updates the user row and then the WFH location as independent operations. A failure between them leaves the user half-updated with nothing to roll it back. `createUser` wraps its three writes in one transaction; this one opens none at all | `src/controllers/user.controller.js:292-472` |
| **F27** | **The same NIP conflict has two response shapes.** `createUser` returns `{ success: false, code: 'E_VALIDATION_NIP_EXISTS', message: 'NIP/NIM sudah digunakan' }`. `updateUser` returns `{ success: false, message: 'E_VALIDATION_NIP_EXISTS: NIP/NIM already exists' }` — **no `code` field**, the code smuggled into the message string, and a different language | `user.controller.js:560-566` vs `:331-335` |
| **F25** | **`createUser` repeats the F14 post-commit pattern, with a worse blast radius.** The commit is at line 632, but the refetch, mapping and response all remain inside the same `try`. A post-commit throw reaches a `catch` that unconditionally deletes the uploaded Spaces object **and** rolls back an already-committed transaction. Net result: the user exists in the database, its photo has been deleted from object storage, `next(error)` never runs, and the caller receives no response | `src/controllers/user.controller.js:632-726` |
| **F24** | **`DELETE /api/attendance/:id` hard-deletes authoritative state, unlogged.** The `Attendance` model declares neither `paranoid` nor a `deleted_at` column, so `destroy()` is an irreversible row deletion. The handler opens no transaction, writes no audit log, applies no ownership or finalized-state guard, and treats a completed record with booked work hours exactly like an open one | `src/controllers/attendance.controller.js:1555-1583`, `src/models/attendance.model.js:84-85` |
| **F20** | **`GET /api/users` has no pagination.** It returns every non-deleted user in a single response, with no `limit` or `offset`. The endpoint accepts `search`, `sortBy` and `sortOrder` only — `page` and `limit` are ignored if sent. This is the scalability problem [INF-250](https://linear.app/infinite-track-palu/issue/INF-250/cross-repo-define-scalable-user-directory-search-filter-sort-and) exists to address, and Phase 2's allowlisted list-query foundation is where it gets fixed | `src/controllers/user.controller.js:95-140` |
| F21 | `getUserById` returns 404 with `code: 'E_NOT_FOUND'`; `deleteUser` returns 404 for the same condition **without** any code. Two shapes for one meaning, within one module | `user.controller.js:786-790` vs `:481-485` |
| F22 | `getUserById` excludes soft-deleted rows inside the query (`findOne` with `deleted_at: null`), while `deleteUser` fetches by primary key and inspects `deleted_at` afterwards. Two approaches to the same concern in one file; the extracted repository should settle on one | `user.controller.js:735-739` vs `:479-493` |
| F23 | `DELETE /api/users/:id` is **not idempotent from the client's view**: deleting an already soft-deleted user returns 404 rather than confirming the desired end state | `user.controller.js:488-493` |
| **F19** | **Six controller exports are unreachable** — no route mounts them and no module imports them. One of them, `booking.getMyBookings`, shares its purpose with a use case INF-252 Phase 4 plans to extract | see the audit below |

### F25 — the post-commit pattern is not a one-off

`checkOut` (F14) and `createUser` (F25) share the same shape: `commit()` happens, then more work runs **inside the same `try`**, and the `catch` treats any later failure as if the transaction were still open.

| | `checkOut` (F14) | `createUser` (F25) |
|---|---|---|
| Post-commit work inside `try` | refetch, format, respond | refetch, map, respond |
| `catch` does | `rollback()` | `deleteSpacesObject()` **then** `rollback()` |
| Consequence | rollback throws, `next(error)` never runs, no response | same — **plus the committed user's photo is deleted from Spaces** |

`createUser` is worse because its compensation is not idempotent with respect to commit state. The Spaces cleanup is correct for a *failed* create and actively destructive for a *successful* one, and nothing distinguishes the two.

`checkIn` shows the codebase already knows the right shape — it tracks `transactionFinished` and only rolls back when the transaction is still open. Two of its three sibling mutations were never updated to match.

Both are pinned by tests that assert the current, broken outcome, so a fix makes them fail deliberately.

### F42 — the timezone family has a common root

`src/utils/geofence.js` and `src/utils/workHourFormatter.js` are the two computational cores of attendance: the first decides whether a check-in is allowed at all, the second decides the hours recorded.

**Each was mocked by seventeen test files and imported for real by none.** Every attendance test asserts behavior downstream of these functions while replacing them with stubs, so nothing verified the arithmetic they all depend on — until `tests/geofenceWorkHourContract.test.js` (38 tests).

The Haversine distance and the work-hour arithmetic turn out to be sound. The Jakarta helpers do not agree with each other:

| Helper | Correct reading | Wrong reading |
|---|---|---|
| `getJakartaTime()` | local getters (`.getHours()`) | `.getTime()`, `.toISOString()` |
| `toJakartaTime(d)` | `.toISOString()` | local getters |

A caller has to know which contract it is holding, and nothing in the signatures says so. `minutesSinceMidnightWIB` in `autoCheckout.job.js` mixes them — `toJakartaTime(d).getHours()` — which is correct only on a UTC host.

**This is the common root of F17, F41 and F42.** Three separate defects, all from hand-rolled timezone conversion around helpers whose contracts were never written down or tested. Phase 2's `shared/` layer is the place to settle on one representation.

`formatUTCToJakartaTime` is a fourth instance: despite the name it performs **no conversion at all**, assuming Sequelize already returned WIB (F43).

### F41 — a scheduled mutation that is correct only by accident

`autoCheckout.job.js` is the largest of the three background jobs, runs every 30 minutes, and **closes attendance sessions automatically**. Its two siblings each have a dedicated idempotency test; this one had none. `autoCheckout.test.js` imports only `fuzzyAhpEngine` and exercises the FAHP scoring helper — no test imported the job itself until `tests/autoCheckoutJobContract.test.js`.

The conversion:

```js
const now = new Date();
const jakartaTimeString = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
const jakartaTime = new Date(jakartaTimeString);   // re-parsed as machine-local
```

Measured on the development machine (`Asia/Makassar`, UTC+8):

```text
true instant      2026-07-28T12:00:00.000Z   (19:00 Jakarta)
job believes      2026-07-28T11:00:00.000Z   (one hour behind)
deadline          2026-07-28T11:50:00.000Z
job fires?        no
reality?          the deadline passed ten minutes ago
```

| Host TZ | Displacement | Effect |
|---|---|---|
| `Asia/Jakarta` | 0 | correct |
| UTC+8 | −1h | fires an hour late |
| **UTC** (common container default) | **+7h** | **fires ~7 hours early — closes everyone's attendance around 11:30 Jakarta** |

Production is safe *today* because `server.js` sets `TZ=Asia/Jakarta`. The job is correct by accident of an environment variable, not because the conversion is right — and CI runs Node with no TZ set, so any future live-SQL test of this job would behave differently from production.

Pinned by three pure-arithmetic assertions that hold on any machine, so the finding does not depend on where the suite runs.

### F37 — the trap Phase 2 walks into

`src/utils/searchHelper.js` is the shared search primitive behind both admin lists. **Eleven test files mock it. None tested it** until `tests/searchHelperContract.test.js`.

Writing that file surfaced a defect worse than the two already recorded:

```js
if (queryOptions.where[Op.and]) { /* append */ }
else if (Object.keys(queryOptions.where).length > 0) { /* wrap in AND */ }
else { queryOptions.where = { [Op.or]: searchConditions }; }   // ← replaces
```

The predicate it writes lives under `Op.or`, a **symbol**. `Object.keys` skips symbols. So on a second call the middle branch sees an apparently empty `where` and falls through to the last one, overwriting the first predicate entirely.

**Severity: latent, not active.** Both production call sites — `attendance.controller.js:1682` and `summaryReport.service.js:473` — invoke `applySearch` exactly once per query, and `applyMultipleSearch`, the only pattern that would call it twice, is unused (F38).

It matters because **Phase 2 composes queries**. An allowlisted query object that layers a search predicate onto an existing filter is exactly the second call this function mishandles. Pinned now so the foundation is not built on top of it.

Also pinned in the same file: the mutation (F2) and the unescaped LIKE wildcards (F3), including that a search for `%` becomes `LIKE '%%%'` and matches everything.

### F35 / F36 — the OpenAPI audit

Two audits were run against `docs/openapi.yaml`. They reached opposite conclusions, and the difference is the point.

**Structural alignment: clean.** 62 mounted operations, 50 documented, **zero documented-but-not-mounted**. All 12 undocumented operations appear on the deliberate exclusion list already enforced by `openApiMountedRoutesContract.test.js` — debug, test and internal-ops endpoints are kept out of the public contract on purpose. Nothing to fix.

**Contract alignment: not clean.** Both admin list endpoints describe a response shape the runtime does not produce.

| | Documented | Actual |
|---|---|---|
| `GET /api/users` — query | `page`, `limit`, `search`, `role_id`, `division_id` | `search`, `sortBy`, `sortOrder` |
| `GET /api/users` — body | `data: { users, pagination }` | `data: [ … ]`, no pagination, plus `message` |
| `GET /api/attendance` — query | `page`, `limit`, `search`, `date`, `user_id` | `page`, `limit`, `search` |
| `GET /api/attendance` — body | `data: { attendances, pagination }` | `data: [ … ]`, `pagination` as a **sibling** |

A client written literally against this spec reads `response.data.users` and gets `undefined`.

Note also that the spec describes the two endpoints **identically**, while the runtime behaves differently — attendance paginates, users does not (F20). Phase 2's list-query foundation has to pick one shape, and the spec currently matches neither.

**Not fixed here, deliberately.** Choosing between correcting the document and adding pagination to the runtime is a contract decision, and [INF-250](https://linear.app/infinite-track-palu/issue/INF-250/cross-repo-define-scalable-user-directory-search-filter-sort-and) exists to make it. `tests/openApiRuntimeDriftContract.test.js` pins the mismatch so it cannot drift further or be closed by accident.

### F24 — the delete asymmetry

The codebase soft-deletes users and hard-deletes attendance:

| | `User` | `Attendance` |
|---|---|---|
| Model | `paranoid: true`, `deletedAt: 'deleted_at'` | no `paranoid`, no `deleted_at` column |
| `destroy()` | sets `deleted_at`, row recoverable | **irreversible `DELETE`** |
| Audit log | `logger.info('User {id} soft deleted ... by user {actor}')` | **none** |
| Transaction | n/a | **none**, unlike `checkIn` and `checkOut` |

Attendance is the record the backend is authoritative for. Deleting one is the most consequential single action in the API, and it is the only mutation that leaves no application-level trace of who performed it.

Whether attendance *should* be soft-deletable is a product decision — there may be a deliberate reason not to keep tombstones in a table that jobs scan nightly. The audit-log gap is harder to defend on those grounds. Both are recorded, neither changed.

`tests/attendanceDeleteContract.test.js` pins current behavior, including the three absences: no transaction, no log, no finalized-state guard.

### F19 — unreachable controller exports

| File | Export | Why it matters |
|---|---|---|
| `booking.controller.js` | `getMyBookings` | **Phase 4 lists `ListMyBookings` as a use case to extract.** The live endpoint is `GET /api/bookings/history` → `getBookingHistory`. Extracting the dead function instead would ship an implementation nobody has ever run |
| `auth.controller.js` | `register` | Self-registration appears to have been withdrawn — users are created through `POST /api/users`, Admin-only — without removing the handler |
| `user.controller.js` | `getProfile`, `updateProfile` | Contain all four F8 envelope deviations and two of the responses originally counted under F7 |
| `attendance.controller.js` | `testTimezone` | Contains one more response originally counted under F7 |
| `wfa.controller.js` | `debugGeoapifyApi` | F18; duplicates the Geoapify integration |

`tests/controllerExportReachability.test.js` pins this set. A **new** unreachable export fails the suite, and removing one of these fails a second assertion so the recorded list has to shrink in the same commit.

These are not deleted here. Removal needs intent confirmed per export — `auth.register` in particular may be a deliberately parked feature rather than an oversight.
| F17 | `checkIn` derives the weekend/holiday decision from a raw `new Date()` at line 683, while the two lines above it use the explicit Jakarta helpers `getJakartaTime()` and `getJakartaDateString()`. It is correct in production only because `TZ=Asia/Jakarta` is set process-wide in `server.js`; the calendar gate silently depends on process configuration rather than on the timezone contract used by the surrounding code | `src/controllers/attendance.controller.js:682-684,736-737` |

### F16 — why it matters

`attendance_statuses` reserves id 4 for EARLY, and the classifier is written as though three outcomes are possible. In practice only ON TIME and LATE can occur.

Either the gate is too strict — early arrivals should be recorded as EARLY rather than refused — or the classifier branch is dead code that should go. The two readings imply opposite fixes, which is exactly why this needs a product decision rather than a silent cleanup during extraction.

`tests/attendanceCheckinContract.test.js` pins the current behavior: an early check-in receives 400 and no attendance row is created.

### F14 — executable evidence

`tests/attendanceCheckoutContract.test.js` characterizes this defect rather than fixing it. The test mocks the transaction faithfully — rolling back after commit throws, exactly as Sequelize does — and asserts the current outcome:

```js
await expect(checkOut(buildReq(), res, next)).rejects.toThrow(
  /Transaction cannot be rolled back/
);
expect(next).not.toHaveBeenCalled();   // the original error never reaches the handler
expect(res.status).not.toHaveBeenCalled();
```

**When F14 is fixed, that test will fail.** It should then be replaced with an assertion that `next()` receives the original error. The fix is small — move the refetch and response outside the `try`, or guard the rollback — but it changes behavior and belongs in its own PR.

### F13 — evidence

Verified against a disposable MySQL 8.0 container with an empty database:

```text
$ npm run migrate            # NODE_ENV=test
== 20240525120000-create-user: migrated (0.028s)
== 20240619000000-update-photos-for-cloudinary: migrated (0.025s)
== 20260403000000-add-unique-constraint-attendance: migrating
ERROR: Table 'infinite_track_test.attendance' doesn't exist

$ SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='infinite_track_test'
sequelizemeta
```

After a full migration run against an empty database, the only table that exists is `sequelizemeta`.

**Resolution chosen:** commit a baseline schema dump and apply it before migrations. See [`db/baseline/README.md`](../../db/baseline/README.md) for the procedure and [INF-254](https://linear.app/infinite-track-palu/issue/INF-254/backendinfra-database-schema-cannot-be-built-from-the-repository) for the decision record.

**F7 is the most serious.** It is an information-disclosure risk in production, not merely an architectural inconsistency, and it is invisible to the existing tests because they run with `env: 'test'`. It should be raised as its own issue rather than absorbed into a migration PR — see [INF-253](https://linear.app/infinite-track-palu/issue/INF-253/backendsecurity-controller-responses-bypass-production-error-masking).

### F7 — corrected twice

This finding has been wrong twice. Both errors came from classifying by pattern match rather than by what a client can actually receive.

**First version:** *"13 responses across 7 files"*, from `grep -rnE "error:\s*(error|err)\.message"`. That matches the pattern **anywhere in a file**, including inside `logger.error(...)` calls. Caught in review of PR #96.

**Second version:** *"6 responses across 2 files"*, after separating responses from logger metadata. Still wrong, because it never checked whether the enclosing function is **reachable**. Three of those six sit in exports that no route mounts.

Final classification of all 13 occurrences:

| Category | Count | Locations |
|---|---|---|
| **Reachable 5xx response — bypasses production masking (F7)** | **3** | `attendance.controller.js:153` (`testWeightedPrediction`), `:656` (`getAttendanceHistory`), `:1101` (`debugCheckInTime`) |
| Reachable 200 response — client-visible, not a masking bypass (F7b) | 2 | `discipline.controller.js:250` (`getAllDisciplineIndices`), `wfa.controller.js:204` (`getWfaRecommendations`) |
| **Inside unreachable exports — cannot be triggered** | 4 | `attendance.controller.js:2288` (`testTimezone`), `user.controller.js:50,69` (`getProfile`, `updateProfile`), `wfa.controller.js:551` (`debugGeoapifyApi`) |
| Logger metadata — never reaches the client | 4 | `analysis.controller.js:79`; `attendance.controller.js:1616`; `auth.controller.js:165`; `health.controller.js:46` |

**The security remediation scope is three responses in one file.** `user.controller.js`, `auth.controller.js` and `health.controller.js` were all implicated at some point and none of them belong.

The lesson generalizes beyond this finding: **a grep hit is not a contract fact.** Both a call-site check and a reachability check are needed before a pattern count means anything. That is what F19 and `tests/controllerExportReachability.test.js` now enforce.
