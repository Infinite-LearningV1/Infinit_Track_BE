# ADR-009: Modular MVC per Feature

Status: Proposed
Date: 2026-07-26
Deciders: Backend owner (Infinite Track palu)
Linear: INF-252

## Context

The backend is organized layer-first: `src/controllers`, `src/routes`, `src/services`, `src/utils`, `src/models`, `src/jobs`. Measured on `develop` at `5ce2f69`, controllers hold 6751 lines, with `attendance.controller.js` alone at 2291. `src/services/` contains only 5 files, all analytics or reporting — there is no service layer for attendance, booking, or user, so those business rules live inside HTTP controllers.

The practical consequences are visible in the code: search, filter, and pagination are reimplemented per endpoint; Sequelize associations and response projections are duplicated; business rules can diverge between controllers, jobs, and scripts; and error envelopes are inconsistent (see `src/routes/index.js:33-35` and `src/middlewares/errorHandler.js:72-96`).

The backend is the authoritative system of record for attendance state, auth/session validity, and booking approval. Any restructuring must therefore preserve observable behavior exactly, and must be verifiable at each step rather than at the end.

Constraints: Express and Sequelize stay. `develop` remains the integration branch. The application must be runnable and testable after every PR. The existing suite — 90 files, 579 tests, 15.5s — must stay green throughout.

## Decision

Adopt feature-oriented **Modular MVC**: each feature owns its route, controller, service, repository, query object, validation, mapper, and errors under `src/modules/<feature>/`, with genuinely shared mechanisms under `src/shared/`.

The layering remains MVC:

```text
Route → Middleware/Validation → Controller → Service → Repository/Query → Sequelize Model → DB
```

Four rules make this enforceable rather than aspirational:

1. **Per-use-case cutover.** One PR migrates one use case; the legacy controller function is deleted in that same PR. No re-export shims, no parallel route prefixes, never two live implementations of one behavior.
2. **Machine-enforced layer contract.** ESLint `no-restricted-imports`, scoped to `src/modules/**`, forbids ORM imports in controllers, `express` imports and `req`/`res`/`next` parameters in services, and `express` imports in repositories.
3. **`shared/` admission requires two real consumers.** The PR that promotes a unit into `shared/` must name both. This is what prevents `shared/` from becoming a second `src/utils/` (22 files, 3201 lines of mixed concerns).
4. **Behavior is pinned before it moves.** Characterization tests for Users, Bookings, and Attendance — 37 of the 60 endpoints — complete before any extraction begins.

`/api/bookings` and `/api/wfa` are owned by a single `bookings/` module. Public paths do not change.

## Options Considered

### Option A: Modular MVC per feature (chosen)

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Cost | Incremental — spreads across many small PRs |
| Scalability | Good — feature ownership is explicit, modules stay individually comprehensible |
| Team familiarity | High — still MVC, still Express and Sequelize |

**Pros:** preserves the existing mental model; migration can stop at any phase and leave a coherent codebase; each PR is small enough to review properly; enforceable by lint.
**Cons:** legacy and modular structure coexist for a long period; discipline is required to avoid `shared/` sprawl.

### Option B: Clean/Hexagonal architecture

| Dimension | Assessment |
|---|---|
| Complexity | High |
| Cost | High — ports, adapters, and DI wiring for every feature |
| Scalability | Good in theory |
| Team familiarity | Low |

**Pros:** strongest decoupling from Express and Sequelize.
**Cons:** requires a DI framework and abstraction layers that INF-252 explicitly rules out; the decoupling it buys is not a problem this codebase actually has, since replacing Express or Sequelize is not planned.

### Option C: Keep layer-first, extract services only

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Cost | Low |
| Scalability | Poor |
| Team familiarity | Highest — no structural change |

**Pros:** cheapest; thins controllers immediately.
**Cons:** treats the symptom, not the cause. `src/services/` would grow into the next god-folder, exactly as `src/utils/` already has. Feature ownership stays unfindable, and duplicated query logic is untouched.

## Trade-off Analysis

The real choice is between B and A, and it turns on what problem is actually being solved. Option B optimizes for swapping infrastructure — a scenario explicitly out of scope. Option A optimizes for *finding and changing one feature's behavior safely*, which is the problem the 2291-line attendance controller creates every day. Paying Option B's abstraction cost to solve a problem nobody has would be the more expensive mistake.

Option C is rejected because it has already been tried implicitly. `src/services/` and `src/utils/` are what layer-first extraction produces over time: folders that grow without an ownership boundary. Adding a sixth layer-first folder would not change that trajectory.

The cost Option A does carry is a long coexistence period. That is accepted, and bounded by rule 1: because the legacy function is deleted in the same PR that replaces it, coexistence never means duplicated behavior — only a mixed folder layout.

## Consequences

**Easier:** locating everything a feature owns; reviewing a migration PR, since the diff shows ownership moving; reusing one business rule across HTTP, cron, and scripts; catching layer violations automatically in CI.

**Harder:** the repository has two structural conventions until migration completes; each migration PR must carry test evidence, so PRs are slower to produce; `shared/` requires active gatekeeping.

**To revisit:** whether query objects need a shared allowlist primitive or per-feature configs suffice (Phase 2 decides); whether jobs should call services directly or through an explicit use-case trigger layer (Phase 6); whether the architecture documents need a machine-checkable drift guard.

**New obligation:** mocked-model tests cannot detect SQL regressions when queries move into repositories. A MySQL service and real integration tests for list endpoints are therefore added to CI, changing `.github/workflows/ci.yml` and the test env contract. This is deploy-adjacent and must land as its own reviewed PR.

## Action Items

1. [ ] Publish `docs/architecture/current-backend-map.md` — dependency map for all 60 endpoints.
2. [ ] Publish `docs/architecture/api-contract-inventory.md` with a per-endpoint test-coverage column.
3. [ ] Publish `docs/architecture/target-modular-mvc.md`.
4. [ ] Backfill characterization tests for the 37 priority endpoints, one PR per route file.
5. [ ] Add MySQL service to CI plus integration tests for list endpoints; document the test env contract.
6. [ ] Add typed error classes and a pure error-to-HTTP translator, wired as an additive branch in `errorHandler.js`.
7. [ ] Add ESLint `no-restricted-imports` layer rules scoped to `src/modules/**`.
8. [ ] Revisit this ADR after the Users module migration confirms or contradicts the pattern.
