# INF-252 Phase 2 — the `users` module

**Issue:** [INF-252](https://linear.app/infinite-track-palu/issue/INF-252)
**Binding spec:** [2026-07-26-inf-252-modular-mvc-design.md](../specs/2026-07-26-inf-252-modular-mvc-design.md)
**Binding list-query design:** [2026-07-27-inf-252-list-query-post-inf262-design.md](../specs/2026-07-27-inf-252-list-query-post-inf262-design.md)
**Status:** plan only. **Execution is gated — see the gate below.**

The spec details execution for Phase 0 and Phase 1 and leaves Phases 2–8 as a single arrow on a dependency diagram. This plan converts the first of them into executable steps, and picks the module order for everything after it.

---

## The gate

Spec §4.4, decision D4, is unambiguous:

> No extraction begins until 0b, 0c, and Phase 1 have all merged.

| Track | Status |
|---|---|
| Phase 0a — architecture documents | ✅ merged |
| Phase 0b — characterization backfill, 37 endpoints | ✅ merged, **zero coverage gaps remain** |
| Phase 1 — typed error foundation | ✅ merged |
| **Phase 0c — CI MySQL integration harness** | ❌ **blocked on `db/baseline/schema.sql`** |

**Phase 0c is the only outstanding gate, and it is blocked on a production schema dump that only a human with database access can produce** (procedure: [db/baseline/README.md](../../../db/baseline/README.md), decision: [INF-254](https://linear.app/infinite-track-palu/issue/INF-254)).

This is not bureaucracy. Slice 3 below moves a `LIKE`-based search query into a query object. Every existing test mocks Sequelize, so **no test in the repository today can tell a correct query from a broken one.** Phase 0c exists specifically to cover that slice. Executing Phase 2 before it lands means moving SQL with no way to detect a regression.

**Do not start slice 1 until Phase 0c is green.**

---

## Module order for Phases 2–8

Chosen by risk, ascending. Each module is a phase.

| Phase | Module | LOC | Endpoints | Why here |
|---|---|---|---|---|
| **2** | `users` | 831 | 6 | Smallest well-characterized feature. One transaction, no jobs, no geofence, no FAHP, no cross-module callers |
| 3 | `auth` | 997 | — | Session/token contract. High risk, but self-contained and heavily tested |
| 4 | `bookings` (owns `/api/bookings` **and** `/api/wfa`) | 980 + 586 | — | Two route prefixes, one module per spec §3.1. Approval semantics are backend-authoritative |
| 5 | `attendance` | 2291 | — | **Last of the large modules.** Final-state authority, three background jobs write to it, FAHP reads it |
| 6 | the small ones — `referenceData`, `settings`, `summary`, `discipline`, `analysis` | 981 total | — | Cheap once the patterns are proven. Not worth spending the pattern-establishing budget on |

`attendance` is deliberately not last-but-one. It is the only module whose state is mutated by something other than an HTTP request, so it should migrate when the pattern is least likely to still be changing.

---

## Phase 2 slices

Six endpoints, six PRs, in this order. **Each PR introduces exactly one new layer concept**, so a failure identifies the layer that caused it.

| # | Endpoint | Introduces | Legacy fn deleted |
|---|---|---|---|
| 1 | `GET /api/users/:id` | module skeleton, `user.mapper.js`, `user.service.js`, `user.controller.js` | `getUserById` |
| 2 | `DELETE /api/users/:id` | `user.repository.js` | `deleteUser` |
| 3 | `GET /api/users` | `user.query.js` — **the slice Phase 0c protects** | `getAllUsers` |
| 4 | `PATCH /api/users/:id` | cross-entity write (User + Location), uniqueness policy | `updateUser` |
| 5 | `POST /api/users/:id/photo` | external adapter boundary (Cloudinary) | `uploadUserPhoto` |
| 6 | `POST /api/users` | transaction boundary owned by the service | `createUser` |

### Why this order

**Slice 1** is a pure read. It establishes the directory, the mapper, and the route-file cutover mechanic with the least possible surface. Note it uses `User.findOne`, not `findByPk` — pinned by `usersPayloadContract.test.js`, and the mapper must preserve that.

**Slice 2** is the simplest mutation. `User` is `paranoid: true` with `deletedAt: 'deleted_at'`, so `destroy()` is a genuine soft delete and the repository must not quietly become a hard delete.

**Slice 3** carries the highest read-path risk. It moves the complete Phase A query matrix into `user.query.js`: the `findAll` compatibility path; the `findAndCountAll` paginated path; pagination defaults and cap; escaped three-field search; five filters; allowlisted sorting; left-joined WFH location integrity; `distinct: true`; and `subQuery: false`. `user.validation.js` owns transport validation, `user.service.js` owns integrity warnings, and `user.mapper.js` owns the slim list projection. The extraction must preserve both response modes exactly.

**Slice 4** writes `User` and `Location` with **no transaction** — the legacy behaviour, pinned by `usersUpdateContract.test.js`. The extraction preserves it. Adding a transaction here would be a behaviour change and belongs to its own issue.

**Slice 5** is the only Cloudinary caller in this module, and it uses a dynamic `import()` inside a helper. It also performs multiple writes without a transaction. The adapter boundary is the point of the slice; the missing transaction moves unchanged.

**Slice 6** is last because `createUser` is the only function that owns a transaction, and spec §3.3 puts transaction ownership in the service. By the time it runs, mapper, repository, query object, and policy code all exist and it is the only new thing being proven.

### Amended 2026-07-27 — INF-251 / INF-261 landed on develop (#125)

`8b6f8f2` changed this module underneath the plan. The slice **order** survives unchanged; the **contents** of slices 1 and 3 do not.

**Slice 3 is now the largest slice, not just the riskiest.** It was "move a `LIKE` search into a query object". It now also carries:

1. **Two projections, not one.** `toUserListProjection` and `toUserDetailProjection` already exist as separate functions in the legacy controller. They map to two mappers, or one mapper with two named projections — the module decides, but the split is now a contract, not an implementation detail. The list deliberately omits `phone` and raw coordinates.
2. **The `location_status` integrity flag**, plus the `logger.warn` that names offending user ids. That warn is a service-layer concern, not a mapper one.
3. **The sort allowlist (F49).** `sortBy` and `sortOrder` reach `ORDER BY` unvalidated today; `?sortOrder[]=x` returns a 500. Spec §3.3 already requires a per-endpoint allowlist, so this closes inside the slice rather than becoming a separate issue.

**Slice 1 gains an error branch.** `GET /api/users/:id` now returns **409 `E_USER_LOCATION_INTEGRITY`** where it used to return a misleading 404. That is a genuine use case for the typed-error taxonomy Phase 1 added — likely a `ConflictError` subclass with a `code` override, which is precisely why the override was added to `AppError`.

**Re-verified against `8b6f8f2`** — every "verified, not assumed" claim above still holds:

| Claim | State |
|---|---|
| `getUserById` uses `findOne`, not `findByPk` | ✅ still true |
| `updateUser` and `uploadUserPhoto` write two entities with **no transaction** | ✅ still true — zero `transaction` references in either |
| 8 exports, 6 mounted; `getProfile`/`updateProfile` unreachable (F19) | ✅ still true |
| `User` is `paranoid: true` | ✅ still true |
| **F25** — post-commit rollback in `createUser` | ✅ **still present**, untouched by #125 |

**The undecided item is unchanged.** `getProfile` and `updateProfile` survived this PR, so spec §3.5.4 still has no answer for the legacy file after slice 6.

**One number moved:** the repository now has **10** migrations, not 9 (`20260727000000-allow-null-location-description.cjs`). The baseline procedure states its ledger check relatively — "must match the number of migration files" — so `db/baseline/README.md` needs no edit, but a dump produced now must carry 10 `sequelizemeta` rows.

### Amended 2026-07-27 — INF-250 / INF-262 landed in PR #129

Slice 3 now extracts the Phase A dual-mode contract. It does not introduce Phase C.

- Pagination is triggered when either `page` or `limit` is supplied; defaults are `page=1` and `limit=20`, the cap is `limit=100`, the paginated path counts the complete result set, and pages beyond the last page return `200` with empty `data` and accurate totals.
- Search covers `full_name`, `nip_nim`, and `email`; `%` and `_` are escaped so they remain literal search characters.
- Filters are `role`, `program`, `division`, `position`, and `location_status`.
- Sorting is allowlisted to `full_name`, `email`, `nip_nim`, `created_at`, and `updated_at`; malformed or unsupported query values receive deterministic `400 E_VALIDATION` responses.
- `location_status=integrity_error` remains a visible recovery state for active users with invalid WFH location integrity; it is not collapsed into a normal not-configured state.
- `UserListItem` is the slim list projection boundary and does not reintroduce phone numbers or raw coordinates.
- Phase B depends on INF-263 moving the Web FE to the server-driven directory contract and verifying that migration.
- Phase C is a separate contract PR, after Phase B evidence, to remove the compatibility branch and make `GET /api/users` always paginated.

---

## The rule every slice obeys

**Extraction is behaviour-preserving. Known defects move with the code.**

The Phase 0b tests are the oracle. A correct slice makes `usersRouteContract`, `usersPayloadContract`, `usersCreateContract`, and `usersUpdateContract` pass **with zero edits to the test files**.

> If a slice requires editing a characterization test, it is not an extraction. It is a behaviour change wearing an extraction's clothes, and it needs its own issue.

Recorded findings that touch this module — F8, F19 among them — stay as they are. Fixes live in INF-253, INF-255, INF-257, INF-258.

---

## One thing this plan does not decide

Spec §3.5 rule 4: *a legacy controller file is removed when its last function has moved.*

`user.controller.js` exports **eight** functions; `users.routes.js` mounts **six**. The other two, `getProfile` and `updateProfile`, are unreachable — no route mounts them, nothing imports them (**F19**, pinned by `controllerExportReachability.test.js`). They contain all four F8 envelope deviations.

They will never "move", because there is no endpoint to move them to. So after slice 6 the file still exists, holding only dead code, and rule 4 has no answer.

**This needs a decision, not a default:**

- **(a)** Delete them in slice 6 and shrink the F19 list in the same commit — the reachability test already requires that pairing.
- **(b)** Leave the file, and close it out in a separate cleanup PR with its own issue.

**(a)** is tidier and the test already supports it. **(b)** keeps slice 6 purely an extraction, which is the discipline every other slice follows. I lean **(b)**, narrowly — slice 6 is already the hardest one, and mixing a deletion into it weakens the "extraction only" rule at exactly the point it is under most pressure.

Not decided here.

---

## Verification per slice

```bash
npm run lint          # the §3.4 layer contract now applies to src/modules/**
npm test              # every Phase 0b contract test, unedited
npm run test:integration   # once Phase 0c is green — mandatory from slice 3 on
```

A slice is done when all three pass, the legacy function is gone, and the diff shows no edits under `tests/`.

Slice 3 must also retain these existing contract tests without edits:

- `tests/usersListPaginationContract.test.js`
- `tests/usersListQueryValidationContract.test.js`
- `tests/usersListSortContract.test.js`
- `tests/usersPayloadContract.test.js`
- `tests/openApiRuntimeDriftContract.test.js`

---

## Docs/ADR note

**DOCS/ADR UPDATE REQUIRED** at the end of Phase 2, not per slice:

- **ADR-009** is still `Proposed`. It should be `Accepted` before slice 1 — it is the document that makes the layer contract binding.
- `docs/architecture/target-modular-mvc.md` gains the users module as the worked reference example.
- `docs/openapi.yaml` should need **no change at all**. If a slice touches it, the slice changed the contract and is out of scope.
