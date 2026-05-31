# INF-155 Dashboard Search Contract Investigation — 2026-05-30

Phase: A — investigation only  
Scope: dashboard search contract mismatch between Web FE summary dashboard caller and backend summary report API.  
Non-runtime guarantee: this document records current behavior and recommended Phase B direction only. It does not change endpoint logic, query behavior, OpenAPI, or tests.

## Goal

Document the current backend and FE contract for dashboard summary report search, identify mismatches, and prepare a Phase B implementation decision without changing runtime behavior in this branch.

## Current state backend

### Route surface

- Canonical report route: `GET /api/summary/reports`.
- Deprecated compatibility alias: `GET /api/summary`.
- Both route paths are registered through the same helper and call `getSummaryReport` with `verifyToken` and `roleGuard(['Admin', 'Management'])`.
- Evidence: `src/routes/summary.routes.js:10-23`.

### Query parameters read by `getSummaryReport`

`getSummaryReport` currently destructures only:

- `period`, default `30d`
- `from`, default `null`
- `to`, default `null`
- `page`, default `1`
- `limit`, default `10`

Evidence: `src/controllers/summary.controller.js:153-166`.

The controller does not read or apply any of these candidate search params:

- `search`
- `q`
- `query`
- `keyword`

### Search behavior

Current code evidence shows no backend search filter in `getSummaryReport`:

- Aggregate summary queries use only `whereClause` based on the effective date window.
- Detail report query uses the same `whereClause`, pagination `limit`, and `offset`.
- No `User.full_name`, `User.email`, `nip_nim`, role, status, or category search condition is added.

Evidence:

- `whereClause` date-only construction: `src/controllers/summary.controller.js:173-178`
- aggregate status/category queries: `src/controllers/summary.controller.js:183-210`
- detail `findAndCountAll` query: `src/controllers/summary.controller.js:281-328`

Phase A conclusion from code evidence: `search`, `q`, `query`, and `keyword` are accepted by HTTP transport as unknown query params, but are ignored by current summary report query logic. Runtime evidence is recorded separately in `docs/inf-155-evidence/RUN_2026-05-30.md`.

### Search scope: per-page vs global dataset

Because backend search is not currently implemented, there is no effective per-page or global dataset search behavior today.

Recommended Phase B decision: if adopted, backend search should be applied before pagination at the database query layer, so pagination metadata reflects the filtered dataset rather than filtering only the current page.

### Period relationship

Backend summary report period contract currently accepts:

- `30d`
- `current_month`
- `custom` with `from` and `to`

`all` is not part of the backend historical window contract.

Evidence:

- `HISTORICAL_WINDOW_PERIODS`: `src/utils/historicalDateWindow.js:4`
- validation message for unsupported period: `src/utils/historicalDateWindow.js:35-38`
- controller validation before querying: `src/controllers/summary.controller.js:157-164`
- OpenAPI contract test expects `['30d', 'current_month', 'custom']`: `tests/clientCriticalOpenApiContract.test.js:329-370`

## Current state FE

FE evidence source used for this investigation: clean local Web FE clone at `E:\skrisi\clonefee\Infinite_Track_Fe` on branch `develop`. A second clone at `E:\skrisi\clone_fe\Infinite_Track_Fe` has local modified files and was not used as source evidence.

### FE service caller

`ReportService.getSummaryReport()` currently defaults to:

- `period = "all"`
- `page = 1`
- `limit = 10`
- `search = ""`
- optional `sortBy`
- `sortOrder = "asc"`

When search is non-empty, the FE sends all four search aliases at once:

- `search`
- `q`
- `query`
- `keyword`

It calls the deprecated compatibility route `${API_CONFIG.BASE_URL}/summary`, not `/summary/reports`.

Evidence: `E:\skrisi\clonefee\Infinite_Track_Fe\src\js\services\reportService.js:23-52`.

### FE dashboard caller

`dashboard.loadSummaryData()` sends:

- `period: this.filters.period`
- `page: this.filters.page`
- `limit: this.filters.limit`
- `search: this.searchQuery`
- `sortBy: this.filters.sortBy`
- `sortOrder: this.filters.sortOrder`

Evidence: `E:\skrisi\clonefee\Infinite_Track_Fe\src\js\features\dashboard\dashboard.js:161-180`.

### FE client-side filtering

For the real API response path, dashboard maps backend rows directly into `attendanceData` / `reportData`; no client-side search filtering is applied after fetch.

Evidence: `E:\skrisi\clonefee\Infinite_Track_Fe\src\js\features\dashboard\dashboard.js:210-281`.

Client-side search filtering exists only in mock data generation (`getMockSummaryData()`), not in the real API path.

Evidence: `E:\skrisi\clonefee\Infinite_Track_Fe\src\js\services\reportService.js:196-211`.

### `period=all` influence

FE default period is `all` in both component state and filters:

- component state: `dashboard.js:23`
- filter state: `dashboard.js:36-42`
- UI options include `all`, `daily`, `weekly`, `monthly`: `dashboard.js:107-113`

Backend summary report does not accept `all`, `daily`, `weekly`, or `monthly` in the current historical window contract. This means the period mismatch can block dashboard data before search behavior is even observable unless FE sends a backend-supported period.

## Identified mismatches

| Area | Backend current state | FE current state | Impact |
| --- | --- | --- | --- |
| Search canonical param | No search param implemented | Sends `search`, `q`, `query`, and `keyword` together | FE search input appears server-driven but backend ignores it. |
| Search semantics | No per-page/global search semantics | Dashboard relies on backend response; no real API client-side filter | Search result rows and pagination do not reflect search intent. |
| Canonical route | `/api/summary/reports` is canonical; `/api/summary` deprecated alias | Uses `/summary` | Works only through compatibility alias; migration remains incomplete. |
| Period values | `30d`, `current_month`, `custom` | Defaults/options include `all`, `daily`, `weekly`, `monthly` | Backend may reject FE default period before search can work. |
| Sort params | No backend sort params implemented in summary report | Sends optional `sortBy`, `sortOrder` | Sort intent is ignored today; should be separate from search scope unless Phase B explicitly includes it. |

## Recommendation: canonical query param

Recommend standardizing backend dashboard summary report search on `q` in Phase B.

Rationale:

- Short and conventional for free-text search.
- Avoids collision with generic `query` naming in code and logs.
- Keeps room for explicit future filters (`status`, `role`, `category`, `from`, `to`) without overloading `search`.
- FE already sends `q` today, so backend can adopt `q` with minimal FE breakage.

Recommended Phase B compatibility strategy:

1. Canonical: `q`.
2. Transitional aliases: accept `search`, `query`, and `keyword` for one migration window.
3. Precedence if multiple aliases are present: `q` wins, then `search`, then `query`, then `keyword`.
4. Add deprecation notes for non-`q` aliases in OpenAPI/docs.
5. Emit no runtime behavior change in Phase A.

## Recommended Phase B semantics

If adopted in a new follow-up issue, `q` should:

- Apply to the detail report row query before pagination.
- Update `report.pagination.total_items` and `total_pages` based on filtered rows.
- Search safe text fields only, such as user full name, NIP/NIM, email, role name, status name, and category name.
- Preserve existing date-window semantics (`30d`, `current_month`, `custom`).
- Avoid changing summary aggregate cards unless explicitly decided. Current recommendation: summary totals remain period-wide, while `report.data` and `report.pagination` reflect row search. This needs user/product decision because dashboard UX may expect either behavior.

## Impact if adopted

Phase B implementation would be API-significant and docs-significant.

Expected updates:

- Controller/search query logic in `src/controllers/summary.controller.js`.
- Contract tests in `tests/summaryReportContract.test.js` or a new focused summary search contract test.
- Route/OpenAPI documentation in `docs/openapi.yaml`.
- Consumer guide update in `docs/reporting-analytics-boundary.md` if search semantics become a documented boundary rule.
- Deprecation note for `search`, `query`, and `keyword` aliases if transitional support is accepted.
- FE migration guidance for INF-160: prefer `/api/summary/reports`, `period=30d/current_month/custom`, and canonical `q`.

DOCS/ADR update required for Phase B: yes, because this changes the API contract surface and dashboard/reporting boundary.

## Risks

- **Contract ambiguity risk:** accepting four aliases forever makes API behavior harder to document and test.
- **Pagination risk:** filtering after pagination would produce confusing pages; filtering before pagination requires careful DB query/count behavior.
- **Aggregate consistency risk:** deciding whether search affects summary cards as well as rows changes dashboard meaning.
- **Period mismatch risk:** FE `period=all` may continue to fail even after search is implemented unless period contract is addressed separately.
- **Performance risk:** broad LIKE search across joined user/status/category tables may need indexes or bounded limits if datasets grow.
- **PII risk:** runtime evidence and logs must not store real emails, tokens, or raw employee identifiers.

## Verification plan

Phase A evidence:

- Read current backend controller/route/validator/tests.
- Read current FE caller behavior read-only.
- Run smoke curl set for:
  - `GET /api/summary/reports?search=nico`
  - `GET /api/summary/reports?q=nico`
  - `GET /api/summary/reports?query=nico`
  - `GET /api/summary/reports?keyword=nico`
- Sanitize tokens/emails/PII from captured response.
- Run `npm run lint` to confirm no accidental runtime/code style changes.

Phase B implementation verification, if approved later:

- Unit/contract tests proving `q` filters before pagination.
- Alias compatibility tests for `search`, `query`, and `keyword` if transitional support is chosen.
- Test precedence when multiple aliases are present.
- Test unsupported/blank `q` behavior.
- Test interaction with `period=30d`, `period=current_month`, and `period=custom`.
- OpenAPI contract tests for documented query params and deprecation notes.
- Runtime smoke with sanitized seeded data.

## Questions requiring user/product decision

1. Should `q` search filter only `report.data` rows and pagination, or should it also filter top-level summary cards?
2. Should backend keep accepting `search`, `query`, and `keyword` as transitional aliases? If yes, for how long?
3. Should alias precedence be `q > search > query > keyword` when FE sends multiple aliases?
4. Should Phase B also address FE/backend period mismatch (`all`, `daily`, `weekly`, `monthly`) or should that be a separate issue from INF-155?
5. Should FE migrate from `/api/summary` to canonical `/api/summary/reports` in INF-160, or stay on compatibility alias until backend Phase B lands?
6. Should backend implement sort params (`sortBy`, `sortOrder`) in the same follow-up issue, or keep sorting out of scope for dashboard search standardization?

## Phase boundary

Phase A output is investigation evidence and draft planning only. Do not infer from this document that `q` is implemented or already part of runtime behavior. Implementation belongs in a new Phase B follow-up issue.
