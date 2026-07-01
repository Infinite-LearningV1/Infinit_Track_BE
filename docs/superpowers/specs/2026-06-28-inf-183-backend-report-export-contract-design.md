# INF-183 — Backend Report Export Contract Design

- **Tanggal:** 2026-06-28
- **Issue utama:** INF-183 — Backend align summary report export attributes with refreshed PDF/Excel contract
- **Related:** INF-166, INF-43, INF-171, INF-155, INF-180, INF-176
- **Family / Layer:** Family F — Monitoring, Reporting, and Admin Consumption / Layer 1B — Backend Report / Export Attribute Contract
- **Status:** Draft approved for contract planning, not implementation

## 1. Purpose

Menyelaraskan kontrak backend reporting/export dengan refreshed Web FE export targets tanpa memaksa Web FE mengarang reporting truth.

Target akhir kontrak:
- PDF export target: `Attendance Summary Report`
- Excel export target: workbook `Infinite Track_Attendance_Report_<period>.xlsx`
- PDF target **tidak** memuat `Report Insight`
- Backend tetap menjadi sumber kebenaran untuk angka report, KPI, discipline aggregates, dan aggregate alert semantics

Task ini hanya menetapkan desain kontrak dan boundary. Task ini **belum** mengimplementasikan endpoint baru atau perubahan response runtime.

## 2. Contract Boundary

### Canonical source-of-truth

Backend summary report domain logic tetap menjadi sumber kebenaran tunggal untuk:
- window / period interpretation
- attendance aggregates
- work mode aggregates
- discipline aggregates
- aggregate alert semantics
- export-safe detail rows

### Endpoint boundary yang disetujui

#### `GET /api/summary/reports`
Tetap menjadi canonical report browsing / report data API untuk admin reporting table, pagination, search, dan agregat umum.

#### `GET /api/summary/reports/pdf`
Endpoint kontrak khusus payload PDF. Menggunakan source logic yang sama dengan summary report utama, tetapi response diproyeksikan khusus untuk kebutuhan PDF render.

#### `GET /api/summary/reports/excel`
Endpoint kontrak khusus payload Excel workbook. Menggunakan source logic yang sama juga, tetapi response diproyeksikan khusus untuk kebutuhan workbook / sheet export.

### Principle

Ketiga endpoint harus memakai **shared core report source logic**. Perbedaan `/reports`, `/reports/pdf`, dan `/reports/excel` hanya boleh terjadi pada projection / formatter response, bukan pada rule perhitungan inti.

## 3. Current Repo Facts

Berdasarkan controller dan OpenAPI saat ini:

- `GET /api/summary/reports` sudah menjadi canonical reporting/export contract route
- response saat ini sudah memuat:
  - `summary`
  - `report.data`
  - `report.pagination`
  - `report.user_attendance_summary`
  - `analytics.discipline_analysis`
  - `period`
  - `date_range`
- `report.data[]` saat ini sudah memuat:
  - `attendance_id`
  - `user_id`
  - `full_name`
  - `role`
  - `nip_nim`
  - `email`
  - `time_in`
  - `time_out`
  - `work_hour`
  - `attendance_date`
  - `location_details`
  - `status`
  - `information`
  - `notes`
  - `discipline_score`
  - `discipline_label`
  - `discipline_breakdown`
- backend saat ini **tidak** mengekspose `phone_number` pada `report.data[]`
- `analytics.discipline_analysis` saat ini dihitung dari visible report users pada current page, bukan seluruh report window
- `user_attendance_summary` saat ini sudah memuat division dan day-count summaries, tetapi belum menjadi export insight contract yang eksplisit

## 4. Key Decisions Locked During Brainstorming

### 4.1 Ownership model untuk derived support labels
Dipilih model **Hybrid**:
- aggregate alert semantics adalah backend-owned reporting truth
- wording / presentation final tetap FE concern

### 4.2 `phone_number`
Diputuskan **tidak disertakan** pada kontrak INF-183.

Rule:
- `phone_number` out of scope untuk endpoint ini
- field hanya boleh ditambahkan lewat approval / compliance decision eksplisit di task terpisah

### 4.3 Summary scope
Diputuskan memakai **dua level summary**:
- `period_summary`
- `export_scope_summary`

Tujuan:
- menghindari ambiguity antara angka seluruh period dan angka subset export/filter
- FE tidak perlu menebak angka mana yang menjadi source untuk artifact export

### 4.4 `recommended_action`
Diputuskan backend tidak mengirim teks final. Backend hanya boleh mengirim **`recommended_action_code`** netral.

### 4.5 Export-safe flat row fields
Diputuskan menambah field flat additive pada row level:
- `work_category`
- `location_description`

Legacy `location_details` boleh tetap dipertahankan untuk kompatibilitas endpoint existing.

### 4.6 Endpoint family direction
Diputuskan kontrak format-specific menggunakan:
- `/api/summary/reports/pdf`
- `/api/summary/reports/excel`

Dengan rule bahwa keduanya memakai source logic bersama dari summary report domain.

## 5. Recommended Architecture

### 5.1 Shared core builder
Direkomendasikan ada satu shared core builder/service yang menghasilkan domain object netral-format untuk dipakai oleh:
- `/api/summary/reports`
- `/api/summary/reports/pdf`
- `/api/summary/reports/excel`

Core builder **tidak** bertugas membentuk HTTP response final. Core builder hanya menghasilkan report domain object yang stabil.

### 5.2 Format-specific projection
- PDF controller/service memproyeksikan core object ke payload PDF
- Excel controller/service memproyeksikan core object ke payload Excel
- endpoint existing `/api/summary/reports` boleh tetap memakai shape existing dengan additive extension bila dibutuhkan

### 5.3 Responsibility split
- **Core source**: period logic, row extraction, aggregate calculation, discipline aggregates, aggregate alert semantics
- **Projection layer**: shape response, metadata labels, format-specific section naming
- **Web FE**: layout, branding, workbook generation, PDF rendering, wording final untuk `recommended_action_code`

## 6. Proposed Core Report Domain Object

Core builder direkomendasikan menghasilkan struktur internal setara berikut:

```json
{
  "window": {
    "period": "monthly",
    "timezone": "Asia/Jakarta",
    "start_date": "2026-05-01",
    "end_date": "2026-05-31"
  },
  "period_summary": {
    "total_records": 1248,
    "attendance_rate": 92,
    "average_discipline_score": 78.4,
    "late_alpha_risk_users": 8,
    "needs_attention_users": 5,
    "status_distribution": {},
    "work_mode_distribution": {},
    "discipline_score_range": {}
  },
  "export_scope_summary": {
    "scope": "filtered_records_only",
    "total_records": 120,
    "attendance_rate": 90.5,
    "average_discipline_score": 76.8
  },
  "detail_rows": [],
  "discipline_insight_rows": []
}
```

## 7. PDF Contract Design

### Endpoint
`GET /api/summary/reports/pdf`

### Purpose
Memberikan payload yang siap dipakai FE untuk membentuk PDF `Attendance Summary Report`.

### Required sections
- `report_metadata`
- `window`
- `period_summary`
- `export_scope_summary`
- `detailed_attendance_table`

### Explicit exclusion
PDF target **tidak** memuat `Report Insight`.

### Recommended shape

```json
{
  "success": true,
  "generated_at": "2026-05-03T10:00:00.000Z",
  "report_metadata": {
    "title": "Attendance Summary Report",
    "period_label": "Monthly",
    "generated_on": "2026-05-03T17:00:00+07:00",
    "generated_by": "Infinite Track System",
    "data_source": "Attendance Summary API",
    "confidentiality": "Confidential internal report",
    "timezone": "Asia/Jakarta"
  },
  "window": {
    "period": "monthly",
    "start_date": "2026-05-01",
    "end_date": "2026-05-31"
  },
  "period_summary": {
    "total_records": 1248,
    "attendance_rate": 92,
    "average_discipline_score": 78.4,
    "late_alpha_risk_users": 8,
    "needs_attention_users": 5,
    "status_distribution": {
      "on_time": { "count": 1120, "percentage": 70 },
      "late": { "count": 98, "percentage": 20 },
      "alpha": { "count": 30, "percentage": 10 }
    },
    "work_mode_distribution": {
      "wfo": { "count": 820, "percentage": 45 },
      "wfh": { "count": 210, "percentage": 30 },
      "wfa": { "count": 218, "percentage": 25 }
    },
    "discipline_score_range": {
      "excellent": { "count": 200, "percentage": 40, "range": "85-100" },
      "good": { "count": 175, "percentage": 35, "range": "70-84" },
      "needs_review": { "count": 75, "percentage": 15, "range": "50-69" },
      "attention": { "count": 50, "percentage": 10, "range": "<50" }
    }
  },
  "export_scope_summary": {
    "scope": "filtered_records_only",
    "total_records": 120,
    "attendance_rate": 90.5,
    "average_discipline_score": 76.8
  },
  "detailed_attendance_table": [
    {
      "attendance_id": 501,
      "user_id": 101,
      "full_name": "Febri Pratama",
      "nip_nim": "EMP0123",
      "role": "Employee",
      "attendance_date": "2026-05-03",
      "time_in": "08:01",
      "time_out": "17:05",
      "work_hour": "9h 04m",
      "status": "On Time",
      "work_category": "WFO",
      "discipline_score": 92,
      "location_description": "Main Office Palu"
    }
  ],
  "message": "PDF report payload generated successfully"
}
```

## 8. Excel Contract Design

### Endpoint
`GET /api/summary/reports/excel`

### Purpose
Memberikan payload yang siap dipakai FE untuk membentuk workbook Excel.

### Required workbook sections
- `summary_sheet`
- `attendance_report_sheet`
- `discipline_insight_sheet`

### Recommended shape

```json
{
  "success": true,
  "generated_at": "2026-05-03T10:00:00.000Z",
  "workbook_metadata": {
    "file_name": "Infinite Track_Attendance_Report_May_2026.xlsx",
    "generated_on": "2026-05-03T17:00:00+07:00",
    "generated_by": "Infinite Track System",
    "timezone": "Asia/Jakarta"
  },
  "window": {
    "period": "monthly",
    "start_date": "2026-05-01",
    "end_date": "2026-05-31"
  },
  "summary_sheet": {
    "period_summary": {
      "total_records": 1248,
      "attendance_rate": 92,
      "average_discipline_score": 78.4,
      "late_alpha_risk_users": 8,
      "needs_attention_users": 5,
      "status_distribution": {
        "on_time": { "count": 1120, "percentage": 70 },
        "late": { "count": 98, "percentage": 20 },
        "alpha": { "count": 30, "percentage": 10 }
      },
      "work_mode_distribution": {
        "wfo": { "count": 820, "percentage": 45 },
        "wfh": { "count": 210, "percentage": 30 },
        "wfa": { "count": 218, "percentage": 25 }
      }
    },
    "export_scope_summary": {
      "scope": "filtered_records_only",
      "total_records": 120,
      "attendance_rate": 90.5,
      "average_discipline_score": 76.8
    }
  },
  "attendance_report_sheet": [
    {
      "attendance_id": 501,
      "user_id": 101,
      "full_name": "Febri Pratama",
      "nip_nim": "EMP0123",
      "role": "Employee",
      "email": "febri.pratama@example.invalid",
      "attendance_date": "2026-05-03",
      "time_in": "08:01",
      "time_out": "17:05",
      "work_hour": "9h 04m",
      "status": "On Time",
      "work_category": "WFO",
      "information": "Within office geofence",
      "notes": "All good",
      "discipline_score": 92,
      "discipline_label": "Excellent",
      "location_description": "Main Office Palu"
    }
  ],
  "discipline_insight_sheet": [
    {
      "user_id": 101,
      "employee_name": "Febri Pratama",
      "division": "Operations",
      "attendance_rate": 98,
      "late_count": 1,
      "alpha_count": 0,
      "avg_discipline_score": 92,
      "discipline_label": "Excellent",
      "recommended_action_code": "none"
    }
  ],
  "message": "Excel workbook payload generated successfully"
}
```

## 9. Rule Semantics Locked for INF-183

### 9.1 `attendance_rate`

Definisi yang disepakati untuk INF-183:

`attendance_rate = valid_attendance_days / expected_working_days * 100`

Dengan `valid_attendance_days` mengikuti rule existing helper saat ini:
- `on_time_days + late_days`

Catatan:
- `early` tidak ditambahkan diam-diam sebagai present-valid pada INF-183
- jika nanti rule itu berubah, perubahan harus menjadi task semantik terpisah

### 9.2 `late_alpha_risk_users`

Definisi:
Jumlah user dalam selected window yang memenuhi salah satu kondisi:
- `late_count > 0`, atau
- `alpha_count > 0`

Field ini adalah aggregate support alert, bukan discipline score replacement.

### 9.3 `needs_attention_users`

Definisi:
Jumlah user dalam selected window yang memenuhi salah satu kondisi:
- `alpha_count > 0`, atau
- `avg_discipline_score < 70`

### 9.4 `discipline_score_range`

Bucket contract yang dikunci:
- `excellent`: `85-100`
- `good`: `70-84.99`
- `needs_review`: `50-69.99`
- `attention`: `<50`

Catatan:
- bucket ini adalah classification layer untuk export summary
- bucket ini tidak harus mengganti label engine existing di row/user level

### 9.5 `recommended_action_code`

Allowed values:
- `none`
- `monitor`
- `remind`
- `review`

Recommended mapping default:
- `none`
  - `alpha_count = 0`
  - `late_count = 0`
  - `avg_discipline_score >= 85`
- `monitor`
  - `alpha_count = 0`
  - `late_count > 0`
  - `avg_discipline_score >= 70`
- `remind`
  - `alpha_count = 0`
  - `avg_discipline_score < 70`
- `review`
  - `alpha_count > 0`

Rule ini sengaja dibuat sederhana agar tetap menjadi contract semantic default, bukan redesign rule engine.

## 10. Scope Semantics

### `period_summary`
- selalu dihitung dari seluruh `date_range`
- tidak dipengaruhi pagination
- tidak dipengaruhi subset export sempit

### `export_scope_summary`
- dihitung dari dataset yang benar-benar menjadi target export
- boleh dipengaruhi query/filter/scope pilihan user
- wajib menyertakan metadata `scope`

### Allowed `scope` values
- `current_period`
- `all_records_in_selected_period`
- `filtered_records_only`

## 11. Backend Attribute Matrix

| Export area | Field | Proposed source | Decision |
|---|---|---|---|
| PDF metadata | `report_metadata` | PDF projection | Backend-owned |
| PDF summary | `period_summary` | Shared core source | Backend-owned |
| PDF summary | `export_scope_summary` | Shared core source | Backend-owned |
| PDF table | `work_category` | Flat additive row field | Add |
| PDF table | `location_description` | Flat additive row field | Add |
| PDF content | `Report Insight` | N/A | Exclude |
| Excel summary | `period_summary` | Shared core source | Backend-owned |
| Excel summary | `export_scope_summary` | Shared core source | Backend-owned |
| Excel attendance | `email` | Existing row field | Keep |
| Excel attendance | `phone_number` | N/A | Omit |
| Excel insight | `division` | User attendance summary / shared core | Keep / enrich as needed |
| Excel insight | `attendance_rate` | Shared core rule | Add |
| Excel insight | `avg_discipline_score` | Shared core rule | Add |
| Excel insight | `recommended_action_code` | Shared core rule | Add |

## 12. Files / Areas Expected to Change During Implementation

### Core backend logic
- `src/controllers/summary.controller.js`
- recommended new core / projection services under `src/services/` or equivalent existing pattern

### Helpers
- `src/utils/userAttendanceSummary.js`

### Routing
- `src/routes/summary.routes.js`

### Contract documentation
- `docs/openapi.yaml`

### Tests
- `tests/summaryReportContract.test.js`
- recommended new contract tests:
  - `tests/summaryReportPdfContract.test.js`
  - `tests/summaryReportExcelContract.test.js`

## 13. Risks

### Reporting truth drift
Jika `/reports`, `/reports/pdf`, dan `/reports/excel` memakai jalur hitung berbeda, angka export bisa drift dari report utama.

**Mitigation:** satu shared core source logic.

### Scope ambiguity
`period_summary` dan `export_scope_summary` bisa tertukar oleh FE atau maintainer berikutnya.

**Mitigation:** nama eksplisit + OpenAPI + contract tests.

### Derived-rule overreach
`needs_attention_users` dan `recommended_action_code` bisa melebar menjadi rule engine besar.

**Mitigation:** kunci rule sederhana pada INF-183 dan jangan mencampur redesign FAHP.

### PII creep
`phone_number` berpotensi masuk “sekalian” saat implementasi Excel.

**Mitigation:** explicit omit sampai ada approval/compliance decision.

### Backward compatibility
Consumer lama `/api/summary/reports` mungkin masih tergantung shape saat ini.

**Mitigation:** additive extension untuk endpoint existing; format-specific contracts via endpoints baru.

## 14. Verification Plan for Implementation Phase

Saat implementasi nanti, verification minimum yang dibutuhkan:

- `npm run lint`
- `npm test -- --testPathPattern=summaryReportContract`
- contract tests baru untuk `/api/summary/reports/pdf`
- contract tests baru untuk `/api/summary/reports/excel`
- runtime smoke untuk:
  - `/api/summary/reports`
  - `/api/summary/reports/pdf`
  - `/api/summary/reports/excel`

Smokes harus membuktikan:
- `period_summary` dan `export_scope_summary` tidak tertukar
- `phone_number` tidak muncul
- `recommended_action_code` berupa code netral
- payload PDF tidak memuat `Report Insight`

## 15. Docs / ADR Requirement

**DOCS/ADR UPDATE REQUIRED**

Alasan:
- task ini menyentuh reporting/export contract
- menambah endpoint surface baru
- mengubah dan memperjelas API response semantics
- memerlukan OpenAPI truth alignment

Minimal sinkronisasi saat implementasi:
- `docs/openapi.yaml`
- contract notes di PR/review
- explicit documentation untuk:
  - aggregate alert semantics
  - scope semantics
  - `recommended_action_code`
  - `phone_number` omitted

## 16. Non-Goals

INF-183 tidak mencakup:
- implementasi PDF rendering
- implementasi workbook generation
- perubahan compliance / approval untuk PII tambahan
- redesign FAHP theory / thresholds
- perubahan diam-diam pada present-valid attendance semantics

## 17. Recommended Next Step

Setelah spec ini disetujui:
1. buat implementation plan terpisah
2. implementasikan di branch/worktree terisolasi
3. jalankan contract verification + OpenAPI updates

Sampai titik ini, deliverable yang diharapkan adalah **spec contract yang committed**, bukan perubahan runtime behavior.
