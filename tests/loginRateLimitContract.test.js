import { jest } from '@jest/globals';

function buildRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('login rate limit contract', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...envBackup,
      NODE_ENV: 'production',
      JWT_SECRET: 'test-secret',
      DB_HOST: 'db.example.internal',
      DB_NAME: 'infinite_track',
      DB_USER: 'trackuser',
      DB_PASS: 'trackpass',
      CORS_ORIGIN: 'https://app.example.com'
    };
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  test('limits repeated login attempts for the same IP and email in production', async () => {
    const { loginRateLimit } = await import('../src/middlewares/security.js');

    for (let attempt = 0; attempt < 10; attempt++) {
      const req = {
        ip: '203.0.113.10',
        body: { email: 'user@example.com' }
      };
      const res = buildRes();
      const next = jest.fn();

      loginRateLimit(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    }

    const req = {
      ip: '203.0.113.10',
      body: { email: 'user@example.com' }
    };
    const res = buildRes();
    const next = jest.fn();

    loginRateLimit(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'AUTH_RATE_LIMITED',
        message: 'Too many login attempts, please try again later'
      })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
