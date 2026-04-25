# INF-32 Backend Config Truth Audit

## Scope
Audit runtime/config truth across these surfaces:
- local development
- Docker Compose / droplet target
- CI
- historical DigitalOcean App Platform specs
- deployment/health documentation

Audit date: 2026-04-20
Target staging host: DigitalOcean droplet `it-backend-staging-sgp1`

## Executive summary
The backend is currently in a mixed-state configuration posture:
- the agreed deployment target in this rollout is **Droplet + Docker**
- repository still contains historical **App Platform** and **Kubernetes** artifacts
- `CLAUDE.md` documents repository-managed deployment via `.do/app*.yaml`, while this rollout targets a droplet runtime
- the active runtime contract in code does **not** fully match `.env.example`, GitHub Actions workflow surfaces, or `.do/*.yaml`
- several important deploy assumptions are duplicated across surfaces with different names or defaults

This means staging deployment can succeed or fail depending on which surface an operator treats as source of truth. The biggest immediate risk is not a missing single variable, but **configuration drift** across repo/runtime surfaces, including conflicting deployment guidance.

## Config truth map

| Config / concept | Declared in | Read by runtime | Local behavior | Docker / droplet behavior | GitHub Actions behavior (`ci.yml` vs deploy-*) | Docs / deploy expectation | Drift / ambiguity |
|---|---|---|---|---|---|---|---|
| `DB_HOST` | `.env.example`, `.do/app*.yaml`, `docker-compose.yml` env | `src/config/index.js`, `src/config/database.js` | defaults to local MySQL expectation | compose sets `db`; droplet target likely needs external DB host | `ci.yml` sets `localhost`; deploy-* workflows and `.do` surfaces imply other runtime targets | `CLAUDE.md` points to `.do/app*.yaml`, while this rollout targets droplet staging | same concept but surface-dependent value, no single canonical source |
| `DB_USER`, `DB_PASS`, `DB_NAME` | `.env.example`, `.do/app*.yaml`, `docker-compose.yml` | `src/config/index.js` | env-driven | compose defaults to sample values | `ci.yml` sets test values; deploy-* workflows and `.do` imply runtime values elsewhere | docs mention env-driven workflow | no explicit staging source-of-truth document |
| `DB_SSL` | `.env.example`, `.do/app-production.yaml`, `k8s/configmap.yaml` | **not read by active runtime config** | no effect | no effect unless future code reads it | not used in `ci.yml` | production app spec assumes it exists | declared but unused by `src/config/index.js` / `database.js` |
| `JWT_SECRET` | `.env.example`, `.do/app*.yaml` | `src/config/index.js` / auth middleware | validated only in production; functionally required wherever JWT sign/verify flows run | required in droplet runtime for auth-enabled deployments | `ci.yml` sets a test secret | docs imply backend-only secret | wording must distinguish prod-only validation from broader runtime requirement |
| `JWT_TTL_SECONDS` | `.env.example`, `.do/app*.yaml` | `src/config/index.js` | defaults to 86400 | env-driven | `ci.yml` does not set it | consistent enough | low drift |
| `CORS_ORIGIN` | `.env.example`, `.do/app*.yaml`, README | `src/config/index.js`, `src/middlewares/security.js` | defaults to `*` | compose does not set explicit value | `ci.yml` does not set it | production guidance exists | dangerous local default can leak into staging if not explicitly set |
| `GEOFENCE_RADIUS_DEFAULT_M` | `.env.example`, `.do/app*.yaml` | `src/config/index.js` | defaulted | env-driven | not relevant to CI tests | documented | low drift |
| `AUTO_CHECKOUT_IDLE_MIN` | `.env.example`, `.do/app*.yaml`, `k8s/configmap.yaml` | `src/config/index.js` | defaulted | env-driven | not set in CI | documented | low drift |
| `AUTO_CHECKOUT_TBUFFER_MIN` | `.env.example`, `.do/app*.yaml`, `k8s/configmap.yaml` | `src/config/index.js` | defaulted | env-driven | not set in CI | documented | low drift |
| `LATE_CHECKOUT_TOLERANCE_MIN` | `.env.example`, `k8s/configmap.yaml` | `src/controllers/attendance.controller.js`, `src/jobs/autoCheckout.job.js` | default fallback used | env-driven if set | not set in CI | only partially documented | runtime uses it outside config module; contract split |
| `DEFAULT_SHIFT_END` | `.env.example`, `k8s/configmap.yaml` | `src/controllers/attendance.controller.js`, `src/jobs/autoCheckout.job.js` | default fallback used | env-driven if set | not set in CI | only partially documented | same drift as above |
| `AHP_CR_THRESHOLD` | `.env.example` | `src/utils/fuzzyAhpEngine.js` | default fallback used | env-driven if set | not set in CI | minimally documented | low drift but outside config module |
| `GEOAPIFY_API_KEY` | `.env.example` | `src/controllers/booking.controller.js`, `src/controllers/wfa.controller.js` | env-driven | env-driven | not required in current CI | docs mention Geoapify | `.do/*.yaml` and `.do/README.md` still use `GEOAPIFY_KEY` instead |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | `.env.example`, CI | `src/config/cloudinary.js`, user controller diagnostics | env-driven | env-driven | CI sets all 3 test values | docs mention Cloudinary | `.do/*.yaml` and `.do/README.md` still use `CLOUDINARY_URL` instead |
| `PORT`, `NODE_ENV`, `TZ`, `LOG_LEVEL` | `.env.example`, compose, `.do/app*.yaml`, Dockerfile | runtime code + logger | default/local env | compose and Dockerfile both set values | CI sets only test-specific env | consistent enough | low drift |

## Surface-by-surface findings

### 1. Local development
- `.env.example` assumes **local MySQL** with `DB_HOST=localhost`
- local workflow is env-driven and simple
- no explicit documented local-vs-droplet split artifact was found in the repository

### 2. Docker Compose / droplet target
- `docker-compose.yml` still uses `build:` for the app service rather than `image:`
- compose assumes bundled MySQL service `db`
- this is good for local compose, but may not match droplet target if droplet should point to managed DB instead of local MySQL container
- compose environment does not set `CORS_ORIGIN`, so staging may inherit insecure wildcard default unless overridden externally

### 3. CI
- `.github/workflows/ci.yml` runs lint and test only
- `ci.yml` sets test DB credentials and Cloudinary test credentials, but does not represent droplet runtime env truth
- deploy-specific workflows (`deploy-staging.yml`, `docker-deploy.yml`) represent a different surface and should not be conflated with `ci.yml`
- CI currently proves code quality, not droplet runtime truth

### 4. Historical App Platform specs
- `.do/app.yaml` and `.do/app-production.yaml` still encode an App Platform worldview
- they use `GEOAPIFY_KEY` and `CLOUDINARY_URL`, but active Node runtime reads `GEOAPIFY_API_KEY` and split Cloudinary credentials
- this makes `.do/*.yaml` unsuitable as source of truth for the droplet deployment target without translation

### 5. Health / readiness / docs
- `health-check.sh` is host/container aware, but still broad enough to be interpreted as Docker/Kubernetes oriented rather than droplet-runtime specific
- `CLAUDE.md` now correctly states deployment is repository-managed and env-driven, but repo still contains multiple deploy surfaces that can confuse operators
- README still contains CORS guidance but does not by itself resolve which deploy artifact is canonical

## Drift and ambiguity report

### Blocking
1. **Active runtime vs historical App Platform env mismatch**
   - runtime reads `GEOAPIFY_API_KEY`
   - `.do/*.yaml` declare `GEOAPIFY_KEY`
2. **Cloudinary contract mismatch**
   - runtime reads 3 separate variables
   - `.do/*.yaml` declare `CLOUDINARY_URL`
3. **Compose local DB assumption may not match droplet staging DB truth**
   - compose uses `DB_HOST=db`
   - droplet target likely needs an explicit external DB host
4. **No single staging env source-of-truth artifact exists**
   - `.env.example` is local-first
   - compose is local-compose-first
   - `.do/*.yaml` are App Platform-first

### Risky
1. `CORS_ORIGIN` defaults to `*` in runtime config
2. `DB_SSL` is documented in multiple places but unused by active runtime config
3. `LATE_CHECKOUT_TOLERANCE_MIN` and `DEFAULT_SHIFT_END` bypass `src/config/index.js`, so runtime contract is split between config module and direct `process.env` reads
4. CI validates code but not droplet-runtime assumptions

### Informational
1. Kubernetes artifacts exist, but there is no evidence in the repository itself of an active DOKS backend deployment target; the connected DigitalOcean account queried during this audit also did not return any active DOKS clusters on 2026-04-20
2. Dockerfile is production-oriented and healthcheck-aware, but compose target still points to local build flow
3. FE App Platform app exists and can confuse backend deploy discussion if not explicitly excluded

## Immediate follow-up recommendations

1. **INF-137 should define the canonical backend runtime config contract**
   - especially DB host strategy, secret names, and local vs staging split
2. **INF-139 should move droplet runtime from `build:` to `image:`**
   - after config truth is locked
3. Create a single droplet-staging env inventory artifact
   - exact env var names
   - which are required
   - where secrets live on droplet
4. Align historical `.do/*.yaml` naming or explicitly mark them obsolete for backend deploy
5. Extend deploy verification so staging smoke test proves Health/Auth/Attendance/WFA on droplet, not only lint/test in CI

## Suggested next issues / refinements
- INF-137 — runtime config contract design
- INF-139 — DOCR image-based droplet runtime
- follow-up issue: droplet staging env inventory and secret placement source-of-truth
- follow-up issue: classify `.do/*.yaml` as historical / obsolete for backend target or reconcile them with the active runtime contract

## Severity summary
- Blocking: 4
- Risky: 4
- Informational: 3
