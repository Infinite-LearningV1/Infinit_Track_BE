# INF-232 — Backend Production Endpoint and Database Operation Matrix

Date: 2026-07-08
Branch/worktree: `fix/backend-production-endpoint-matrix` at `a462663`
Scope: release gate mapping before backend is considered production-usable by Android, Web FE, Admin/Management dashboard, and operator/research demo flows.

> This document is a production-readiness matrix and handoff artifact. It does **not** claim production readiness by itself. Production readiness still requires fresh runtime smoke evidence against the selected production base URL and a manual-first database/migration decision.

## 1. Fact

- Main checkout `E:/test/Infinit_Track_BE` was on `develop` at `a462663`, but dirty (`AGENTS.md`, `docker-compose.yml`, `src/middlewares/validator.js`, `.claude/tmp/`). It was treated as read-only validation surface.
- INF-232 work was isolated in `C:/Users/Febriyadi/.claude/worktrees/backend-production-endpoint-matrix` on branch `fix/backend-production-endpoint-matrix`, clean at creation, based on `develop` `a462663`.
- Canonical route mount points are defined in `src/routes/index.js`:
  - public operational: `GET /livez`, `GET /health`
  - API: `/api/auth`, `/api/attendance`, `/api/users`, `/api/summary`, `/api`, `/api/bookings`, `/api/wfa`, `/api/discipline`, `/api/analysis`, `/api/settings`
- `src/routes/auth.routes.js` exposes login, refresh, logout, and current-user session endpoints. `GET /api/auth/me` is protected by `verifyToken`.
- `src/routes/attendance.routes.js` applies `verifyToken` to all attendance endpoints and then uses route-level `roleGuard` for Admin/Management surfaces.
- `src/routes/booking.routes.js` applies `verifyToken` to all booking endpoints. User booking creation/history is authenticated; approval/list/delete are Admin/Management.
- `src/routes/summary.routes.js`, `src/routes/users.routes.js`, `src/routes/settings.routes.js`, and `src/routes/analysis.routes.js` are Admin/Management oriented.
- `src/routes/discipline.routes.js` applies `verifyToken` globally. Route-level `roleGuard` exists only on `/test-ahp`; `discipline.controller.js` enforces own-data/Admin/Management access for `/user/:userId`, but route-level role evidence is not uniform for `/all` and `/config`.
- Production runtime contract is image-first Docker Compose via DOCR image `registry.digitalocean.com/infinit-track/infinit-track-backend:${BACKEND_IMAGE_TAG}` in `docker-compose.yml`.
- `docker-compose.yml` fails fast when `BACKEND_IMAGE_TAG` is missing and reads `deploy/env/backend.production.env` by default.
- Production workflow `.github/workflows/deploy-production.yml` builds/pushes immutable DOCR image on `master`, SSHes to droplet, runs `docker compose up -d --force-recreate app`, executes `npm run migrate`, runs droplet verification, checks `npm run migrate:status`, then runs `npm run smoke-test "$PRODUCTION_PUBLIC_BASE_URL"`.
- `scripts/smoke-test.js` currently checks unauthenticated liveness/readiness/security/CORS/auth-protection surfaces, not authenticated business happy paths.
- Required production env variables in `src/config/index.js`: `JWT_SECRET`, `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`; additional runtime dependencies are documented in `.env.example`.
- Sequelize MySQL runtime uses timezone `+07:00` in `src/config/database.js`.
- Operational attendance settings are DB-backed via `settings` and `src/utils/settings.js`. Five canonical operational keys are: `attendance.geofence.radius_default_m`, `attendance.auto_checkout.idle_min`, `attendance.auto_checkout.tbuffer_min`, `attendance.auto_checkout.late_tolerance_min`, `checkout.fallback_time`.
- Migration `20260424000000-bootstrap-operational-settings.cjs` inserts missing operational setting rows using defaults or legacy env values.
- Migration `20260511000000-create-auth-sessions.cjs` creates `auth_sessions`, required for stateful auth/session validity.
- Migration `20260707010000-create-attendance-session-states.cjs` creates and seeds `attendance_session_states` used by the status-today contract.
- Migration `20260403000000-add-unique-constraint-attendance.cjs` cleans duplicate attendance rows before adding a unique `(user_id, attendance_date)` index; this is manual-first/high-risk in production.
- Seeder files under `src/models/seeders` are stubs/commented and cannot be assumed to seed production master data.

## 2. Assumption

- Android must consume `auth`, `attendance/status-today`, `attendance/check-in`, `attendance/checkout/:id`, `attendance/history`, personal PDF export/preview, WFA booking history/create, WFA recommendations, and location-event surfaces.
- Web FE must consume auth/session endpoints, dashboard/summary/report endpoints, admin user/reference/booking management endpoints, and operational settings.
- Admin/Management dashboard must treat report/export, dashboard analytics, FAHP/discipline analysis, booking approval, user CRUD, reference data, and operational settings as privileged surfaces.
- Operator/research demo flows may need research-trigger/manual job endpoints, but those should remain Admin/Management-only and should not be treated as normal consumer production endpoints.
- Production base URL, domain/IP mapping, managed MySQL endpoint, credentials, and smoke credentials are provided outside the repo through GitHub environment variables, droplet env file, or operator secret store.

## 3. Mismatch / Needs Verification

- **Production smoke gap:** `npm run smoke-test <url>` verifies liveness/readiness/security/CORS/auth protection but does not authenticate as User/Admin/Management and does not prove Android/Web FE business flows.
- **Migration policy mismatch:** `.github/workflows/deploy-production.yml` executes `npm run migrate` automatically on production. Repo rules mark migrations as manual-first. INF-232 release gate should require explicit human approval before letting this run against production.
- **Seed/master-data gap:** production-critical master data (`roles`, `users`, `attendance_categories`, `attendance_statuses`, `booking_status`, `locations`) is required by endpoints, but current seeders are stubs/commented. Actual production seed state needs DB verification.
- **Discipline route authorization evidence:** route file does not apply route-level Admin/Management guard to `/api/discipline/all` and `/api/discipline/config`; controller evidence must be reviewed before production exposure is accepted.
- **OpenAPI sync needs targeted diff:** OpenAPI contains many current surfaces, including auth, attendance, bookings, WFA, summary, analysis, users, research triggers. It still needs a route-vs-spec completeness check for manual/debug/settings/reference endpoints before INF-232 closure.
- **Runtime path drift risk:** docs say canonical runtime is droplet Docker Compose. `.do/` and `k8s/` remain in repo as legacy/historical surfaces and must not be mistaken for active backend production runtime without live evidence.
- **DO MCP deploy not executed:** no production deploy was performed in this mapping pass. DigitalOcean deploy evidence remains Needs Verification.
- **Consumer expectation gap:** Android/Web FE exact production route usage has not been rechecked against their current code in this pass.

## 4. Risk

- **High — migration/data risk:** production `npm run migrate` may mutate attendance/auth/session/settings tables. The duplicate cleanup in `20260403000000-add-unique-constraint-attendance.cjs` can delete older duplicate attendance rows by design.
- **High — auth/session risk:** `auth_sessions` is required for valid sessions. Missing table or failed migration breaks protected endpoints even if JWT signing works.
- **High — master-data risk:** missing/incorrect category/status/location rows can break check-in, WFA booking, reporting, and dashboard semantics.
- **High — manual trigger exposure:** manual job and research-trigger endpoints mutate attendance/booking data and must remain Admin/Management-only/operator-only; they should not be consumer-normal endpoints.
- **Medium — smoke false positive:** current smoke can pass while authenticated business flows fail.
- **Medium — docs/runtime mismatch:** production workflow and docs include automatic migration while repo policy says migration is manual-first.
- **Medium — role exposure:** discipline and debug/config routes need explicit auth/role verification in runtime smoke or review.
- **Medium — external dependency risk:** WFA recommendations/FAHP WFA depend on Geoapify; photo/user upload/report/export may depend on Cloudinary/Spaces and PDF generation paths.

## 5. Endpoint production matrix

Legend:
- Criticality: **must-have**, **optional**, **operator-only**, **forbidden-public**.
- Smoke: expected unauthenticated/authorized status or expected behavior class. `NV` = Needs Verification with authenticated runtime credentials.

| Endpoint | Owner domain | Consumer | Auth/Role | Criticality | Expected production status | Smoke expectation | Notes |
|---|---|---|---|---|---|---|---|
| `GET /livez` | Ops | Load balancer/operator | Public | must-have | Online | `200`, `{status:"OK"}` | Liveness only, no DB guarantee. |
| `GET /health` | Ops | Deploy gate/operator | Public | must-have | Online | `200` with `ready:true`; `503` if deps not ready | Probes DB and scheduler readiness. |
| `GET /docs/` | API docs | Admin/operator | Protected by app docs middleware | forbidden-public | Not anonymous-public | `401/403` anonymous | Current smoke expects anonymous blocked. |
| `GET /docs/openapi.yaml` | API docs | Admin/operator | Protected by app docs middleware | forbidden-public | Not anonymous-public | `401/403` anonymous | Current smoke expects anonymous blocked. |
| `POST /api/auth/login` | Auth/session | Android, Web FE, Admin | Public + rate limit | must-have | Online | invalid credentials `400/401/422`; valid login `200` NV | Valid login requires test account. |
| `POST /api/auth/refresh` | Auth/session | Android, Web FE | Refresh token/cookie/body | must-have | Online | invalid/missing refresh rejected; valid refresh `200` NV | `X-Client-Type` matters for client behavior. |
| `POST /api/auth/logout` | Auth/session | Android, Web FE | Access or refresh token context | must-have | Online | missing/invalid should not create active session; valid logout NV | Session revocation must affect `auth_sessions`. |
| `GET /api/auth/me` | Auth/session | Android, Web FE | User/Admin/Management | must-have | Online | anonymous `401/403`; valid token `200` NV | Smoke currently checks anonymous block. |
| `POST /api/auth/register` | Auth/session | None | Not mounted | forbidden-public | Closed | `404` anonymous | Current smoke checks register route closed. |
| `GET /api/attendance/status-today` | Attendance core | Android, Web FE | Any authenticated user | must-have | Online | anonymous `401/403`; user `200` NV | Source of truth for today's UI state. |
| `POST /api/attendance/check-in` | Attendance core | Android primary, Web optional | Any authenticated user | must-have | Online | anonymous `401/403`; valid WFO/WFH/WFA behavior NV | Mutates attendance final state. |
| `POST /api/attendance/checkout/:id` | Attendance core | Android primary, Web optional | Any authenticated owner/scope | must-have | Online | anonymous `401/403`; valid checkout NV | Mutates attendance final state. |
| `GET /api/attendance/history` | Attendance history | Android, Web FE | Any authenticated user | must-have | Online | anonymous `401/403`; user `200` NV | User-scoped history contract. |
| `GET /api/attendance/history/personal/pdf` | Report/export | Android | Any authenticated user | must-have for Android PDF preview | Online | anonymous `401/403`; user PDF response NV | Backend-generated personal report preview. |
| `GET /api/attendance/history/export.pdf` | Report/export | Android/Web | Any authenticated user | must-have if client exposes download | Online | anonymous `401/403`; user PDF attachment NV | Backend-generated personal report export. |
| `POST /api/attendance/location-event` | Attendance/geofence | Android | Any authenticated user | must-have if geofence/smart AC enabled | Online | anonymous `401/403`; valid event `200/201` NV | Feeds smart attendance evidence. |
| `GET /api/attendance` | Attendance admin | Admin/Management dashboard | Admin/Management | must-have admin | Online | anonymous `401/403`; User `403`; Admin `200` NV | Admin list/search. |
| `DELETE /api/attendance/:id` | Attendance admin | Admin/Management | Admin/Management | operator-only | Online but restricted | anonymous `401/403`; User `403`; Admin expected guarded | Destructive attendance mutation. |
| `GET /api/attendance/today-locations` | Dashboard map | Web FE dashboard/Admin | Admin/Management | must-have dashboard | Online | anonymous `401/403`; Admin `200` NV | Current replacement for non-existent dashboard-map. |
| `GET /api/attendance/geofence-evidence` | Dashboard evidence | Admin/Management dashboard | Admin/Management | optional/dashboard | Online | anonymous `401/403`; Admin `200` NV | Historical geofence context only. |
| `GET /api/attendance/debug-checkin-time` | Debug | Operator/Admin | Admin/Management | operator-only | Online but restricted | anonymous `401/403`; User `403` NV | Should not be consumer-normal. |
| `POST /api/attendance/manual-auto-checkout` | Manual job | Operator/Admin | Admin/Management | operator-only | Online but restricted/manual-first | anonymous `401/403`; Admin execution only after approval | Mutates attendance final state. |
| `GET /api/attendance/auto-checkout-settings` | Debug/settings | Operator/Admin | Admin/Management | operator-only | Online but restricted | anonymous `401/403`; Admin `200` NV | Debug/visibility surface. |
| `POST /api/attendance/manual-resolve-wfa-bookings` | Manual job | Operator/Admin | Admin/Management | operator-only | Online but restricted/manual-first | anonymous `401/403`; Admin execution only after approval | Mutates WFA booking/attendance state. |
| `POST /api/attendance/manual-general-alpha` | Manual job | Operator/Admin | Admin/Management | operator-only | Online but restricted/manual-first | anonymous `401/403`; Admin execution only after approval | Creates alpha final-state rows. |
| `POST /api/attendance/manual-resolve-wfa-for-date` | Manual job | Operator/Admin | Admin/Management | operator-only | Online but restricted/manual-first | anonymous `401/403`; Admin execution only after approval | Date-targeted WFA resolution. |
| `POST /api/attendance/manual-smart-auto-checkout` | Manual job | Operator/Admin | Admin/Management | operator-only | Online but restricted/manual-first | anonymous `401/403`; Admin execution only after approval | Date-targeted smart checkout. |
| `POST /api/attendance/research-trigger/daily` | Research/demo | Operator/research | Admin/Management + feature flag | operator-only | Disabled unless explicitly enabled | anonymous `401/403`; if disabled `409`/guarded NV | Not normal production consumer flow. |
| `POST /api/attendance/research-trigger/full-day` | Research/demo | Operator/research | Admin/Management + feature flag | operator-only | Disabled unless explicitly enabled | anonymous `401/403`; if disabled `409`/guarded NV | Not normal production consumer flow. |
| `POST /api/attendance/test-weighted-prediction` | Debug/test | Operator/Admin | Admin/Management | operator-only | Prefer not consumer-public | anonymous `401/403`; Admin-only NV | Test-only endpoint. |
| `GET /api/attendance/smart-config` | Debug/config | Operator/Admin | Admin/Management | operator-only | Online but restricted | anonymous `401/403`; Admin `200` NV | Visibility into smart engine config. |
| `GET /api/attendance/enhanced-auto-checkout-settings` | Debug/settings | Operator/Admin | Admin/Management | operator-only | Online but restricted | anonymous `401/403`; Admin `200` NV | Debug/visibility surface. |
| `POST /api/bookings` | WFA booking | Android, Web FE | Any authenticated user | must-have WFA | Online | anonymous `401/403`; valid future booking `201/200` NV | Same-day rejection expected by collection docs. |
| `GET /api/bookings/history` | WFA booking/history | Android, Web FE | Any authenticated user | must-have WFA | Online | anonymous `401/403`; user `200` NV | Recent additive summary contract. |
| `GET /api/bookings` | WFA admin | Admin/Management | Admin/Management | must-have admin | Online | anonymous `401/403`; User `403`; Admin `200` NV | Approval queue/list. |
| `PATCH /api/bookings/:id` | WFA approval | Admin/Management | Admin/Management | must-have admin | Online | anonymous `401/403`; User `403`; Admin valid update NV | Booking approval semantics are backend authority. |
| `DELETE /api/bookings/:id` | WFA admin | Admin/Management | Admin/Management | operator-only/admin | Online but restricted | anonymous `401/403`; User `403`; Admin NV | Destructive booking mutation. |
| `GET /api/wfa/recommendations` | WFA recommendation | Android, Web FE | Any authenticated user | must-have if WFA shown | Online if Geoapify/env OK | anonymous `401/403`; user `200` or provider error shape NV | External Geoapify dependency. |
| `GET /api/wfa/ahp-config` | WFA config | Android/Web/Admin | Any authenticated user | optional | Online | anonymous `401/403`; user `200` NV | Exposes current AHP config. |
| `POST /api/wfa/test-ahp` | Debug/test | Operator/Admin | Admin/Management | operator-only | Online but restricted | anonymous `401/403`; User `403` NV | Test-only FAHP. |
| `GET /api/summary/dashboard-analytics` | Dashboard/report | Admin/Management dashboard | Admin/Management | must-have dashboard | Online | anonymous `401/403`; User `403`; Admin `200` NV | Dashboard cockpit aggregate. |
| `GET /api/summary/reports` | Dashboard/report | Admin/Management dashboard | Admin/Management | must-have admin | Online | anonymous `401/403`; Admin `200` NV | Canonical report list. |
| `GET /api/summary/reports/pdf` | Dashboard/report export | Admin/Management dashboard | Admin/Management | must-have if export exposed | Online | anonymous `401/403`; Admin PDF NV | Official report export. |
| `GET /api/summary/reports/excel` | Dashboard/report export | Admin/Management dashboard | Admin/Management | must-have if export exposed | Online | anonymous `401/403`; Admin Excel NV | Official report export. |
| `GET /api/users` | User admin | Admin/Management | Admin/Management | must-have admin | Online | anonymous `401/403`; User `403`; Admin `200` NV | User directory. |
| `GET /api/users/:id` | User admin | Admin/Management | Admin/Management | must-have admin | Online | anonymous `401/403`; Admin `200` NV | User detail. |
| `POST /api/users` | User admin | Admin/Management | Admin/Management | must-have admin | Online but restricted | anonymous `401/403`; User `403`; Admin create NV | Requires upload/cloud storage readiness if `face_photo`. |
| `POST /api/users/:id/photo` | User admin/photo | Admin/Management | Admin/Management | optional unless face/photo required | Online but restricted | anonymous `401/403`; Admin upload NV | Cloudinary/Spaces dependency risk. |
| `PATCH /api/users/:id` | User admin | Admin/Management | Admin/Management | must-have admin | Online but restricted | anonymous `401/403`; User `403`; Admin update NV | User profile/admin mutation. |
| `DELETE /api/users/:id` | User admin | Admin only | Admin | operator-only/admin | Online but restricted | anonymous `401/403`; Management/User `403`; Admin NV | Soft delete user. |
| `GET /api/roles` | Reference data | Admin/Management dashboard | Admin/Management | must-have admin | Online | anonymous `401/403`; Admin `200` NV | Master-data dependency. |
| `GET /api/programs` | Reference data | Admin/Management dashboard | Admin/Management | must-have admin | Online | anonymous `401/403`; Admin `200` NV | Master-data dependency. |
| `GET /api/positions` | Reference data | Admin/Management dashboard | Admin/Management | must-have admin | Online | anonymous `401/403`; Admin `200` NV | Master-data dependency. |
| `GET /api/divisions` | Reference data | Admin/Management dashboard | Admin/Management | must-have admin | Online | anonymous `401/403`; Admin `200` NV | Master-data dependency. |
| `GET /api/settings/operational` | Operational settings | Admin/Management | Admin/Management | must-have ops/admin | Online | anonymous `401/403`; User `403`; Admin `200` NV | DB-backed settings integrity required. |
| `PATCH /api/settings/operational` | Operational settings | Admin/Management | Admin/Management | operator-only/admin | Online but restricted/manual-reviewed | anonymous `401/403`; User `403`; Admin mutation only after approval | Changes runtime behavior. |
| `GET /api/analysis/fuzzy-ahp` | FAHP legacy | Admin/Management dashboard/research | Admin/Management | optional/deprecated | Online but restricted | anonymous `401/403`; Admin `200` NV | Legacy combined endpoint. |
| `GET /api/analysis/fuzzy-ahp/discipline` | FAHP dashboard | Admin/Management | Admin/Management | optional/dashboard | Online but restricted | anonymous `401/403`; Admin `200` NV | Dedicated FAHP. |
| `GET /api/analysis/fuzzy-ahp/wfa` | FAHP dashboard | Admin/Management | Admin/Management | optional/dashboard | Online if Geoapify/env OK | anonymous `401/403`; Admin `200/provider error` NV | External provider dependency. |
| `GET /api/analysis/fuzzy-ahp/smart-ac` | FAHP dashboard | Admin/Management | Admin/Management | optional/dashboard | Online but restricted | anonymous `401/403`; Admin `200` NV | Uses current runtime evidence. |
| `GET /api/analysis/fuzzy-ahp/dashboard` | FAHP dashboard | Admin/Management dashboard | Admin/Management | optional/dashboard | Online but restricted | anonymous `401/403`; Admin `200` NV | Monthly recap endpoint. |
| `GET /api/discipline/user/:userId` | Discipline | User self, Admin/Management | Controller own-data/Admin/Management | optional/user-dashboard | Online | anonymous `401/403`; own user `200`; other user `403` NV | Controller enforces own-data scope. |
| `GET /api/discipline/all` | Discipline admin | Admin/Management | Needs route/controller verification | optional/admin | Needs Verification | anonymous `401/403`; User should be `403` NV | Route lacks explicit roleGuard. |
| `GET /api/discipline/config` | Discipline config | Admin/Management | Needs route/controller verification | optional/admin | Needs Verification | anonymous `401/403`; User should be `403` NV | Route lacks explicit roleGuard. |
| `POST /api/discipline/test-ahp` | Debug/test | Operator/Admin | Admin/Management | operator-only | Online but restricted | anonymous `401/403`; User `403` NV | Test-only FAHP. |

### Must-have online by consumer

**Android must-have:**
- `/livez`, `/health`
- `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/auth/me`
- `/api/attendance/status-today`, `/api/attendance/check-in`, `/api/attendance/checkout/:id`, `/api/attendance/history`, `/api/attendance/history/personal/pdf`, `/api/attendance/history/export.pdf`, `/api/attendance/location-event`
- `/api/bookings`, `/api/bookings/history`
- `/api/wfa/recommendations`, `/api/wfa/ahp-config` if shown in app

**Web FE must-have:**
- `/livez`, `/health`
- Auth/session endpoints
- `/api/attendance/status-today`, `/api/attendance/history` if user attendance UI exists
- `/api/summary/dashboard-analytics`, `/api/summary/reports`, `/api/summary/reports/pdf`, `/api/summary/reports/excel`
- `/api/attendance/today-locations`, `/api/attendance/geofence-evidence` for dashboard map/evidence
- `/api/users*`, `/api/roles`, `/api/programs`, `/api/positions`, `/api/divisions`
- `/api/bookings*` for WFA admin approval
- `/api/settings/operational` for operational admin UI

**Admin/Management-only:**
- `/api/attendance`, `/api/attendance/today-locations`, `/api/attendance/geofence-evidence`, attendance delete/manual/debug endpoints
- `/api/users*`, `/api/summary/*`, `/api/settings/operational`, `/api/analysis/*`, admin booking operations, reference data

**Operator/research-only / not normal production consumer:**
- `/api/attendance/manual-*`
- `/api/attendance/research-trigger/*`
- `/api/attendance/test-weighted-prediction`
- `/api/wfa/test-ahp`
- `/api/discipline/test-ahp`
- debug/config surfaces (`debug-checkin-time`, `auto-checkout-settings`, `smart-config`, `enhanced-auto-checkout-settings`)

## 6. Database deployment / operation matrix

| Table / setting / dependency | Purpose | Required for production? | Migration risk | Seed dependency | Runtime dependency | Rollback concern | Notes |
|---|---|---:|---|---|---|---|---|
| `users` | Identity/profile/source of user scope | Yes | High if schema missing | Admin/user data required; seeder stub not sufficient | Auth, attendance, booking, reporting | User deletion/rollback affects FK chains | `01-user-admin.js` is only stub. |
| `roles` | RBAC role resolution | Yes | Medium | Must contain `Admin`, `Management`, `User` | `verifyToken`, `roleGuard`, controllers | Missing roles break authorization | Verify live rows before promotion. |
| `auth_sessions` | Stateful access/refresh session validity | Yes | Medium | None; table migration required | Auth/session endpoints and protected route validity | Dropping/reverting invalidates sessions | Created by `20260511000000-create-auth-sessions.cjs`. |
| `attendance` | Final attendance state | Yes | High | Existing production data | Attendance core/history/reports/jobs | Duplicate cleanup migration can delete older duplicates | Backend source of truth. Manual-first. |
| `attendance_categories` | WFO/WFH/WFA category IDs | Yes | Medium | Must contain category IDs used by clients | Check-in, history, reports | Wrong IDs break client category mapping | Verify WFO/WFH/WFA rows. |
| `attendance_statuses` | Attendance status masters | Yes | Medium | Must contain expected statuses | History/report/status semantics | Wrong rows corrupt labels/aggregation | Verify status keys/IDs. |
| `attendance_session_states` | `status-today` session state labels | Yes | Medium | Migration seeds 4 states | Android/Web status-today contract | Drop/revert breaks current contract | Created by `20260707010000-create-attendance-session-states.cjs`. |
| `bookings` | WFA request/booking state | Yes for WFA | High | Existing user booking data | WFA check-in/history/admin approval | Rollback can orphan attendance WFA expectations | Indexed by user/schedule migration. |
| `booking_status` | Booking approval status masters | Yes for WFA | Medium | Must contain pending/approved/rejected | Booking history/admin approval/WFA check-in | Wrong IDs break approval semantics | Verify live rows. |
| `locations` | WFO/WFH/WFA geofence locations | Yes | High | WFO and user/work locations required | Check-in geofence, recommendations/map | Wrong coordinates/radius break production check-in | Seeder for WFO location is commented out. |
| `location_events` | Geofence transition evidence | Required if smart/geofence evidence enabled | Medium | None | Smart AC/geofence evidence | Rolling back loses evidence timeline | Android location-event depends on it. |
| `settings` | DB-backed operational settings | Yes | Medium | Migration inserts missing 5 operational rows | Auto-checkout, geofence, check-in windows | Bad rollback may restore env/default drift | Integrity strict mode can throw 500 if missing/invalid. |
| `photos` | Uploaded face/photo metadata | Required if photo upload/face features used | Medium | Existing uploaded assets | User photo upload, profile/photo display | External storage rollback may not match DB rollback | Cloudinary/Spaces dependency. |
| `programs`, `positions`, `divisions` | Admin reference dropdowns | Yes for admin UI | Low/Medium | Live master data required | User CRUD/reference endpoints | Missing refs break admin UX | Verify live rows. |
| `wfa_requests` | Historical/legacy WFA request model | Needs Verification | Unknown | Unknown | Model exists; route usage unclear | Unknown | Confirm if still active or legacy. |
| `GEOAPIFY_API_KEY` | External WFA places/recommendation provider | Required if WFA recommendations/FAHP WFA are promoted | N/A | N/A | `/api/wfa/recommendations`, FAHP WFA | Provider outage affects endpoint success | Env required by integration. |
| Cloudinary keys | Upload/profile photo integration | Required if user photo upload is promoted | N/A | N/A | `/api/users`, `/api/users/:id/photo` | Asset rollback separate from DB | `.env.example` documents canonical keys. |
| DigitalOcean Spaces keys | Object storage path for backend photo writes | Required if Spaces path active | N/A | N/A | Upload/runtime storage | Asset rollback separate from DB | Verify actual runtime path before deploy. |
| `BACKEND_IMAGE_TAG` | Immutable image selection in Compose | Yes | N/A | N/A | Production container boot | Wrong tag deploys wrong code | Compose fails fast if absent. |
| `DB_SSL`, `DB_SSL_REJECT_UNAUTHORIZED` | Managed MySQL TLS behavior | Depends on DB endpoint | N/A | N/A | DB connectivity | Wrong TLS can block readiness | DO Managed MySQL commonly uses port 25060. |

### Migration safety classification

| Migration | Production classification | Reason |
|---|---|---|
| Base schema migrations (`create-user`, photos, indexes) | Manual-first | Schema/data shape must match existing production state. |
| `20260403000000-add-unique-constraint-attendance.cjs` | Manual-first / high risk | Deletes older duplicate attendance rows before adding unique index. Requires backup and duplicate audit first. |
| `20260424000000-bootstrap-operational-settings.cjs` | Safer but still manual-first | Inserts missing setting rows only; verify existing rows and values before run. |
| `20260511000000-create-auth-sessions.cjs` | Required / manual-first | Required for stateful auth; migration failure breaks auth/session contract. |
| `20260707010000-create-attendance-session-states.cjs` | Required / manual-first | Creates and seeds current status-today session-state contract. |
| `npm run seed` | Do not run blindly | Current seeders are stub/commented and do not represent complete production master data. |

## 7. Production smoke readiness matrix

| Endpoint group | Current evidence | Required smoke result before production usable | Status |
|---|---|---|---|
| Liveness/readiness | `scripts/smoke-test.js` covers `/livez`, `/health` | `/livez` 200; `/health` 200 `ready:true`; if 503, release blocked | Needs production run |
| Security/docs/CORS | `scripts/smoke-test.js` covers docs block, raw spec block, CORS, security headers | Anonymous docs/spec blocked, CORS restricted, request ID/security headers present | Needs production run |
| Auth negative | `scripts/smoke-test.js` covers `/api/auth/me`, invalid login, closed register | anonymous `401/403`, invalid login `400/401/422`, register `404` | Needs production run |
| Auth positive | Not covered by script | User/Admin/Management login 200; refresh 200; logout revokes; `/me` 200 then rejected after revoke | Needs Verification |
| User attendance core | Not covered by script | User `status-today` 200, valid check-in/checkout works in allowed window, duplicate/invalid cases return stable non-200 | Needs Verification |
| WFA booking core | Postman collection exists but not part of npm smoke script | Create future booking, history summary 200, admin approval guarded, WFA check-in behavior verified | Needs Verification |
| Admin dashboard/report | Not covered by script | Admin/Management 200; normal User 403; anonymous 401/403 for summary/users/reference/settings | Needs Verification |
| Operator/manual/debug | Not covered by script | Anonymous 401/403; normal User 403; Admin/Management only; mutation endpoints not executed without explicit approval | Needs Verification |
| Research/demo | OpenAPI docs exist; feature flag env exists | Disabled unless `RESEARCH_ATTENDANCE_TRIGGER_ENABLED=true`; protected Admin/Management; dry-run/apply behavior manually approved | Needs Verification |
| External provider paths | Not covered by script | Geoapify/Cloudinary/Spaces configured or endpoints return explicit provider error shape without silent success | Needs Verification |

### Minimum production smoke checklist

1. Run `npm run smoke-test "$PRODUCTION_PUBLIC_BASE_URL"` after deploy.
2. With real smoke credentials, run authenticated checks:
   - User: login, `/api/auth/me`, `/api/attendance/status-today`, `/api/attendance/history`, `/api/bookings/history`, `/api/wfa/recommendations`.
   - Admin/Management: login, `/api/summary/dashboard-analytics`, `/api/summary/reports`, `/api/attendance/today-locations`, `/api/users`, `/api/bookings`, `/api/settings/operational`.
3. Role restrictions:
   - Anonymous expected `401/403` for all `/api/*` protected endpoints.
   - User expected `403` for Admin/Management endpoints.
   - Management expected `403` for Admin-only user delete.
4. Mutation guard:
   - Do not execute manual job/research apply endpoints unless the operator explicitly approves target date/mode and database backup/restore plan.
5. Data integrity:
   - Verify master rows for roles, attendance categories/statuses, booking statuses, locations, settings.
   - Run `npm run migrate:status` as read-only migration state evidence after approval.

## 8. Files/area terdampak

- Route evidence: `src/routes/index.js`, `src/routes/auth.routes.js`, `src/routes/attendance.routes.js`, `src/routes/booking.routes.js`, `src/routes/summary.routes.js`, `src/routes/wfa.routes.js`, `src/routes/users.routes.js`, `src/routes/referenceData.routes.js`, `src/routes/discipline.routes.js`, `src/routes/analysis.routes.js`, `src/routes/settings.routes.js`.
- Controller evidence: `src/controllers/auth.controller.js`, `src/controllers/attendance.controller.js`, `src/controllers/booking.controller.js`, `src/controllers/summary.controller.js`, `src/controllers/wfa.controller.js`, `src/controllers/discipline.controller.js`, `src/controllers/analysis.controller.js`, `src/controllers/settings.controller.js`, `src/controllers/health.controller.js`.
- DB/model evidence: `src/models/*.js`, `src/models/migrations/*.cjs`, `src/models/seeders/*`, `src/utils/settings.js`.
- Runtime/deploy evidence: `src/config/index.js`, `src/config/database.js`, `.env.example`, `docker-compose.yml`, `.github/workflows/ci.yml`, `.github/workflows/deploy-production.yml`, `scripts/smoke-test.js`, `docs/openapi.yaml`, `postman/client-critical-smoke-gate.collection.json`.
- New artifact: `docs/specs/inf-232-production-endpoint-db-matrix.md`.

## 9. Verification evidence and plan

### Fresh local verification evidence (2026-07-08)

Executed in isolated worktree `C:/Users/Febriyadi/.claude/worktrees/backend-production-endpoint-matrix` after copying the local `.env` from the main checkout for local DB connectivity.

```bash
npm run lint
npm test
npm run test:alpha
npm run test:smart
```

Result:

- `npm run lint`: PASS.
- `npm test`: PASS — 89 test suites passed, 574 tests passed.
- `npm run test:alpha`: PASS against the configured local DB. State-changing local result for target date `2026-07-07`: alpha rows increased from 0 to 35; open sessions remained 0.
- `npm run test:smart`: PASS against the configured local DB. Result for target date `2026-07-07`: `totalAttendances=35`, `filledTimeOut=35`, `stillOpen=0`, `smartUsed=0`, `fallbackUsed=0`.

Caution: `test:alpha` and `test:smart` are local DB/runtime verification only and can mutate local attendance data. They are **not** production smoke evidence.

### Runtime smoke verification still required

```bash
npm run smoke-test "$PRODUCTION_PUBLIC_BASE_URL"
```

### Manual-first database verification

```bash
npm run migrate:status
```

Do **not** run `npm run migrate` against production unless a human explicitly approves the exact runtime target, backup/restore plan, and migration list.

### Suggested authenticated curl/Postman checks

Use a smoke-only User and Admin/Management account. Do not reuse personal/operator credentials in committed artifacts.

- Anonymous negative checks expected `401/403`:
  - `GET /api/auth/me`
  - `GET /api/attendance/status-today`
  - `GET /api/bookings/history`
  - `GET /api/summary/reports`
  - `GET /api/users`
  - `GET /api/settings/operational`
- User positive checks expected `200`:
  - `GET /api/auth/me`
  - `GET /api/attendance/status-today`
  - `GET /api/attendance/history`
  - `GET /api/bookings/history?status=all`
- User restriction checks expected `403`:
  - `GET /api/users`
  - `GET /api/summary/reports`
  - `GET /api/settings/operational`
- Admin/Management positive checks expected `200`:
  - `GET /api/users`
  - `GET /api/summary/dashboard-analytics`
  - `GET /api/summary/reports`
  - `GET /api/attendance/today-locations`
  - `GET /api/bookings`
  - `GET /api/settings/operational`

## 10. Docs/ADR update note

DOCS/ADR UPDATE REQUIRED.

Reason: INF-232 touches deploy/runtime truth, production endpoint matrix, dashboard/reporting contract, database operation policy, and release readiness source of truth. This document should be reviewed alongside OpenAPI and production deployment docs. If accepted, either link this matrix from production deployment docs or promote it into the release checklist.

## 11. PR/review note draft

```markdown
## Summary
- Add INF-232 production endpoint matrix covering Android, Web FE, Admin/Management, operator/research, and forbidden-public/debug/manual surfaces.
- Add database deployment/operation matrix for production-critical tables, settings, migrations, seed dependencies, and rollback concerns.
- Document smoke readiness gaps: current `npm run smoke-test` covers unauthenticated operational/security checks but not authenticated User/Admin business flows.
- Flag manual-first migration risk, especially production `npm run migrate` in deploy workflow and attendance duplicate cleanup migration.

## Verification
- [x] npm run lint
- [x] npm test — 89 suites / 574 tests passed
- [x] npm run test:alpha — local DB verification passed; state-changing local alpha delta +35 for 2026-07-07
- [x] npm run test:smart — local DB verification passed; 35/35 filled timeout, 0 open sessions for 2026-07-07
- [ ] npm run smoke-test "$PRODUCTION_PUBLIC_BASE_URL" (runtime/manual)

## Risk / Needs Verification
- No production deploy executed in this PR.
- No production migration executed in this PR.
- Local alpha/smart verification used copied local `.env` and mutated local DB state; it is not production evidence.
- Authenticated production smoke with User/Admin/Management credentials remains required before production-ready claim.
- Master data and migration status must be verified against managed MySQL before promotion/deploy.

## Docs/ADR
DOCS/ADR UPDATE REQUIRED: endpoint matrix + database operation matrix + runtime deploy policy.
```

## 12. Handoff / release gate recommendation

- **Must-have online now:** health/livez, auth/session, attendance status/check-in/checkout/history/PDF, booking create/history/admin approval, WFA recommendations if WFA is enabled, dashboard summary/reports, user/reference/admin endpoints, operational settings read.
- **Optional/deferred:** FAHP analysis dashboard detail endpoints, discipline self/admin endpoints, geofence evidence if not used by current UI, WFA AHP config if not exposed.
- **Operator/Admin-only:** all manual job endpoints, research triggers, debug settings/config endpoints, test FAHP/weighted-prediction endpoints, destructive attendance/user/booking deletes.
- **Database safe vs manual-first:** `migrate:status` is read-only evidence; all production migrations are manual-first. The attendance duplicate cleanup/unique-index migration is the highest-risk migration and requires backup plus duplicate audit before execution.
- **Readiness verdict:** **Partially ready / still Needs Verification**. Repo has route/runtime/docs evidence for a production matrix, but backend cannot be called production-ready until production deploy evidence, migration-status evidence, master-data verification, and authenticated endpoint smoke pass.
- **Biggest blocker before Android/Web FE production usage:** lack of fresh authenticated production smoke matrix proving User/Admin role behavior and business success paths against the real managed MySQL/runtime.
