# Current Backend Map

**Status:** Phase 0a deliverable for INF-252
**Measured at:** commit `5ce2f69` (tip of `develop`), 2026-07-26
**Scope:** every route mounted by `src/routes/index.js`, the controller it resolves to, the models that controller touches, the background jobs writing the same tables, and the external services involved.

This document describes the backend **as it is**, not as it should be. The target structure lives in [target-modular-mvc.md](target-modular-mvc.md).

---

## 1. How requests reach a controller

```text
src/server.js          TZ=Asia/Jakarta, DB auth, cron start, listen
  └── src/app.js       security → CORS → body → Swagger → routes → errorHandler
        └── src/routes/index.js
              ├── GET  /livez                     health.controller.getLiveness
              ├── GET  /health                    health.controller.getReadiness
              ├── /api/auth        → auth.routes.js
              ├── /api/attendance  → attendance.routes.js
              ├── /api/users       → users.routes.js
              ├── /api/summary     → summary.routes.js
              ├── /api            → referenceData.routes.js
              ├── /api/bookings    → booking.routes.js
              ├── /api/wfa         → wfa.routes.js
              ├── /api/discipline  → discipline.routes.js
              ├── /api/analysis    → analysis.routes.js
              ├── /api/settings    → settings.routes.js
              └── *                 404 → { message: 'Route not found' }
```

`src/routes/index.js` is the **only** mount point. No route is registered anywhere else. This is what makes per-use-case cutover viable.

`src/routes/contribution.routes.js` exists but its entire contents are commented out, and it is not imported by `index.js`. It contributes zero routes.

## 2. Endpoint totals

| Route file | Endpoints |
|---|---|
| `attendance.routes.js` | 23 |
| `users.routes.js` | 6 |
| `booking.routes.js` | 5 |
| `analysis.routes.js` | 5 |
| `summary.routes.js` | 4 |
| `referenceData.routes.js` | 4 |
| `discipline.routes.js` | 4 |
| `auth.routes.js` | 4 |
| `wfa.routes.js` | 3 |
| `settings.routes.js` | 2 |
| `contribution.routes.js` | 0 (fully commented out) |
| **Route-file subtotal** | **60** |

Plus two endpoints registered directly on the root router in `src/routes/index.js`:

| Endpoint | |
|---|---|
| `GET /livez` | process liveness |
| `GET /health` | dependency readiness |
| **Health subtotal** | **2** |
| **Total mounted endpoints** | **62** |

**Read the denominators carefully.** Elsewhere in these documents, "60" always means the route-file subtotal, and the migration-scope figure "37 of 60" counts priority-module endpoints against it. Health endpoints are deliberately outside migration scope — they have no feature module — but they are part of the 62 mounted routes. Caught in review of PR #96, where the mixed denominators read as an inconsistency.

---

## 3. `/api/auth` — `src/routes/auth.routes.js`

Authentication is applied per route, not at router level.

| Method | Path | Auth | Roles | Controller fn |
|---|---|---|---|---|
| POST | `/api/auth/login` | none (`loginRateLimit`) | — | `login` |
| POST | `/api/auth/refresh` | none | — | `refresh` |
| POST | `/api/auth/logout` | none | — | `logout` |
| GET | `/api/auth/me` | `verifyToken` | any | `getCurrentUser` |

**Models touched:** `User`, `Photo`, `Role`, `Program`, `Position`, `Division`, `AttendanceCategory`, `AuthSession`
**Jobs writing the same tables:** none
**External services:** none

`/refresh` and `/logout` intentionally carry no `verifyToken` — they operate on the refresh cookie or session record rather than an access token.

---

## 4. `/api/users` — `src/routes/users.routes.js`

Every route: `verifyToken` then `roleGuard`.

| Method | Path | Roles | Extra middleware | Controller fn |
|---|---|---|---|---|
| GET | `/api/users` | Admin, Management | — | `getAllUsers` |
| GET | `/api/users/:id` | Admin, Management | — | `getUserById` |
| POST | `/api/users` | Admin, Management | `upload.single('face_photo')`, `validateCreateUser`, `validate` | `createUser` |
| POST | `/api/users/:id/photo` | Admin, Management | `upload.single('face_photo')` | `uploadUserPhoto` |
| PATCH | `/api/users/:id` | Admin, Management | `validateUpdateUser`, `validate` | `updateUser` |
| DELETE | `/api/users/:id` | Admin | — | `deleteUser` |

**Models touched:** `User`, `Photo`, `Role`, `Program`, `Position`, `Division`, `AttendanceCategory`, `Location`, plus a direct `sequelize` import for transactions
**Jobs writing the same tables:** `createGeneralAlpha.job.js` reads `User` and `Role`
**External services:**

| Service | Role | Evidence |
|---|---|---|
| **DigitalOcean Spaces** | **Primary** photo storage — upload and cleanup | `src/config/spaces.js`, imported at `user.controller.js:16` as `buildUserProfilePhotoKey`, `uploadBufferToSpaces`, `deleteSpacesObject`; used at lines 218-223 and 276-278 |
| Cloudinary | Legacy-photo deletion fallback only, via a lazy dynamic import | `user.controller.js:20-21` |

An earlier version of this document listed Cloudinary as the only storage dependency. That was wrong and would have carried a real migration risk: extracting the Users module against this map could have left the **primary** storage adapter and its environment contract behind. Caught in review of PR #96.

`user.controller.js` imports `sequelize` directly to orchestrate its own transactions. `discipline.controller.js` does the same — see section 9. Those are the two.

---

## 5. `/api/attendance` — `src/routes/attendance.routes.js`

`router.use(verifyToken)` covers all 23 routes. Roles below are the additional `roleGuard`.

| Method | Path | Roles | Extra middleware | Controller fn |
|---|---|---|---|---|
| POST | `/location-event` | any | `locationEventValidation`, `validate` | `logLocationEvent` |
| GET | `/` | Admin, Management | — | `getAllAttendances` |
| GET | `/today-locations` | Admin, Management | `todayLocationsValidation` | `getTodayLocations` |
| GET | `/geofence-evidence` | Admin, Management | `dashboardAnalyticsValidation` | `getGeofenceEvidence` |
| POST | `/check-in` | any | `checkInValidation`, `validate` | `checkIn` |
| POST | `/checkout/:id` | any | `checkOutValidation`, `validate` | `checkOut` |
| GET | `/history/personal/pdf` | any | — | `previewMyAttendanceReportPdf` |
| GET | `/history/export.pdf` | any | — | `exportMyAttendanceReportPdf` |
| GET | `/history` | any | — | `getAttendanceHistory` |
| GET | `/status-today` | any | — | `getAttendanceStatus` |
| GET | `/debug-checkin-time` | Admin, Management | — | `debugCheckInTime` |
| POST | `/manual-auto-checkout` | Admin, Management | — | `manualAutoCheckout` |
| GET | `/auto-checkout-settings` | Admin, Management | — | `getAutoCheckoutSettings` |
| POST | `/manual-resolve-wfa-bookings` | Admin, Management | — | `manualResolveWfaBookings` |
| POST | `/manual-general-alpha` | Admin, Management | — | `manualGeneralAlphaForDate` |
| POST | `/manual-resolve-wfa-for-date` | Admin, Management | — | `manualResolveWfaForDate` |
| POST | `/manual-smart-auto-checkout` | Admin, Management | — | `manualSmartAutoCheckoutForDate` |
| POST | `/research-trigger/daily` | Admin, Management | — | `triggerResearchAttendanceDaily` |
| POST | `/research-trigger/full-day` | Admin, Management | — | `triggerResearchAttendanceFullDay` |
| POST | `/test-weighted-prediction` | Admin, Management | inline lazy-import wrapper | `testWeightedPrediction` |
| DELETE | `/:id` | Admin, Management | redundant second `verifyToken` | `deleteAttendance` |
| GET | `/smart-config` | Admin, Management | — | `getSmartEngineConfig` |
| GET | `/enhanced-auto-checkout-settings` | Admin, Management | — | `getEnhancedAutoCheckoutSettings` |

**Models touched:** `Attendance`, `Booking`, `Location`, `Settings`, `AttendanceCategory`, `AttendanceStatus`, `BookingStatus`, `User`, `Role`, `LocationEvent`
**Controllers involved:** `attendance.controller.js` (2291 LOC) and `researchAttendance.controller.js` (29 LOC, delegates to `researchAttendanceTrigger.service.js`)
**Jobs writing the same tables:**

| Job | Schedule | Writes |
|---|---|---|
| `createGeneralAlpha.job.js` | 23:55 Mon–Fri | `Attendance` (alpha for absent users) |
| `resolveWfaBookings.job.js` | 23:50 daily | `Booking`, `Attendance` |
| `autoCheckout.job.js` | every 30 min + 23:45 daily | `Attendance` |

**External services:** none directly

Nine of the 23 routes are operational or debug triggers (`manual-*`, `research-trigger/*`, `debug-*`, `test-*`) rather than end-user endpoints. They mutate final attendance state and therefore belong to the same bounded context.

---

## 6. `/api/bookings` — `src/routes/booking.routes.js`

`router.use(verifyToken)` covers all routes.

| Method | Path | Roles | Extra middleware | Controller fn |
|---|---|---|---|---|
| POST | `/api/bookings` | any | `createBookingValidation`, `validate` | `createBooking` |
| PATCH | `/api/bookings/:id` | Admin, Management | `updateStatusValidation`, `validate` | `updateBookingStatus` |
| GET | `/api/bookings` | Admin, Management | — | `getAllBookings` |
| GET | `/api/bookings/history` | any | — | `getBookingHistory` |
| DELETE | `/api/bookings/:id` | Admin, Management | — | `deleteBooking` |

**Models touched:** `Booking`, `Location`, `BookingStatus`, `User`, `Position`, `Role`
**Jobs writing the same tables:** `resolveWfaBookings.job.js` (alpha for unused WFA, rejects expired pending), `autoCheckout.job.js` reads `Booking`
**External services:** Geoapify via `axios`

---

## 7. `/api/wfa` — `src/routes/wfa.routes.js`

`router.use(verifyToken)` covers all routes.

| Method | Path | Roles | Controller fn |
|---|---|---|---|
| GET | `/api/wfa/recommendations` | any | `getWfaRecommendations` |
| GET | `/api/wfa/ahp-config` | any | `getWfaAhpConfig` |
| POST | `/api/wfa/test-ahp` | Admin, Management | `testFuzzyAhp` |

**Models touched:** imports `../models/settings.model.js` **directly**, bypassing `models/index.js` where associations are registered
**Jobs writing the same tables:** none
**External services:** Geoapify via `axios`; FAHP engine via `src/utils/fuzzyAhpEngine.js`; geofence via `src/utils/geofence.js`

`/api/wfa` and `/api/bookings` are the same bounded context — WFA location booking. ADR-009 assigns both to a single `bookings` module while keeping the public paths unchanged.

---

## 8. `/api/summary` — `src/routes/summary.routes.js`

| Method | Path | Auth | Roles | Extra middleware | Controller fn |
|---|---|---|---|---|---|
| GET | `/api/summary/dashboard-analytics` | `verifyToken` | Admin, Management | `dashboardAnalyticsValidation` | `getDashboardAnalytics` |
| GET | `/api/summary/reports` | `verifyToken` | Admin, Management | — | `getSummaryReport` |
| GET | `/api/summary/reports/pdf` | `verifyToken` | Admin, Management | — | `getSummaryReportPdf` |
| GET | `/api/summary/reports/excel` | `verifyToken` | Admin, Management | — | `getSummaryReportExcel` |

**Models touched:** none directly — delegates to `src/services/summaryReport.service.js` (840 LOC) and `src/utils/dashboardAnalytics.js` (382 LOC)
**Jobs writing the same tables:** reads tables written by all three attendance jobs
**External services:** none

At 177 LOC, `summary.controller.js` is already close to the target shape: thin controller over a service.

---

## 9. `/api/discipline` — `src/routes/discipline.routes.js`

`router.use(verifyToken)` covers all routes.

| Method | Path | `roleGuard` | Authorization actually enforced | Controller fn |
|---|---|---|---|---|
| GET | `/api/discipline/user/:userId` | **none** | in controller, `discipline.controller.js:26-30` — Admin, Management, or own record | `getUserDisciplineIndex` |
| GET | `/api/discipline/all` | **none** | in controller, `discipline.controller.js:163` — Admin, Management | `getAllDisciplineIndices` |
| GET | `/api/discipline/config` | **none** | in controller, `discipline.controller.js:307` — Admin, Management | `getDisciplineConfig` |
| POST | `/api/discipline/test-ahp` | Admin, Management | middleware | `testDisciplineAhp` |

**Models touched:** `Attendance`, `User`, `Role`, plus a direct `sequelize` import
**Jobs writing the same tables:** all three attendance jobs write `Attendance`
**External services:** none

Authorization is **not** a gap here — it is enforced, and returns 403 as expected. But it lives in two different places depending on the endpoint: middleware for one route, controller body for the other three. Under the target architecture, the route owns authorization wiring.

---

## 10. `/api/analysis` — `src/routes/analysis.routes.js`

`router.use(verifyToken)`; every route additionally `roleGuard(['Admin', 'Management'])`.

| Method | Path | Extra middleware | Controller fn |
|---|---|---|---|
| GET | `/api/analysis/fuzzy-ahp` | — | `getFuzzyAhpAnalysis` |
| GET | `/api/analysis/fuzzy-ahp/discipline` | `disciplineFahpValidation`, `validate` | `getDisciplineFahp` |
| GET | `/api/analysis/fuzzy-ahp/wfa` | `wfaFahpValidation`, `validate` | `getWfaFahp` |
| GET | `/api/analysis/fuzzy-ahp/smart-ac` | — | `getSmartAcFahp` |
| GET | `/api/analysis/fuzzy-ahp/dashboard` | `fuzzyAhpDashboardRecapValidation`, `validate` | `getFuzzyAhpDashboardRecap` |

**Models touched:** none directly — delegates to `src/services/fuzzyAhpAnalysis.service.js` (1061 LOC)
**Jobs writing the same tables:** reads attendance tables written by all three jobs
**External services:** Geoapify via the service

At 140 LOC over 5 endpoints, `analysis.controller.js` is the thinnest controller in the codebase and the closest existing example of the target shape.

---

## 11. `/api/settings` — `src/routes/settings.routes.js`

`router.use(verifyToken)`; both routes `roleGuard(['Admin', 'Management'])`.

| Method | Path | Extra middleware | Controller fn |
|---|---|---|---|
| GET | `/api/settings/operational` | — | `getOperationalSettings` |
| PATCH | `/api/settings/operational` | `operationalSettingsPatchValidation` | `patchOperationalSettings` |

**Models touched:** none — delegates to `src/services/operationalSettings.service.js`
**Jobs writing the same tables:** `autoCheckout.job.js` reads operational settings
**External services:** none

At 22 LOC this is already a pure delegating controller. It also owns the only feature-local validator in the codebase, `src/middlewares/settings.validator.js` — the closest existing precedent for feature-owned validation.

---

## 12. `/api` reference data — `src/routes/referenceData.routes.js`

Each route carries `verifyToken` and `roleGuard(['Admin', 'Management'])` individually. Mounted at `/api`, so paths are unprefixed.

| Method | Path | Controller fn |
|---|---|---|
| GET | `/api/roles` | `getRoles` |
| GET | `/api/programs` | `getPrograms` |
| GET | `/api/positions` | `getPositions` (optional program filter) |
| GET | `/api/divisions` | `getDivisions` |

**Models touched:** `Role`, `Program`, `Position`, `Division`
**Jobs writing the same tables:** none
**External services:** none

---

## 13. Health endpoints

| Method | Path | Auth | Controller fn |
|---|---|---|---|
| GET | `/livez` | none | `getLiveness` — process liveness |
| GET | `/health` | none | `getReadiness` — dependency readiness |

Mounted directly on the root router, outside `/api`.

---

## 14. Cross-cutting middleware

| File | Role |
|---|---|
| `src/middlewares/authJwt.js` | JWT verification via cookie or Bearer, sliding TTL |
| `src/middlewares/roleGuard.js` | RBAC — Admin, Management, User |
| `src/middlewares/validator.js` | **All** transport validation except settings — shared across every feature |
| `src/middlewares/settings.validator.js` | The only feature-local validator |
| `src/middlewares/errorHandler.js` | Single global error exit for the whole API |
| `src/middlewares/requestLogger.js` | Request ID and structured logging |
| `src/middlewares/security.js` | Helmet, CORS, rate limits including `loginRateLimit` |

`validator.js` is a single shared module holding validation chains for attendance, auth, booking, user, analysis, and dashboard concerns. Under the target architecture each of those moves into its owning module.

## 15. Layer-first folders and their sizes

| Folder | Contents |
|---|---|
| `src/controllers` | 13 files, 6751 LOC |
| `src/services` | 5 files, 3466 LOC — analytics and reporting only |
| `src/utils` | 22 files, 3201 LOC — mixed concerns |
| `src/jobs` | 3 state-changing jobs |
| `src/models` | Sequelize models plus `migrations/` and `seeders/` |

There is **no service layer for attendance, booking, or user**. Those business rules live inside their controllers. There is no repository, query-object, or mapper layer anywhere.
