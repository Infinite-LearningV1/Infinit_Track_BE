# INF-171 Summary Search and Period Query Contract Design — 2026-05-30

Branch: `feature/inf-171-summary-search-period-contract`  
Issue: INF-171 — Backend: standardize dashboard summary search query param  
Design status: approved direction from user, pending final user review before implementation plan.

## Goal

Align backend summary report query behavior with the dashboard contract so Web FE can use dashboard-native period values and canonical search without relying on ignored aliases or unsupported `period=all` behavior.

This design updates the scope of INF-171 from search-only to a unified dashboard summary query contract:

- canonical search param: `q`,
- temporary deprecated search aliases: `search`, `query`, `keyword`,
- canonical dashboard periods: `daily`, `weekly`, `monthly`, `range`,
- explicit rejection of `all`,
- transitional legacy compatibility for existing backend consumers.

## Current facts

- `GET /api/summary/reports` is the canonical report/export surface.
- `GET /api/summary` is a deprecated compatibility alias for the same handler.
- `getSummaryReport` currently reads only `period`, `from`, `to`, `page`, and `limit`.
- Current accepted backend periods are `30d`, `current_month`, and `custom`.
- Current backend ignores `search`, `q`, `query`, and `keyword`.
- Runtime evidence from INF-155 shows baseline and all search aliases returned identical pagination and first-row fingerprint.
- Web FE dashboard currently sends all search aliases and uses `period=all`, but INF-171 should remove `all` from the dashboard contract.

References:

- INF-155 investigation: `docs/superpowers/specs/2026-05-30-inf-155-dashboard-search-contract.md`
- INF-155 evidence: `docs/inf-155-evidence/RUN_2026-05-30.md`
- INF-171 Linear issue: https://linear.app/infinite-track-palu/issue/INF-171/backend-standardize-dashboard-summary-search-query-param

## User-approved decisions

1. Search filters only `report.data` and `report.pagination`.
2. Top-level `summary` remains period-wide and is not filtered by `q`.
3. Backend accepts deprecated search aliases temporarily.
4. Search alias precedence is `q > search > query > keyword`.
5. Dashboard canonical periods are rolling-window based:
   - `daily` = today only,
   - `weekly` = rolling last 7 days including today,
   - `monthly` = rolling last 30 days including today,
   - `range` = explicit `from`/`to` date range.
6. `all` is removed from the dashboard summary report contract and should be rejected.
7. Backend sorting params (`sortBy`, `sortOrder`) remain out of scope.
8. FE implementation remains out of scope.

## API contract

### Endpoints

Canonical:

```http
GET /api/summary/reports
```

Deprecated alias:

```http
GET /api/summary
```

Both endpoints must remain behaviorally equivalent for the same query.

### Canonical period values

| Query | Effective window | Notes |
| --- | --- | --- |
| `period=daily` | Today to today, Asia/Jakarta date | Canonical dashboard period |
| `period=weekly` | Today minus 6 days through today | Rolling 7-day window |
| `period=monthly` | Today minus 29 days through today | Rolling 30-day window |
| `period=range&from=YYYY-MM-DD&to=YYYY-MM-DD` | Inclusive custom range | Max 31 days, same guardrail as existing custom |

### Legacy period compatibility

| Query | Behavior | Status |
| --- | --- | --- |
| `period=30d` | Same effective window as `monthly` | Deprecated compatibility alias |
| `period=custom&from=YYYY-MM-DD&to=YYYY-MM-DD` | Same behavior as `range` | Deprecated compatibility alias |
| `period=current_month` | Current calendar month through today | Legacy compatibility mode, not dashboard canonical |

### Rejected period

```http
GET /api/summary/reports?period=all
```

Returns `400 E_VALIDATION`. Unlimited/all-time report behavior is not part of this dashboard summary contract.

### Search params

Canonical:

```http
?q=<term>
```

Deprecated temporary aliases:

```http
?search=<term>
?query=<term>
?keyword=<term>
```

Precedence when multiple aliases are present:

```text
q > search > query > keyword
```

Blank or whitespace-only search is treated the same as no search.

### Search effect

Search applies only to:

- `report.data`,
- `report.pagination.total_items`,
- `report.pagination.total_pages`,
- `report.pagination.has_next_page`,
- `report.pagination.has_prev_page`.

Search does not apply to:

- top-level `summary`,
- `analytics.discipline_analysis`,
- `report.user_attendance_summary`,
- `date_range`,
- `period`.

Reason: top-level summary cards remain period-wide KPI values. Search narrows the visible report rows, not the period-wide dashboard totals.

## Backend design

### `src/utils/historicalDateWindow.js`

Extend the historical window helper to support both canonical dashboard periods and legacy compatibility periods.

Accepted period values:

- `daily`
- `weekly`
- `monthly`
- `range`
- `30d`
- `current_month`
- `custom`

Rejected:

- `all`
- old FE-only values not approved in this design
- any unknown period

Behavior:

- `daily`: uses Jakarta today for both start and end.
- `weekly`: uses Jakarta today minus 6 days through Jakarta today.
- `monthly`: uses Jakarta today minus 29 days through Jakarta today.
- `range`: requires valid `from` and `to`.
- `custom`: same date validation and effective window as `range`.
- `30d`: same effective window as `monthly`.
- `current_month`: current calendar month through Jakarta today.

Validation messages should remain `E_VALIDATION` at the controller boundary. Message text can be updated to list accepted values and explain `range/custom` date requirements.

### `src/controllers/summary.controller.js`

`getSummaryReport` should:

1. Read `period`, `from`, `to`, `page`, `limit`, `q`, `search`, `query`, and `keyword`.
2. Resolve a single search term using precedence `q > search > query > keyword`.
3. Treat blank/whitespace-only terms as no search.
4. Build the effective date window using the updated helper.
5. Keep top-level status/category summary aggregate queries date-window-only.
6. Build detail report query with date window and optional search conditions.
7. Apply search before pagination at the DB query layer.
8. Use `distinct: true` for `findAndCountAll` to protect count semantics with joins.
9. Preserve the existing response shape.

Recommended searchable fields:

- `$user.full_name$`
- `$user.nip_nim$`
- `$user.email$`
- `$user.role.role_name$`
- `$status.attendance_status_name$`
- `$attendance_category.category_name$`

`Location` search is intentionally excluded for this issue to keep scope focused on dashboard table identity/status/category fields.

### `src/utils/searchHelper.js`

Reuse the existing `applySearch` helper if it works with the summary query aliases and nested Sequelize paths.

If helper changes are necessary, keep them backwards-compatible with attendance search.

A small summary-specific resolver can live near the summary controller if needed:

```js
resolveSummarySearchTerm({ q, search, query, keyword })
```

This resolver is contract-specific and should be tested through controller behavior.

## OpenAPI and docs design

### `docs/openapi.yaml`

Update both `/api/summary/reports` and `/api/summary`:

- `period` enum should include canonical dashboard values and legacy accepted values.
- `all` must not be in the enum.
- Add canonical query param `q`.
- Add deprecated alias params `search`, `query`, and `keyword` with descriptions.
- Document that `q` filters `report.data` before pagination only.
- Document that top-level `summary` remains period-wide.
- Document that `range` requires `from` and `to` and has the existing max 31-day range guardrail.

### `docs/reporting-analytics-boundary.md`

Update consumer rules:

- Use `/api/summary/reports` for dashboard report rows and exports.
- Use `q` as canonical summary report search.
- Use canonical dashboard periods `daily`, `weekly`, `monthly`, and `range`.
- Do not use `period=all` for dashboard summary reports.
- Treat top-level `summary` as period-wide KPI totals, not search-filtered totals.

### ADR requirement

A full ADR is optional if OpenAPI and boundary docs clearly capture the decision. PR notes must still include `DOCS/ADR UPDATE REQUIRED` because this changes an API contract surface.

## Error handling

### Unsupported period

Unknown periods, including `all`, return:

```json
{
  "success": false,
  "code": "E_VALIDATION",
  "message": "Parameter period harus berupa: daily, weekly, monthly, range, 30d, current_month, atau custom"
}
```

Exact wording can be adjusted, but it must not list `all` as accepted.

### Missing range boundaries

For `period=range` or `period=custom`, missing either `from` or `to` returns `400 E_VALIDATION`.

### Invalid dates

Existing strict `YYYY-MM-DD` validation remains.

### Date range too large

Existing max 31-day custom range guardrail remains for `range` and `custom`.

### Search with no results

Return `200` with:

- `report.data: []`,
- `pagination.total_items: 0`,
- `pagination.total_pages: 0` using the current formula convention.

## Testing strategy

### Summary report contract tests

Extend `tests/summaryReportContract.test.js` to cover:

- `period=daily` accepted.
- `period=weekly` accepted.
- `period=monthly` accepted.
- `period=range` accepted with `from` and `to`.
- `period=all` rejected with `400 E_VALIDATION` and no DB calls.
- Legacy `30d`, `current_month`, and `custom` still accepted.
- `q` search applies before pagination.
- Top-level summary queries remain date-only and do not receive search conditions.
- Blank `q` behaves like no search.
- `search`, `query`, and `keyword` aliases work when higher-precedence aliases are absent.
- Alias precedence uses `q > search > query > keyword`.

### OpenAPI contract tests

Update `tests/clientCriticalOpenApiContract.test.js` to assert:

- Summary report period enum includes canonical dashboard periods.
- `all` is not documented as accepted.
- `q` is documented on both canonical and deprecated alias routes.
- Deprecated search aliases are documented as deprecated.
- Response schema remains `SummaryReportResponse`.

### Route tests

Existing route equivalence coverage should continue to pass. Add explicit query pass-through coverage only if route tests need to guard the new `q` contract.

### Runtime smoke

After implementation, capture sanitized smoke evidence for:

- baseline no-search,
- `q=nico`,
- alias searches if supported,
- `period=daily`,
- `period=weekly`,
- `period=monthly`,
- `period=range&from=...&to=...`,
- `period=all` rejected.

Never store token, email, full name, or NIP/NIM in evidence.

### Standard verification

Run:

- `npm run lint`
- focused summary tests
- focused OpenAPI contract tests
- full `npm test`

## Risks and mitigations

### Search/card semantics confusion

Risk: consumers may expect `q` to filter top-level summary cards.

Mitigation: OpenAPI and boundary docs explicitly say `q` filters only report rows and pagination.

### Join count duplication

Risk: `findAndCountAll` with joined search fields can over-count.

Mitigation: use `distinct: true` in the summary detail query and add tests that check filtered count semantics.

### Legacy period ambiguity

Risk: `monthly` means rolling 30 days while `current_month` means calendar month.

Mitigation: docs distinguish canonical `monthly` from legacy `current_month`.

### `all` rejection affects FE

Risk: FE currently uses `period=all` and will receive 400 until migrated.

Mitigation: this is intentional per user decision. INF-160 already has a heads-up comment. PR notes must call out the impact.

### Search helper regression

Risk: changing shared `searchHelper` could affect attendance search.

Mitigation: prefer summary-local resolver and backward-compatible helper usage. Run existing attendance tests.

## Non-goals

- Do not implement FE changes.
- Do not implement backend sorting (`sortBy`, `sortOrder`).
- Do not change attendance final-state behavior.
- Do not change scheduler/background jobs.
- Do not change auth/session behavior.
- Do not remove `/api/summary` alias.
- Do not change `/api/summary/dashboard-analytics`.
- Do not change `/api/attendance/today-locations`.

## Definition of done

INF-171 implementation is done only when:

- canonical periods are implemented and tested,
- `all` is rejected and tested,
- `q` filters report rows before pagination,
- deprecated aliases are implemented and tested,
- top-level summary remains period-wide and is tested/documented,
- OpenAPI and boundary docs are updated,
- sanitized runtime smoke is captured,
- lint, focused tests, and full test suite pass,
- PR notes include impact, risk, verification evidence, and docs/ADR update note.
