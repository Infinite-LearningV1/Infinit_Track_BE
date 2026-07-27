# INF-252 Phase 2 — List Query Foundation after INF-262

**Status:** Approved migration source of truth
**Supersedes:** [2026-07-27-inf-252-phase2-list-query-design.md](2026-07-27-inf-252-phase2-list-query-design.md)
**Baseline:** `develop` at `df5a491`

## 1. Resolved decisions

| Former decision | Resolution |
|---|---|
| D1 — pagination envelope | Users uses the canonical `{ page, limit, total, totalPages }` object as a sibling of `data`; attendance and reports migrate separately |
| D2 — paginate users | Yes; opt-in in Phase A, always paginated only after INF-263 in Phase C |
| D3 — search fields | Per-endpoint allowlist; Users searches `full_name`, `nip_nim`, and `email` |

## 2. Current contract — Phase A

Phase A is the live compatibility contract at `df5a491`. `GET /api/users` preserves the legacy full-array response when both `page` and `limit` are omitted. Supplying either parameter enables pagination, with `page=1`, `limit=20`, and maximum `limit=100`.

Paginated responses keep `data` and the canonical pagination object as siblings:

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

Users search `full_name`, `nip_nim`, and `email`, with literal handling for `%` and `_`. Filters are `role`, `program`, `division`, `position`, and `location_status`; sort fields are restricted to `full_name`, `email`, `nip_nim`, `created_at`, and `updated_at`. Invalid query values return deterministic `400 E_VALIDATION`; pages past the last page return `200` with empty `data` and accurate totals.

## 3. Client migration — Phase B

INF-263 moves the Web FE to the server-driven directory contract. Every directory request sends `page` and `limit`; search, filters, and sorting go to the backend; URL state represents the directory query; and the client renders server pagination metadata without a second hidden pagination layer. Verification requires data spanning at least two pages.

Phase B must be verified before the Phase A compatibility path can be removed.

## 4. Target contract — Phase C

After INF-263 is deployed and verified, a separate backend contract-change issue and PR will make `GET /api/users` always paginated. Omitting parameters will use `page=1` and `limit=20`; the legacy full-array branch will be removed; the canonical envelope and maximum `limit=100` remain. That delivery updates OpenAPI, contract tests, shared context, release notes, and client compatibility evidence together.

Phase C is approved target architecture, not current runtime.

## 5. Modular MVC ownership

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

Extraction preserves both the Phase A `findAll` compatibility path and the paginated `findAndCountAll` path.

## 6. Shared list-query boundary

Shared code may own scalar pagination parsing, escaped LIKE construction, and canonical pagination metadata only when the ADR-009 two-consumer rule is satisfied. The Users module owns its public field lists and feature-specific association graph. The extraction must not create a global query specification containing user-specific fields.

## 7. Extraction invariants

- Preserve the public Phase A response shapes and status codes.
- Preserve deterministic validation, including rejection of malformed array-shaped query values.
- Preserve successful empty pages and accurate totals.
- Preserve `location_status=integrity_error` as a visible recovery state, not a normal not-configured state.
- Do not introduce Phase C as an accidental side effect of moving files.
- Do not remove the full-array compatibility path until Phase B evidence exists and a separate Phase C contract PR is approved.

## 8. Verification gates

- Verify the extraction preserves both Phase A paths and all documented query validation.
- Verify a paginated request returns the canonical sibling `pagination` object with accurate totals, including an empty page beyond the last page.
- Verify search, filters, sort allowlists, and literal `%` and `_` handling.
- Verify INF-263 client compatibility evidence before any Phase C contract change.
- Run `npm run lint`, `npm test`, and `git diff --check` for a migration delivery.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Phase C is mistaken for current runtime | Keep Phase A explicitly current and label Phase C as target |
| Extraction removes compatibility | Preserve both query paths and require INF-263 evidence before Phase C |
| Shared query code absorbs feature policy | Apply the two-consumer rule and keep Users fields and joins feature-owned |
| Attendance or reports are treated as resolved | Migrate those contracts separately |

## 10. Out of scope

- Changing `GET /api/users` runtime behavior.
- Implementing INF-263.
- Migrating controller code into `src/modules/users/`.
- Unifying attendance or summary-report pagination.
- Changing authentication, role authorization, database schema, Docker, deployment, or Linear issue states.
