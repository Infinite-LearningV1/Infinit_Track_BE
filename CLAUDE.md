# CLAUDE.md

## Project Overview

Infinite Track Backend — Node.js/Express REST API for attendance and workforce management (WFO, WFH, WFA). The backend is the **source of final truth** for attendance state, auth/session validity, approval semantics, and scheduled job results.

Key domains: authentication, attendance (check-in/out/status), WFA booking, FAHP-based recommendations/discipline scoring, summary/reporting, nightly background jobs that finalize attendance state.

## Commands

```bash
# Development
npm run dev                          # Start with nodemon
npm start                            # Production: node src/server.js

# Database (local MySQL)
# Ensure a local MySQL instance is running and environment variables are configured
npm run migrate                      # Run Sequelize migrations
npm run migrate:status               # Check migration state
npm run seed                         # Run seeders

# Testing & Linting
npm test                             # All tests (ESM via --experimental-vm-modules)
npm test -- --testPathPattern=fahp   # Single test by pattern
npm run test:alpha                   # Alpha fixture tests
npm run test:smart                   # Smart auto-checkout tests
npm run lint                         # ESLint
```

CI: GitHub Actions (`.github/workflows/ci.yml`) — checkout → Node 18 → `npm ci` → lint → test.

## Architecture

**Boot**: `src/server.js` (TZ=Asia/Jakarta, DB auth, cron start, listen) → `src/app.js` (security → CORS → body → Swagger → routes → error handler).

**Routes** (all under `/api/` via `src/routes/index.js`):
- `/api/auth` → `auth.controller.js` | `/api/attendance` → `attendance.controller.js`
- `/api/users` → `user.controller.js` | `/api/bookings` → `booking.controller.js`
- `/api/wfa` → `wfa.controller.js` | `/api/summary` → `summary.controller.js`
- `/api/discipline` → `discipline.controller.js` | `/api` → `referenceData.controller.js`
- `/health` — health check

**Database**: MySQL via Sequelize 6 (`src/config/database.js`, timezone `+07:00`). Models in `src/models/*.js`, associations in `src/models/index.js`.

**Background Jobs** (state-changing, target H-1 Jakarta time):
- `src/jobs/createGeneralAlpha.job.js` — marks absent as alpha (23:55 Mon-Fri)
- `src/jobs/resolveWfaBookings.job.js` — alpha for unused WFA, reject expired pending (23:50 daily)
- `src/jobs/autoCheckout.job.js` — missed checkout flagger (every 30min) + FAHP smart auto-checkout (23:45 daily)

**Auth**: JWT via cookie or Bearer. Chain: `authJwt.js` (verify + sliding TTL) → `roleGuard.js` (RBAC). Roles: Admin, Management, User.

**Timezone**: All business logic uses **WIB (Asia/Jakarta, UTC+7)** — set in server.js, Sequelize config, and scheduled job runtime.

**Deployment**: Repository-managed deployment configuration is defined in `.do/app*.yaml` rather than root-level `docker-compose.yml`/`Dockerfile` artifacts. Use `DB_HOST=localhost` for local development; in managed or containerized environments, set `DB_HOST` to the database service hostname provided by that platform.

## Search & Research Routing

- Use `WebSearch` for recent information, broad public-web discovery, changelogs, and comparisons.
- Use `WebFetch` only after a specific public URL is known and needs to be read/analyzed.
- Use `Context7` first for library/framework documentation and version-specific usage.
- Prefer authenticated tools/plugins over `WebFetch` for private systems (GitHub private repos, Linear, internal docs).
- For GitHub URLs or repo-centric investigation, prefer GitHub tooling over generic web fetch.
- Search prompts should include exact error text, library/framework name, version, runtime/platform, and current year when recency matters.
- Prefer official docs before blogs or SEO-style articles when researching implementation details.

## Sensitive Areas

Handle with extra caution — always read current state, identify risks, plan verification before editing:
- **Attendance final state**: `src/controllers/attendance.controller.js`, `src/jobs/createGeneralAlpha.job.js`, `src/jobs/autoCheckout.job.js`
- **Auth/session**: `src/middlewares/authJwt.js`, `src/middlewares/roleGuard.js`
- **Background jobs**: `src/jobs/*.js`, `src/utils/jobHelper.js`
- **Env/deploy contract**: `src/config/index.js`, `.env.example`
- **FAHP engine**: `src/utils/fuzzyAhpEngine.js`, `src/analytics/fahp*.js`, `src/analytics/config.fahp.js`
- **API contract**: `docs/openapi.yaml`
- **External integrations**: Cloudinary (`src/config/cloudinary.js`), Geoapify (`GEOAPIFY_API_KEY`)

## Backend Standards Sync

- Backend is the **final authority** for attendance, auth/session validity, booking approval semantics, and job-driven state changes.
- Clients are request originators, not final source of truth.
- **Architecture-significant areas**: attendance final state, auth/session contract, scheduler behavior, env contract, and API contract.
- Do not change those areas without stating:
  - impact,
  - risk,
  - verification evidence,
  - whether docs/ADR updates are required.
- If evidence is insufficient, mark it explicitly as **Needs Verification**.
- Do not claim a change is safe only because a manual happy path worked once.
- If code reality, deploy reality, and docs are not aligned, treat that as a defect until proven intentional.

## System Design Sync

- Backend is the **authoritative system of record** for attendance, auth/session validity, booking approval semantics, and scheduled job results.
- **System-design-significant areas**: final-state changes, background jobs, retry behavior, idempotent operations, env contract, and health/readiness.
- Do not change those areas without stating:
  - impact,
  - risk,
  - verification evidence,
  - whether docs/ADR updates are required.
- If evidence is insufficient, mark it explicitly as **Needs Verification**.
- Do not assume in-process cron, retry behavior, or a simple health endpoint is production-safe just because it works in local/dev.
- If route reality, config reality, deploy reality, and docs are not aligned, treat that as a system design defect until proven intentional.

## API Design Sync

- Backend API is a **contract surface**, not merely a controller/route implementation detail.
- **API-significant areas**: auth/session contract, authorization boundary, idempotent mutations, error contract, OpenAPI truth, and rate limiting.
- Do not change those areas without stating:
  - impact,
  - risk,
  - verification evidence,
  - whether docs/ADR updates are required.
- If evidence is insufficient, mark it explicitly as **Needs Verification**.
- Do not add routes, response shapes, token conventions, or auth modes silently.
- If runtime reality, OpenAPI, and docs are not aligned, treat that as an API design defect until proven intentional.

## Working Rules

1. Always distinguish **fact** vs **assumption** vs **needs-verification**
2. Always name files to be changed and risks of the change
3. Never declare done without **verification evidence** (test output, curl result, or review checklist)
4. If change touches architecture-significant area → note **"docs/ADR update required"**
5. **Stop and ask first** if task touches: attendance final state without tests, scheduler/cron timing, undocumented env vars, FAHP theory/algorithm, or has unclear scope

## Source of Truth Hierarchy

1. **PRD** → product intent, resilience intent, guardrails
2. **Architecture audit** → as-is condition, risks, constraints
3. **Gap Matrix** → active gap priorities
4. **Architecture Governance** → hierarchy, update obligations
5. **Issue/task** → current work scope
6. **Repo code + runtime** → implementation ground truth

If documents conflict with repo/runtime → **flag explicitly**, do not silently pick one.

## Definition of Done

A task is done **only when**:
- Verification evidence exists
- No risk left without explicit annotation
- Docs/ADR update note created if change touches architectural area
- PR notes draft available if task produces code changes

## Agent Tooling

- `/backend-plan` — structured task planning (use before starting any non-trivial task)
- `/backend-review` — PR notes, deploy checklist, contract compliance check
- `/backend-deploy-check` — deploy readiness verification
- `/backend-attendance-inspection` — attendance correctness inspection for final-state, mutation safety, job-driven attendance, timezone, and idempotency risks
- `/backend-auth-contract-inspection` — auth contract inspection for token, session, cookie, RBAC, role resolution, and middleware-route boundary checks
- `backend-contract-reviewer` — read-only subagent for contract compliance review
