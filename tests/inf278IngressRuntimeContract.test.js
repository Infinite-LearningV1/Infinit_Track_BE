import { execFileSync } from 'node:child_process';
import request from 'supertest';

const { default: app } = await import('../src/app.js');

const repoRoot = process.cwd();

function readConfigInChild(envOverrides = {}) {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    JWT_SECRET: 'test-secret',
    DB_HOST: 'db.example.internal',
    DB_NAME: 'infinite_track',
    DB_USER: 'trackuser',
    DB_PASS: 'trackpass',
    CORS_ORIGIN: 'https://web.example.test',
    PORT: '3005',
    ...envOverrides
  };

  return JSON.parse(
    execFileSync(
      process.execPath,
      ['--input-type=module', '-e', "import config from './src/config/index.js'; console.log(JSON.stringify({ bindHost: config.bindHost, port: config.port }))"],
      { cwd: repoRoot, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
  );
}

describe('INF-278 runtime ingress contract', () => {
  test('defaults production listener to loopback and rejects a public bind host', () => {
    expect(readConfigInChild()).toEqual({ bindHost: '127.0.0.1', port: '3005' });

    expect(() => readConfigInChild({ APP_BIND_HOST: '0.0.0.0' })).toThrow(
      /APP_BIND_HOST.*127\.0\.0\.1/
    );
  });

  test('trusts forwarded client IP and HTTPS protocol only through loopback', async () => {
    const { default: express } = await import('express');
    const { configureProxyTrust } = await import('../src/configureProxyTrust.js');
    const app = express();
    configureProxyTrust(app, 'production');
    app.get('/probe', (req, res) => res.json({ ip: req.ip, protocol: req.protocol }));

    await request(app)
      .get('/probe')
      .set('X-Forwarded-For', '203.0.113.44')
      .set('X-Forwarded-Proto', 'https')
      .expect(200, { ip: '203.0.113.44', protocol: 'https' });

    const nonProduction = express();
    configureProxyTrust(nonProduction, 'test');
    expect(nonProduction.get('trust proxy')).toBe(false);
  });

  test('limits ordinary JSON and URL-encoded bodies to 1 MiB', async () => {
    await request(app)
      .post('/livez')
      .set('Content-Type', 'application/json')
      .send({ payload: 'x'.repeat(1024) })
      .expect(404);

    await request(app)
      .post('/livez')
      .set('Content-Type', 'application/json')
      .send({ payload: 'x'.repeat(1024 * 1024) })
      .expect(413);

    await request(app)
      .post('/livez')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(`payload=${'x'.repeat(1024 * 1024)}`)
      .expect(413);
  });
});
