import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { jest } from '@jest/globals';

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
  return fs.readFileSync(path.resolve(process.cwd(), 'docker-compose.yml'), 'utf8');
}

function readDockerfile() {
  return fs.readFileSync(path.resolve(process.cwd(), 'Dockerfile'), 'utf8');
}

function readK8sDeployment() {
  return fs.readFileSync(path.resolve(process.cwd(), 'k8s/app-deployment.yaml'), 'utf8');
}

function readScript(relativePath) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

function migrationFiles() {
  return fs.readdirSync(path.resolve(process.cwd(), 'src/models/migrations')).sort();
}

function loadCliConfig() {
  const require = createRequire(import.meta.url);
  const configPath = path.resolve(process.cwd(), 'src/config/database-cli.cjs');

  delete require.cache[configPath];

  return require(configPath);
}

function readDoDeploySpec(fileName) {
  return fs.readFileSync(path.resolve(process.cwd(), '.do', fileName), 'utf8');
}

function readDoReadme() {
  return fs.readFileSync(path.resolve(process.cwd(), '.do/README.md'), 'utf8');
}

function readRootReadme() {
  return fs.readFileSync(path.resolve(process.cwd(), 'README.md'), 'utf8');
}

function readClaudeInstructions() {
  return fs.readFileSync(path.resolve(process.cwd(), 'CLAUDE.md'), 'utf8');
}

function readWorkflow(relativePath) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

function buildRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

async function loadWfaControllerWithMocks({ axiosGet, logger, settingsValue = null } = {}) {
  const axiosGetMock = axiosGet || jest.fn().mockResolvedValue({ data: { features: [] } });
  const loggerMock =
    logger ||
    ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    });

  jest.unstable_mockModule('axios', () => ({
    default: {
      get: axiosGetMock
    }
  }));

  jest.unstable_mockModule('../src/models/settings.model.js', () => ({
    default: {
      findOne: jest.fn().mockResolvedValue(settingsValue)
    }
  }));

  jest.unstable_mockModule('../src/utils/logger.js', () => ({
    default: loggerMock
  }));

  jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
    default: {
      getWfaAhpWeights: jest.fn(() => ({
        location_type: 0.4,
        amenity_score: 0.4,
        distance_factor: 0.2,
        consistency_ratio: 0.05
      })),
      calculateWfaScore: jest.fn(),
      getCategoryDisplayName: jest.fn((value) => value),
      categorizePlace: jest.fn(() => 'catering')
    }
  }));

  jest.unstable_mockModule('../src/utils/geofence.js', () => ({
    calculateDistance: jest.fn(() => 0)
  }));

  const controller = await import('../src/controllers/wfa.controller.js');

  return {
    ...controller,
    axiosGetMock,
    loggerMock
  };
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

  test('declares droplet runtime contract with host networking and env-file driven config', () => {
    const compose = readDockerCompose();

    expect(compose).toContain('image: ${BACKEND_IMAGE:-infinit-track-backend}:${BACKEND_IMAGE_TAG:-latest}');
    expect(compose).toContain('build:');
    expect(compose).toContain('network: host');
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

    expect(smokeTest).toContain('/livez');
    expect(smokeTest).toContain('/health');
    expect(smokeTest).toContain("const disallowedOrigin = 'https://example.com';");
    expect(smokeTest).toContain('const disallowedOriginRejected = corsHeader !== disallowedOrigin;');
    expect(smokeTest).toContain("const credentialsConfigured = credentialsHeader === 'true';");
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
    expect(dropletVerify).toContain("check_json_endpoint");
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
    expect(readme).toContain('Smoke/readiness verification adalah release gate');
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

  test('locks staging and production workflows to droplet rollout with blocking verification', () => {
    const stagingWorkflow = readWorkflow('.github/workflows/deploy-staging.yml');
    const productionWorkflow = readWorkflow('.github/workflows/deploy-production.yml');
    const dockerDeployWorkflow = readWorkflow('.github/workflows/docker-deploy.yml');

    expect(stagingWorkflow).toContain('Deploy to Staging Droplet');
    expect(stagingWorkflow).toContain('registry.digitalocean.com/infinit-track/infinit-track-backend');
    expect(stagingWorkflow).toContain('docker compose pull app');
    expect(stagingWorkflow).toContain('docker compose up -d --force-recreate app');
    expect(stagingWorkflow).toContain("docker compose exec -T app npm run migrate");
    expect(stagingWorkflow).toContain('./deploy/scripts/verify-droplet-api.sh');
    expect(stagingWorkflow).toContain('npm run smoke-test "$STAGING_PUBLIC_BASE_URL"');
    expect(stagingWorkflow).toContain('STAGING_PUBLIC_BASE_URL');
    expect(stagingWorkflow).toContain('STAGING_PUBLIC_DOMAIN');
    expect(stagingWorkflow).toContain('STAGING_EXPECTED_IP');
    expect(stagingWorkflow).toContain('Missing required staging runtime variable');
    expect(stagingWorkflow).toContain('authenticated Admin/Management only');
    expect(stagingWorkflow).not.toContain('https://api.infinite-track.tech');
    expect(stagingWorkflow).not.toContain('continue-on-error: true');
    expect(stagingWorkflow).not.toContain('doctl apps create-deployment');
    expect(stagingWorkflow).not.toContain('ondigitalocean.app');

    expect(productionWorkflow).toContain('Deploy to Production Droplet');
    expect(productionWorkflow).toContain('registry.digitalocean.com/infinit-track/infinit-track-backend');
    expect(productionWorkflow).toContain('docker compose pull app');
    expect(productionWorkflow).toContain('docker compose up -d --force-recreate app');
    expect(productionWorkflow).toContain("docker compose exec -T app npm run migrate");
    expect(productionWorkflow).toContain('./deploy/scripts/verify-droplet-api.sh');
    expect(productionWorkflow).toContain('npm run smoke-test "$PRODUCTION_PUBLIC_BASE_URL"');
    expect(productionWorkflow).toContain('Type "deploy-to-production" to confirm');
    expect(productionWorkflow).toContain('PRODUCTION_PUBLIC_BASE_URL');
    expect(productionWorkflow).toContain('authenticated Admin/Management only');
    expect(productionWorkflow).not.toContain('doctl apps create-deployment');
    expect(productionWorkflow).not.toContain('yourdomain.com');
    expect(productionWorkflow).not.toContain('ondigitalocean.app');

    expect(dockerDeployWorkflow).toContain('name: Publish Backend Image');
    expect(dockerDeployWorkflow).toContain('Build & Push Docker Image');
    expect(dockerDeployWorkflow).toContain('registry.digitalocean.com/infinit-track/infinit-track-backend');
    expect(dockerDeployWorkflow).toContain('Use the immutable SHA tag for droplet rollout.');
    expect(dockerDeployWorkflow).not.toContain('Deploy to Kubernetes');
    expect(dockerDeployWorkflow).not.toContain('kubectl apply -f k8s/');
    expect(dockerDeployWorkflow).not.toContain('KUBECONFIG');
    expect(dockerDeployWorkflow).not.toContain('api.your-domain.com');
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
      const content = fs.readFileSync(path.resolve(process.cwd(), 'src/models/migrations', file), 'utf8');
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

  test('accepts GEOAPIFY_KEY as a temporary fallback for WFA recommendations', async () => {
    delete process.env.GEOAPIFY_API_KEY;
    process.env.GEOAPIFY_KEY = 'legacy-geoapify-key';

    const axiosGet = jest.fn().mockResolvedValue({ data: { features: [] } });
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    const { getWfaRecommendations } = await loadWfaControllerWithMocks({
      axiosGet,
      logger
    });

    const req = {
      query: {
        lat: '-0.8917',
        lng: '119.8707'
      }
    };
    const res = buildRes();
    const next = jest.fn();

    await getWfaRecommendations(req, res, next);

    expect(axiosGet).toHaveBeenCalledWith(
      'https://api.geoapify.com/v2/places',
      expect.objectContaining({
        params: expect.objectContaining({ apiKey: 'legacy-geoapify-key' })
      })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Using legacy GEOAPIFY_KEY fallback for WFA recommendations')
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  test('fails explicitly when no Geoapify env variable is configured for WFA recommendations', async () => {
    delete process.env.GEOAPIFY_API_KEY;
    delete process.env.GEOAPIFY_KEY;

    const axiosGet = jest.fn();
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    const { getWfaRecommendations } = await loadWfaControllerWithMocks({
      axiosGet,
      logger
    });

    const req = {
      query: {
        lat: '-0.8917',
        lng: '119.8707'
      }
    };
    const res = buildRes();
    const next = jest.fn();

    await getWfaRecommendations(req, res, next);

    expect(axiosGet).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'Geoapify API key not found for WFA recommendations. Set GEOAPIFY_API_KEY.'
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'E_CONFIG',
      message: 'API key Geoapify tidak ditemukan'
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('redacts Geoapify API key in booking suitability diagnostics', () => {
    const bookingController = fs.readFileSync(
      path.resolve(process.cwd(), 'src/controllers/booking.controller.js'),
      'utf8'
    );

    expect(bookingController).toContain("const diagnosticParams = { ...params, apiKey: '[REDACTED]' };");
    expect(bookingController).toContain('JSON.stringify(diagnosticParams)');
    expect(bookingController).not.toContain('JSON.stringify(params)');
  });

  test('documents BACKEND_IMAGE_TAG in env example for operators', () => {
    const envExample = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf8');

    expect(envExample).toContain('BACKEND_IMAGE_TAG=latest');
  });
});
