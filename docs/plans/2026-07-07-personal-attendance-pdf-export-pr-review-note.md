# PR / Review Note — Personal Attendance PDF Export

Branch: `fix/backend-personal-attendance-pdf-export`
Worktree: `C:\Users\Febriyadi\.claude\worktrees\backend-personal-attendance-pdf-export`
Base: `develop` @ `d5af9b1`
Date: 2026-07-07

## Summary

Implemented backend-generated Personal Attendance PDF export for Android My Attendance Report.

Final endpoints:

- Preview: `GET /api/attendance/history/personal/pdf`
- Download/share: `GET /api/attendance/history/export.pdf?period=monthly`

The previous candidate endpoints from INF-213/INF-215 are treated as superseded.

## Contract Behavior

Preview endpoint returns:

```http
Content-Type: application/pdf
Content-Disposition: inline; filename="infinite-track-attendance-report-YYYY-MM.pdf"
Cache-Control: no-store
```

Download/export endpoint returns:

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="infinite-track-attendance-report-YYYY-MM.pdf"
Cache-Control: no-store
```

Both endpoints support:

```text
period=daily|weekly|monthly|custom
start_date=YYYY-MM-DD
end_date=YYYY-MM-DD
timezone=Asia/Makassar optional
```

Default behavior:

```text
period=monthly
current month
authenticated user only
```

## Security / Scope

- Both endpoints are mounted under the existing attendance router `verifyToken` chain.
- Report scope comes from `req.user.id` only.
- `user_id` and `userId` query values are stripped before calling the report service.
- No arbitrary user report export is exposed for normal Android clients.
- Admin/Management multi-user summary export is not reused.
- No Android changes included.

## Shared Service / Drift Prevention

Both preview and download/export call the same:

- `buildPersonalAttendanceReportPayload(...)`
- `renderMyAttendanceReportPdf(payload)`

The only intended runtime difference is `Content-Disposition`:

- `inline` for preview
- `attachment` for download/export

## PDF Content

Included:

- Infinite Track
- My Attendance Report
- user full name
- role/position if available
- period metadata
- generated-at metadata
- Report Summary
- Attendance Mode Distribution
- Attendance Timeline
- backend source-of-truth footer

Excluded:

- Personal Insight
- Smart Reminder
- Company Services
- AI-generated interpretation
- admin multi-user export content

## Calculation Notes

- Total work hours are computed from backend attendance rows and exclude misleading alpha work hours.
- Late and alpha counters are derived from backend attendance status mapping.
- WFO/WFA counts are derived from backend attendance category mapping.
- WFH is marked `Needs Verification` and excluded from official percentage due INF-164 dependency.
- Attendance rate is rendered unavailable because expected working day denominator is not verified.
- Empty period returns a valid empty-state PDF.
- Alpha rows render safe timeline values:
  - `--:-- - --:--`
  - no formatted misleading work hour
  - raw work hour null in payload

## OpenAPI / Docs

Updated:

- `docs/openapi.yaml`
- `docs/specs/2026-07-07-personal-attendance-pdf-export-spec.md`
- `docs/plans/2026-07-07-personal-attendance-pdf-export-implementation.md`

`.gitignore` was updated to allow tracking new planning docs under:

- `docs/specs/*.md`
- `docs/plans/*.md`

## Verification Evidence

Dependency setup:

```bash
PUPPETEER_SKIP_DOWNLOAD=true npm --prefix "C:/Users/Febriyadi/.claude/worktrees/backend-personal-attendance-pdf-export" ci
```

Reason: plain `npm ci` failed due Puppeteer Chrome headless shell cache/download issue.

Automated checks:

```bash
npm --prefix "C:/Users/Febriyadi/.claude/worktrees/backend-personal-attendance-pdf-export" run lint
```

Result: PASS, no lint output.

```bash
npm --prefix "C:/Users/Febriyadi/.claude/worktrees/backend-personal-attendance-pdf-export" test
```

Result:

```text
Test Suites: 89 passed, 89 total
Tests: 569 passed, 569 total
```

Diff hygiene:

```bash
git -C "C:/Users/Febriyadi/.claude/worktrees/backend-personal-attendance-pdf-export" diff --check
```

Result: PASS, no output.

## Needs Verification

The following commands were attempted but failed because DB credentials were empty in the worktree environment:

```bash
npm --prefix "C:/Users/Febriyadi/.claude/worktrees/backend-personal-attendance-pdf-export" run test:alpha
npm --prefix "C:/Users/Febriyadi/.claude/worktrees/backend-personal-attendance-pdf-export" run test:smart
```

Observed error:

```text
SequelizeAccessDeniedError: Access denied for user ''@'172.17.0.1' (using password: NO)
```

Manual/API evidence still required with a running backend and valid token:

- `GET /api/attendance/history/personal/pdf?period=monthly`
- `GET /api/attendance/history/export.pdf?period=monthly`
- header evidence for `application/pdf`, `inline`, `attachment`, `no-store`
- sample generated PDF file
- authenticated-user-only content inspection
- negative evidence for arbitrary `user_id`
- empty-period PDF evidence

## Android Handoff

Preview:

```http
GET /api/attendance/history/personal/pdf
Response: application/pdf
Content-Disposition: inline
```

Download/share:

```http
GET /api/attendance/history/export.pdf?period=monthly
Response: application/pdf
Content-Disposition: attachment
```

Auth:

```text
Authorization Bearer token required.
```

Default:

```text
period=monthly, current month, authenticated user only.
```

Android responsibility:

```text
request, preview, download/share.
do not calculate official totals.
do not render official PDF locally.
```
