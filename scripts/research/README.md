# INF-181 Research Attendance Dataset Generator

## Purpose

Script penelitian untuk melengkapi data attendance historis tanpa mengubah runtime contract backend.

## Commands

### Dry-run (default)

```bash
node scripts/research/generate-attendance-dataset.js
```

### Apply (guarded)

```bash
node scripts/research/generate-attendance-dataset.js --apply --i-understand-this-writes-attendance-data
```

## Safety Rules

- Tidak mengubah existing `attendance` rows.
- Skip existing `user_id + attendance_date`.
- `2025-07`, `2025-08`, `2025-09` hanya best-effort untuk missing rows.
- `2025-12` dan `2026-05` adalah blackout months.
- Tidak pernah generate attendance untuk `2026-06-27`.
- WFA attendance wajib punya approved booking.

## Output

- Terminal dry-run report
- JSON summary: `scripts/research/output/attendance-dataset-dry-run.json`

## Geofence Evidence Limitation

Evidence hanya dibentuk dari `location_events`:
- Full = ENTER + EXIT
- Partial = ENTER only atau EXIT only
- Missing = tidak ada event
- Alpha = tidak ada event

Script ini tidak menghitung kepatuhan radius/koordinat fisik.
