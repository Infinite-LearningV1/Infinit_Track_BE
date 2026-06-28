# INF-181 Design — Attendance Research Dataset Generator Contract

- **Date:** 2026-06-27
- **Repo:** `Infinit_Track_BE`
- **Issue:** INF-181 — Define attendance research dataset generation contract
- **Execution model:** isolated worktree from `develop`
- **Routing:** single-session + manual-first guard

## 1. Goal

Implement a **research-only** attendance dataset generator that can complete missing attendance-related data for the period:

- start: `2025-07-01`
- effective end: `2026-06-26`

The generator must support:

1. **default dry-run mode** (read-only),
2. **strict deterministic planning** using a fixed seed,
3. **optional apply mode** behind an explicit write guard,
4. **terminal reporting + fixed-path JSON summary output**, and
5. **best-effort monthly target shaping** without mutating existing attendance truth.

The purpose of this pass is not to redesign attendance runtime behavior. The purpose is to create a bounded research script that can safely generate missing historical research data while respecting backend truth boundaries.

## 2. Repo Reality Summary

### 2.1 Backend truth posture

This backend is the final authority for:

- attendance final state,
- auth/session validity,
- booking approval semantics,
- reporting outcomes,
- and scheduled job effects.

Because of that, the generator must not silently invent runtime contract changes or bypass domain rules that production logic depends on.

### 2.2 Scope is script-only

The requested change is intentionally bounded to research artifacts:

- `scripts/research/generate-attendance-dataset.js`
- `scripts/research/research-attendance-config.js`
- `scripts/research/README.md`
- optional scoped tests if practical

### 2.3 Forbidden surfaces for this pass

This pass must **not** modify runtime-sensitive areas unless explicitly re-approved:

- `src/controllers/attendance.controller.js`
- `src/jobs/createGeneralAlpha.job.js`
- `src/jobs/autoCheckout.job.js`
- `src/jobs/resolveWfaBookings.job.js`
- `src/models/*.js`
- `docs/openapi.yaml`
- `docker-compose.yml`
- `src/config/index.js`
- `src/config/database.js`

### 2.4 Current host evidence that shapes the contract

The host prompt establishes the following starting evidence:

- local MySQL target: `127.0.0.1:3306`
- database: `v1_infinite_track`
- `attendance_categories`: `1=WFO`, `2=WFH`, `3=WFA`
- `attendance_statuses`: `1=ontime`, `2=late`, `3=alpha`, `4=early`
- `booking_status`: `1=approved`, `2=rejected`, `3=pending`
- roles include `Management`, `Internship`, `Employee`, `Admin`
- **there is no `User` role in the current DB**

This means the generator must not derive its population from a nonexistent `User` role assumption.

## 3. Core Contract

### 3.1 Research-only contract

The generator is a **research data helper**, not a runtime attendance feature. It may create historical rows in the database only through its guarded apply mode, but it must not alter the meaning of attendance, bookings, geofence evidence, or scheduled job behavior.

### 3.2 Deterministic contract

For the same:

- code version,
- fixed seed,
- configuration,
- and database state,

`--dry-run` must produce the same plan and the same JSON summary every time.

Determinism is mandatory because the output is intended to be reviewed and audited before any write action.

### 3.3 Existing-data preservation contract

The generator must never overwrite or replace existing attendance truth.

Hard rules:

- never update existing `attendance` rows,
- skip existing `user_id + attendance_date` pairs,
- report `skipped_existing`,
- `2025-07`, `2025-08`, and `2025-09` are treated as **immutable months**,
- immutable months may only be completed for **missing** user-date rows.

Target percentages for immutable months are informational only and must be reported as:

- target %
- existing %
- planned after generation %
- variance

The script must not mutate existing rows to force a target distribution.

## 4. Scope

This pass includes:

1. designing and implementing a deterministic attendance research planner,
2. generating dry-run reports in terminal output,
3. writing a fixed-path JSON summary artifact,
4. supporting guarded apply mode,
5. documenting usage and limitations in `scripts/research/README.md`,
6. adding scoped tests if practical without broadening runtime scope.

## 5. Non-Goals

This pass does **not**:

- change attendance controller semantics,
- change scheduler timing or job behavior,
- change database schema,
- run migrations,
- modify models,
- update dashboard API contracts,
- change FAHP theory, thresholds, or configuration,
- infer real geofence radius compliance from unavailable data,
- or force historical rows to match target percentages by rewriting truth.

## 6. Chosen Design Approach

### Approach selected

**Central planner + separate executor**.

This is preferred over a monolithic script and over an explicit persisted plan-file workflow.

### Why this approach

It gives the strongest balance for this repo’s constraints:

- dry-run and apply share the same planning logic,
- determinism is easier to guarantee,
- auditability is strong without introducing a heavier multi-step operator flow,
- testing can focus on planner behavior without requiring DB writes,
- and runtime attendance surfaces stay untouched.

## 7. Architecture and Components

### 7.1 Config layer

File: `scripts/research/research-attendance-config.js`

This file contains the stable contract inputs:

- fixed deterministic seed,
- effective date range,
- blackout months,
- monthly status distribution targets,
- monthly attendance mode distribution targets,
- monthly geofence evidence distribution targets,
- allowed operational note templates,
- fixed JSON output path,
- apply-mode guard settings.

Design rule: all research-policy constants live here so reviewers can inspect the business shape without tracing implementation logic.

### 7.2 Planner layer

File: `scripts/research/generate-attendance-dataset.js`

The planner is the read-heavy, decision-forming part of the script.

Responsibilities:

- validate DB identity and lookup values,
- load baseline population,
- compute effective working days,
- inspect existing attendance / bookings / location events,
- compute missing slots,
- produce a deterministic creation plan,
- compute monthly target vs existing vs planned variances,
- print a terminal report,
- write the fixed-path JSON summary.

The planner is the **single source of truth** for “what would be created.”

### 7.3 Executor layer

The executor remains in the same script but must be logically isolated from the planner.

Responsibilities:

- activate only when both write flags are present,
- print explicit DB identity and write counts before mutation,
- execute inserts based on the already-built plan,
- never recompute plan logic through a different path,
- never update or delete existing rows.

### 7.4 README layer

File: `scripts/research/README.md`

Responsibilities:

- explain dry-run vs apply mode,
- document output locations,
- explain immutable months and skip behavior,
- explain geofence evidence limitations,
- explain safety warnings and write guards.

### 7.5 Optional test layer

File candidate: `tests/researchAttendanceDatasetGenerator.test.js`

Tests should focus on planner correctness and deterministic behavior rather than integration-wide runtime semantics.

## 8. Data Sources and Population Contract

### 8.1 Population source

The attendance generation population must come from:

- **existing July 2025 attendance baseline**,
- excluding deleted users.

The generator must not assume a `User` role exists.

Dry-run output must report:

- population source,
- user count,
- missing/deleted baseline users, if any.

### 8.2 Lookup contract

Before planning, the script must validate the key lookup mappings used by the host prompt.

If the lookup values are missing or materially inconsistent, dry-run must report the mismatch and apply mode must not continue.

## 9. Calendar Contract

The effective planning calendar is constrained by:

- date range `2025-07-01` through `2026-06-26`,
- exclusion of Saturdays,
- exclusion of Sundays,
- exclusion of Indonesian national holidays via `date-holidays`,
- blackout month exclusion for:
  - `2025-12`
  - `2026-05`
- and explicit exclusion of `2026-06-27`.

Dry-run must report:

- working days by month,
- excluded weekends and holidays,
- blackout months.

## 10. Attendance Planning Rules

### 10.1 Monthly status targets

The planner must use the host-provided monthly status distributions for:

- ontime,
- late,
- alpha,
- early.

For months marked `existing`, the planner must respect the current DB state and only shape missing slots best-effort.

### 10.2 Monthly mode targets

The planner must use the host-provided monthly attendance mode distributions for:

- WFO,
- WFH,
- WFA.

### 10.3 Attendance row validity

Every planned attendance row must satisfy:

- valid FK references,
- `time_in` is present, including for alpha,
- `work_hour` is derived from `time_in` / `time_out`,
- `alpha` rows use `work_hour = 0`,
- notes look operational and natural,
- notes must not include words such as:
  - `dummy`
  - `synthetic`
  - `research`
  - `generated`
  - `fake`
- WFA attendance rows require approved booking support.

### 10.4 Deterministic distribution strategy

The allocation of status and mode must be deterministic based on:

- fixed seed,
- stable user ordering,
- stable date ordering,
- stable slot assignment rules.

The exact implementation may use seeded hashing, seeded ranking, or deterministic bucket allocation, but the planner must ensure that a repeated dry-run over the same DB state produces identical outputs.

## 11. Booking Planning Rules

### 11.1 WFA dependency rule

Any planned WFA attendance row must have an approved booking available for the same user/date.

### 11.2 Booking plan behavior

The planner must:

- detect existing approved bookings,
- reuse them when valid,
- plan new approved bookings only when needed to satisfy WFA attendance,
- report booking conflicts or unresolved cases in `potentialConflicts` / `needsVerification`.

The script must not reinterpret rejected or pending bookings as approved truth.

## 12. Geofence Evidence Rules

### 12.1 Evidence model

The generator must model dashboard-facing geofence evidence from current `location_events` capabilities only:

- **Full Evidence** = `ENTER + EXIT`
- **Partial Evidence** = `ENTER only` or `EXIT only`
- **Missing Evidence** = no location event
- **Alpha** = no location event

The generator must **not** claim this is real coordinate/radius compliance, because the current schema does not provide that truth surface.

### 12.2 July amendment

For `2025-07`:

- attendance rows remain untouched,
- missing `location_events` may be generated for existing present attendance rows when expected location is resolvable,
- existing `location_events` must not be replaced or deleted.

### 12.3 Monthly geofence targets

The planner must use the host-provided monthly evidence percentages as best-effort planning targets, again without rewriting existing truth.

## 13. Dry-Run and Apply Modes

### 13.1 Dry-run mode

Dry-run is the default operating mode.

It must:

- perform no DB writes,
- build the full deterministic plan,
- print the full report,
- write the fixed-path JSON summary.

### 13.2 Apply mode guard

Apply mode requires both flags:

- `--apply`
- `--i-understand-this-writes-attendance-data`

Without both flags, the script must hard fail before any write action.

### 13.3 Pre-write apply output

Before writing, apply mode must print:

- DB host,
- DB port,
- DB name,
- planned attendance writes,
- planned booking writes,
- planned location_event writes.

## 14. Error Handling and Safety Policy

### 14.1 Hard-fail conditions

The script should stop immediately when core planning truth cannot be trusted, including:

- DB connection failure,
- missing or invalid lookup mappings,
- inability to build July baseline population,
- invalid FK resolution in planned rows,
- missing critical config such as seed/output path,
- write-guard flags incomplete during apply,
- inability to write the JSON summary artifact.

### 14.2 Needs Verification conditions

The script may continue planning but must report `Needs Verification` or `potentialConflicts` when:

- baseline users are now missing/deleted,
- existing bookings conflict with WFA planning,
- immutable-month variance remains large,
- expected location resolution is partial,
- existing data density prevents target closeness without mutation,
- or other best-effort conditions reduce confidence without invalidating the plan.

### 14.3 No silent fallback

The generator must not silently:

- downgrade invalid lookup values,
- fabricate alternative population rules,
- auto-fix existing attendance truth,
- or pretend apply safety conditions are satisfied when they are not.

## 15. JSON Summary Contract

The dry-run JSON summary must be written to a **fixed path**, not a timestamped path.

Suggested location within repo scope:

- `scripts/research/output/attendance-dataset-dry-run.json`

Minimum summary sections:

- `runMode`
- `deterministicSeed`
- `dbIdentity`
- `lookupValidation`
- `population`
- `calendar`
- `blackoutMonths`
- `existingSkipped`
- `plannedWrites`
  - attendance
  - bookings
  - locationEvents
- `monthlySummaries`
  - status target/existing/planned/variance
  - mode target/existing/planned/variance
  - geofence target/existing/planned/variance
- `fkValidation`
- `potentialConflicts`
- `needsVerification`

If apply mode is executed, the summary may also include:

- `applyAttempted`
- `applyResult`
- `writtenCounts`

## 16. Required Dry-Run Report Output

The terminal dry-run report must include:

- DB host/port/name (no secrets),
- lookup validation,
- population source and count,
- missing/deleted baseline users,
- working days by month,
- excluded weekends and holidays,
- blackout months,
- existing attendance skipped count,
- planned attendance rows by month,
- planned bookings by month,
- planned location_events by month,
- status/mode/geofence target vs existing vs planned variance,
- FK validation result,
- potential conflicts.

## 17. Verification Plan

Fresh verification expected for this work item:

- `npm run lint`
- `npm test -- --testPathPattern=summaryDashboardAnalytics --runInBand`
- `npm test -- --testPathPattern=analysisFuzzyAhp --runInBand`
- `node scripts/research/generate-attendance-dataset.js --dry-run`

If full `npm test` is not run, the final report must explicitly mark the remaining gap as `Needs Verification` rather than implying full repo validation.

## 18. Risks

### Main risk

The generator could accidentally drift from “research helper” into “attendance runtime side-door” if it starts rewriting existing truth, bypassing WFA booking semantics, or normalizing data beyond the agreed scope.

### Secondary risks

- deterministic allocation may still produce visible month-level variance in immutable months,
- existing inconsistent data may prevent ideal target closeness,
- geofence evidence modeling may be misunderstood as physical compliance if documentation is vague,
- apply mode could be used prematurely if dry-run evidence is not reviewed carefully.

### Mitigations

- script-only scope,
- strict dry-run default,
- dual-flag apply guard,
- no update/delete of existing rows,
- explicit JSON summary artifact,
- explicit `Needs Verification` reporting.

## 19. Docs / ADR Posture

For this scoped pass:

- `scripts/research/README.md` is required,
- ADR update is **not** required,
- runtime/API/OpenAPI/docs contract surfaces must remain untouched.

If implementation pressure expands into runtime semantics, schema, OpenAPI, scheduler behavior, or FAHP theory, the work must stop and be re-approved under `DOCS/ADR UPDATE REQUIRED`.

## 20. Expected Output

At the end of implementation, this work should produce:

1. a deterministic research attendance dataset generator,
2. a dedicated config file for research targets and guards,
3. a README describing how to run and interpret the script,
4. a dry-run JSON summary written to a fixed path,
5. and fresh verification evidence for the scoped change.

The intended final position is:

> a bounded, deterministic, audit-friendly research generator that respects backend truth boundaries,
> not a redesign of attendance runtime behavior.
