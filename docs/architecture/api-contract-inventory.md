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
| POST | `/api/auth/refresh` | refresh cookie | — | cookie | 401 | covered | covered | **gap** |
| POST | `/api/auth/logout` | none | — | cookie | 200 always | covered | n/a | **gap** |
| GET | `/api/auth/me` | Bearer or cookie | any | — | 401 | covered | covered | n/a |

Strongest-covered module in the codebase: seven dedicated auth test files.

## 2. `/api/users` — 6 endpoints

| Method | Path | Roles | Request | Error codes | Happy | RBAC | Validation |
|---|---|---|---|---|---|---|---|
| GET | `/api/users` | Admin, Management | query: page, limit, search | 401, 403 | route-only | covered | n/a |
| GET | `/api/users/:id` | Admin, Management | param: id | 401, 403, 404 | route-only | covered | n/a |
| POST | `/api/users` | Admin, Management | multipart + body | 400, 401, 403 | route-only | covered | covered |
| POST | `/api/users/:id/photo` | Admin, Management | multipart `face_photo` | 400, 404, `E_UPLOAD` | covered | covered | covered |
| PATCH | `/api/users/:id` | Admin, Management | body | 400, 404, `E_VALIDATION_NIP_EXISTS`, `E_VALIDATION_EMAIL_EXISTS` | route-only | covered | covered |
| DELETE | `/api/users/:id` | Admin | param: id | 401, 403, 404 | route-only | covered | n/a |

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
| POST | `/location-event` | any | 400 | route-only | covered | **gap** |
| GET | `/` | Admin, Management | 401, 403 | route-only | covered | **gap** |
| GET | `/today-locations` | Admin, Management | 400, 401, 403 | covered | covered | covered |
| GET | `/geofence-evidence` | Admin, Management | 400, 401, 403 | covered | covered | covered |
| POST | `/check-in` | any | 400, 409 | partial | covered | **gap** |
| POST | `/checkout/:id` | any | 400, 404 | route-only | covered | **gap** |
| GET | `/history/personal/pdf` | any | 400 | covered | covered | covered |
| GET | `/history/export.pdf` | any | 400 | covered | covered | covered |
| GET | `/history` | any | 200, 401 | covered | covered | **gap** |
| GET | `/status-today` | any | 200 | partial | **gap** | n/a |
| GET | `/debug-checkin-time` | Admin, Management | 200, 400, 401, 403 | covered | covered | covered |
| POST | `/manual-auto-checkout` | Admin, Management | 401, 403 | route-only | covered | **gap** |
| GET | `/auto-checkout-settings` | Admin, Management | 401, 403 | route-only | covered | n/a |
| POST | `/manual-resolve-wfa-bookings` | Admin, Management | 401, 403 | route-only | covered | **gap** |
| POST | `/manual-general-alpha` | Admin, Management | 400 | route-only | covered | **gap** |
| POST | `/manual-resolve-wfa-for-date` | Admin, Management | 400 | route-only | covered | **gap** |
| POST | `/manual-smart-auto-checkout` | Admin, Management | 400 | route-only | covered | **gap** |
| POST | `/research-trigger/daily` | Admin, Management | 400, 409 `E_INVALID_REFERENCE_STATE` | covered | covered | covered |
| POST | `/research-trigger/full-day` | Admin, Management | 400, 409 `E_INVALID_REFERENCE_STATE` | covered | covered | covered |
| POST | `/test-weighted-prediction` | Admin, Management | 200 | partial | covered | **gap** |
| DELETE | `/:id` | Admin, Management | 401, 403, 404 | route-only | covered | **gap** |
| GET | `/smart-config` | Admin, Management | 200 | route-only | covered | n/a |
| GET | `/enhanced-auto-checkout-settings` | Admin, Management | 200 | route-only | covered | **gap** |

`partial` for `/check-in` means `attendanceDuplicateSafety.test.js` exercises `checkIn` at controller level, but only for duplicate-safety behavior — not the general success path. `/checkout/:id` has **no dedicated test at all**, despite being a final-state mutation.

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
| GET | `/api/wfa/recommendations` | any | 401 | route-only | **gap** | **gap** |
| GET | `/api/wfa/ahp-config` | any | 401 | route-only | **gap** | **gap** |
| POST | `/api/wfa/test-ahp` | Admin, Management | 401, 403 | **gap** | **gap** | **gap** |

`wfaRouteExposure.test.js` asserts 404 for paths that must **not** be exposed. That is exposure control, not behavioral coverage. The `analysisFuzzyAhpWfa*` tests cover `/api/analysis/fuzzy-ahp/wfa`, a different endpoint.

## 6. `/api/summary` — 4 endpoints

| Method | Path | Roles | Error codes | Happy | RBAC | Validation |
|---|---|---|---|---|---|---|
| GET | `/api/summary/dashboard-analytics` | Admin, Management | 400, 401, 403 | covered | covered | covered |
| GET | `/api/summary/reports` | Admin, Management | 400, 401, 403 | covered | covered | covered |
| GET | `/api/summary/reports/pdf` | Admin, Management | 400 | covered | **gap** | partial |
| GET | `/api/summary/reports/excel` | Admin, Management | 400 | covered | **gap** | partial |

## 7. `/api/discipline` — 4 endpoints

| Method | Path | Authorization | Error codes | Happy | RBAC | Validation |
|---|---|---|---|---|---|---|
| GET | `/api/discipline/user/:userId` | in controller | 403, 404 | **gap** | **gap** | **gap** |
| GET | `/api/discipline/all` | in controller | 403 | covered | partial | n/a |
| GET | `/api/discipline/config` | in controller | 403 | **gap** | **gap** | n/a |
| POST | `/api/discipline/test-ahp` | `roleGuard` | 400, 403 | **gap** | **gap** | **gap** |

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
| PATCH | `/api/settings/operational` | Admin, Management | 400, 401, 403 | **gap** | **gap** | **gap** |

The read path is well covered; the **mutation path has none**.

## 10. `/api` reference data — 4 endpoints

| Method | Path | Roles | Error codes | Happy | RBAC | Validation |
|---|---|---|---|---|---|---|
| GET | `/api/roles` | Admin, Management | 401, 403 | **gap** | **gap** | n/a |
| GET | `/api/programs` | Admin, Management | 401, 403 | **gap** | **gap** | n/a |
| GET | `/api/positions` | Admin, Management | 401, 403 | **gap** | **gap** | **gap** |
| GET | `/api/divisions` | Admin, Management | 401, 403 | **gap** | **gap** | n/a |

No behavioral coverage at all. These are low-risk read-only dropdown endpoints, which is why they are not in the Phase 0b priority set.

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
| Users — controller response bodies | open | needs model-level mocking |
| Attendance — `check-in` / `checkout` controller behavior | open | highest remaining risk |
| WFA — 3 endpoints | open | — |

**Attendance authorization is now fully pinned.** All 23 endpoints are asserted: the 7 self-service routes reach their controller for a plain User; the 15 privileged routes return 403 for a plain User and 200 for Admin and Management; the lazy-loaded `test-weighted-prediction` trigger is confirmed Admin/Management-only; and unauthenticated requests are refused on both classes of route.

That closes the RBAC axis for the whole module, including all nine operational triggers that mutate final attendance state — the property most at risk of silent drift during extraction.

Remaining highest-risk gaps, in order:

1. `POST /api/attendance/checkout/:id` — final-state mutation. Routing and authorization are pinned; **controller behavior is not**.
2. `POST /api/attendance/check-in` — only duplicate-safety behavior is covered, by `attendanceDuplicateSafety.test.js`.
3. `PATCH /api/settings/operational` — mutation feeding the auto-checkout job, untested.
4. Users controller response bodies, per the note in section 2.
5. WFA's three endpoints, which still have only route-exposure coverage.

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
| **F7** | **13 controller responses across 7 files return `error: error.message` directly instead of calling `next(err)`. These bypass the global handler entirely, so the production 500-masking in `errorHandler.js:66-70` never applies to them — internal error text can reach clients in production.** | `analysis` ×1, `attendance` ×5, `auth` ×1, `discipline` ×1, `health` ×1, `user` ×2, `wfa` ×2 |
| F8 | Four responses use a bare `{ message }` envelope with no `success` flag, breaking the dominant convention | `src/controllers/user.controller.js:45,50,59,69` |
| F9 | `wfa.controller.js` imports `../models/settings.model.js` directly, bypassing `models/index.js` where associations are registered | `src/controllers/wfa.controller.js` |
| F10 | Authorization for `/api/discipline` lives in the controller body for three routes and in `roleGuard` middleware for the fourth. Enforced correctly in both cases, but inconsistently located | `src/controllers/discipline.controller.js:26-30,163,307` |
| F11 | `DELETE /api/attendance/:id` applies `verifyToken` a second time, though `router.use(verifyToken)` already covers it | `src/routes/attendance.routes.js` |

**F7 is the most serious.** It is an information-disclosure risk in production, not merely an architectural inconsistency, and it is invisible to the existing tests because they run with `env: 'test'`. It should be raised as its own issue rather than absorbed into a migration PR.
