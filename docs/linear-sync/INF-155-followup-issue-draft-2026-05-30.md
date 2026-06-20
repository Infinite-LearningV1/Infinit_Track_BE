# Linear follow-up issue draft — 2026-05-30

Do not create this issue automatically from this file. User should paste manually after Phase A review.

## Title

Backend: standardize dashboard summary search query param

## Related

- INF-155 — dashboard summary search contract investigation
- INF-160 — Web FE dashboard consumer alignment
- INF-159 — reporting/dashboard analytics boundary

## Background

INF-155 Phase A found a contract mismatch between Web FE dashboard search and backend summary report behavior.

Current backend:

- Canonical report endpoint: `GET /api/summary/reports`.
- Deprecated compatibility alias: `GET /api/summary`.
- `getSummaryReport` reads `period`, `from`, `to`, `page`, and `limit`.
- Search aliases `search`, `q`, `query`, and `keyword` are not currently used by backend query logic.
- Runtime smoke confirms all aliases are accepted at the HTTP layer but ignored for filtering.

Current FE:

- Dashboard service sends all four aliases when search is non-empty.
- Dashboard real API path does not apply client-side filtering after fetch.
- FE currently depends on backend for search semantics.

Phase A evidence:

- Spec: `docs/superpowers/specs/2026-05-30-inf-155-dashboard-search-contract.md`
- Runtime evidence: `docs/inf-155-evidence/RUN_2026-05-30.md`

## Problem

Dashboard search UI can send search intent to the backend, but backend summary report currently ignores search params. This creates a user-visible mismatch: search appears wired in FE, but report rows and pagination remain unchanged.

## Proposed direction

Standardize canonical summary report search on `q`.

Recommended transitional compatibility:

- Canonical param: `q`
- Temporary aliases: `search`, `query`, `keyword`
- Alias precedence if multiple are present: `q > search > query > keyword`
- Add deprecation note for aliases in OpenAPI/docs

## Acceptance criteria

- [ ] `GET /api/summary/reports?q=<term>` filters summary report detail rows before pagination.
- [ ] `report.pagination.total_items` and `total_pages` reflect the filtered dataset.
- [ ] Blank or whitespace-only `q` behaves the same as no search param.
- [ ] Search is case-insensitive for supported text fields where the database collation/runtime supports it, or equivalent lower-case matching is implemented safely.
- [ ] Search covers agreed row fields, at minimum: user full name, NIP/NIM, email, role name, attendance status, and attendance category.
- [ ] Search preserves existing period semantics for `30d`, `current_month`, and `custom`.
- [ ] Search works consistently on both `GET /api/summary/reports` and deprecated alias `GET /api/summary` while the alias remains supported.
- [ ] If transitional aliases are accepted, `search`, `query`, and `keyword` are covered by tests and documented as deprecated aliases.
- [ ] If multiple search aliases are sent, precedence is deterministic and tested.
- [ ] Contract tests prove search is applied before pagination, not only to the current page.
- [ ] OpenAPI documents canonical `q`, alias/deprecation behavior if applicable, and examples.
- [ ] Runtime smoke evidence is captured with sanitized output.

## Decision points before implementation

- [ ] Confirm whether `q` filters only `report.data` + `report.pagination`, or also top-level summary cards.
- [ ] Confirm whether temporary aliases (`search`, `query`, `keyword`) should be accepted and for how long.
- [ ] Confirm alias precedence: recommended `q > search > query > keyword`.
- [ ] Confirm whether period mismatch (`all`, `daily`, `weekly`, `monthly`) is a separate issue.
- [ ] Confirm whether backend sort params (`sortBy`, `sortOrder`) are out of scope for this issue.

## Non-goals

- Do not change attendance final-state semantics.
- Do not change background jobs or scheduler behavior.
- Do not implement FE changes in this backend issue.
- Do not expand accepted period values unless explicitly approved as separate scope.
- Do not implement backend sorting unless explicitly added to this issue.
- Do not remove `/api/summary` compatibility alias in this issue.
- Do not change auth/session behavior.

## Verification plan

Automated tests:

- Add or update summary report contract tests for canonical `q`.
- Test blank `q` equals no search.
- Test search before pagination using enough mock rows to prove filtered `total_items` changes.
- Test supported fields such as full name, NIP/NIM, role, status, and category.
- Test `period=30d`, `period=current_month`, and `period=custom` interactions.
- If aliases are accepted, test `search`, `query`, and `keyword` behavior.
- Test multiple-alias precedence.
- Update OpenAPI contract tests.

Runtime smoke:

- `GET /api/summary/reports?q=nico`
- `GET /api/summary/reports?search=nico` if alias supported
- `GET /api/summary/reports?query=nico` if alias supported
- `GET /api/summary/reports?keyword=nico` if alias supported
- Baseline no-search request for comparison
- All output sanitized: no token, email, NIP/NIM, or full name stored.

Standard checks:

- `npm run lint`
- Relevant focused Jest contract tests
- Full test suite if scope touches shared query helpers or OpenAPI contract tests

## DOCS/ADR UPDATE REQUIRED

Required because this changes an API contract surface and dashboard/reporting boundary.

Expected documentation updates:

- `docs/openapi.yaml`
- `docs/reporting-analytics-boundary.md` if search semantics become a documented reporting boundary rule
- Optional ADR or decision note if product decides summary cards are or are not affected by row search

## Suggested PR notes for Phase B

- Impact: Backend summary report search becomes server-driven and canonicalized on `q`.
- Risk: Pagination and summary-card semantics can confuse consumers if not documented.
- Verification: Contract tests, OpenAPI tests, lint, and sanitized runtime smoke.
- Docs/ADR: Required.
