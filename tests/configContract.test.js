import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { jest } from '@jest/globals';

const repoRoot = process.cwd();

function setRequiredBaseEnv() {
  process.env.DB_HOST = 'db.example.internal';
  process.env.DB_NAME = 'infinite_track';
  process.env.DB_USER = 'trackuser';
  process.env.DB_PASS = 'trackpass';
}

async function loadRuntimeConfig() {
  const { default: config } = await import('../src/config/index.js');

  return config;
}

const productionCorsValidationError =
  'CORS_ORIGIN must be set explicitly in production; wildcard or empty origins are not allowed.';

async function loadSecurityModule() {
  return import('../src/middlewares/security.js');
}

async function loadProductionCorsValidation(origin) {
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'test-secret';
  process.env.CORS_ORIGIN = origin;
  setRequiredBaseEnv();

  const config = await loadRuntimeConfig();
  const { validateCorsOrigin } = await loadSecurityModule();

  return { config, validateCorsOrigin };
}

function readDockerCompose() {
  return fs.readFileSync(path.resolve(repoRoot, 'docker-compose.yml'), 'utf8');
}

function readDockerfile() {
  return fs.readFileSync(path.resolve(repoRoot, 'Dockerfile'), 'utf8');
}

function readK8sDeployment() {
  return fs.readFileSync(path.resolve(repoRoot, 'k8s/app-deployment.yaml'), 'utf8');
}

function readScript(relativePath) {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function migrationFiles() {
  return fs.readdirSync(path.resolve(repoRoot, 'src/models/migrations')).sort();
}

function loadCliConfig() {
  const require = createRequire(import.meta.url);
  const configPath = path.resolve(repoRoot, 'src/config/database-cli.cjs');

  delete require.cache[configPath];

  return require(configPath);
}

function readDoDeploySpec(fileName) {
  return fs.readFileSync(path.resolve(repoRoot, '.do', fileName), 'utf8');
}

function readDoReadme() {
  return fs.readFileSync(path.resolve(repoRoot, '.do/README.md'), 'utf8');
}

function readRootReadme() {
  return fs.readFileSync(path.resolve(repoRoot, 'README.md'), 'utf8');
}

function readClaudeInstructions() {
  return fs.readFileSync(path.resolve(repoRoot, 'CLAUDE.md'), 'utf8');
}

function readWorkflow(relativePath) {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), 'utf8');
}

describe('backend runtime config contract', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...envBackup };
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  test('reads DB_PORT, DB_SSL and DB_SSL_REJECT_UNAUTHORIZED from environment into runtime config', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.DB_PORT = '25060';
    process.env.DB_SSL = 'true';
    process.env.DB_SSL_REJECT_UNAUTHORIZED = 'false';
    setRequiredBaseEnv();

    const config = await loadRuntimeConfig();

    expect(config.db.port).toBe(25060);
    expect(config.db.ssl).toBe(true);
    expect(config.db.sslRejectUnauthorized).toBe(false);
  });

  test('defaults the backend listener to port 3005 when PORT is unset', async () => {
    delete process.env.PORT;
    process.env.JWT_SECRET = 'test-secret';
    setRequiredBaseEnv();

    const config = await loadRuntimeConfig();

    expect(config.port).toBe(3005);
  });

  test('fails closed when production credentialed CORS origin resolves empty', async () => {
    const { config, validateCorsOrigin } = await loadProductionCorsValidation('');

    expect(config.cors.origin).toBe('');
    expect(() => validateCorsOrigin()).toThrow(productionCorsValidationError);
  });

  test('fails closed when production CORS origin is left as wildcard', async () => {
    const { validateCorsOrigin } = await loadProductionCorsValidation('*');

    expect(() => validateCorsOrigin()).toThrow(productionCorsValidationError);
  });

  test('accepts explicit production CORS origin for credentialed requests', async () => {
    const { config, validateCorsOrigin } = await loadProductionCorsValidation('https://app.example.com');

    expect(config.cors.origin).toBe('https://app.example.com');
    expect(() => validateCorsOrigin()).not.toThrow();
  });

  test('reads DB_PORT and SSL settings into sequelize-cli config for managed database migrations', () => {
    process.env.DB_PORT = '25060';
    process.env.DB_SSL = 'true';
    process.env.DB_SSL_REJECT_UNAUTHORIZED = 'false';
    setRequiredBaseEnv();

    const config = loadCliConfig();

    expect(config.staging.port).toBe(25060);
    expect(config.production.port).toBe(25060);
    expect(config.staging.dialectOptions.ssl).toEqual({ rejectUnauthorized: false });
    expect(config.production.dialectOptions.ssl).toEqual({ rejectUnauthorized: false });
  });
  test('reads explicit access refresh and inactivity auth config from environment', async () => {
    process.env.JWT_SECRET = 'legacy-secret';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    process.env.JWT_ACCESS_TTL_SECONDS = '900';
    process.env.JWT_REFRESH_TTL_SECONDS = '2592000';
    process.env.JWT_REFRESH_INACTIVITY_WINDOW_SECONDS = '172800';
    setRequiredBaseEnv();

    const config = await loadRuntimeConfig();

    expect(config.jwt.secret).toBe('legacy-secret');
    expect(config.jwt.refreshSecret).toBe('refresh-secret');
    expect(config.jwt.accessTtl).toBe(900);
    expect(config.jwt.refreshTtl).toBe(2592000);
    expect(config.jwt.refreshInactivityWindowSeconds).toBe(172800);
  });

  test('loads sequelize-cli env from a parent repo .env when invoked inside a worktree', () => {
    const cwdBackup = process.cwd();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-env-'));

    try {
      const fakeRepoRoot = path.join(tempRoot, 'repo-root');
      const worktreeDir = path.join(fakeRepoRoot, '.worktrees', 'feature-branch');

      fs.mkdirSync(worktreeDir, { recursive: true });
      fs.writeFileSync(
        path.join(fakeRepoRoot, '.env'),
        [
          'DB_HOST=parent-host',
          'DB_NAME=parent-db',
          'DB_USER=parent-user',
          'DB_PASS=parent-pass',
          'DB_PORT=25060',
          'DB_SSL=true',
          'DB_SSL_REJECT_UNAUTHORIZED=false'
        ].join('\n') + '\n',
        'utf8'
      );

      delete process.env.DB_HOST;
      delete process.env.DB_NAME;
      delete process.env.DB_USER;
      delete process.env.DB_PASS;
      delete process.env.DB_PORT;
      delete process.env.DB_SSL;
      delete process.env.DB_SSL_REJECT_UNAUTHORIZED;

      process.chdir(worktreeDir);
      const config = loadCliConfig();

      expect(config.production.host).toBe('parent-host');
      expect(config.production.database).toBe('parent-db');
      expect(config.production.port).toBe(25060);
      expect(config.production.dialectOptions.ssl).toEqual({ rejectUnauthorized: false });
    } finally {
      process.chdir(cwdBackup);
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('does not expose operational attendance settings as env-backed runtime config', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.GEOFENCE_RADIUS_DEFAULT_M = '999';
    process.env.AUTO_CHECKOUT_IDLE_MIN = '99';
    process.env.AUTO_CHECKOUT_TBUFFER_MIN = '88';
    setRequiredBaseEnv();

    const config = await loadRuntimeConfig();

    expect(config.geofence).toBeUndefined();
    expect(config.autoCheckout).toBeUndefined();
  });

  test('declares immutable DOCR production runtime and env-file driven config', () => {
    const compose = readDockerCompose();

    expect(compose).toContain(
      'image: ${BACKEND_IMAGE:-registry.digitalocean.com/infinit-track/infinit-track-backend}:${BACKEND_IMAGE_TAG:?BACKEND_IMAGE_TAG is required}'
    );
    expect(compose).not.toContain('build:');
    expect(compose).not.toContain('infinit-track-backend:latest');
    expect(compose).not.toContain('network: host');
    expect(compose).toContain('network_mode: host');
    expect(compose).toContain('env_file:');
    expect(compose).toContain('${BACKEND_ENV_FILE:-./deploy/env/backend.production.env}');
    expect(compose).not.toContain('ports:');
    expect(compose).toContain('PORT: 3005');
    expect(compose).toContain('TZ: Asia/Jakarta');
    expect(compose).toContain('http://127.0.0.1:3005/health');
  });

  test('maps probe consumers to liveness or readiness endpoints by intent', () => {
    const dockerfile = readDockerfile();
    const compose = readDockerCompose();
    const k8sDeployment = readK8sDeployment();
    const stagingSpec = readDoDeploySpec('app.yaml');
    const productionSpec = readDoDeploySpec('app-production.yaml');

    expect(dockerfile).toContain('http://localhost:3005/health');
    expect(compose).toContain('http://127.0.0.1:3005/health');
    expect(k8sDeployment).toContain('Legacy/historical backend artifact only.');
    expect(k8sDeployment).toContain('registry.digitalocean.com/infinit-track/infinit-track-backend');
    expect(k8sDeployment).toContain('containerPort: 3005');
    expect(k8sDeployment).toMatch(/livenessProbe:\s+httpGet:\s+path: \/livez/s);
    expect(k8sDeployment).toMatch(/livenessProbe:\s+httpGet:\s+path: \/livez\s+port: 3005/s);
    expect(k8sDeployment).toMatch(/readinessProbe:\s+httpGet:\s+path: \/health/s);
    expect(k8sDeployment).toMatch(/readinessProbe:\s+httpGet:\s+path: \/health\s+port: 3005/s);
    expect(stagingSpec).toContain('http_path: /health');
    expect(productionSpec).toContain('http_path: /health');
  });

  test('operator verification scripts check liveness and readiness explicitly', () => {
    const smokeTest = readScript('scripts/smoke-test.js');
    const healthCheck = readScript('health-check.sh');
    const productionTest = readScript('test-production.sh');
    const dropletVerify = readScript('deploy/scripts/verify-droplet-api.sh');

    const smokeTestEndpoints = [
      '/livez',
      '/health',
      '/docs/',
      '/docs/openapi.yaml',
      '/api/auth/register',
      '/api/auth/me',
      '/api/bookings/history',
      '/api/wfa/recommendations',
      '/api/summary/reports'
    ];

    for (const endpoint of smokeTestEndpoints) {
      expect(smokeTest).toContain(endpoint);
    }

    const dropletVerifyEndpoints = [
      '/docs/',
      '/docs/openapi.yaml',
      '/api/auth/register',
      '/api/auth/me',
      '/api/bookings/history',
      '/api/wfa/recommendations',
      '/api/summary/reports'
    ];

    for (const endpoint of dropletVerifyEndpoints) {
      expect(dropletVerify).toContain(endpoint);
    }
    expect(dropletVerify).toContain('PUBLIC_API_BASE_URL');
    expect(dropletVerify).toContain('check_blocked_endpoint');
    expect(dropletVerify).toContain('check_removed_post_route');
    expect(smokeTest).toContain("const disallowedOrigin = 'https://example.com';");
    expect(smokeTest).toContain('const disallowedOriginRejected = corsHeader !== disallowedOrigin;');
    expect(smokeTest).toContain("const credentialsConfigured = credentialsHeader === 'true';");
    expect(smokeTest).toContain('X-Client-Type');
    expect(smokeTest).toContain('allowsClientType');
    expect(smokeTest).toContain('Allow-Credentials');
    expect(smokeTest).not.toContain("corsHeader === '*'");
    expect(productionTest).toContain('Testing API documentation access control');
    expect(productionTest).toContain('API documentation blocks anonymous access with HTTP $response');
    expect(productionTest).toContain('Expected API documentation to block anonymous access with HTTP 401/403');
    expect(healthCheck).toContain('/livez');
    expect(healthCheck).toContain('/health');
    expect(healthCheck).toContain('http://localhost:${PORT:-3005}');
    expect(healthCheck).not.toContain('http://localhost:${PORT:-3000}');
    expect(healthCheck).toContain('curl is required to run health probes');
    expect(healthCheck).toContain('python3 is required to validate health JSON contracts');
    expect(healthCheck).toContain('check_http_contract');
    expect(healthCheck).toContain('json.loads(raw_body)');
    expect(healthCheck).toContain("data.get('status') != 'OK'");
    expect(healthCheck).toContain("data.get('ready') is not True");
    expect(healthCheck).toContain("isinstance(data.get('components'), dict)");
    expect(healthCheck).toContain("isinstance(data.get('missing'), list)");
    expect(productionTest).toContain('/livez');
    expect(productionTest).toContain('/health');
    expect(productionTest).toContain('check_http_contract');
    expect(productionTest).toContain('test_container_runtime');
    expect(productionTest).toContain('python3 is required for JSON contract verification');
    expect(productionTest).toContain('json.loads(raw_body)');
    expect(productionTest).toContain("data.get('status') != 'OK'");
    expect(productionTest).toContain("data.get('ready') is not True");
    expect(productionTest).toContain("isinstance(data.get('components'), dict)");
    expect(productionTest).toContain("isinstance(data.get('missing'), list)");
    expect(productionTest).toContain('docker compose -f "${DEPLOY_PATH}/docker-compose.yml" ps app');
    expect(productionTest).not.toContain('docker compose -f "${DEPLOY_PATH}/docker-compose.yml" ps app || true');
    expect(productionTest).toContain('docker inspect infinit-track-app >/dev/null 2>&1');
    expect(productionTest).toContain('Container healthcheck is missing');
    expect(productionTest).toContain('Auth endpoint returned unexpected HTTP');
    expect(productionTest).toContain('Admin endpoint ${endpoint} rejected credentials');
    expect(productionTest).toContain('Local readiness');
    expect(productionTest).toContain('Public readiness');
    expect(productionTest).not.toContain('PM2');
    expect(productionTest).not.toContain('pm2');
    expect(dropletVerify).toContain('/livez');
    expect(dropletVerify).toContain('/health');
    expect(dropletVerify).toContain('check_json_endpoint');
    expect(dropletVerify).toContain('python3 is required for JSON readiness verification');
    expect(dropletVerify).toContain('socket.getaddrinfo');
    expect(dropletVerify).toContain('DNS_FAIL lookup failed');
    expect(dropletVerify).not.toContain('getent ahostsv4');
    expect(dropletVerify).toContain("data.get('status') != 'OK'");
    expect(dropletVerify).toContain("data.get('ready') is not True");
    expect(dropletVerify).toContain("isinstance(data.get('components'), dict)");
    expect(dropletVerify).toContain("isinstance(data.get('missing'), list)");
  });

  test('documents DigitalOcean health semantics with separate liveness and readiness checks', () => {
    const deployReadme = readDoReadme();

    expect(deployReadme).toContain('/livez');
    expect(deployReadme).toContain('/health');
    expect(deployReadme).toContain('"ready":true');
    expect(deployReadme).toContain('"components"');
    expect(deployReadme).toContain('"missing"');
    expect(deployReadme).toContain('HTTP `503`');
    expect(deployReadme).toContain('`missing` array');
    expect(deployReadme).not.toContain(
      '- **Success Response:** `{"status":"OK","timestamp":"..."}`'
    );
  });

  test('documents root health semantics with separate liveness and readiness checks', () => {
    const readme = readRootReadme();

    expect(readme).toContain('/livez');
    expect(readme).toContain('/health');
    expect(readme).toContain('Process liveness');
    expect(readme).toContain('Dependency readiness');
    expect(readme).toContain('HTTP `503`');
    expect(readme).toContain('`missing` array');
    expect(readme).not.toContain('# Expected: {"status":"OK","timestamp":"..."}');
    expect(readme).not.toContain('GET /health              # Basic server health');
  });

  test('documents droplet and DOCR as the canonical backend deployment path', () => {
    const claude = readClaudeInstructions();
    const readme = readRootReadme();
    const deployReadme = readDoReadme();
    const dropletRuntime = readScript('docs/droplet-docr-runtime.md');

    expect(claude).toContain('Canonical backend runtime is the droplet-hosted Docker Compose stack');
    expect(claude).toContain('registry.digitalocean.com/infinit-track/infinit-track-backend');
    expect(claude).toContain('Treat `.do/app*.yaml` and `k8s/` as legacy or historical backend paths');
    expect(readme).toContain('DigitalOcean Container Registry (DOCR) + droplet-hosted Docker Compose runtime + host Nginx');
    expect(readme).toContain('registry.digitalocean.com/infinit-track/infinit-track-backend');
    expect(readme).toContain('Smoke/readiness verification adalah release gate operasional');
    expect(readme).toContain('Staging host is environment-specific');
    expect(readme).toContain('Docker Compose');
    expect(readme).toContain('bash ./test-production.sh --local-base-url http://127.0.0.1:3005 --public-base-url http://127.0.0.1:3005');
    expect(readme).not.toContain('**PM2**');
    expect(readme).not.toContain('npm run prod:pm2');
    expect(readme).not.toContain('DigitalOcean App Platform dan GitHub Actions');
    expect(readme).not.toContain('https://infinit-track-staging.ondigitalocean.app');
    expect(readme).not.toContain('https://api.yourdomain.com');
    expect(readme).not.toContain('doctl apps list');
    expect(deployReadme).toContain('App Platform Backend Specs (Legacy)');
    expect(deployReadme).toContain('bukan lagi App Platform');
    expect(dropletRuntime).toContain('registry.digitalocean.com/infinit-track/infinit-track-backend');
    expect(dropletRuntime).toContain('/livez');
    expect(dropletRuntime).toContain('/health');
    expect(dropletRuntime).toContain('127.0.0.1:3005');
    expect(dropletRuntime).toContain('docker compose up -d --force-recreate app');
    expect(dropletRuntime).toContain('docker compose exec -T app npm run migrate');
    expect(dropletRuntime).toContain('./deploy/scripts/verify-droplet-api.sh');
    expect(dropletRuntime).toContain('npm run smoke-test https://<public-domain>');
    expect(dropletRuntime).not.toContain('localhost:3000');
    expect(dropletRuntime).not.toContain('docker compose up -d app');
  });

  test('treats master as the only deploy source branch for both staging and production workflows', () => {
    const stagingWorkflow = readWorkflow('.github/workflows/deploy-staging.yml');
    const productionWorkflow = readWorkflow('.github/workflows/deploy-production.yml');

    expect(stagingWorkflow).toContain('push:');
    expect(stagingWorkflow).toContain('branches:');
    expect(stagingWorkflow).toContain('- master');
    expect(stagingWorkflow).not.toContain('branches:\n      - develop');

    expect(productionWorkflow).toContain('push:');
    expect(productionWorkflow).toContain('branches:');
    expect(productionWorkflow).toContain('- master');
    expect(productionWorkflow).not.toContain('workflow_dispatch:');
    expect(productionWorkflow).not.toContain('deploy-to-production');
  });

  test('documents the official backend release path as develop to master to deploy', () => {
    const readme = readRootReadme();
    const productionGuide = readScript('docs/PRODUCTION_DEPLOYMENT.md');

    expect(readme).toContain('develop -> review -> master -> deploy');
    expect(productionGuide).toContain('develop -> review -> master -> deploy');
    expect(productionGuide).toContain('staging deploy is automatic from `master`');
    expect(productionGuide).toContain('production deploy is automatic from `master`');
    expect(productionGuide).toContain('all required evidence is green before merge into `master`');
  });

  test('documents promotion checklist mvp as openapi-driven and status-code only', () => {
    const checklist = readScript('docs/promotion-checklist-mvp.md');

    expect(checklist).toContain('`docs/openapi.yaml`');
    expect(checklist).toContain('status-code contract only');
  });

  test('documents auth and attendance proof batch in the promotion checklist artifact', () => {
    const checklist = readScript('docs/promotion-checklist-mvp.md');
    const expectedRows = [
      '| Auth | POST | /api/auth/login | public route | documented validation status | 2026-07-02 anonymous probe returned 400 | PASS |',
      '| Auth | POST | /api/auth/refresh | public route | documented rejection status | 2026-07-02 anonymous probe returned 401 | PASS |',
      '| Auth | POST | /api/auth/logout | public route | documented public status | 2026-07-02 anonymous probe returned 200 | PASS |',
      '| Auth | GET | /api/auth/me | authenticated route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |',
      '| Attendance | GET | /api/attendance/today-locations | admin/management-only route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |',
      '| Attendance | GET | /api/attendance/geofence-evidence | admin/management-only route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |',
      '| Attendance | GET | /api/attendance | admin/management-only route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |',
      '| Attendance | POST | /api/attendance/check-in | authenticated route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |',
      '| Attendance | POST | /api/attendance/checkout/{id} | authenticated route | 401 when anonymous | 2026-07-02 anonymous probe to `/api/attendance/checkout/1` returned 401 | PASS |',
      '| Attendance | GET | /api/attendance/history | authenticated route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |',
      '| Attendance | GET | /api/attendance/status-today | authenticated route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |',
      '| Attendance | POST | /api/attendance/location-event | authenticated route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |',
      '| Attendance | POST | /api/attendance/research-trigger/daily | admin/management-only route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |',
      '| Attendance | POST | /api/attendance/research-trigger/full-day | admin/management-only route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |',
      '| Attendance | DELETE | /api/attendance/{id} | admin/management-only route | 401 when anonymous | 2026-07-02 anonymous probe to `/api/attendance/1` returned 401 | PASS |'
    ];

    expect(checklist).toContain('## Scoped Proof Batch — Auth, Attendance');
    expect(checklist).toContain('This batch covers:\n- Auth\n- Attendance');
    expect(checklist).toContain('Auth public endpoints use their minimum documented contract status.');
    expect(checklist).toContain(
      'Protected Auth endpoints and protected Attendance endpoints use anonymous `401` as the default minimum proof in this phase.'
    );
    for (const row of expectedRows) {
      expect(checklist).toContain(row);
    }
  });

  test('distinguishes auth public routes from protected auth routes in the checklist artifact', () => {
    const checklist = readScript('docs/promotion-checklist-mvp.md');

    expect(checklist).toContain('public-by-contract auth endpoints');
    expect(checklist).toContain('minimum documented status expected by contract');
    expect(checklist).toContain('protected auth endpoints use anonymous `401`');
  });

  test('documents users bookings summary proof batch in the promotion checklist artifact', () => {
    const checklist = readScript('docs/promotion-checklist-mvp.md');
    const expectedRows = [
      '| Users | GET | /api/users | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |',
      '| Users | POST | /api/users | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |',
      '| Users | GET | /api/users/{id} | authenticated route | 401 when anonymous | anonymous probe to `/api/users/1` returned 401 | PASS |',
      '| Users | PATCH | /api/users/{id} | authenticated route | 401 when anonymous | anonymous probe to `/api/users/1` returned 401 | PASS |',
      '| Users | DELETE | /api/users/{id} | authenticated route | 401 when anonymous | anonymous probe to `/api/users/1` returned 401 | PASS |',
      '| Users | POST | /api/users/{id}/photo | authenticated route | 401 when anonymous | anonymous probe to `/api/users/1/photo` returned 401 | PASS |',
      '| Bookings | GET | /api/bookings | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |',
      '| Bookings | POST | /api/bookings | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |',
      '| Bookings | GET | /api/bookings/history | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |',
      '| Bookings | PATCH | /api/bookings/{id} | authenticated route | 401 when anonymous | anonymous probe to `/api/bookings/1` returned 401 | PASS |',
      '| Bookings | DELETE | /api/bookings/{id} | authenticated route | 401 when anonymous | anonymous probe to `/api/bookings/1` returned 401 | PASS |',
      '| Summary | GET | /api/summary/dashboard-analytics | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |',
      '| Summary | GET | /api/summary/reports | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |',
      '| Summary | GET | /api/summary/reports/pdf | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |',
      '| Summary | GET | /api/summary/reports/excel | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |'
    ];

    expect(checklist).toContain('## Scoped Proof Batch — Users, Bookings, Summary');
    expect(checklist).toContain('Protected endpoints in this batch use anonymous `401` as the default minimum proof in this phase.');
    for (const row of expectedRows) {
      expect(checklist).toContain(row);
    }
  });

  test('documents final endpoint proof batch in the promotion checklist artifact', () => {
    const checklist = readScript('docs/promotion-checklist-mvp.md');
    const expectedRows = [
      '| Analysis | GET | /api/analysis/fuzzy-ahp | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |',
      '| Analysis | GET | /api/analysis/fuzzy-ahp/discipline | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |',
      '| Analysis | GET | /api/analysis/fuzzy-ahp/wfa | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |',
      '| Analysis | GET | /api/analysis/fuzzy-ahp/smart-ac | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |',
      '| Analysis | GET | /api/analysis/fuzzy-ahp/dashboard | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |',
      '| WFA | GET | /api/wfa/recommendations | authenticated route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |',
      '| WFA | GET | /api/wfa/ahp-config | authenticated route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |',
      '| Discipline | GET | /api/discipline/all | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |',
      '| Discipline | GET | /api/discipline/config | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |',
      '| Settings | GET | /api/settings/operational | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |',
      '| Settings | PATCH | /api/settings/operational | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |',
      '| Reference Data | GET | /api/roles | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |',
      '| Reference Data | GET | /api/programs | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |',
      '| Reference Data | GET | /api/positions | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |',
      '| Reference Data | GET | /api/divisions | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |'
    ];

    expect(checklist).toContain('## Scoped Proof Batch — Analysis, WFA, Discipline, Settings, Reference Data');
    expect(checklist).toContain(
      'This batch covers:\n- Analysis\n- WFA\n- Discipline\n- Settings\n- Reference Data'
    );
    expect(checklist).toContain(
      'Protected endpoints in this batch use anonymous `401` as the default minimum proof in this phase.'
    );
    expect(checklist).toContain('The endpoint inventory in this batch is derived from `docs/openapi.yaml`.');
    for (const row of expectedRows) {
      expect(checklist).toContain(row);
    }
  });

  test('keeps known endpoint mismatches visible in the final proof batch', () => {
    const checklist = readScript('docs/promotion-checklist-mvp.md');

    expect(checklist).toContain(
      '| Discipline | GET | /api/discipline/user/{userId} | ownership/privilege boundary on authenticated route | 401 when anonymous + 403 when authenticated non-owner without privilege | 2026-07-03 anonymous probe to `/api/discipline/user/1` returned 401; insufficient-privilege proof not yet recorded | FAIL |'
    );
    expect(checklist).toContain(
      '| WFA | POST | /api/wfa/test-ahp | intentionally excluded debug/test route | Keep excluded from public OpenAPI inventory unless contract owner says otherwise | Path is listed in `tests/openApiMountedRoutesContract.test.js` `excludedPaths` and is not represented in `docs/openapi.yaml` | Needs Verification |'
    );
    expect(checklist).toContain(
      '| Discipline | POST | /api/discipline/test-ahp | intentionally excluded debug/test route | Keep excluded from public OpenAPI inventory unless contract owner says otherwise | Path is listed in `tests/openApiMountedRoutesContract.test.js` `excludedPaths` and is not represented in `docs/openapi.yaml` | Needs Verification |'
    );
    expect(checklist).toContain(
      '- Record insufficient-privilege `403` evidence for `GET /api/discipline/user/{userId}` before treating the endpoint as promotion-complete.'
    );
    expect(checklist).toContain(
      '- Confirm whether `POST /api/wfa/test-ahp` should remain an internal-only route outside the public OpenAPI contract.'
    );
    expect(checklist).toContain(
      '- Confirm whether `POST /api/discipline/test-ahp` should remain an internal-only route outside the public OpenAPI contract.'
    );
    expect(checklist).toContain('One endpoint without proof = block promotion');
  });

  test('keeps missing proof as a master-promotion blocker at the checklist rule level', () => {
    const checklist = readScript('docs/promotion-checklist-mvp.md');

    expect(checklist).toContain('One endpoint without proof = block promotion');
  });

  test('documents that one endpoint without proof blocks promotion to master', () => {
    const checklist = readScript('docs/promotion-checklist-mvp.md');

    expect(checklist).toContain('One endpoint without proof = block promotion');
    expect(checklist).toContain('Claude verdict');
    expect(checklist).toContain('Operator approval');
  });

  test('documents checklist-first master promotion decision rules in operator-facing release docs', () => {
    const readme = readRootReadme();
    const productionGuide = readScript('docs/PRODUCTION_DEPLOYMENT.md');

    expect(readme).toContain('Promotion to `master` is gated by the promotion checklist MVP.');
    expect(readme).toContain('endpoint inventory source: `docs/openapi.yaml`');
    expect(readme).toContain('verification depth: status-code contract only');
    expect(readme).toContain('one endpoint without proof blocks promotion');
    expect(readme).toContain('Claude provides the verdict');
    expect(readme).toContain('operator provides the final go/no-go approval');

    expect(productionGuide).toContain('Before `develop -> master` promotion:');
    expect(productionGuide).toContain('run the promotion checklist MVP');
    expect(productionGuide).toContain(
      'require status-code proof for all endpoints represented in `docs/openapi.yaml`'
    );
    expect(productionGuide).toContain('block promotion if any endpoint lacks proof');
    expect(productionGuide).toContain('review the Claude verdict');
    expect(productionGuide).toContain('operator approves or rejects promotion');
    expect(productionGuide).toContain(
      'If the checklist passes and the operator approves, promotion to `master` may proceed and existing automation may run.'
    );
  });

  test('describes master github gate honestly as pr review plus build where build means install lint and test', () => {
    const readme = readRootReadme();
    const productionGuide = readScript('docs/PRODUCTION_DEPLOYMENT.md');
    const ciWorkflow = readWorkflow('.github/workflows/ci.yml');

    expect(readme).toContain('GitHub enforces PR review + `build`');
    expect(readme).toContain('`build` means install + lint + test');
    expect(productionGuide).toContain('GitHub enforces PR review + `build`');
    expect(productionGuide).toContain('`build` means install + lint + test');

    expect(ciWorkflow).toContain('name: CI');
    expect(ciWorkflow).toContain('build:');
    expect(ciWorkflow).toContain('npm ci');
    expect(ciWorkflow).toContain('npm run lint');
    expect(ciWorkflow).toContain('npm test');
  });

  test('does not claim github-enforced smoke or runtime verification on master', () => {
    const readme = readRootReadme();
    const productionGuide = readScript('docs/PRODUCTION_DEPLOYMENT.md');

    expect(readme).toContain('runtime/smoke verification is still an operational verification concern');
    expect(productionGuide).toContain('runtime/smoke verification is still an operational verification concern');

    expect(readme).not.toContain('GitHub enforces smoke');
    expect(readme).not.toContain('GitHub enforces runtime verification');
    expect(productionGuide).not.toContain('GitHub-enforced smoke gate');
    expect(productionGuide).not.toContain('GitHub-enforced runtime verification');
  });

  test('locks staging and production workflows to droplet rollout with blocking verification', () => {
    const stagingWorkflow = readWorkflow('.github/workflows/deploy-staging.yml');
    const productionWorkflow = readWorkflow('.github/workflows/deploy-production.yml');
    const dockerDeployWorkflow = readWorkflow('.github/workflows/docker-deploy.yml');

    expect(stagingWorkflow).toContain('Deploy to Staging Droplet');
    expect(stagingWorkflow).toContain('registry.digitalocean.com/infinit-track/infinit-track-backend');
    expect(stagingWorkflow).toContain('docker compose pull app');
    expect(stagingWorkflow).toContain('docker compose up -d --force-recreate app');
    expect(stagingWorkflow).toContain('docker compose exec -T app npm run migrate');
    expect(stagingWorkflow).toContain('./deploy/scripts/verify-droplet-api.sh');
    expect(stagingWorkflow).toContain('npm run smoke-test "$STAGING_PUBLIC_BASE_URL"');
    expect(stagingWorkflow).toContain('STAGING_PUBLIC_BASE_URL');
    expect(stagingWorkflow).toContain('STAGING_PUBLIC_DOMAIN');
    expect(stagingWorkflow).toContain('STAGING_EXPECTED_IP');
    expect(stagingWorkflow).toContain('Missing required staging runtime variable');
    expect(stagingWorkflow).toContain('authenticated Admin/Management only');
    expect(stagingWorkflow).toContain('push:');
    expect(stagingWorkflow).toContain('pull_request:');
    expect(stagingWorkflow).not.toContain('workflow_dispatch:');
    expect(stagingWorkflow).not.toContain('https://api.infinite-track.tech');
    expect(stagingWorkflow).not.toContain('continue-on-error: true');
    expect(stagingWorkflow).not.toContain('doctl apps create-deployment');
    expect(stagingWorkflow).not.toContain('ondigitalocean.app');

    expect(productionWorkflow).toContain('Deploy to Production Droplet');
    expect(productionWorkflow).toContain('registry.digitalocean.com/infinit-track/infinit-track-backend');
    expect(productionWorkflow).toContain('docker compose pull app');
    expect(productionWorkflow).toContain('docker compose up -d --force-recreate app');
    expect(productionWorkflow).toContain('docker compose exec -T app npm run migrate');
    expect(productionWorkflow).toContain('./deploy/scripts/verify-droplet-api.sh');
    expect(productionWorkflow).toContain('npm run smoke-test "$PRODUCTION_PUBLIC_BASE_URL"');
    expect(productionWorkflow).toContain("if: github.event_name != 'pull_request'");
    expect(productionWorkflow).toContain('PRODUCTION_PUBLIC_BASE_URL');
    expect(productionWorkflow).toContain('authenticated Admin/Management only');
    expect(productionWorkflow).not.toContain('doctl apps create-deployment');
    expect(productionWorkflow).not.toContain('yourdomain.com');
    expect(productionWorkflow).not.toContain('ondigitalocean.app');

    expect(dockerDeployWorkflow).toContain('name: Publish Backend Image');
    expect(dockerDeployWorkflow).toContain('Build & Push Docker Image');
    expect(dockerDeployWorkflow).toContain('registry.digitalocean.com/infinit-track/infinit-track-backend');
    expect(dockerDeployWorkflow).toContain('Use the immutable SHA tag for droplet rollout.');
    expect(dockerDeployWorkflow).toContain('Validate DigitalOcean token secret');
    expect(dockerDeployWorkflow).toContain('DIGITALOCEAN_ACCESS_TOKEN repository secret is required');
    expect(dockerDeployWorkflow).toContain('digitalocean/action-doctl@v2');
    expect(dockerDeployWorkflow).toContain('docker/build-push-action@v5');
    expect(dockerDeployWorkflow).not.toContain('Deploy to Kubernetes');
    expect(dockerDeployWorkflow).not.toContain('kubectl apply -f k8s/');
    expect(dockerDeployWorkflow).not.toContain('KUBECONFIG');
    expect(dockerDeployWorkflow).not.toContain('api.your-domain.com');
    const dockerPublishSection = dockerDeployWorkflow.slice(
      dockerDeployWorkflow.indexOf('name: Build & Push Docker Image')
    );
    expect(dockerPublishSection.indexOf('Validate DigitalOcean token secret')).toBeLessThan(
      dockerPublishSection.indexOf('Checkout code')
    );
  });

  test('uses CommonJS migration filenames for sequelize-cli compatibility', () => {
    const files = migrationFiles();

    expect(files).toContain('20240525120000-create-user.cjs');
    expect(files).toContain('20240619000000-update-photos-for-cloudinary.cjs');
    expect(files).toContain('20260403000000-add-unique-constraint-attendance.cjs');
    expect(files).toContain('20260422000000-add-photo-storage-metadata.cjs');
    expect(files).toContain('20260423010000-add-attendance-date-index.cjs');
    expect(files).toContain('20260424000000-bootstrap-operational-settings.cjs');
    expect(files).not.toContain('20240619000000-update-photos-for-cloudinary.js');
    expect(files).not.toContain('20260403000000-add-unique-constraint-attendance.js');
    expect(files).not.toContain('20260422000000-add-photo-storage-metadata.js');
    expect(files).not.toContain('20260423010000-add-attendance-date-index.js');
    expect(files).not.toContain('20260424000000-bootstrap-operational-settings.js');

    for (const file of files.filter((name) => name.endsWith('.cjs'))) {
      const content = fs.readFileSync(path.resolve(repoRoot, 'src/models/migrations', file), 'utf8');
      expect(content).not.toContain('export default');
    }
  });

  test('documents GEOAPIFY_API_KEY in DigitalOcean deployment manifests and operator guide', () => {
    const stagingSpec = readDoDeploySpec('app.yaml');
    const productionSpec = readDoDeploySpec('app-production.yaml');
    const deployReadme = readDoReadme();

    expect(stagingSpec).toContain('GEOAPIFY_API_KEY');
    expect(productionSpec).toContain('GEOAPIFY_API_KEY');
    expect(deployReadme).toContain('GEOAPIFY_API_KEY=<your-geoapify-key>');
    expect(stagingSpec).not.toMatch(/\bGEOAPIFY_KEY\b/);
    expect(productionSpec).not.toMatch(/\bGEOAPIFY_KEY\b/);
    expect(deployReadme).not.toMatch(/\bGEOAPIFY_KEY\b/);
  });

  test('keeps the compatibility Geoapify key fallback scoped to the injectable WFA client', () => {
    const geoapifyClient = fs.readFileSync(
      path.resolve(repoRoot, 'src/services/geoapifyWfa.client.js'),
      'utf8'
    );

    expect(geoapifyClient).toContain('process.env.GEOAPIFY_API_KEY');
    expect(geoapifyClient).toContain('process.env.GEOAPIFY_KEY');
    expect(geoapifyClient).toContain('Using legacy GEOAPIFY_KEY fallback for WFA Geoapify client');
  });

  test('keeps legacy deployment references non-authoritative and environment-specific', () => {
    const stagingSpec = readDoDeploySpec('app.yaml');
    const productionSpec = readDoDeploySpec('app-production.yaml');
    const k8sDeployment = readK8sDeployment();

    expect(stagingSpec).toContain('Legacy/historical backend artifact only.');
    expect(stagingSpec).toContain('Do not treat this App Platform spec as the active backend deployment source of truth.');
    expect(productionSpec).toContain('Legacy/historical backend artifact only.');
    expect(productionSpec).toContain('Do not treat this App Platform spec as the active backend deployment source of truth.');
    expect(productionSpec).toContain('<production-spaces-bucket>');
    expect(productionSpec).not.toContain('infinite-track-staging-sgp1');
    expect(k8sDeployment).toContain('Legacy/historical backend artifact only.');
    expect(k8sDeployment).toContain('Do not treat this manifest as the active backend deployment source of truth.');
    expect(k8sDeployment).not.toContain('<your-dockerhub-username>/infinit-track-backend:latest');
  });

  test('keeps Geoapify credentials and diagnostics out of booking orchestration', () => {
    const bookingController = fs.readFileSync(
      path.resolve(repoRoot, 'src/controllers/booking.controller.js'),
      'utf8'
    );

    expect(bookingController).toContain("import { scoreBookingLocation } from '../services/wfaRecommendation.service.js';");
    expect(bookingController).not.toContain('process.env.GEOAPIFY_API_KEY');
    expect(bookingController).not.toContain('process.env.GEOAPIFY_KEY');
    expect(bookingController).not.toContain('apiKey');
  });

  test('documents BACKEND_IMAGE_TAG in env example for operators', () => {
    const envExample = fs.readFileSync(path.resolve(repoRoot, '.env.example'), 'utf8');

    expect(envExample).toContain('BACKEND_IMAGE_TAG=latest');
    expect(envExample).toContain('DB_PORT=3306');
  });
});
