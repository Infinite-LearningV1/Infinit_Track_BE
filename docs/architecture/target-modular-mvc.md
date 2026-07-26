# Target Architecture: Modular MVC per Feature

**Status:** Phase 0a deliverable for INF-252. Binding once ADR-009 is accepted.
**Decision record:** [ADR-009](../adr/ADR-009-modular-mvc-per-feature.md)
**Current state:** [current-backend-map.md](current-backend-map.md)
**Coverage baseline:** [api-contract-inventory.md](api-contract-inventory.md)

This is the document to read first if you are about to write or move backend code.

---

## 1. The structure

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

**Create only the files a module actually needs.** An eight-file skeleton for a two-endpoint module is waste, not consistency. `/api/settings` needs a route, a controller, a service, and a validation file — nothing else.

## 2. The flow

```text
Route → Middleware/Validation → Controller → Service → Repository/Query → Sequelize Model → DB
```

Responses travel back through a mapper:

```text
Sequelize Entity → Mapper → Service Result → Controller → HTTP Response
```

This is still MVC. It is not Clean Architecture, not Hexagonal, and there is no dependency-injection container.

## 3. Who owns what

### Route

Selects a controller and wires authentication, authorization, and request validation. Contains no business logic.

Authorization belongs **here**, in middleware — not inside the controller body. `/api/discipline` currently enforces roles inside the controller for three of its four routes (finding F10); the migrated version moves that to `roleGuard`.

### Controller

Owns HTTP concerns only:

- read validated input,
- call exactly one service operation,
- choose the status code and response envelope.

A controller must **not** contain Sequelize operators, transaction orchestration, geofence rules, external API calls, or large response transformations.

A controller must **not** answer an error itself. It calls `next(err)` and lets the global handler render it. Thirteen current responses violate this (finding F7) and thereby bypass production error masking.

### Service

Owns use-case orchestration and business flow.

- Must not reference `req`, `res`, or `next`.
- Owns transaction boundaries for mutations.
- Calls repositories, query objects, policies, and external-service adapters.
- Is the unit that HTTP, cron jobs, and scripts all share. If a rule can differ between a controller and a job, it is in the wrong place.

### Repository

Owns persistence mutations and stable entity lookups.

- Accepts transaction options explicitly.
- Never returns an Express response.
- **Do not create a generic `BaseRepository`** that only renames Sequelize methods. It adds indirection and removes nothing.

### Query object

Owns list and report queries: associations, selected attributes, search, filter, sort, pagination, and query-specific projections.

- Uses a **strict allowlist per endpoint**. A client-supplied sort field that is not on the list is rejected, not passed through.
- Shared code supplies the mechanism; each feature owns its public query contract.

### Validation

Transport validation only — params, query shape, body types and ranges. Business validation stays in the service or a policy.

Validation modules live **inside the owning feature**. Today `src/middlewares/validator.js` holds chains for attendance, auth, booking, user, analysis, and dashboard concerns all at once. `src/middlewares/settings.validator.js` is the existing precedent for the target shape.

### Mapper

Converts Sequelize instances into stable API objects. This is what keeps internal columns and ORM instances out of response contracts.

### `shared/`

Only genuinely reused mechanisms: typed application errors, error middleware, request-ID and logging context, allowlisted list-query primitives, pagination metadata, database and transaction infrastructure.

## 4. The four rules that make this stick

### Rule 1 — Per-use-case cutover

1. One PR migrates one use case.
2. The feature route file points that endpoint at the new module handler.
3. The legacy controller function is deleted **in the same PR**.
4. A legacy controller file disappears when its last function has moved.
5. `src/routes/index.js` is not touched until every module has migrated.

No shims. No parallel `/v2` prefixes. At no point do two live implementations of the same behavior exist.

### Rule 2 — The layer contract is enforced by lint

`.eslintrc.cjs` carries `no-restricted-imports` overrides scoped to `src/modules/**`:

| Rule | Enforcement |
|---|---|
| Controllers must not touch the ORM | `src/modules/*/*.controller.js` may not import `sequelize`, `**/models`, or `**/config/database` |
| Services must not know about HTTP | `src/modules/*/*.service.js` may not import `express`; `req`/`res`/`next` are denied identifiers |
| Repositories must not answer HTTP | `src/modules/*/*.repository.js` may not import `express` |

`**/config/database` is on the controller list deliberately. It exports the configured Sequelize instance, and it is how the attendance, booking and auth controllers obtain transactions today. Without it the "controllers must not touch the ORM" guarantee had a hole a migrated controller could open transactions through while `npm run lint` stayed green — worse than no rule, because it invites trust. Services are still allowed to import it: transaction boundaries belong to them.

A violation fails `npm run lint`. The rules do not apply to legacy folders, so they can land before any migration and never block unrelated work.

### Rule 3 — `shared/` requires two real consumers

A unit moves into `shared/` only when two modules genuinely consume it, and the PR that moves it must **name both**. Until then it lives in the module that owns it.

Why this rule exists: `src/utils/` is 22 files and 3201 lines of unrelated concerns. It got that way one plausible-sounding addition at a time.

### Rule 4 — Behavior is pinned before it moves

An endpoint may not be extracted until its happy path, its auth/RBAC rejection, and its primary validation failure are locked by test. See the coverage baseline in [api-contract-inventory.md](api-contract-inventory.md) — 20 of the 37 priority endpoints currently have none.

## 5. What this explicitly is not

- Not a rewrite.
- Not a replacement of Express or Sequelize.
- Not Clean or Hexagonal architecture.
- Not a DI framework.
- Not `BaseController` / `BaseService` / `BaseRepository`.
- Not a licence to change an API or database contract because the new structure would prefer a different shape. Contract changes need their own decision.

## 6. Migration order

| Phase | Content | Status |
|---|---|---|
| 0a | Architecture documents | this document |
| 0b | Characterization backfill, 37 priority endpoints | scope defined by the inventory |
| 0c | MySQL integration harness in CI | planned |
| 1 | Typed errors and centralized error mapping | planned |
| 2 | Allowlisted list-query foundation | roadmap |
| 3 | Users module | roadmap |
| 4 | Bookings module (incl. WFA) | roadmap |
| 5 | Attendance module | roadmap |
| 6 | Jobs and scheduler reuse application services | roadmap |
| 7 | Reports, summary, analysis, remaining modules | roadmap |
| 8 | Data-access and production hardening | roadmap |

Phases 2–8 are roadmap, not executable steps. Each gets its own spec and plan when it starts.

## 7. Where to start reading the current code

Two controllers already approximate the target shape and are the best references:

- `src/controllers/settings.controller.js` — 22 LOC, pure delegation to a service, feature-local validator.
- `src/controllers/analysis.controller.js` — 140 LOC across 5 endpoints, delegates to `fuzzyAhpAnalysis.service.js`, and has the deepest test coverage in the repository.

The clearest counter-example is `src/controllers/attendance.controller.js` at 2291 lines.
