# Implementation Plan — INF-235 / INF-236 Personal Attendance PDF Summary + Template

Date: 2026-07-08
Spec: `docs/specs/2026-07-08-inf-235-236-pdf-summary-template-spec.md`
Branch: `fix/backend-pdf-summary-and-template`
Worktree: `C:\Users\Febriyadi\.claude\worktrees\backend-pdf-summary-and-template`
Base: `refs/remotes/origin/develop` @ `6727cd3`

## 0. Guardrails

- Work only in isolated worktree.
- Do not edit main checkout `E:\test\Infinit_Track_BE`.
- Do not change endpoint paths.
- Do not change Android flow.
- Do not change auth/session contract.
- Do not change attendance final-state semantics.
- Do not change scheduler/job behavior.
- Do not add DB schema or tables.
- Do not add AI-like insight, Personal Insight, Smart Reminder, or Company Services.
- Do not add discipline score/range unless source-of-truth exists and is approved.

## 1. Current Mapping Summary

Main checkout state:

- Branch: `develop`
- Dirty baseline exists:
  - `AGENTS.md`
  - `docker-compose.yml`
  - `src/middlewares/validator.js`
  - `.claude/tmp/`
- Main checkout is behind remote develop; do not edit it.

Isolated worktree:

- Created at `C:\Users\Febriyadi\.claude\worktrees\backend-pdf-summary-and-template`
- Branch `fix/backend-pdf-summary-and-template`
- Based on explicit `refs/remotes/origin/develop` due ambiguous local `origin/develop` branch.

Mapped current flow:

```text
attendance.routes.js
  GET /history/personal/pdf
  GET /history/export.pdf
    ↓
attendance.controller.js
  previewMyAttendanceReportPdf
  exportMyAttendanceReportPdf
  sendMyAttendanceReportPdf(req, res, disposition)
    ↓
attendanceReport.service.js
  buildPersonalAttendanceReportPayload(...)
    ↓
pdfReportRenderer.js
  renderMyAttendanceReportPdf(payload)
```

## 2. Questions Answered From Repo Reality

1. Existing isolated PDF/report worktree: none found by relevant name/path.
2. Safe path: new worktree branch `fix/backend-pdf-summary-and-template` is clean and isolated.
3. Existing payload fields: `report_metadata`, `user`, `period`, `summary`, `mode_distribution`, `timeline`, `empty_state`.
4. Available source-of-truth attributes: full name, NIP/NIM, role, position, division relation, period, generated timestamp, status/mode/timeline, total work hours.
5. Missing attributes: payload does not expose `nip_nim`; payload does not fetch/expose division; summary lacks counted-day attendance rate fields.
6. Out-of-scope: avg discipline, discipline score range, per-row score.
7. `nip_nim` is fetched but not exposed in `payload.user`.
8. Division exists via `User.belongsTo(Division, as: 'division')`, field `division_name`.
9. `on_time_days` can be safely derived from `status_counters.ontime`.
10. Discipline score is not available in personal PDF payload today.
11. Score-range distribution is not available in personal PDF payload today.
12. Renderer supports simple multi-page growth by cursor/page break, but not structured cards/tables yet.
13. Minimum shippable structured layout: text-based official report with section headers, metric blocks, distribution rows, table-like timeline, footer.

## 3. Phase 1 — INF-235 Summary Correctness

### Files likely touched

- `src/services/attendanceReport.service.js`
- `tests/attendancePersonalReportService.test.js`

### Implementation steps

1. Add/adjust tests first:
   - non-empty monthly payload computes `attendance_rate` using counted-day denominator.
   - summary exposes `attendance_rate_label`, `attendance_rate_denominator`, `total_present`, `total_absent`, `total_counted_days`, `on_time_days`, `late_days`, `alpha_days`, `total_work_hours_label`.
   - empty payload keeps rate unavailable/null safely.
   - alpha row remains safe.
2. Update summary builder:
   - `total_present = non-alpha attended_days`
   - `total_absent = alpha`
   - `total_counted_days = total_present + total_absent`
   - `attendance_rate = Math.round((total_present / total_counted_days) * 100)` when denominator > 0
   - `attendance_rate_label = "N/A"` when denominator = 0, otherwise `${rate}%`
   - `expected_working_days = null`
   - `expected_working_days_label = "Unavailable"` or explanatory note
   - `total_work_hours_label` using hours/minutes display.
3. Build status distribution from status counters:
   - on time
   - late
   - early if present
   - alpha
   - other if present
4. Keep WFH Needs Verification policy unless product explicitly verifies INF-164.

## 4. Phase 2 — Identity Payload Improvements

### Files likely touched

- `src/services/attendanceReport.service.js`
- `tests/attendancePersonalReportService.test.js`

### Implementation steps

1. Include `Division` from `Models` namespace safely.
2. Extend `User.findByPk` include with division relation if available.
3. Expose in `payload.user`:
   - `nip_nim`
   - `division`
4. Keep null-safe fields if relation/value absent.
5. Use namespace import pattern to avoid breaking existing tests that mock partial `models/index.js`.

## 5. Phase 3 — INF-236 Renderer Template

### Files likely touched

- `src/utils/pdfReportRenderer.js`
- `tests/attendancePersonalReportPdfRenderer.test.js`

### Implementation steps

1. Add PDF primitive helpers internally or as small refactor:
   - section headings
   - label/value rows
   - metric block lines
   - distribution rows
   - timeline table header and rows
   - page footer/page number if feasible
2. Keep renderer DB-free.
3. Render sections:
   - Header / brand area
   - Identity block
   - Report Summary
   - Attendance Status Distribution
   - Work Mode Distribution
   - Monthly Attendance Timeline
   - Footer
4. Use clear text layout with spacing. Add color primitives only if low-risk.
5. Ensure excluded strings remain absent:
   - Personal Insight
   - Smart Reminder
   - Company Services
6. Ensure total work hours uses label if present.
7. Ensure attendance rate uses `attendance_rate_label`, not unavailable field, when denominator exists.
8. Preserve valid PDF output and filename behavior.

## 6. Optional File Split Decision

Target architecture requested:

```text
src/services/attendanceReport/
  attendanceReportQuery.service.js
  attendanceReportSummary.service.js
  attendanceReportPayload.service.js
  attendanceReportPresentation.service.js
src/utils/pdf/
  pdfPrimitives.js
  pdfReportTemplate.js
  pdfReportRenderer.js
```

Recommended for this PR:

- Avoid broad file relocation unless necessary.
- Keep route/controller stable.
- At minimum, separate responsibilities inside existing service/renderer via focused helper functions.
- If renderer becomes too large, split only PDF primitives/template into new `src/utils/pdf/*` while preserving existing import path with a re-export adapter if needed.

Reason:

- Existing tests and imports target `src/utils/pdfReportRenderer.js` and `src/services/attendanceReport.service.js`.
- Small focused changes lower risk for two issue closure.

## 7. Phase 4 — Docs / OpenAPI Check

### Files likely touched

- `docs/openapi.yaml` if summary/template behavior documentation changes materially.
- possibly add/update planning/review notes in `docs/plans` and `docs/specs`.

Implementation:

- Check existing OpenAPI descriptions for PDF endpoints.
- Update wording only if needed to reflect summary semantics/layout expectations.
- Do not change endpoint paths or auth contract.

## 8. Tests / Verification

Targeted tests after implementation:

```bash
npm test -- --runTestsByPath tests/attendancePersonalReportService.test.js tests/attendancePersonalReportPdfRenderer.test.js tests/attendancePersonalReportPdfController.test.js tests/attendancePersonalReportPdfRoute.test.js
```

Full verification:

```bash
npm run lint
npm test
npm run test:alpha
npm run test:smart
```

If `node_modules` missing in worktree:

```bash
PUPPETEER_SKIP_DOWNLOAD=true npm ci
```

If DB env is missing for alpha/smart scripts, report as Needs Verification with exact output.

Runtime/manual if possible:

```bash
npm run smoke-test <url>
```

Postman/API evidence if token/runtime available:

- `GET /api/attendance/history/export.pdf?period=monthly`
- verify `Content-Type: application/pdf`
- verify `Content-Disposition: attachment`
- save sample PDF
- inspect/extract text for header, summary, distributions, timeline, footer

## 9. Risk / Mitigation

### Risk: summary semantics drift from history contract

Mitigation:

- derive present/absent/counted days directly from normalized timeline/status counters
- test formula explicitly

### Risk: inventing unsupported attributes

Mitigation:

- expose only fields available from user/attendance relations
- omit discipline metrics
- keep expected working days unavailable

### Risk: PDF invalidity after layout changes

Mitigation:

- keep minimal PDF primitives deterministic
- tests assert `%PDF-` and required text sections
- do not add complex image/font dependencies

### Risk: test mocks break due new model export imports

Mitigation:

- use `Models.Division` namespace access rather than static named import requirements
- guard optional includes if needed

### Risk: final-state attendance change

Mitigation:

- report read-only service only
- no changes to check-in/checkout/jobs

## 10. PR / Review Note Draft Requirements

PR should clearly separate:

```text
Section 1: INF-235 summary correctness
Section 2: INF-236 PDF visual/template
```

Must state:

- no endpoint path changes
- no Android changes
- no auth/session changes
- no DB schema changes
- no Personal Insight / Smart Reminder / Company Services
- avg discipline / score range / per-row score omitted as not source-of-truth in payload
- expected working days remains unavailable until official denominator is verified
- verification evidence and Needs Verification items

## 11. Approval Checkpoint

Plan is ready for implementation.

Next step after approval:

1. Add failing tests for summary + renderer layout.
2. Implement summary fields + identity fields.
3. Implement structured PDF layout.
4. Run targeted tests.
5. Run lint/full tests.
6. Produce PR review note and sample PDF evidence if runtime allows.
