# Task 3 Report — INF-181 Dry-Run Reporting and Snapshot Layer

Status: DONE

## Fact
- Task 3 reporting/snapshot layer is implemented on the current branch at commit `2478a91`.
- Task 3 code changes are limited to the intended reporting surface:
  - `scripts/research/generate-attendance-dataset.js`
  - `tests/researchAttendanceDatasetGenerator.test.js`
- The script now exports dry-run summary helpers, fixed-path JSON writing, formatted terminal reporting, and a database snapshot loader that derives July baseline users from `Attendance` first before loading non-deleted `User` rows.

## Files changed
- `scripts/research/generate-attendance-dataset.js`
- `tests/researchAttendanceDatasetGenerator.test.js`

## Verification
- Dependency bootstrap used in the isolated worktree when needed:
  - `PUPPETEER_SKIP_DOWNLOAD=1 npm ci`
- Focused Task 3 verification commands:
  - `npm test -- --runTestsByPath tests/researchAttendanceDatasetGenerator.test.js --runInBand`
  - `npm run lint`
- Result:
  - PASS

## Commit
- `2478a91` — `feat: add INF-181 dry-run reporting`

## Self-review notes
- The July baseline user loading path now matches the corrected plan: read July user IDs from `Attendance`, then load active `User` rows, and report deleted/missing baseline users separately.
- Dry-run summary writing stays machine-readable and writes to the fixed JSON path while keeping reporting logic in the allowed research script file.
- `expectedLocationsByUser` is still an empty map in this task, which is consistent with Task 3 scope and leaves richer location resolution to later integration work.

## Concerns
- `npm ci` reported existing audit vulnerabilities during dependency bootstrap in the isolated worktree, but that did not block scoped Task 3 verification.
- No blocking code concerns for Task 3.

## Fix wave — Important review findings

Status: DONE

### Fact
- Apply mode now fails fast when `--apply` is provided without `--i-understand-this-writes-attendance-data`.
- Existing approved WFA booking selection is deterministic: booking rows are sorted before planner `.find()` selection, and the DB snapshot query orders booking rows by user/date/status/booking id.

### Files changed
- `scripts/research/generate-attendance-dataset.js`
- `tests/researchAttendanceDatasetGenerator.test.js`
- `.superpowers/sdd/task-3-report.md`

### Verification
- `npm test -- --runTestsByPath tests/researchAttendanceDatasetGenerator.test.js --runInBand`
  - PASS: 1 suite, 11 tests
- `npm run lint`
  - PASS
- `git diff --check`
  - PASS

### Commit
- Pending at report append time.

### Concerns
- `PUPPETEER_SKIP_DOWNLOAD=1 npm ci` was required in the isolated worktree before verification because `node_modules` was missing; npm audit still reports existing vulnerabilities from dependency install.
