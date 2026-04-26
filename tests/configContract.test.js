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

function readDockerCompose() {
  return fs.readFileSync(path.resolve(process.cwd(), 'docker-compose.yml'), 'utf8');
}

function loadCliConfig() {
  const require = createRequire(import.meta.url);
  const configPath = path.resolve(process.cwd(), 'src/config/database-cli.cjs');

  delete require.cache[configPath];

  return require(configPath);
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

  test('declares image-based runtime with explicit BACKEND_IMAGE_TAG in docker compose', () => {
    const compose = readDockerCompose();

    expect(compose).toContain('image: registry.digitalocean.com/infinit-track/infinit-track-backend:${BACKEND_IMAGE_TAG:-latest}');
    expect(compose).toContain('BACKEND_IMAGE_TAG: ${BACKEND_IMAGE_TAG:-latest}');
    expect(compose).not.toContain('build:');

    expect(compose).toContain('DB_HOST: ${DB_HOST:-db}');
    expect(compose).toContain('DB_PORT: ${DB_PORT:-3306}');
    expect(compose).toContain('DB_SSL: ${DB_SSL:-false}');
    expect(compose).toContain('DB_SSL_REJECT_UNAUTHORIZED: ${DB_SSL_REJECT_UNAUTHORIZED:-true}');
    expect(compose).toContain('JWT_ACCESS_TTL_SECONDS: ${JWT_ACCESS_TTL_SECONDS:-14400}');
    expect(compose).toContain('JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET:-dev-refresh-secret-change-me}');
    expect(compose).toContain('JWT_REFRESH_TTL_SECONDS: ${JWT_REFRESH_TTL_SECONDS:-2592000}');
    expect(compose).toContain('JWT_REFRESH_INACTIVITY_WINDOW_SECONDS: ${JWT_REFRESH_INACTIVITY_WINDOW_SECONDS:-172800}');
  });

  test('documents BACKEND_IMAGE_TAG and DB_PORT in env example for operators', () => {
    const envExample = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf8');

    expect(envExample).toContain('BACKEND_IMAGE_TAG=latest');
    expect(envExample).toContain('DB_PORT=3306');
  });
});
