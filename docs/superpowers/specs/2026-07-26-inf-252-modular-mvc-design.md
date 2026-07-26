# INF-252 — Modular MVC per Feature: Design Spec

**Linear:** [INF-252](https://linear.app/infinite-track-palu/issue/INF-252/backendarchitecture-adopt-modular-mvc-per-feature-with-safe)
**Branch:** `feature/inf-252-modular-mvc`
**Date:** 2026-07-26
**Status:** Proposed — awaiting review
**Scope of this document:** full target architecture (binding for all phases) + execution detail for Phase 0 and Phase 1 only. Phases 2–8 remain roadmap, not executable steps.

---

## 1. Fact base

Everything below was measured on `feature/inf-252-modular-mvc` at commit `5ce2f69` (tip of `develop`).

### 1.1 Current structure

Layer-first, not feature-first:

```text
src/analytics  src/config  src/controllers  src/jobs
src/middlewares  src/models  src/routes  src/services  src/utils
```

### 1.2 Controller hotspots (measured LOC)

| File | LOC |
|---|---|
| `src/controllers/attendance.controller.js` | 2291 |
| `src/controllers/auth.controller.js` | 997 |
| `src/controllers/booking.controller.js` | 980 |
| `src/controllers/user.controller.js` | 831 |
| `src/controllers/wfa.controller.js` | 586 |
| `src/controllers/discipline.controller.js` | 554 |
| **Total, all controllers** | **6751** |

### 1.3 Service layer is effectively absent for core domains

`src/services/` holds 5 files / 3466 LOC, all analytics or reporting:
`fuzzyAhpAnalysis` (1061), `researchAttendanceTrigger` (1001), `summaryReport` (840), `attendanceReport` (448), `operationalSettings` (116).

There is **no service layer for attendance, booking, or user**. That logic lives in controllers.

### 1.4 Endpoint inventory

60 registered endpoints across 11 route files:

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
| `contribution.routes.js` | 0 |

The three priority modules (Users, Bookings incl. WFA, Attendance) account for **37 of 60** endpoints.

### 1.5 Test baseline

`npm test` on this branch: **90 suites, 579 tests, all passing, 15.5s.**

Tests do **not** touch MySQL. Sequelize models are mocked via `jest.unstable_mockModule`; HTTP is exercised through `supertest`. See risk R1.

### 1.6 Missing artifacts

`docs/architecture/` does not exist. None of the three Phase 0 documents required by INF-252 are present. `docs/adr/` exists with ADR-007 and ADR-008.

### 1.7 Findings recorded, deliberately not fixed here

These are contract observations for the Phase 0 inventory. Fixing them is out of scope for INF-252 and each needs its own issue.

| ID | Finding | Evidence |
|---|---|---|
| F1 | 404 handler returns `{ message }` without `success: false`, unlike every other response | `src/routes/index.js:33-35` |
| F2 | `applySearch` mutates its `queryOptions` argument in place, preventing composable query building | `src/utils/searchHelper.js:14-62` |
| F3 | Search term is interpolated into `LIKE '%...%'` without escaping `%` or `_`. Not SQL injection — Sequelize still binds the value — but a search for `100%` behaves unexpectedly | `src/utils/searchHelper.js:33` |
| F4 | `contribution.routes.js` registers zero routes and is not mounted in `index.js` — dead file | `src/routes/contribution.routes.js` |
| F5 | Error `code` is exposed only when status < 500 **or** the code is in `PUBLIC_ERROR_CODES`; `E_INVALID_REFERENCE_STATE` has its fields copied one by one | `src/middlewares/errorHandler.js:72-96` |
| F6 | CI pins Node 18; this worktree runs Node v24.16.0 | `.github/workflows/ci.yml:10` |

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | This document binds the target architecture for all phases, but details execution only for Phase 0 and Phase 1 | A single plan covering 8 phases would be stale before it is executed |
| D2 | Typed errors are **additive**. `errorHandler.js` keeps its existing behavior untouched | Global handler serves every endpoint; a rewrite makes one PR touch the whole API surface |
| D3 | Cutover happens **per use case at the feature route file**. No re-export shims | Shims blur ownership and are easy to forget; a per-use-case diff shows ownership transfer explicitly |
| D4 | Characterization backfill for Users, Bookings (incl. WFA), and Attendance completes **inside Phase 0**, before any extraction | Chosen deliberately over just-in-time backfill, accepting a longer Phase 0 in exchange for a fully protected baseline |
| D5 | Phase 0a (documents) blocks. Phase 0b (backfill), Phase 0c (CI integration harness), and Phase 1 (error foundation) then run **in parallel** on separate branches | They share no files: 0b only adds under `tests/`, 0c only touches `.github/workflows/ci.yml` plus new integration test files, Phase 1 only adds under `src/shared/` plus one branch in `errorHandler.js` |
| D6 | One `bookings/` module owns both `/api/bookings` and `/api/wfa` | Same bounded context — WFA location booking. Splitting them would duplicate booking rules across two modules |
| D7 | Layer contract is enforced by ESLint `no-restricted-imports`, scoped to `src/modules/**` only | Prose rules rot. Legacy folders stay unaffected, so the rule can land before any migration |
| D8 | Something enters `shared/` only when **two real consumers exist** | `src/utils/` — 22 files, 3201 LOC of mixed concerns — is what happens without this rule |
| D9 | MySQL runs as a CI service and real integration tests are added for list endpoints | Chosen deliberately over query-option snapshots, accepting expanded scope and a change to `.github/workflows/ci.yml`. See risk R1 and R4 |

---

## 3. Target architecture

### 3.1 Module layout

```text
src/
├── modules/
│   ├── users/
│   │   ├── user.routes.js
│   │   ├── user.controller.js
│   │   ├── user.service.js
│   │   ├── user.repository.js
│   │   ├── user.query.js
│   │   ├── user.validation.js
│   │   ├── user.mapper.js
│   │   └── user.errors.js
│   ├── bookings/          # owns /api/bookings and /api/wfa
│   ├── attendance/
│   ├── auth/
│   └── ...
└── shared/
    ├── errors/
    ├── http/
    ├── middleware/
    ├── query/
    ├── database/
    └── logging/
```

A module creates only the files it needs. An eight-file skeleton for a two-endpoint module is waste.

### 3.2 Request and response flow

```text
Route → Middleware/Validation → Controller → Service → Repository/Query → Sequelize Model → DB
Sequelize Entity → Mapper → Service Result → Controller → HTTP Response
```

### 3.3 Layer responsibilities

**Route** selects a controller and wires authentication, authorization, and request validation. No business logic.

**Controller** owns HTTP concerns only: read validated input, call exactly one service operation, choose status and envelope. Must not contain Sequelize operators, transaction orchestration, geofence rules, external API calls, or large response transformations.

**Service** owns use-case orchestration. It must not reference `req`, `res`, or `next`. It owns transaction boundaries for mutations and calls repositories, query objects, policies, and external adapters.

**Repository** owns persistence mutations and stable entity lookups. It accepts transaction options explicitly and never returns Express responses. No generic `BaseRepository` that merely renames Sequelize methods.

**Query object** owns list and report queries: associations, selected attributes, search, filter, sort, pagination, and projections — with strict per-endpoint allowlists. Shared code supplies the mechanism; each feature owns its public query contract.

**Validation** covers transport concerns only: params, query shape, body types and ranges. Business validation stays in service or policy code. Validation modules live inside the owning feature.

**Mapper** converts Sequelize instances into stable API objects, keeping internal columns and ORM instances out of response contracts.

### 3.4 Machine-enforced layer contract (D7)

Added to `eslint.config.js`, scoped to `src/modules/**` so legacy code is unaffected:

| Rule | Enforcement |
|---|---|
| Controllers must not touch the ORM | `src/modules/*/*.controller.js` may not import `sequelize` or `../../models` |
| Services must not know about HTTP | `src/modules/*/*.service.js` may not import `express`; `req`/`res`/`next` are forbidden parameter names |
| Repositories must not answer HTTP | `src/modules/*/*.repository.js` may not import `express` |

Violations then fail `npm run lint` instead of depending on reviewer attention.

### 3.5 Cutover rule (D3)

1. One PR migrates one use case.
2. The feature route file points that endpoint at the new module handler.
3. The legacy controller function is deleted **in the same PR**.
4. A legacy controller file is removed when its last function has moved.
5. `src/routes/index.js` is not touched until every module has migrated.

At no point do two live implementations of the same behavior coexist.

### 3.6 `shared/` admission rule (D8)

A unit may move into `shared/` only when two modules genuinely consume it, and the PR that moves it must name both consumers. Until then it lives in the module that owns it.

---

## 4. Phase 0 — inventory, documentation, characterization baseline

### 4.1 Phase 0a — documents (blocking)

| Artifact | Content |
|---|---|
| `docs/architecture/current-backend-map.md` | Route → controller → model → job → external service dependency map for all 60 endpoints |
| `docs/architecture/api-contract-inventory.md` | One row per endpoint: method, path, auth mode, roles, request shape, success envelope, error codes, **test coverage status (covered / gap)** |
| `docs/architecture/target-modular-mvc.md` | Target structure, layer responsibilities, cutover rule, `shared/` admission rule |
| `docs/adr/ADR-009-modular-mvc-per-feature.md` | The architecture decision itself, in the ADR format already used by ADR-007 and ADR-008 |

The coverage column in the inventory is the source of truth for Phase 0b scope. Phase 0b does not start before this document merges.

### 4.2 Phase 0b — characterization backfill (37 endpoints)

Per-endpoint exit criteria — all three locked by test:

1. Happy path: status code and response envelope shape.
2. Auth/RBAC rejection: unauthenticated and wrong-role responses.
3. Primary validation failure: status, message, and error code.

Split one PR per route file, so the 23 attendance endpoints never land as a single PR.

### 4.3 Phase 0c — MySQL integration harness (D9)

Adds a MySQL service to `.github/workflows/ci.yml` and an integration suite covering list endpoints for the three priority modules, run against a real schema.

This is the one part of Phase 0 that changes deploy-adjacent configuration. It requires:

- a test database env contract added to `.env.example` and documented;
- separation of integration tests from the existing mocked suite, so the 15.5s feedback loop is not lost;
- confirmation that CI's Node 18 pin still matches the intended runtime (finding F6).

**DOCS/ADR UPDATE REQUIRED** — env contract and CI behavior both change.

---

### 4.4 Sequencing

```text
Phase 0a (documents)  ──blocks──┐
                                ├──> Phase 0b (characterization backfill)  ──┐
                                ├──> Phase 0c (CI MySQL integration harness) ─┼──> Phase 2+
                                └──> Phase 1  (typed error foundation)      ──┘
```

Phase 0a blocks because the coverage column in the contract inventory defines Phase 0b's scope. The three downstream tracks touch disjoint files and may proceed concurrently on separate branches. **No extraction begins until 0b, 0c, and Phase 1 have all merged** — that is the point of D4.

---

## 5. Phase 1 — additive typed error foundation

### 5.1 New files

| File | Responsibility |
|---|---|
| `src/shared/errors/AppError.js` | Base class carrying `code`, `status`, `details`, plus `ValidationError` 400, `UnauthorizedError` 401, `ForbiddenError` 403, `NotFoundError` 404, `ConflictError` 409 |
| `src/shared/http/toErrorResponse.js` | Pure function `AppError → { status, body }`, unit-testable without Express |

### 5.2 The single change to existing code

One branch is added at the top of `errorHandler.js`:

```text
if (err instanceof AppError) → respond via toErrorResponse(err)
otherwise                    → existing logic, byte for byte unchanged
```

The envelope produced by the new path is **deliberately identical** to the current convention, `{ success: false, message, code?, details? }`. No client observes a new shape.

### 5.3 Proof that nothing changed

`tests/errorHandler.test.js` already exists and pins three branches: the `E_OPERATIONAL_SETTINGS_INVALID` details path, the `E_INVALID_REFERENCE_STATE` field copying, and the rule that a `details` array is *not* logged for other codes.

Five branches are unpinned and must be covered before the new branch is added:

| Branch | Expected |
|---|---|
| `SequelizeValidationError` | 400, `errors[]` of `{ field, message }` |
| `SequelizeUniqueConstraintError` | 400, `Resource already exists` |
| `JsonWebTokenError` | 401, `Invalid token` |
| `TokenExpiredError` | 401, `Token expired` |
| `config.env === 'production'` and status 500 | message masked to `Internal server error` |

---

## 6. Verification gate

Every PR under INF-252 must show:

| Check | Command | Bar |
|---|---|---|
| Lint | `npm run lint` | clean |
| Unit/contract tests | `npm test` | ≥ 90 suites / 579 tests, all green |
| Integration tests | `npm test` (integration project, after Phase 0c) | green |
| Boot | `npm start` | process starts |
| Smoke, runtime slices | `npm run smoke-test <url>` | green |

Database migrations are manual-first and are not touched in Phase 0 or Phase 1.

---

## 7. Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Mocked-model tests cannot catch SQL regressions when queries move into repository/query objects. Tests can stay green while generated SQL changes | High | D9: real MySQL integration tests in CI for list endpoints |
| R2 | Phase 0b is the long pole — 37 endpoints, attendance alone is 2291 LOC — and may stall the whole effort | High | One PR per route file; Phase 1 runs in parallel so the critical path is not serialized |
| R3 | Architecture documents drift from runtime, which CLAUDE.md treats as a defect | Medium | Documents are regenerated as part of any PR that adds or moves a route; a router-introspection drift guard is an open option, deferred |
| R4 | Phase 0c edits `.github/workflows/ci.yml` and adds env keys — deploy-adjacent, sensitive area | Medium | Isolated in its own PR, reviewed separately from any code migration; ADR note required |
| R5 | ESLint layer rules could block legitimate work mid-migration | Low | Rules are scoped to `src/modules/**` only; legacy paths unaffected |
| R6 | `npm install` in a fresh worktree fails on the puppeteer postinstall when the local browser cache is corrupt | Low | Documented workaround: `PUPPETEER_SKIP_DOWNLOAD=true npm install`. Environment issue, not a code defect |

---

## 8. Out of scope

Replacing Express or Sequelize. Clean/Hexagonal architecture. Full backend rewrite. DI frameworks. Generic `BaseController`/`BaseService`/`BaseRepository`. Any API or database contract change motivated only by architectural preference. Fixing findings F1–F5, each of which needs its own issue.

---

## 9. Needs verification

- Whether CI's Node 18 pin still reflects the intended production runtime (F6). Not confirmed against the droplet runtime in this cycle.
- Whether adding a MySQL service to CI requires schema seeding beyond `npm run migrate`, and how long that extends CI wall time. Unmeasured.
- Whether `contribution.routes.js` (F4) is genuinely dead or awaiting a feature. Not confirmed with the issue author.
