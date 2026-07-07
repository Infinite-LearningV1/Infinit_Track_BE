# Implementation Plan — Personal Attendance PDF Export

Date: 2026-07-07
Spec: `docs/specs/2026-07-07-personal-attendance-pdf-export-spec.md`
Branch: `fix/backend-personal-attendance-pdf-export`
Worktree: `C:\Users\Febriyadi\.claude\worktrees\backend-personal-attendance-pdf-export`
Base: `develop` @ `d5af9b1`

## 0. Guardrails

- Work only in isolated worktree.
- Do not edit main checkout `E:\test\Infinit_Track_BE`.
- Do not change auth/session contract.
- Do not change check-in/check-out behavior.
- Do not change attendance final-state semantics.
- Do not change scheduled jobs.
- Do not reuse admin/management multi-user summary export as Android personal report.
- Do not accept arbitrary `user_id` for Android personal report.
- Do not create new database tables.
- Do not add Personal Insight, Smart Reminder, Company Services, or AI interpretation.

## 1. Current State Summary

Mapped evidence:

- `src/routes/attendance.routes.js` protects attendance routes with `router.use(verifyToken)`.
- `GET /api/attendance/history` exists and is user-scoped through `req.user.id`.
- `GET /api/attendance/history/personal/pdf` does not exist.
- `GET /api/attendance/history/export.pdf` does not exist.
- `GET /api/summary/reports/pdf` exists but is Admin/Management only and returns JSON payload, not binary PDF.
- Current attendance history already contains useful period, summary, timeline, and alpha-safe behavior.
- Existing `summaryReport.service.js` is admin/dashboard reporting; it is not suitable as Android personal report source.
- No PDF dependency exists in `package.json`.

## 2. Files Expected to Change

Implementation files:

- `src/services/attendanceReport.service.js` — new shared personal report payload/calculation service.
- `src/utils/pdfReportRenderer.js` — new PDF renderer that accepts normalized payload only.
- `src/controllers/attendance.controller.js` — add preview/export handlers; optionally refactor history helper reuse only if safe.
- `src/routes/attendance.routes.js` — add two endpoint routes.

Contract/docs:

- `docs/openapi.yaml` — add PDF endpoint contracts and headers.

Tests:

- `tests/attendancePersonalReportService.test.js` — service payload, user scope, monthly/custom, empty period, alpha safety.
- `tests/attendancePersonalReportPdfRoute.test.js` — auth and headers for preview/export routes.
- `tests/attendancePersonalReportPdfContract.test.js` — renderer/handler PDF content guardrails and excluded strings.
- Existing OpenAPI/client contract tests may need updates if they assert route list.

Optional docs/evidence:

- `docs/api-evidence/` or existing evidence docs if present after mapping.

## 3. Phase Plan

### Phase 0 — Pre-implementation safety check

Commands:

```bash
git -C "C:/Users/Febriyadi/.claude/worktrees/backend-personal-attendance-pdf-export" status --short
git -C "C:/Users/Febriyadi/.claude/worktrees/backend-personal-attendance-pdf-export" branch --show-current
```

Expected:

- Branch is `fix/backend-personal-attendance-pdf-export`.
- Only approved spec/plan artifacts are changed before coding starts.

### Phase 1 — Tests first

Add failing tests for:

1. route auth:
   - anonymous preview returns 401 via existing `verifyToken` middleware.
   - anonymous export returns 401.
2. route headers:
   - preview returns `application/pdf`, `inline`, `no-store`.
   - export returns `application/pdf`, `attachment`, `no-store`.
3. service user scope:
   - `userId` comes from argument derived from `req.user.id`.
   - query `user_id` does not change scope.
4. monthly period:
   - period defaults to current month when query empty.
   - explicit `period=monthly` works.
5. custom period:
   - valid `start_date`/`end_date` works.
   - invalid dates return 400 validation.
6. empty period:
   - valid empty PDF payload and PDF buffer, not server error.
7. alpha safety:
   - alpha row uses safe time range and no misleading work hour.
8. excluded content:
   - PDF bytes/text do not include `Personal Insight`, `Smart Reminder`, or `Company Services`.
9. WFH:
   - WFH count is omitted or marked Needs Verification unless mapping is explicitly verified.

### Phase 2 — Shared personal report service

Create `src/services/attendanceReport.service.js` with:

```text
buildPersonalAttendanceReportPeriod(query, now)
buildPersonalAttendanceReportPayload({ userId, query, now })
```

Service responsibilities:

- Validate `period` values: `daily|weekly|monthly|custom` only.
- Default to monthly current month.
- Validate custom `start_date` and `end_date` strict `YYYY-MM-DD`.
- Query `User.findByPk(userId)` with role/position includes.
- Query `Attendance.findAll` with `where.user_id = userId` and date range.
- Include attendance category, status, and location.
- Normalize timeline rows.
- Compute total work hours from non-alpha safe rows.
- Compute late and alpha counters.
- Compute attended days.
- Render attendance rate as unavailable unless denominator is verified.
- Render WFH as omitted/Needs Verification until INF-164 mapping is cleared.
- Return normalized payload only; no Express response logic.

### Phase 3 — PDF renderer

Create `src/utils/pdfReportRenderer.js` with:

```text
renderMyAttendanceReportPdf(payload) -> Buffer
buildAttendanceReportFileName(payload) -> string
```

Renderer responsibilities:

- Accept normalized payload only.
- Do not query database.
- Include required header, summary, mode distribution, timeline, footer.
- Return valid binary PDF buffer.
- Avoid Personal Insight / Smart Reminder / Company Services.

Dependency decision:

- MVP preferred: no new dependency if simple deterministic PDF is enough.
- If rendering quality requires library, request explicit approval before adding dependency and modifying lockfile.

### Phase 4 — Controller handlers

Add handlers in `src/controllers/attendance.controller.js`:

```text
previewMyAttendanceReportPdf(req, res)
exportMyAttendanceReportPdf(req, res)
```

Shared helper inside controller may be used:

```text
sendMyAttendanceReportPdf(req, res, disposition)
```

Rules:

- `const userId = req.user.id`.
- Do not read `req.query.user_id`.
- Call shared service once.
- Call shared renderer once.
- Set:
  - `Content-Type: application/pdf`
  - `Content-Disposition: inline|attachment; filename="..."`
  - `Cache-Control: no-store`
- Return PDF buffer.
- Validation errors return 400 JSON.
- Other errors pass to existing error handling pattern or return 500 consistently with controller style.

### Phase 5 — Routes

Add to `src/routes/attendance.routes.js` after existing history route area:

```js
router.get('/history/personal/pdf', previewMyAttendanceReportPdf);
router.get('/history/export.pdf', exportMyAttendanceReportPdf);
```

Because the router already has `router.use(verifyToken)`, both endpoints require auth.

### Phase 6 — OpenAPI

Update `docs/openapi.yaml`:

- Add `/api/attendance/history/personal/pdf`.
- Add `/api/attendance/history/export.pdf`.
- Bearer auth required.
- Query params:
  - `period`
  - `start_date`
  - `end_date`
  - `timezone`
- Response `200` content `application/pdf`.
- Document response headers:
  - `Content-Disposition`
  - `Cache-Control`
- Document `401` unauthorized.
- Document `400` validation errors.

### Phase 7 — Evidence docs / Android handoff

Prepare PR/review note and Android handoff:

```text
Preview:
GET /api/attendance/history/personal/pdf
Response: application/pdf
Content-Disposition: inline

Download/share:
GET /api/attendance/history/export.pdf?period=monthly
Response: application/pdf
Content-Disposition: attachment

Auth:
Authorization Bearer token required.

Default:
period=monthly, current month, authenticated user only.

Android responsibility:
request, preview, download/share.
Do not calculate official totals.
Do not render official PDF locally.
```

## 4. Verification Plan

Automated verification from isolated worktree:

```bash
npm run lint
npm test
npm run test:alpha
npm run test:smart
```

Manual/API evidence if runtime and token are available:

```bash
curl -i -H "Authorization: Bearer <token>" "<baseUrl>/api/attendance/history/personal/pdf?period=monthly" --output preview.pdf
curl -i -H "Authorization: Bearer <token>" "<baseUrl>/api/attendance/history/export.pdf?period=monthly" --output export.pdf
```

Required evidence checklist:

- `Content-Type: application/pdf`.
- Preview `Content-Disposition: inline`.
- Export `Content-Disposition: attachment`.
- `Cache-Control: no-store`.
- Sample PDF generated.
- PDF contains only authenticated user's data.
- Query `user_id` ignored/rejected.
- Empty-period PDF valid.
- Alpha/absent safe rendering.
- No Personal Insight / Smart Reminder / Company Services.
- OpenAPI diff.

If runtime/token unavailable, mark manual/API evidence as `Needs Verification` rather than Done.

## 5. Risks and Mitigations

### Risk: user data leakage

Cause: accidental reuse of admin summary report source or arbitrary `user_id` query.

Mitigation:

- Build separate personal report service.
- Scope only by `req.user.id`.
- Add tests for ignored `user_id` query.

### Risk: calculation drift between preview and download

Cause: duplicate logic in two handlers.

Mitigation:

- One shared service.
- One shared renderer.
- Only disposition header differs.

### Risk: misleading alpha work hours

Cause: alpha rows may have synthetic `time_in`, `time_out`, or `work_hour` values.

Mitigation:

- Explicit alpha-safe timeline normalization.
- Tests for alpha row safe display.

### Risk: attendance rate fabrication

Cause: denominator not verified.

Mitigation:

- Do not calculate attendance rate until expected working day denominator is verified.
- Render unavailable note.

### Risk: WFH mapping uncertainty

Cause: INF-164 still calls out WFH verification.

Mitigation:

- Omit WFH from official distribution or mark Needs Verification in PDF/payload.
- Add test to prevent unqualified WFH official percentage.

### Risk: weak PDF renderer quality

Cause: no PDF dependency currently exists.

Mitigation:

- MVP renderer can be simple but valid PDF.
- If high-fidelity layout is needed, pause and request approval before adding PDF dependency.

## 6. Docs/ADR Update Note

`DOCS/ADR UPDATE REQUIRED`

Reason:

- New backend API contract endpoints.
- Android INF-216 depends on preview/download file contract.
- Backend ownership of official PDF report is explicit.
- Content-Disposition semantics differ by endpoint.

Minimum update:

- `docs/openapi.yaml`

Optional follow-up:

- shared cross-repo `API_CONTRACT.md` update after implementation/verification if user wants cockpit docs synced.

## 7. Approval Checkpoint

Do not implement code until this plan is approved.

Recommended next step after approval:

1. Confirm worktree status.
2. Add tests first.
3. Implement service/renderer/controller/routes.
4. Update OpenAPI.
5. Run verification.
6. Produce PR/review note and Android handoff.
