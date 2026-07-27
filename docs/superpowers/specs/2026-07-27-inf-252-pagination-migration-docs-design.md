# INF-252 Pagination Migration Documentation Refresh: Design Spec

**Linear:** [INF-252](https://linear.app/infinite-track-palu/issue/INF-252/backendarchitecture-adopt-modular-mvc-per-feature-with-safe), [INF-250](https://linear.app/infinite-track-palu/issue/INF-250/cross-repo-define-scalable-user-directory-search-filter-sort-and), [INF-262](https://linear.app/infinite-track-palu/issue/INF-262/backend-implement-server-driven-get-users-directory-query-inf-250), [INF-263](https://linear.app/infinite-track-palu/issue/INF-263/web-fe-consume-server-driven-user-directory-pagination-search-filter)
**Date:** 2026-07-27
**Status:** Approved design
**Baseline:** `develop` at merge commit `df5a491` (PR #129)
**Scope:** Documentation alignment only. No runtime, route, response, database, Docker, or Linear-state changes.

---

## 1. Problem

PR #129 implemented the INF-250 contract for `GET /api/users`, but the migration documentation still describes the pre-INF-262 architecture:

- the Phase 2 list-query spec says the user directory has no pagination;
- it treats the pagination envelope and the decision to paginate users as unresolved;
- the Users-module migration plan describes moving the older two-field search and unvalidated sorting implementation;
- the target Modular MVC document explains query-object ownership generically but does not show how the live user-directory contract maps into that ownership;
- the API contract inventory contains a stale endpoint-table row even though later sections correctly record INF-262.

This creates a migration hazard. An implementer following the old design could preserve or recreate the wrong contract while extracting `getAllUsers` into the Users module.

## 2. Decision

Use a **superseding-document strategy**:

1. Preserve the original Phase 2 list-query design as historical evidence.
2. Mark it explicitly as superseded by a new post-INF-262 design.
3. Make the new design the source of truth for migrating the user-directory query into Modular MVC.
4. Keep OpenAPI truthful to the current Phase A runtime until a later runtime PR implements Phase C.
5. Record current, transitional, and target states separately so future intent cannot be mistaken for live behavior.

The old document is not silently rewritten because it records the facts and trade-offs that led to INF-250. The new document resolves those decisions using the evidence from INF-250, INF-262, and PR #129.

## 3. Contract lifecycle

### Phase A — current backend compatibility mode

This is the live contract at `df5a491`:

- `GET /api/users` without `page` and `limit` preserves the legacy full-array response.
- Supplying either `page` or `limit` enables server pagination.
- Defaults in paginated mode are `page=1` and `limit=20`.
- The maximum `limit` is `100`.
- Paginated responses use:

```json
{
  "success": true,
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0
  },
  "message": "Users fetched successfully"
}
```

- Search covers `full_name`, `nip_nim`, and `email`, with literal handling for `%` and `_`.
- Filters are `role`, `program`, `division`, `position`, and `location_status`.
- Sort fields are restricted to `full_name`, `email`, `nip_nim`, `created_at`, and `updated_at`.
- Invalid query values return deterministic `400 E_VALIDATION`.
- A page beyond the last page returns `200`, an empty `data` array, and accurate totals.

Phase A is intentionally transitional. It is not the target state for a scalable directory.

### Phase B — Web FE cutover

INF-263 moves the Web FE to the server-driven contract:

- every directory request sends `page` and `limit`;
- search, filters, and sorting are sent to the backend;
- URL state represents the directory query;
- the client renders the server-provided pagination metadata;
- the client does not apply a second hidden pagination layer;
- verification uses a dataset spanning at least two pages.

Phase B must be verified before removing the compatibility path.

### Phase C — target backend contract

After INF-263 is deployed and verified, a separate backend contract-change issue and PR will:

- make `GET /api/users` always paginated;
- apply `page=1` and `limit=20` when the client omits them;
- remove the legacy full-array response branch;
- retain the canonical envelope and maximum `limit=100`;
- update OpenAPI, contract tests, shared context, release notes, and client compatibility evidence in the same delivery cycle.

Phase C is approved target architecture, not current runtime. Documentation must label it accordingly.

## 4. Target Modular MVC ownership

The migration preserves the public Phase A contract first. It must not introduce Phase C as an accidental side effect of moving files.

```text
user.routes.js
  -> user.validation.js
  -> user.controller.js
  -> user.service.js
  -> user.query.js
  -> Sequelize models
  -> user.mapper.js
  -> user.controller.js response
```

### `user.routes.js`

- Wires authentication, role guards, query validation, and the controller.
- Does not interpret pagination, filters, or sort values.

### `user.validation.js`

- Owns transport validation and normalization for all documented query parameters.
- Rejects arrays and malformed scalar values.
- Enforces integer bounds, enums, and the sort allowlist.
- Produces the same `400 E_VALIDATION` contract as Phase A.

### `user.controller.js`

- Reads validated query input.
- Calls one service operation.
- Returns the response envelope supplied by the use case.
- Contains no Sequelize operators, includes, sorting map, count logic, or integrity scanning.

### `user.service.js`

- Orchestrates the directory use case.
- Calls the query object and mapper.
- Owns the warning for active users whose `location_status` is `integrity_error`.
- Does not know about Express request or response objects.

### `user.query.js`

- Owns the `where` clause, associations, selected attributes, search predicates, filters, sort mapping, `findAll` compatibility path, and `findAndCountAll` paginated path.
- Preserves `distinct: true` and `subQuery: false` while the association topology remains compatible with those choices.
- Returns query results and count data; it does not construct HTTP responses.
- Uses per-endpoint allowlists. No client-provided column name reaches Sequelize directly.

### `user.mapper.js`

- Produces the stable slim `UserListItem`.
- Does not reintroduce phone numbers or raw coordinates.
- Preserves `location_status` semantics.

### Shared query primitives

Shared code may own mechanisms such as scalar pagination parsing, escaped LIKE construction, and canonical pagination metadata only when the ADR-009 two-consumer rule is satisfied. The Users module owns its public field lists and feature-specific association graph.

The architecture migration must not create a global query specification containing user-specific fields.

## 5. Documentation changes

### Create

`docs/superpowers/specs/2026-07-27-inf-252-list-query-post-inf262-design.md`

- Becomes the binding post-INF-262 design for the list-query foundation and Users-module extraction.
- Records the Phase A/B/C lifecycle.
- Resolves the old D1/D2/D3 decisions with the accepted INF-250 contract.
- Defines feature and shared ownership boundaries.

### Modify

`docs/superpowers/specs/2026-07-27-inf-252-phase2-list-query-design.md`

- Add a prominent `Superseded` status and link to the replacement.
- Preserve the historical body.

`docs/superpowers/plans/2026-07-27-inf-252-phase2-users-module.md`

- Add a post-INF-262 amendment.
- Replace stale Slice 3 assumptions with the live query matrix.
- State that extraction preserves Phase A and that Phase C requires a separate contract PR.
- Map query, validation, service, and mapper responsibilities.

`docs/architecture/target-modular-mvc.md`

- Add the user-directory list flow as the worked query-object example.
- Show the boundary between feature-owned contract and shared mechanism.
- Add the Phase A preservation rule and Phase C non-goal for extraction.

`docs/architecture/api-contract-inventory.md`

- Correct the stale `/api/users` endpoint row.
- Reconcile stale findings text with the already-recorded INF-262 closure.
- Keep unrelated attendance and summary pagination inconsistencies open.

`docs/openapi.yaml`

- No semantic change in this documentation refresh.
- It continues to describe Phase A because OpenAPI represents live runtime, not future architecture.
- It changes only in the later Phase C runtime delivery.

`docs/adr/ADR-009-modular-mvc-per-feature.md`

- Keep `Status: Proposed`.
- Add no acceptance claim.
- The refreshed docs may link to ADR-009, but only the decider can accept it.

## 6. Source-of-truth rules

The refreshed documents use these labels:

- **Current:** verified in the live repository/runtime at `df5a491`.
- **Transitional:** approved and implemented for compatibility, but scheduled for removal.
- **Target:** approved future contract that is not yet live.
- **Historical:** accurate record of an earlier decision point, superseded for implementation.

When documents conflict:

1. runtime and code establish current behavior;
2. OpenAPI describes the current public contract;
3. the new post-INF-262 design controls migration structure and target state;
4. the old Phase 2 design remains historical only.

## 7. Error and compatibility handling

- The architecture extraction must preserve Phase A status codes and response shapes.
- Validation remains deterministic and rejects malformed array-shaped query values.
- Empty pages remain successful responses.
- `location_status=integrity_error` remains a visible recovery state, not a normal “not configured” state.
- Phase C cannot be merged until INF-263 compatibility evidence exists.
- Removing the full-array path without that evidence is a breaking contract change.

## 8. Verification

The documentation refresh is complete when:

1. no active migration document says `/api/users` lacks pagination;
2. no active migration document treats INF-250 pagination decisions as unresolved;
3. every future-state statement is labelled Phase C or target;
4. OpenAPI remains aligned with Phase A runtime;
5. the inventory table and findings register agree;
6. links between historical, current, and superseding documents resolve;
7. `npm run lint` passes;
8. `npm test` passes, including OpenAPI drift and findings-register guards;
9. `git diff --check` reports no whitespace errors.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Future Phase C is mistaken for current runtime | Keep OpenAPI on Phase A and label every Phase C statement as target |
| Migration silently removes legacy compatibility | State that extraction is behavior-preserving and Phase C needs a separate issue/PR |
| Historical evidence is lost | Preserve the old design body and add only a superseded banner |
| Shared query code absorbs feature policy | Document the two-consumer rule and keep field lists/joins inside Users |
| Attendance or reporting pagination is accidentally declared resolved | Keep F39 and unrelated endpoint contracts explicitly out of scope |
| ADR acceptance is implied without authority | Keep ADR-009 `Proposed` |

## 10. Out of scope

- Changing `GET /api/users` runtime behavior.
- Implementing INF-263.
- Migrating controller code into `src/modules/users/`.
- Unifying attendance or summary-report pagination.
- Changing authentication, role authorization, database schema, Docker, or deployment.
- Updating Linear issue states.
