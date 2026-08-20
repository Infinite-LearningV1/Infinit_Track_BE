# INF-279 Backend Runtime Contract Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align backend local port, production/staging Web-origin contracts, deployment artifact synchronization, credentialed CORS smoke verification, and operator documentation with INF-277 and merged INF-278 runtime truth.

**Architecture:** Keep Express as CORS authority and host Nginx as the only public backend ingress. Deployment workflows receive an independent expected Web origin, compare it with the deployed container `CORS_ORIGIN`, synchronize only tracked runtime artifacts they execute remotely, and run a reusable smoke script with a mandatory Web-origin surface in staging/production.

**Tech Stack:** Node.js 18, Express 4, Jest 29, GitHub Actions YAML, Docker Compose, Bash/SSH, Axios.

**Spec:** `docs/superpowers/specs/2026-08-20-inf-279-runtime-contract-alignment-design.md`

## Global Constraints

- Base implementation on `origin/develop` commit `935702e` or its direct descendants after rebasing; do not copy the stale INF-278 worktree wholesale.
- Backend remains CORS authority; do not add CORS directives to Nginx.
- Keep public API/auth/Attendance semantics unchanged.
- Canonical local ports are Web FE `3000` and Backend `3005`.
- Production browser origin is exactly `https://infinite-track.tech`.
- Never guess the staging Web origin, production database host/name, or production Spaces bucket.
- Never overwrite `deploy/env/backend.production.env` or other host-local secrets during artifact synchronization.
- Do not change database migrations, Attendance business code, Nginx vhost semantics, or public OpenAPI schemas.
- Preserve the baseline gates: `npm run lint` and full non-integration `npm test` must remain green.

---
### Task 1: Lock local port and production env template truth

**Files:**
- Modify: `tests/configContract.test.js`
- Create: `tests/inf279RuntimeContract.test.js`
- Modify: `.env.example`
- Modify: `src/config/index.js`
- Modify: `deploy/env/backend.production.example`

**Interfaces:**
- Consumes: existing `loadRuntimeConfig()` test helper and environment-driven runtime config.
- Produces: default backend port `3005`; canonical production browser origin; staging-free production template.

- [ ] **Step 1: Add the failing runtime default-port test**

Add inside `describe('backend runtime config contract', ...)` in `tests/configContract.test.js`:

```js
test('defaults the backend listener to port 3005 when PORT is unset', async () => {
  delete process.env.PORT;
  process.env.JWT_SECRET = 'test-secret';
  setRequiredBaseEnv();

  const config = await loadRuntimeConfig();

  expect(config.port).toBe(3005);
});
```
- [ ] **Step 2: Add failing tracked-env contract tests**

Create `tests/inf279RuntimeContract.test.js` with the initial contract:

```js
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');

describe('INF-279 backend runtime contract alignment', () => {
  test('uses 3005 as the canonical local backend port', () => {
    const envExample = read('.env.example');
    expect(envExample).toContain('PORT=3005');
    expect(envExample).not.toContain('PORT=3000');
  });

  test('keeps the production env template production-specific and secret-free', () => {
    const productionEnv = read('deploy/env/backend.production.example');
    expect(productionEnv).toContain('CORS_ORIGIN=https://infinite-track.tech');
    expect(productionEnv).toContain('DB_HOST=replace-with-production-managed-mysql-host');
    expect(productionEnv).toContain('SPACES_BUCKET=replace-with-production-spaces-bucket');
    expect(productionEnv).not.toContain('it-mysql-staging-sgp1');
    expect(productionEnv).not.toContain('infinite-track-staging-sgp1');
  });
});
```
- [ ] **Step 3: Run the new tests and confirm they fail for the current drift**

Run:

```bash
npm test -- --runInBand tests/configContract.test.js tests/inf279RuntimeContract.test.js
```

Expected: FAIL because runtime/config still defaults to `3000`, `.env.example` still contains `PORT=3000`, and the production template still carries the old frontend/staging resource values.

- [ ] **Step 4: Implement the minimal runtime/env corrections**

Change `.env.example`:

```env
# Server Configuration
PORT=3005
NODE_ENV=development
```

Change `src/config/index.js`:

```js
export default {
  port: process.env.PORT || 3005,
  bindHost,
  env,
```

Do not alter explicit `PORT` override behavior or production bind-host validation.
Update the relevant production template sections to:

```env
# Public clients
# Exact browser origin for the canonical production Web FE.
CORS_ORIGIN=https://infinite-track.tech

# DigitalOcean Managed MySQL
# Use the production managed MySQL connection details from the target runtime.
DB_HOST=replace-with-production-managed-mysql-host
DB_PORT=25060
DB_USER=replace-with-production-managed-mysql-user
DB_PASS=replace-with-production-managed-mysql-password
DB_NAME=replace-with-production-managed-mysql-database
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=true

# DigitalOcean Spaces
SPACES_ENDPOINT=sgp1.digitaloceanspaces.com
SPACES_REGION=sgp1
SPACES_BUCKET=replace-with-production-spaces-bucket
SPACES_ACCESS_KEY_ID=replace-with-rotated-spaces-access-key
SPACES_SECRET_ACCESS_KEY=replace-with-rotated-spaces-secret-key
```

Do not invent the real production database or bucket identifier.

- [ ] **Step 5: Re-run focused tests**

Run: `npm test -- --runInBand tests/configContract.test.js tests/inf279RuntimeContract.test.js`

Expected: PASS.
- [ ] **Step 6: Verify lint on the touched JavaScript before commit**

Run:

```bash
npx eslint src/config/index.js tests/configContract.test.js tests/inf279RuntimeContract.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add .env.example src/config/index.js deploy/env/backend.production.example tests/configContract.test.js tests/inf279RuntimeContract.test.js
git diff --cached --check
git commit -m "fix(infra): align backend runtime env contract"
```

---

### Task 2: Add reusable credentialed Web-origin smoke verification

**Files:**
- Modify: `tests/inf279RuntimeContract.test.js`
- Modify: `scripts/smoke-test.js`

**Interfaces:**
- Consumes: `BASE_URL` argument and optional `WEB_ORIGIN` environment variable.
- Produces: a Web FE credentialed CORS/session smoke surface that is optional for generic/manual smoke but blocking when deploy workflows provide `WEB_ORIGIN`.
- [ ] **Step 1: Extend the INF-279 source contract for Web-origin smoke**

Append to `tests/inf279RuntimeContract.test.js`:

```js
test('defines an optional credentialed Web FE CORS/session smoke surface', () => {
  const smoke = read('scripts/smoke-test.js');

  expect(smoke).toContain('const WEB_ORIGIN = process.env.WEB_ORIGIN');
  expect(smoke).toContain('Web FE Credentialed CORS / Session Surface');
  expect(smoke).toContain("Origin: WEB_ORIGIN");
  expect(smoke).toContain("'X-Client-Type': 'web'");
  expect(smoke).toContain('/api/auth/login');
  expect(smoke).toContain('/api/auth/refresh');
  expect(smoke).toContain("response.headers['access-control-allow-origin'] === WEB_ORIGIN");
  expect(smoke).toContain("response.headers['access-control-allow-credentials'] === 'true'");
  expect(smoke).toContain('WEB_ORIGIN not provided');
  expect(smoke).toContain('logSkip');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --runInBand tests/inf279RuntimeContract.test.js`

Expected: FAIL because current smoke has no `WEB_ORIGIN` surface.
- [ ] **Step 3: Add `WEB_ORIGIN` and explicit skip accounting**

Near `BASE_URL` in `scripts/smoke-test.js` add:

```js
const WEB_ORIGIN = process.env.WEB_ORIGIN;
```

Extend `results` and add a skip logger:

```js
const results = {
  passed: 0,
  failed: 0,
  skipped: 0,
  tests: []
};

function logSkip(name, details = '') {
  console.log(`⏭️ ${name}`);
  if (details) console.log(`   ${details}`);
  results.tests.push({ name, passed: null, skipped: true, details });
  results.skipped++;
}
```

Keep skipped checks out of `failed`; a generic smoke without `WEB_ORIGIN` must remain usable but visibly incomplete for Web FE compatibility.
- [ ] **Step 4: Add the credentialed Web FE smoke function**

Add after the existing generic CORS test:

```js
async function testWebFrontendCorsSession() {
  const testName = 'Web FE Credentialed CORS / Session Surface';
  if (!WEB_ORIGIN) {
    logSkip(testName, 'WEB_ORIGIN not provided; skipping optional Web-origin verification');
    return true;
  }

  try {
    const preflight = await axios.options(`${BASE_URL}/api/auth/login`, {
      timeout: TIMEOUT,
      validateStatus: () => true,
      headers: {
        Origin: WEB_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,X-Client-Type'
      }
    });

    const login = await requestWithAnyStatus('post', '/api/auth/login', {
      headers: {
        Origin: WEB_ORIGIN,
        'Content-Type': 'application/json',
        'X-Client-Type': 'web'
      },
      data: { email: 'smoke-web@example.com', password: 'wrongpassword' }
    });
```
Continue the same function:

```js
    const refresh = await requestWithAnyStatus('post', '/api/auth/refresh', {
      headers: {
        Origin: WEB_ORIGIN,
        'Content-Type': 'application/json',
        'X-Client-Type': 'web'
      },
      data: {}
    });

    const hasCredentialedCors = (response) =>
      response.headers['access-control-allow-origin'] === WEB_ORIGIN &&
      response.headers['access-control-allow-credentials'] === 'true';

    const passed =
      [200, 204].includes(preflight.status) &&
      EXPECTED_INVALID_LOGIN_STATUSES.has(login.status) &&
      refresh.status === 401 &&
      hasCredentialedCors(preflight) &&
      hasCredentialedCors(login) &&
      hasCredentialedCors(refresh);

    logTest(
      testName,
      passed,
      `Origin: ${WEB_ORIGIN}, preflight=${preflight.status}, login=${login.status}, refresh=${refresh.status}`
    );
    return passed;
  } catch (error) {
    logTest(testName, false, formatAxiosError(error));
    return false;
  }
}
```
- [ ] **Step 5: Invoke the new smoke surface and expose skip count**

In `runTests()`, call it immediately after the generic CORS test:

```js
await testCORS();
await testWebFrontendCorsSession();
await testSecurityHeaders();
```

In the summary add:

```js
console.log(`⏭️ Skipped: ${results.skipped}`);
```

Do not make skipped checks increment `failed`.

- [ ] **Step 6: Run focused source contract and lint**

Run:

```bash
npm test -- --runInBand tests/inf279RuntimeContract.test.js
npx eslint scripts/smoke-test.js tests/inf279RuntimeContract.test.js
```

Expected: PASS.

- [ ] **Step 7: Preserve generic smoke behavior without `WEB_ORIGIN`**

Do not call a public environment yet. Source review requirement: `WEB_ORIGIN` absence reaches `logSkip(...)` and does not call `process.exit(1)` by itself.
- [ ] **Step 8: Commit Task 2**

```bash
git add scripts/smoke-test.js tests/inf279RuntimeContract.test.js
git diff --cached --check
git commit -m "test(infra): verify credentialed web cors surface"
```

---

### Task 3: Make production deploy verify independent Web-origin truth and sync runtime artifacts

**Files:**
- Modify: `tests/inf279RuntimeContract.test.js`
- Modify: `.github/workflows/deploy-production.yml`

**Interfaces:**
- Consumes: GitHub production environment variable `PRODUCTION_WEB_ORIGIN`, remote production container `CORS_ORIGIN`, current checkout's `docker-compose.yml`, and `deploy/scripts/verify-droplet-api.sh`.
- Produces: a blocking comparison between expected production Web origin and deployed backend CORS config, plus release-commit runtime artifact synchronization.

- [ ] **Step 1: Add the failing production workflow contract**

Append to `tests/inf279RuntimeContract.test.js`:

```js
test('production deploy independently verifies Web origin and syncs executed runtime artifacts', () => {
  const workflow = read('.github/workflows/deploy-production.yml');

  expect(workflow).toContain('PRODUCTION_WEB_ORIGIN: ${{ vars.PRODUCTION_WEB_ORIGIN }}');
  expect(workflow).toContain('"$PRODUCTION_WEB_ORIGIN"');
  expect(workflow).toContain('docker-compose.yml');
  expect(workflow).toContain('deploy/scripts/verify-droplet-api.sh');
```
Continue the test:

```js
  expect(workflow).toContain('docker compose exec -T app printenv CORS_ORIGIN');
  expect(workflow).toContain('DEPLOYED_CORS_ORIGIN');
  expect(workflow).toContain('PRODUCTION_WEB_ORIGIN');
  expect(workflow).toContain('WEB_ORIGIN="$PRODUCTION_WEB_ORIGIN" npm run smoke-test');
  expect(workflow).not.toContain('WEB_ORIGIN="$DEPLOYED_CORS_ORIGIN" npm run smoke-test');
  expect(workflow).not.toContain('deploy/env/backend.production.env');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- --runInBand tests/inf279RuntimeContract.test.js`

Expected: FAIL because production workflow does not yet expose `PRODUCTION_WEB_ORIGIN`, synchronize the tracked files, or compare deployed CORS truth.

- [ ] **Step 3: Add the production expected-origin variable**

Under workflow `env:` add exactly:

```yaml
PRODUCTION_WEB_ORIGIN: ${{ vars.PRODUCTION_WEB_ORIGIN }}
```

Add `"$PRODUCTION_WEB_ORIGIN"` to the existing `Validate production runtime contract` loop so an unset value fails before SSH rollout.
- [ ] **Step 4: Lock the production variable to the known canonical Web origin**

Immediately after required-variable validation add:

```bash
if [ "$PRODUCTION_WEB_ORIGIN" != "https://infinite-track.tech" ]; then
  echo "PRODUCTION_WEB_ORIGIN must equal the canonical Web FE origin https://infinite-track.tech."
  exit 1
fi
```

Also extend the production workflow test with:

```js
expect(workflow).toContain('https://infinite-track.tech');
expect(workflow).toContain('PRODUCTION_WEB_ORIGIN must equal the canonical Web FE origin');
```

This prevents two independently stored but equally wrong backend values from producing a false green result.

- [ ] **Step 5: Synchronize only the tracked remote runtime artifacts**

After `Configure SSH key` and before `Deploy selected image on production droplet`, add:

```yaml
- name: Sync tracked runtime artifacts
  run: |
    set -euo pipefail
    tar -czf - docker-compose.yml deploy/scripts/verify-droplet-api.sh \
      | ssh -i "$HOME/.ssh/production.key" -o IdentitiesOnly=yes "$PRODUCTION_SSH_USER@$PRODUCTION_SSH_HOST" "
          set -euo pipefail
          mkdir -p '$PRODUCTION_DEPLOY_PATH/deploy/scripts'
          tar -xzf - -C '$PRODUCTION_DEPLOY_PATH'
        "
```
- [ ] **Step 6: Compare deployed CORS truth with the independent expected origin**

Replace the production smoke step with:

```yaml
- name: Verify production Web-origin contract and run blocking smoke
  run: |
    set -euo pipefail
    DEPLOYED_CORS_ORIGIN="$(ssh -i "$HOME/.ssh/production.key" -o IdentitiesOnly=yes "$PRODUCTION_SSH_USER@$PRODUCTION_SSH_HOST" "
      cd '$PRODUCTION_DEPLOY_PATH'
      docker compose exec -T app printenv CORS_ORIGIN
    " | tr -d '\r\n')"

    if [ -z "$DEPLOYED_CORS_ORIGIN" ]; then
      echo "Production deployed CORS_ORIGIN is empty."
      exit 1
    fi

    if [ "$DEPLOYED_CORS_ORIGIN" != "$PRODUCTION_WEB_ORIGIN" ]; then
      echo "Production CORS mismatch: deployed backend origin does not match PRODUCTION_WEB_ORIGIN."
      exit 1
    fi

    WEB_ORIGIN="$PRODUCTION_WEB_ORIGIN" npm run smoke-test "$PRODUCTION_PUBLIC_BASE_URL"
```

Do not print secret env values. `CORS_ORIGIN` is not secret, but the workflow must not dump the full container environment.
- [ ] **Step 7: Run the production workflow contract tests and lint**

Run:

```bash
npm test -- --runInBand tests/inf279RuntimeContract.test.js tests/inf278DeploymentVerificationContract.test.js
npx eslint tests/inf279RuntimeContract.test.js
```

Expected: PASS. Existing INF-278 deployment verification tests must remain green.

- [ ] **Step 8: Review the workflow diff for secret/runtime-state safety**

Run:

```bash
git diff -- .github/workflows/deploy-production.yml
```

Required review result:
- transfer list contains only `docker-compose.yml` and `deploy/scripts/verify-droplet-api.sh`;
- no `deploy/env/backend.production.env` transfer exists;
- no private key, database secret, JWT secret, or Spaces credential is echoed.

- [ ] **Step 9: Commit Task 3**

```bash
git add .github/workflows/deploy-production.yml tests/inf279RuntimeContract.test.js
git diff --cached --check
git commit -m "fix(infra): verify production web origin contract"
```

---
### Task 4: Add staging Web-origin and runtime-artifact parity

**Files:**
- Modify: `tests/inf279RuntimeContract.test.js`
- Modify: `.github/workflows/deploy-staging.yml`

**Interfaces:**
- Consumes: GitHub staging environment variable `STAGING_WEB_ORIGIN`, remote staging container `CORS_ORIGIN`, current checkout's Compose/verifier files.
- Produces: staging credentialed Web compatibility as a blocking deployment check without hardcoding an unverified staging frontend domain.

- [ ] **Step 1: Add the failing staging workflow contract**

Append:

```js
test('staging deploy verifies its configured Web origin and syncs executed runtime artifacts', () => {
  const workflow = read('.github/workflows/deploy-staging.yml');

  expect(workflow).toContain('STAGING_WEB_ORIGIN: ${{ vars.STAGING_WEB_ORIGIN }}');
  expect(workflow).toContain('"$STAGING_WEB_ORIGIN"');
  expect(workflow).toContain('docker-compose.yml');
  expect(workflow).toContain('deploy/scripts/verify-droplet-api.sh');
  expect(workflow).toContain('docker compose exec -T app printenv CORS_ORIGIN');
  expect(workflow).toContain('DEPLOYED_CORS_ORIGIN');
  expect(workflow).toContain('WEB_ORIGIN="$STAGING_WEB_ORIGIN" npm run smoke-test');
  expect(workflow).not.toContain('deploy/env/backend.production.env');
  expect(workflow).not.toContain('https://infinite-track.tech');
});
```
- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --runInBand tests/inf279RuntimeContract.test.js`

Expected: FAIL because staging has no expected Web-origin input, no artifact sync, and no deployed CORS comparison.

- [ ] **Step 3: Add staging expected-origin input and required-variable validation**

Under staging workflow `env:` add:

```yaml
STAGING_WEB_ORIGIN: ${{ vars.STAGING_WEB_ORIGIN }}
```

Add `"$STAGING_WEB_ORIGIN"` to `Validate staging runtime contract`.

Do not add a literal staging frontend URL in repository source. The actual value must be configured in the GitHub `staging` environment from observed staging deployment truth.

- [ ] **Step 4: Synchronize the same bounded tracked artifacts**

After SSH key setup and before staging rollout, add the staging equivalent of Task 3's tar-over-SSH step:

```yaml
- name: Sync tracked runtime artifacts
  run: |
    set -euo pipefail
    tar -czf - docker-compose.yml deploy/scripts/verify-droplet-api.sh \
      | ssh -i "$HOME/.ssh/staging.key" -o IdentitiesOnly=yes "$STAGING_SSH_USER@$STAGING_SSH_HOST" "
          set -euo pipefail
          mkdir -p '$STAGING_DEPLOY_PATH/deploy/scripts'
          tar -xzf - -C '$STAGING_DEPLOY_PATH'
        "
```
- [ ] **Step 5: Compare deployed staging CORS truth and run blocking Web smoke**

Replace the current staging smoke step with:

```yaml
- name: Verify staging Web-origin contract and run blocking smoke
  run: |
    set -euo pipefail
    DEPLOYED_CORS_ORIGIN="$(ssh -i "$HOME/.ssh/staging.key" -o IdentitiesOnly=yes "$STAGING_SSH_USER@$STAGING_SSH_HOST" "
      cd '$STAGING_DEPLOY_PATH'
      docker compose exec -T app printenv CORS_ORIGIN
    " | tr -d '\r\n')"

    if [ -z "$DEPLOYED_CORS_ORIGIN" ]; then
      echo "Staging deployed CORS_ORIGIN is empty."
      exit 1
    fi

    if [ "$DEPLOYED_CORS_ORIGIN" != "$STAGING_WEB_ORIGIN" ]; then
      echo "Staging CORS mismatch: deployed backend origin does not match STAGING_WEB_ORIGIN."
      exit 1
    fi

    WEB_ORIGIN="$STAGING_WEB_ORIGIN" npm run smoke-test "$STAGING_PUBLIC_BASE_URL"
```

This intentionally uses environment truth rather than a guessed repository URL.
- [ ] **Step 6: Run staging + production workflow contract tests**

Run:

```bash
npm test -- --runInBand tests/inf279RuntimeContract.test.js tests/inf278DeploymentVerificationContract.test.js
```

Expected: PASS.

- [ ] **Step 7: Review staging diff for environment isolation**

Run: `git diff -- .github/workflows/deploy-staging.yml`

Required review result:
- no production host/domain is hardcoded into staging;
- no production env file is copied;
- only tracked Compose/verifier artifacts are synchronized;
- `STAGING_WEB_ORIGIN` is required and independently compared with deployed `CORS_ORIGIN`.

- [ ] **Step 8: Commit Task 4**

```bash
git add .github/workflows/deploy-staging.yml tests/inf279RuntimeContract.test.js
git diff --cached --check
git commit -m "fix(infra): align staging runtime verification"
```

---

### Task 5: Reconcile operator-facing runtime and release documentation

**Files:**
- Modify: `tests/inf279RuntimeContract.test.js`
- Modify: `README.md`
- Modify: `docs/GITHUB_ACTIONS_SETUP.md`
- Modify: `docs/PRODUCTION_DEPLOYMENT.md`
- Modify: `docs/droplet-docr-runtime.md`
**Interfaces:**
- Consumes: implementation truth from Tasks 1-4 and the existing droplet + Compose + host-Nginx architecture.
- Produces: operator docs that distinguish repository contract, deployment workflow contract, and external/runtime evidence.

- [ ] **Step 1: Add failing documentation contract assertions**

Append to `tests/inf279RuntimeContract.test.js`:

```js
test('documents Web-origin inputs and current droplet runtime truth without unsupported HA claims', () => {
  const readme = read('README.md');
  const actionsGuide = read('docs/GITHUB_ACTIONS_SETUP.md');
  const productionGuide = read('docs/PRODUCTION_DEPLOYMENT.md');
  const dropletGuide = read('docs/droplet-docr-runtime.md');

  expect(actionsGuide).toContain('STAGING_WEB_ORIGIN');
  expect(actionsGuide).toContain('PRODUCTION_WEB_ORIGIN');
  expect(readme).not.toContain('2+ (HA)');
  expect(readme).not.toContain('Check environment variable in DO Dashboard');
  expect(readme).toContain('docker compose exec -T app printenv CORS_ORIGIN');
  expect(productionGuide).toContain('expected Web origin');
  expect(productionGuide).toContain('tracked runtime artifacts');
  expect(productionGuide).toContain('repository YAML does not enforce staging-before-production ordering');
  expect(dropletGuide).toContain('WEB_ORIGIN');
  expect(dropletGuide).toContain('host-local');
});
```
- [ ] **Step 2: Run the documentation contract and verify RED**

Run: `npm test -- --runInBand tests/inf279RuntimeContract.test.js`

Expected: FAIL on missing Web-origin variables, unsupported HA wording, obsolete CORS troubleshooting, and missing deployment-sync/evidence language.

- [ ] **Step 3: Reconcile the README environment-separation table**

Replace unsupported instance/log-level claims with repository-backed wording:

```markdown
| Component | Staging | Production |
| --- | --- | --- |
| **Database** | Staging DB (test data) | Production DB (**separate**) |
| **JWT_SECRET** | Staging secret | **Different** secret |
| **CORS_ORIGIN** | Must equal `STAGING_WEB_ORIGIN` | Must equal `https://infinite-track.tech` / `PRODUCTION_WEB_ORIGIN` |
| **Deploy Trigger** | `master` workflow | `master` workflow; ordering/protection requires external GitHub evidence |
| **Runtime instances** | One tracked `app` service | One tracked `app` service; HA is not established by repository runtime config |
| **Log level** | Environment-controlled | Environment-controlled; tracked production template currently uses `info` |
```

Do not claim a multi-instance topology unless separate infrastructure evidence is inspected.

- [ ] **Step 4: Replace obsolete README CORS troubleshooting**

Use:

```markdown
#### CORS Errors
1. SSH to the target backend droplet.
2. Enter the configured backend deploy path.
3. Run `docker compose exec -T app printenv CORS_ORIGIN`.
4. Compare the value exactly with `STAGING_WEB_ORIGIN` or `PRODUCTION_WEB_ORIGIN` from the corresponding GitHub environment.
5. For production, the expected browser origin is `https://infinite-track.tech` with no trailing slash.
```
- [ ] **Step 5: Document the GitHub environment variables**

Under staging variables in `docs/GITHUB_ACTIONS_SETUP.md`, add:

```markdown
- `STAGING_WEB_ORIGIN`
  - Exact browser origin of the deployed staging Web FE.
  - Must equal the staging backend container `CORS_ORIGIN`.
```

Under production variables add:

```markdown
- `PRODUCTION_WEB_ORIGIN`
  - Canonical value: `https://infinite-track.tech`.
  - Deployment fails if this differs from the deployed backend container `CORS_ORIGIN`.
```

Update the validation prose to state that both workflows require the corresponding Web-origin variable before rollout.

- [ ] **Step 6: Add deployment synchronization and evidence boundaries to `docs/PRODUCTION_DEPLOYMENT.md`**

Add a section containing this contract:

```markdown
## Web-Origin and Runtime Artifact Contract

Each environment has an independent expected Web-origin input. The deployment compares that value with the running backend container's `CORS_ORIGIN` before claiming Web FE compatibility.

The workflow synchronizes the release commit's `docker-compose.yml` and `deploy/scripts/verify-droplet-api.sh` before executing them on the droplet. Host-local env/secrets remain untracked and are never copied from Git.

Staging and production are separate workflows triggered from `master`; repository YAML does not enforce staging-before-production ordering. GitHub environment/ruleset protection is external operational evidence and must be inspected separately.
```
- [ ] **Step 7: Document host-local env ownership and Web-origin smoke invocation**

In `docs/droplet-docr-runtime.md`, add:

```markdown
## Runtime env ownership

`deploy/env/backend.production.env` is host-local runtime state. Deployment artifact synchronization must not replace it. The running container's `CORS_ORIGIN` must match the expected browser origin configured for the environment.

## Web-origin smoke

Staging:
`WEB_ORIGIN="$STAGING_WEB_ORIGIN" npm run smoke-test "$STAGING_PUBLIC_BASE_URL"`

Production:
`WEB_ORIGIN="$PRODUCTION_WEB_ORIGIN" npm run smoke-test "$PRODUCTION_PUBLIC_BASE_URL"`

A generic smoke invocation without `WEB_ORIGIN` remains useful for backend-only checks but does not constitute Web FE CORS/session evidence.
```

- [ ] **Step 8: Run documentation contract and focused regression tests**

Run:

```bash
npm test -- --runInBand tests/inf279RuntimeContract.test.js tests/configContract.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

```bash
git add README.md docs/GITHUB_ACTIONS_SETUP.md docs/PRODUCTION_DEPLOYMENT.md docs/droplet-docr-runtime.md tests/inf279RuntimeContract.test.js
git diff --cached --check
git commit -m "docs(infra): align backend runtime verification truth"
```
---

### Task 6: Run repository gates and capture external runtime/release evidence

**Files:**
- Create only if evidence is executed in the same implementation cycle: `docs/superpowers/reports/2026-08-20-inf-279-runtime-contract-alignment.md`
- No product/runtime source changes are allowed in this task unless a failing gate reveals an INF-279 regression.

**Interfaces:**
- Consumes: completed Tasks 1-5, GitHub environment configuration, deployed staging/production runtime.
- Produces: completion evidence that clearly separates repository/CI proof from external runtime proof.

- [ ] **Step 1: Run focused INF-279 and inherited ingress contracts**

Run:

```bash
npm test -- --runInBand \
  tests/inf279RuntimeContract.test.js \
  tests/configContract.test.js \
  tests/inf278DeploymentVerificationContract.test.js \
  tests/inf278IngressRuntimeContract.test.js \
  tests/inf278NginxContract.test.js
```

Expected: all selected suites PASS.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: PASS with exit code `0`.
- [ ] **Step 3: Run the full non-integration regression suite**

Run:

```bash
npm test -- --runInBand
```

Expected: PASS. Compare against the pre-change baseline of `161 suites / 1540 tests`; a count change is acceptable only when explained by the new INF-279 test file, while zero failures remains mandatory.

- [ ] **Step 4: Scan the final diff for stale runtime truth and secret leakage**

Run:

```bash
git diff origin/develop...HEAD --check
git grep -n "CORS_ORIGIN=https://orca-app-58alv.ondigitalocean.app" -- . ':!docs/superpowers/specs/**' ':!docs/superpowers/plans/**'
git grep -n "SPACES_BUCKET=infinite-track-staging-sgp1" -- deploy/env/backend.production.example
git grep -n "PORT=3000" -- .env.example
git diff origin/develop...HEAD -- .github/workflows deploy/env .env.example src/config scripts tests README.md docs
```

Expected:
- `git diff --check` produces no output;
- the three stale-value searches produce no active-contract matches;
- review shows no secret material and no Nginx/business/API semantic changes.

- [ ] **Step 5: Verify GitHub environment inputs before runtime deployment**

Using authenticated GitHub environment/repository tooling, verify:

```text
production.PRODUCTION_WEB_ORIGIN = https://infinite-track.tech
staging.STAGING_WEB_ORIGIN = the observed deployed staging Web FE browser origin
```

If the staging Web origin cannot be established from actual deployment truth, stop: do not invent it and do not run staging Web-compatibility smoke.
- [ ] **Step 6: Inspect the actual production release protection**

Inspect the GitHub `production` environment and relevant branch/ruleset settings. Record one of these exact outcomes:

```text
VERIFIED: an explicit protection/approval rule exists; record the actual rule and who/what gates deployment.
```

or:

```text
NEEDS VERIFICATION / NEEDS DECISION: repository workflows are independently triggered from master and no verified external rule proves staging-before-production ordering.
```

Do not add a new workflow orchestration architecture merely to turn the second outcome into green; that requires a separate decision.

- [ ] **Step 7: Execute staging runtime evidence after the staging environment is configured**

Required observed evidence from the staging deploy run:

```text
deployed CORS_ORIGIN == STAGING_WEB_ORIGIN
Web FE Credentialed CORS / Session Surface: PASS
/livez: PASS
/health: PASS
tracked runtime artifact synchronization: PASS
```

A repository unit test is not a substitute for these deployed checks.

- [ ] **Step 8: Execute production runtime evidence after approved promotion**

Required observed evidence:

```text
PRODUCTION_WEB_ORIGIN == https://infinite-track.tech
deployed CORS_ORIGIN == PRODUCTION_WEB_ORIGIN
Web FE Credentialed CORS / Session Surface: PASS
public ingress verification: PASS
/livez: PASS
/health: PASS
```
- [ ] **Step 9: Capture evidence without overstating completion**

If external checks were performed in this cycle, create `docs/superpowers/reports/2026-08-20-inf-279-runtime-contract-alignment.md` with these sections and actual observed results:

```markdown
# INF-279 Runtime Contract Alignment Verification

## Repository Evidence
- lint result
- focused test result
- full test result
- final commit SHA

## Staging Runtime Evidence
- expected Web origin
- deployed CORS origin comparison
- credentialed Web smoke result
- workflow run reference

## Production Runtime Evidence
- canonical Web origin comparison
- credentialed Web smoke result
- ingress/health result
- workflow run reference

## Release Protection Evidence
- `VERIFIED` with the observed protection rule, or
- `NEEDS VERIFICATION / NEEDS DECISION` with the missing evidence stated explicitly.
```

Do not fabricate workflow URLs, environment values, or protection rules.
- [ ] **Step 10: Commit the evidence report only when it contains real evidence**

If the report was created from actual observed checks:

```bash
git add docs/superpowers/reports/2026-08-20-inf-279-runtime-contract-alignment.md
git diff --cached --check
git commit -m "docs(infra): record INF-279 runtime verification"
```

If external runtime checks were not executed, do not create an empty evidence artifact. Keep those acceptance criteria explicitly open in Linear/PR notes.

## Final Completion Gate

INF-279 can be proposed as repository-complete only when Tasks 1-5 and repository gates in Task 6 pass. It can be marked fully Done only when the required staging/production runtime evidence is also available and release-protection status is either verified or explicitly resolved by a new decision.

Final PR notes must answer:

```text
What changed in runtime configuration?
Where is CORS policy still owned?
How are expected Web origins independent from deployed CORS config?
Which tracked artifacts are synchronized and which host-local files are protected?
What repository tests passed?
What staging/production evidence actually exists?
What release-protection evidence exists or remains unresolved?
```

Do not claim runtime success from source tests alone.
