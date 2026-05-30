# INF-155 Linear sync draft — 2026-05-30

Use these as paste-ready Linear comments. Do not change issue status from these notes alone.

## INF-155 — Phase A investigation done

Phase A investigation is complete for the dashboard summary search contract mismatch.

Evidence/spec files prepared in the backend repo:

- Spec: `docs/superpowers/specs/2026-05-30-inf-155-dashboard-search-contract.md`
- Runtime evidence: `docs/inf-155-evidence/RUN_2026-05-30.md`

Findings:

- Backend `GET /api/summary/reports` currently reads only `period`, `from`, `to`, `page`, and `limit`.
- Backend does not currently implement search behavior for `search`, `q`, `query`, or `keyword`.
- Runtime smoke shows all four aliases are accepted at the HTTP layer but produce the same pagination and first-row fingerprint as the baseline request, so they are ignored rather than used for filtering.
- Web FE currently sends all four search aliases (`search`, `q`, `query`, `keyword`) when dashboard search is non-empty.
- Web FE real API path does not apply client-side filtering after fetch, so dashboard search depends on backend filtering.
- Additional mismatch: FE defaults/options include `period=all`/legacy period values, while backend summary report currently accepts only `30d`, `current_month`, and `custom`.

Recommendation for Phase B:

- Standardize canonical dashboard summary search query param as `q`.
- Consider temporary alias support for `search`, `query`, and `keyword` for one migration window.
- Recommended alias precedence if multiple are present: `q > search > query > keyword`.
- Apply search before pagination at the backend query layer so `report.pagination.total_items` reflects filtered results.
- Keep Phase B as a new follow-up implementation issue, not part of this investigation branch.

Open decision needed before Phase B:

- Should `q` filter only `report.data` + pagination, or also top-level summary cards?
- Should period mismatch (`all`, `daily`, `weekly`, `monthly`) be handled in the same follow-up or a separate issue?
- Should backend sort params (`sortBy`, `sortOrder`) remain out of scope for the search standardization issue?

No Linear status change requested from this comment.

## INF-160 — FE heads-up

Heads up for FE dashboard integration:

Backend Phase A investigation for INF-155 found that summary search is not currently implemented server-side.

Current backend behavior:

- Canonical report endpoint is `GET /api/summary/reports`.
- `GET /api/summary` is a deprecated compatibility alias.
- Current supported summary periods are `30d`, `current_month`, and `custom` with `from`/`to`.
- `search`, `q`, `query`, and `keyword` are accepted but ignored by runtime behavior today.

Current FE behavior observed from the local FE `develop` clone:

- Dashboard calls the compatibility route through `/summary`.
- Dashboard service sends all four aliases (`search`, `q`, `query`, `keyword`) when search is non-empty.
- Real API dashboard path does not perform client-side filtering after fetch.
- Dashboard defaults/options include `period=all`, which backend summary report does not accept today.

Recommendation for FE alignment after backend Phase B is approved:

- Prefer canonical route `/api/summary/reports`.
- Prefer canonical search param `q`.
- Continue compatibility only during migration if backend implements temporary aliases.
- Align dashboard period values with backend-supported values unless a separate period-contract issue expands backend support.

Phase B should be tracked as a new backend follow-up issue: “Backend: standardize dashboard summary search query param”.

No Linear status change requested from this comment.
