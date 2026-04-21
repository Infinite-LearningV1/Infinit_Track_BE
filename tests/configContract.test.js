import fs from 'fs';
import path from 'path';
import { jest } from '@jest/globals';

describe('backend runtime config contract', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...envBackup };
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  test('reads DB_SSL and DB_SSL_REJECT_UNAUTHORIZED from environment into runtime config', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.DB_HOST = 'db.example.internal';
    process.env.DB_NAME = 'infinite_track';
    process.env.DB_USER = 'trackuser';
    process.env.DB_PASS = 'trackpass';
    process.env.DB_SSL = 'true';
    process.env.DB_SSL_REJECT_UNAUTHORIZED = 'false';

    const { default: config } = await import('../src/config/index.js');

    expect(config.db.ssl).toBe(true);
    expect(config.db.sslRejectUnauthorized).toBe(false);
  });

  test('declares explicit DB_HOST and DB_SSL app env in docker compose', () => {
    const compose = fs.readFileSync(
      path.resolve(process.cwd(), 'docker-compose.yml'),
      'utf8'
    );

    expect(compose).toContain('DB_HOST: ${DB_HOST:-db}');
    expect(compose).toContain('DB_SSL: ${DB_SSL:-false}');
    expect(compose).toContain('DB_SSL_REJECT_UNAUTHORIZED: ${DB_SSL_REJECT_UNAUTHORIZED:-true}');
  });
});
