# INF-279 — Backend Runtime Contract Alignment Design

**Date:** 2026-08-20
**Repository:** `Infinite-LearningV1/Infinit_Track_BE`
**Base:** `origin/develop` at `935702e`
**Branch:** `djangosuryaa/inf-279-backendinfra-align-web-origin-runtime-env-contracts-and`
**Worktree:** `.worktrees/inf-279-runtime-contract-alignment`
**Linear:** `INF-279`
**Status:** Design formalization for the approved INF-279 scope

## Purpose

Align the backend runtime contract with the Web FE boundary established by INF-277 and the production ingress boundary merged through INF-278 / PR #144.

The target remains:

```text
Development
Web FE :3000
   ↓ /api proxy
Backend :3005

Production browser origin
https://infinite-track.tech
   ↓ credentialed requests
https://api.infinite-track.tech
   ↓
Host Nginx
   ↓
Express 127.0.0.1:3005
```

INF-279 does not redesign Nginx, authentication, Attendance semantics, database schema, API contracts, or hosting topology. It corrects environment truth and deployment verification around the existing runtime.

## Factual Baseline

Fresh baseline from `origin/develop`:

```text
npm run lint
PASS

focused config / INF-278 contract tests
44 passed / 44 total

npm test -- --runInBand
161 suites passed / 161 total
1540 tests passed / 1540 total
```

The worktree starts clean and is based directly on the merged `develop` hardening commit, not the older INF-278 worktree.

### Source-of-truth correction

The Linear issue was drafted from the later local INF-278 worktree, but merged `origin/develop` differs from that branch.

On `935702e`:

- production smoke does not yet receive a `WEB_ORIGIN`;
- `scripts/smoke-test.js` does not yet contain a credentialed allowed-origin/session-surface probe;
- neither staging nor production synchronizes the tracked Compose/verifier artifacts before remote rollout.

Therefore INF-279 must be specified against merged repository truth rather than assuming unmerged INF-278 follow-up commits are present.

## Confirmed Gaps

### 1. Local port contract drift

`README.md` already documents native backend development on `3005`, while:

```text
.env.example        PORT=3000
src/config/index.js process.env.PORT || 3000
```

This is the only active source-level `PORT=3000` development default found in the audit. Canonical local backend development will use `3005`.

### 2. Production Web origin drift

`deploy/env/backend.production.example` currently contains:

```env
CORS_ORIGIN=https://orca-app-58alv.ondigitalocean.app
```

The canonical production browser origin is:

```text
https://infinite-track.tech
```

The tracked production example must represent that exact origin because browser credentialed CORS is origin-sensitive.

### 3. Production template contains staging infrastructure truth

The same production template refers to the staging MySQL cluster in comments and uses:

```env
SPACES_BUCKET=infinite-track-staging-sgp1
```

Production templates must not promote staging resource identifiers. Exact production DB and bucket names are not established by repository evidence, so the tracked template will use explicit production-oriented replacement values rather than invented infrastructure names.

### 4. Deployment Web-origin verification is missing

Both deployment workflows currently run:

```bash
npm run smoke-test "$<ENV>_PUBLIC_BASE_URL"
```

without an independent expected browser origin.

The generic smoke test checks that a known disallowed origin is not echoed, but it does not prove that the actual Web FE origin receives the credentialed CORS contract required by cookie-based web sessions.

### 5. Remote rollout can consume stale tracked artifacts

Both workflows SSH into an existing deployment directory and immediately execute its existing:

```text
docker-compose.yml
deploy/scripts/verify-droplet-api.sh
```

Neither workflow currently synchronizes those tracked files from the checked-out release commit before executing them.

This is a reproducibility defect: a new image can be combined with stale runtime orchestration or verification logic.

### 6. Release ordering is not proven by repository YAML

Staging and production are separate workflows triggered from `master`. Repository YAML alone does not prove staging completes before production starts.

GitHub environment protection or another external control may provide the intended approval gate. That state is external and must be verified before documentation claims enforced staging-before-production ordering.

### 7. Operator docs contain runtime drift

Examples found in active docs include:

- production instance count described as `2+ (HA)` although the tracked Compose contract defines one `app` service and does not establish HA;
- production log level described as `warn` while the production env template currently uses `LOG_LEVEL=info`;
- CORS troubleshooting refers to a DigitalOcean dashboard even though the canonical backend runtime is droplet + local runtime env file;
- GitHub Actions setup does not list expected Web-origin environment variables.

## Architecture Decisions

### Decision A — Backend remains CORS authority

Express continues to own the actual CORS policy:

```text
config.cors.origin
→ Express cors middleware
→ Access-Control-* response headers
```

Nginx must not gain CORS directives as part of INF-279. Web FE remains a consumer that sends credentialed browser requests.

### Decision B — Expected browser origin is independent deployment input

Deployment verification introduces environment-scoped GitHub variables:

```text
PRODUCTION_WEB_ORIGIN
STAGING_WEB_ORIGIN
```

`PRODUCTION_WEB_ORIGIN` must resolve to:

```text
https://infinite-track.tech
```

The exact staging frontend origin is not established by repository evidence and must come from the actual staging environment configuration. INF-279 must not hardcode a guessed staging domain.

Each deployment workflow must compare two independent facts:

```text
expected browser origin from GitHub environment
              ==
deployed container CORS_ORIGIN
```

A mismatch is a blocking deployment failure.

### Decision C — Generic smoke stays reusable, deploy workflows make Web-origin smoke mandatory

`scripts/smoke-test.js` remains usable outside staging/production. `WEB_ORIGIN` is therefore optional at script level, but absence must produce an explicit skipped Web-origin check rather than a false pass message.

Staging and production workflows, however, must require their expected Web-origin variables and always invoke:

```bash
WEB_ORIGIN="$EXPECTED_WEB_ORIGIN" npm run smoke-test "$PUBLIC_BASE_URL"
```

The Web-origin smoke surface covers:

- credentialed preflight to `/api/auth/login`;
- invalid web login request with `X-Client-Type: web`;
- refresh-without-session rejection at `/api/auth/refresh`;
- exact `Access-Control-Allow-Origin` equality;
- `Access-Control-Allow-Credentials: true`.

This verifies browser transport compatibility without needing production credentials or changing auth semantics.

### Decision D — Canonical native backend port is 3005

The default backend port becomes `3005` in both:

```text
.env.example
src/config/index.js
```

Explicit `PORT` continues to override the default. Production continues to set `PORT=3005` explicitly through its runtime contract.

This aligns the default local path with INF-277:

```text
Webpack :3000 → /api proxy → Backend :3005
```

### Decision E — Synchronize only the tracked artifacts the remote rollout executes

Before remote rollout, both staging and production must copy the release commit's current versions of:

```text
docker-compose.yml
deploy/scripts/verify-droplet-api.sh
```

into the configured remote deployment path.

The deployment must not overwrite:

```text
deploy/env/backend.production.env
```

or any other host-local secret/runtime state.

`deploy/scripts/verify-public-ingress.sh` runs from the GitHub runner checkout, so it does not need remote synchronization.

INF-279 will not change Nginx vhost content. Automated installation/replacement of host Nginx configuration is outside this issue unless a separate decision explicitly changes Nginx lifecycle ownership.

A tar-over-SSH copy is preferred because it preserves the current droplet model without requiring a Git checkout on the host or introducing a new artifact service.

### Decision F — Production template is explicit but secret-free

The tracked production template will use:

```env
CORS_ORIGIN=https://infinite-track.tech
DB_HOST=replace-with-production-managed-mysql-host
SPACES_BUCKET=replace-with-production-spaces-bucket
```

The template must not name a staging database cluster or staging bucket as production truth. Exact credentials and infrastructure identifiers remain host-managed and untracked.

### Decision G — External release protection remains evidence, not assumption

INF-279 will not invent cross-workflow orchestration solely because repository YAML cannot prove staging-before-production ordering.

Before completion, the actual GitHub `production` environment/ruleset must be inspected. Outcomes:

- if an approval/protection gate already enforces the intended release control, record that evidence and update docs accurately;
- if no such gate exists, mark release ordering as a remaining blocker / needs-decision rather than silently implementing a new release architecture.

## Files and Responsibilities

### Runtime contract

- `.env.example` — canonical local development defaults.
- `src/config/index.js` — runtime fallback when `PORT` is not explicitly supplied.
- `deploy/env/backend.production.example` — secret-free production runtime template.

### Deployment verification

- `.github/workflows/deploy-production.yml` — expected production Web origin, runtime-config comparison, artifact synchronization, blocking smoke.
- `.github/workflows/deploy-staging.yml` — expected staging Web origin, parity checks, artifact synchronization, blocking smoke.
- `scripts/smoke-test.js` — generic application smoke plus optional Web credentialed CORS/session surface.

### Tests

- `tests/configContract.test.js` — runtime default port contract.
- `tests/inf279RuntimeContract.test.js` — focused environment/workflow/smoke source contract for INF-279.

### Operator documentation

- `README.md` — local port and high-level release/runtime truth.
- `docs/GITHUB_ACTIONS_SETUP.md` — required staging/production Web-origin environment variables.
- `docs/PRODUCTION_DEPLOYMENT.md` — environment ownership, deployment synchronization, release evidence boundaries.
- `docs/droplet-docr-runtime.md` — host env ownership and smoke invocation with expected Web origin.

`docs/PRODUCTION_NGINX_INGRESS.md` remains the Nginx-specific authority and is not expected to change unless implementation reveals a direct contradictory reference.

## Test Design

### Runtime default

A focused config test clears `PORT`, loads runtime config, and requires:

```js
expect(config.port).toBe(3005);
```

The same contract verifies `.env.example` contains `PORT=3005` and no active `PORT=3000` default remains.

### Production template

The INF-279 contract test reads `deploy/env/backend.production.example` and requires:

```text
CORS_ORIGIN=https://infinite-track.tech
no it-mysql-staging-sgp1
no SPACES_BUCKET=infinite-track-staging-sgp1
production-oriented replacement values for unknown resources
```

### Workflow contract

Static workflow tests require both environments to:

- declare the environment-specific expected Web-origin variable;
- include it in pre-rollout required-variable validation;
- synchronize `docker-compose.yml` and `deploy/scripts/verify-droplet-api.sh` before executing them remotely;
- read deployed `CORS_ORIGIN` from the running app container;
- fail on mismatch with the independently configured expected Web origin;
- pass `WEB_ORIGIN` to `npm run smoke-test`.

The test also requires that production does not derive its expected origin from deployed `CORS_ORIGIN`.

### Web credentialed CORS/session surface

The source contract requires `scripts/smoke-test.js` to use:

```text
WEB_ORIGIN
Origin: WEB_ORIGIN
X-Client-Type: web
/api/auth/login
/api/auth/refresh
access-control-allow-origin
access-control-allow-credentials
```

A real deployed smoke provides final behavioral evidence. Repository source assertions alone do not prove public CORS behavior.

## Deployment Data Flow

For each environment:

```text
GitHub environment expected Web origin
        │
        ├─────────────┐
        │             │
        ▼             ▼
required var      deployed app CORS_ORIGIN
validation             │
        │               │
        └──── compare ──┘
```

If equal:

```text
WEB_ORIGIN=<expected origin>
        ↓
application smoke
        ↓
credentialed CORS/login/refresh surface
```

If unequal, deployment stops before claiming Web FE compatibility.

Remote runtime artifact flow:

```text
GitHub checkout at release commit
        ↓
copy tracked Compose + droplet verifier
        ↓
remote deploy path
        ↓
docker compose pull / recreate / migrate
        ↓
droplet verification
        ↓
external ingress verification where applicable
        ↓
application smoke
```

Host-local `.env` state remains outside this transfer.

## Error and Failure Semantics

- missing expected Web-origin GitHub variable → fail before remote rollout;
- deployed `CORS_ORIGIN` empty → fail verification;
- deployed `CORS_ORIGIN` differs from expected origin → fail verification;
- artifact synchronization failure → fail before Compose rollout;
- credentialed Web-origin smoke failure → fail deployment smoke gate;
- missing external GitHub release-protection evidence → completion remains `Needs Verification`, not silently accepted.

## Documentation Contract

Docs must distinguish three evidence classes:

1. **Repository contract** — source and tests define intended configuration.
2. **CI/deploy workflow contract** — workflows require and compare environment inputs.
3. **Runtime evidence** — actual staging/production hosts demonstrate the configured origin and smoke behavior.

Docs must not claim production HA from the single tracked Compose service. They should say HA is not established by the current repository runtime contract unless separate infrastructure evidence exists.

Docs must describe `LOG_LEVEL` as environment-controlled; the tracked production example currently demonstrates `info`, not a guaranteed platform-wide `warn` policy.

CORS troubleshooting must point operators to the droplet runtime env / container environment, not an obsolete App Platform dashboard.

## Non-Goals

INF-279 does not:

- remove, replace, or redesign backend Nginx;
- move CORS policy into Nginx;
- change JWT/cookie/session semantics;
- create production user credentials for smoke tests;
- change Attendance, geofence, WFA, FAHP, reporting, or user-management rules;
- change DB schema or migrations;
- guess production DB, bucket, staging Web origin, or other infrastructure identifiers;
- migrate hosting platforms;
- introduce Git checkout as a droplet runtime dependency;
- overwrite host-local env/secrets during artifact synchronization;
- redesign the master promotion model without verified GitHub protection evidence.

## Acceptance Criteria
- canonical backend local default is `3005` in runtime config and `.env.example`;
- explicit `PORT` override behavior remains unchanged;
- tracked production CORS origin is `https://infinite-track.tech`;
- production template contains no staging MySQL cluster name or staging Spaces bucket default;
- production and staging deployments use independent expected Web-origin variables;
- deployed `CORS_ORIGIN` is compared with the expected Web origin before Web compatibility is claimed;
- both workflows synchronize the tracked Compose and droplet verifier they execute remotely;
- host-local env files are never copied from Git or overwritten;
- generic smoke remains runnable without Web-origin input and clearly reports the skipped optional surface;
- staging/production workflows always provide `WEB_ORIGIN`, making that surface blocking there;
- CORS remains Express-owned;
- Nginx ingress behavior remains unchanged;
- operator docs match droplet + Compose + host-Nginx runtime truth;
- unsupported HA/log-level claims are removed or qualified;
- actual GitHub production environment/ruleset protection is verified before release-ordering claims are closed;
- `npm run lint` passes;
- focused INF-279/config tests pass;
- full non-integration `npm test` passes;
- staging and production runtime smoke evidence is captured separately from repository test evidence.

## Minimum Verification Evidence

```text
Repository / CI
npm run lint: PASS
focused INF-279/config tests: PASS
npm test: PASS
no staging identifiers in production env template: PASS
workflow expected-origin contract tests: PASS
workflow artifact-sync contract tests: PASS

Runtime / external
staging deployed CORS_ORIGIN == STAGING_WEB_ORIGIN: PASS
staging Web credentialed CORS/session smoke: PASS
production deployed CORS_ORIGIN == https://infinite-track.tech: PASS
production Web credentialed CORS/session smoke: PASS
production environment/ruleset gate: VERIFIED or explicitly NEEDS-DECISION
```

## Planning Boundary

The implementation plan should use small reviewable commits in this order:

1. local port and tracked production env truth;
2. focused INF-279 source-contract tests;
3. credentialed Web-origin smoke surface;
4. production workflow expected-origin + artifact synchronization;
5. staging workflow parity;
6. operator documentation reconciliation;
7. repository verification;
8. external staging/production evidence and GitHub release-gate verification.

No implementation task may modify Attendance business code, auth controllers/middleware, Nginx vhost semantics, database migrations, or public OpenAPI schemas.

## Context Availability Note

`CLAUDE.md` requests cross-repo cockpit files under `Deploy Infinite Track/Infinite Track/shared-context/`. A local search under `E:\skrisi` did not find `API_CONTRACT.md`, so those cockpit files were not available to this worktree audit.

This does not block the repository-derived design above, but any separate cockpit source that materially contradicts these runtime facts must be reconciled before implementation is declared complete.
