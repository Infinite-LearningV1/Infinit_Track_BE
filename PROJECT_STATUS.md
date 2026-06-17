# PROJECT_STATUS — Backend (Infinit_Track_BE)

> File DINAMIS. Baca di awal task, update di akhir task. Bukan tempat aturan permanen (itu CLAUDE.md) atau kontrak API (itu shared context).
> Status terakhir diisi manusia/PM Auditor, bukan diklaim agent tanpa evidence.

## Snapshot
- Branch aktif: develop
- Baseline: NEEDS_BASELINE_FREEZE (dirty ~228; freeze via worktree sebelum agent write)
- CI: lint + test (ci.yml). Branch protection: NEEDS VERIFICATION.

## Sedang berjalan
- (isi: issue/PR yang sedang dikerjakan)

## PR terakhir
- (isi: nomor PR + status merge)

## Risiko / blocker aktif
- Baseline belum di-freeze.
- Area sensitif: attendance final-state, jobs, FAHP, auth/session, deploy — manual-first.

## Next safe action
- Freeze baseline, lalu 1 pilot single-session kecil (lint/test fix).

## Catatan
- Upstream truth untuk Web FE + Android. Jangan ubah kontrak tanpa DOCS/ADR note.
