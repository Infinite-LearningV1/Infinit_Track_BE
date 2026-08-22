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

  test('keeps the generic env example free of staging resource identifiers', () => {
    const envExample = read('.env.example');

    expect(envExample).toContain('SPACES_BUCKET=your_spaces_bucket');
    expect(envExample).not.toContain('infinite-track-staging-sgp1');
  });

  test('keeps the production env template production-specific and secret-free', () => {
    const productionEnv = read('deploy/env/backend.production.example');
    expect(productionEnv).toContain('CORS_ORIGIN=https://infinite-track.tech');
    expect(productionEnv).toContain('DB_HOST=replace-with-production-managed-mysql-host');
    expect(productionEnv).toContain('SPACES_BUCKET=replace-with-production-spaces-bucket');
    expect(productionEnv).not.toContain('it-mysql-staging-sgp1');
    expect(productionEnv).not.toContain('infinite-track-staging-sgp1');
  });

  test('defines an optional credentialed Web FE CORS/session smoke surface', () => {
    const smoke = read('scripts/smoke-test.js');

    expect(smoke).toContain('const WEB_ORIGIN = process.env.WEB_ORIGIN');
    expect(smoke).toContain('Web FE Credentialed CORS / Session Surface');
    expect(smoke).toContain('Origin: WEB_ORIGIN');
    expect(smoke).toContain("'X-Client-Type': 'web'");
    expect(smoke).toContain('/api/auth/login');
    expect(smoke).toContain('/api/auth/refresh');
    expect(smoke).toContain("response.headers['access-control-allow-origin'] === WEB_ORIGIN");
    expect(smoke).toContain("response.headers['access-control-allow-credentials'] === 'true'");
    expect(smoke).toContain('WEB_ORIGIN not provided');
    expect(smoke).toContain('logSkip');
  });

  test('production deploy independently verifies Web origin and syncs executed runtime artifacts', () => {
    const workflow = read('.github/workflows/deploy-production.yml');

    expect(workflow).toContain('PRODUCTION_WEB_ORIGIN: ${{ vars.PRODUCTION_WEB_ORIGIN }}');
    expect(workflow).toContain('"$PRODUCTION_WEB_ORIGIN"');
    expect(workflow).toContain('docker-compose.yml');
    expect(workflow).toContain('deploy/scripts/verify-droplet-api.sh');
    expect(workflow).toContain('docker compose exec -T app printenv CORS_ORIGIN');
    expect(workflow).toContain('DEPLOYED_CORS_ORIGIN');
    expect(workflow).toContain('PRODUCTION_WEB_ORIGIN');
    expect(workflow).toContain('WEB_ORIGIN="$PRODUCTION_WEB_ORIGIN" npm run smoke-test');
    expect(workflow).not.toContain('WEB_ORIGIN="$DEPLOYED_CORS_ORIGIN" npm run smoke-test');
    expect(workflow).not.toContain('deploy/env/backend.production.env');
    expect(workflow).toContain('https://infinite-track.tech');
    expect(workflow).toContain('PRODUCTION_WEB_ORIGIN must equal the canonical Web FE origin');
  });

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
});
