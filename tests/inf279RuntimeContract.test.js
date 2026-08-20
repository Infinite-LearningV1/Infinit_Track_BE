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
