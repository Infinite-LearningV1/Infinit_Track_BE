# INF-130 Remediation Linear Sync Draft — 2026-05-30

## INF-130 umbrella comment draft

Paste-ready:

```markdown
INF-130 remediation update from `feature/inf-130-n-plus-one-remediation`.

Scope completed:
- Kept existing latest-develop composite index migration `20260529010000-add-attendance-user-date-index.cjs` as canonical; no duplicate `20260530010000-add-attendance-user-date-index.cjs` migration added.
- Locked `discipline.controller.js#getAllDisciplineIndices` with performance guard coverage for one users query + one scoped attendance query for N users.
- Refactored `summary.controller.js#getSummaryReport` to fetch Settings once per request and replace per-user attendance refetches with one scoped full-window attendance fetch for the users present on the current report page.
- Refactored `createGeneralAlpha.job.js` to batch existing-attendance checks and insert missing alpha rows with transactional `bulkCreate(..., { ignoreDuplicates: true })`; retained idempotency with explicit `insertRowsRequested` vs created nuance.
- Refactored `resolveWfaBookings.job.js` unused approved WFA alpha creation to batch existing-attendance checks and insert with transactional `bulkCreate(..., { ignoreDuplicates: true })`; Task B failure propagation preserved, and actual WFA created count is not strictly derivable when duplicates are ignored.
- Reviewed INF-130 #6 `autoCheckout.job.js`; kept as-is because existing batching is acceptable with 10-minute timing tolerance.

Verification evidence:
- `npm run lint`: PASS — eslint completed with no warnings after scoped cleanup.
- `npm test -- --testPathPattern=disciplineIndicesPerformance`: PASS — 1 suite passed, 2 tests passed.
- `npm test -- --testPathPattern=summaryReportPerformance`: PASS — 1 suite passed, 2 tests passed.
- `npm test -- --testPathPattern=createGeneralAlphaJobIdempotency`: PASS — 1 suite passed, 6 tests passed.
- `npm test -- --testPathPattern=resolveWfaBookingsJobIdempotency`: PASS — 1 suite passed, 9 tests passed.
- `npm test -- --testPathPattern=attendanceUserDateIndexMigration`: PASS — 1 suite passed, 5 tests passed.
- `npm test -- --testPathPattern=clientCriticalOpenApiContract`: PASS — 1 suite passed, 15 tests passed.
- `npm test`: PASS — 59 suites passed, 357 tests passed, 0 snapshots, time 8.639s.
- `npm run migrate:status`: Needs Verification — configured DB credentials unavailable; exact output: `ERROR: Access denied for user ''@'172.19.0.1' (using password: NO)`.
- `SHOW INDEX FROM attendance`: Needs Verification — read-only Sequelize query blocked by same configured DB credential gap; exact output: `SequelizeAccessDeniedError: Access denied for user ''@'172.19.0.1' (using password: NO)`.
- Smoke `/api/summary?period=30d&page=1&limit=5`: Needs Verification — local DB/auth context unavailable (`DB_USER`, `DB_PASS`, `DB_NAME`, `DB_HOST`, `JWT_SECRET`, and `PORT` env vars are unset), and DB auth failed before server smoke could be validly executed.
- Smoke `/api/discipline/all?months=1&page=1&limit=5`: Needs Verification — local DB/auth context unavailable (`DB_USER`, `DB_PASS`, `DB_NAME`, `DB_HOST`, `JWT_SECRET`, and `PORT` env vars are unset), and DB auth failed before server smoke could be validly executed.

Risk notes:
- Public route/RBAC surface unchanged.
- Attendance final-state behavior remains inside official jobs.
- Job inserts rely on unique attendance user/date constraint plus `ignoreDuplicates` for idempotency.
- Summary discipline calculation remains full-window for users present on the current report page while avoiding per-user attendance refetch loops; the endpoint now uses one scoped batch attendance fetch for those users.
- DB-backed migration/index verification and authenticated smoke remain Needs Verification until configured local MySQL credentials/schema and auth credentials are available.
```

## INF-133 summary child comment draft

Paste-ready:

```markdown
INF-133 summary N+1 remediation update.

Implemented on `feature/inf-130-n-plus-one-remediation`:
- `getSummaryReport` no longer re-fetches attendance per unique user for discipline metrics.
- Settings lookup for `checkin.start_time` is fetched once per request.
- Discipline metrics use one scoped full-window attendance fetch for users present on the current report page, avoiding page-row-only scoring and per-user loops.
- Existing additive `report.user_attendance_summary` remains present.

Focused verification:
- `npm test -- --testPathPattern=summaryReportPerformance`: PASS — 1 suite passed, 2 tests passed.
- Existing summary regression tests (`summaryReportContract`, `summarySettingsCache`, `summaryDashboardAnalyticsRoute`): PASS — focused reruns passed, and full `npm test` passed 59 suites / 357 tests.
```
