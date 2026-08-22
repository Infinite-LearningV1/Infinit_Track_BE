# INF-235 / INF-236 — Personal Attendance PDF Summary + Official Template Spec

Date: 2026-07-08
Branch: `fix/backend-pdf-summary-and-template`
Worktree: `C:\Users\Febriyadi\.claude\worktrees\backend-pdf-summary-and-template`
Base: `refs/remotes/origin/develop` @ `6727cd3`

## 1. Problem

Two follow-up issues refine the backend-generated Personal Attendance PDF report:

- INF-235 fixes summary correctness so the PDF summary matches UI-ready attendance history/report semantics.
- INF-236 improves the official PDF layout so the generated document is readable, professional, and aligned with Infinite Track branding.

The existing endpoints remain stable:

- Preview: `GET /api/attendance/history/personal/pdf`
- Download/export: `GET /api/attendance/history/export.pdf?period=monthly`

Android remains a request/preview/download/share client. Backend remains the source of truth.

## 2. Current Repo Reality

Mapped from isolated worktree:

- Routes exist in `src/routes/attendance.routes.js`:
  - `GET /history/personal/pdf`
  - `GET /history/export.pdf`
- Controller flow in `src/controllers/attendance.controller.js`:
  - `previewMyAttendanceReportPdf`
  - `exportMyAttendanceReportPdf`
  - `sendMyAttendanceReportPdf(req, res, disposition)`
  - `buildPersonalAttendanceReportPayload(...)`
  - `renderMyAttendanceReportPdf(payload)`
- Payload builder exists in `src/services/attendanceReport.service.js`.
- Renderer exists in `src/utils/pdfReportRenderer.js` and is currently line-by-line text oriented.
- Current payload includes:
  - `report_metadata`
  - `user`
  - `period`
  - `summary`
  - `mode_distribution`
  - `timeline`
  - `empty_state`
- `User` model includes `nip_nim`.
- `User.belongsTo(Division, { as: 'division' })` exists in `src/models/index.js` and `Division` exposes `division_name`.
- Current payload fetches `nip_nim` but does not expose it under `payload.user`.
- Current payload fetches role and position but not division.
- Current PDF summary still renders `Attendance Rate` as unavailable because `summary.attendance_rate_percent` is null.
- Current renderer supports simple page breaks using cursor position but lacks structured table/card primitives.

## 3. Product / Design Direction

The PDF must be:

- clean academic SaaS report
- light theme only
- professional official document
- calm, trustworthy, readable
- no heavy glass effect inside PDF
- no neon
- no dark mode
- no excessive decoration

Allowed brand colors, used sparingly:

- Primary purple: `#8A3DFF`
- Secondary yellow: `#FFCD29`
- Accent cyan: `#38F9F5`
- Dark text: `#2F2530`
- Light background: `#E7E4E9`
- Soft alert: `#FF6B6B`

Given the current internal minimal PDF renderer, color support may be implemented only if primitives are safely added. A readable structured black/gray PDF with brand labels is acceptable for MVP if color primitives would destabilize rendering.

## 4. INF-235 Summary Correctness Contract

PDF summary must no longer show Attendance Rate as unavailable when a counted-day denominator exists.

MVP formula:

```text
total_present = attended_days
total_absent = alpha
total_counted_days = total_present + total_absent
attendance_rate = round((total_present / total_counted_days) * 100)
```

If `total_counted_days = 0`:

- `attendance_rate = null`
- `attendance_rate_label = "N/A"` or equivalent unavailable display
- explanatory note remains safe

Expected new/display-ready summary fields:

- `attendance_rate`
- `attendance_rate_label`
- `attendance_rate_denominator`
- `total_present`
- `total_absent`
- `total_counted_days`
- `total_work_hours_label`
- `on_time_days`
- `late_days`
- `alpha_days`
- `expected_working_days` remains null/unavailable unless official denominator is verified

Total work hours should render as a user-friendly display label, not raw decimal when a label exists.

Alpha row display must remain safe:

- no misleading fake work duration
- no misleading fake check-in/check-out display

## 5. INF-236 Template Contract

Required PDF sections:

### 5.1 Header

Include:

- Infinite Track brand title
- My Attendance Report / Personal Attendance Report title
- user identity
- period label
- generated timestamp

Recommended structure:

```text
Top header band/card
Left: brand + report title
Right: period + generated timestamp
Below: user identity block
```

### 5.2 User identity block

Implement when source exists:

- full name
- NIP/NIM
- role
- position
- division/department if available

### 5.3 Summary metric blocks/cards

Display:

- Attendance Rate
- On Time Days
- Late Days
- Alpha Days
- Total Work Hours
- Expected Working Days / denominator note if unavailable

### 5.4 Distribution section

Display:

Display:

- Attendance Status Distribution
- Work Mode Distribution

If charts are too risky for the current renderer, use readable row-list with count + percentage.

Do not fake discipline score range.

### 5.6 Timeline table

Structured table-like format:

```text
Date | Check In | Check Out | Work Hours | Status | Mode | Location
```

No score column unless source exists and is approved later.

### 5.7 Footer

Include:

- Generated by Infinite Track
- backend source-of-truth notice
- generated timestamp
- page number if feasible

## 6. Source-of-Truth Attribute Decisions

### Implemented / safe to implement

- brand/title
- full_name
- NIP/NIM
- role
- position
- division/department when relation exists and value is present
- period
- generated timestamp
- attendance rate using counted-day denominator
- on-time days from `status_counters.ontime`
- late days from status counters/summary
- alpha days from status counters/summary
- total work hours and display label
- attendance status distribution
- work mode distribution
- attendance timeline
- source-of-truth note

### Omit / Needs Verification

- avg discipline: not present in personal PDF payload and not approved for this PDF
- discipline score range: not present in personal PDF payload and not approved
- per-row score: not present in personal PDF payload and not approved
- official expected working day denominator: keep unavailable until source-of-truth is verified

## 7. Non-goals

Do not:

- change endpoint paths
- change Android flow
- generate PDF in Android
- change auth/session contract
- change attendance final-state semantics
- change scheduler/job behavior
- add DB schema/table
- add Personal Insight
- add Smart Reminder
- add Company Services
- add AI-like interpretation/advice
- add admin/multi-user export behavior

## 8. Acceptance Criteria Mapping

### INF-235

- PDF no longer displays Attendance Rate as unavailable when counted-day denominator exists.
- PDF summary includes present/absent/counted-day consistency.
- Total Work Hours renders as friendly label.
- Expected Working Days remains explicitly unavailable if official denominator is not verified.
- PDF remains `application/pdf` and export remains attachment.
- Summary is aligned with UI-ready history semantics.

### INF-236

- PDF has structured official layout.
- Header includes brand, title, identity, period, generated timestamp.
- Summary appears as readable metric blocks/cards.
- Attendance Status Distribution section exists.
- Work Mode Distribution section exists.
- Attendance Timeline is table-like and readable.
- Footer includes source-of-truth note and generated timestamp.
- Excluded content remains absent.

## 9. Evidence Needed

Automated:

- tests for summary fields and rate formula
- tests for identity fields
- tests for renderer section labels and excluded content
- lint
- full jest

Runtime/manual when environment is available:

- sample generated PDF file
- extracted text/screenshot showing structured header, summary, distributions, timeline, footer
- Postman/API evidence for `GET /api/attendance/history/export.pdf?period=monthly`
- before/after note

## 10. Needs Verification

- Runtime sample PDF depends on running backend + valid token.
- `npm run test:alpha` and `npm run test:smart` may require local DB credentials.
- Whether PDF color drawing primitives should be added beyond current text renderer needs implementation feasibility check.
