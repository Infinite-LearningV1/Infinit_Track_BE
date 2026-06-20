import { jest } from '@jest/globals';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

const TEST_JWT_SECRET = 'test-secret';
const mockUserFindByPk = jest.fn();
const mockAuthSessionFindByPk = jest.fn();

jest.unstable_mockModule('../src/config/index.js', () => ({
  default: {
    db: {
      database: 'test_db',
      username: 'test_user',
      password: 'test_password',
      host: 'localhost',
      port: 3306
    },
    jwt: {
      secret: TEST_JWT_SECRET,
      ttl: 7200
    }
  }
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  User: {
    findByPk: mockUserFindByPk
  },
  Role: {},
  AuthSession: {
    findByPk: mockAuthSessionFindByPk
  }
}));

const { verifyToken } = await import('../src/middlewares/authJwt.js');
const { default: logger } = await import('../src/utils/logger.js');

function buildActiveSession(sessionId, userId) {
  return {
    session_id: sessionId,
    user_id: userId,
    revoked_at: null,
    last_activity_at: new Date(),
    expires_at: new Date(Date.now() + 60_000)
  };
}

const app = express();
app.use((req, _res, next) => {
  req.cookies = Object.fromEntries(
    (req.headers.cookie || '')
      .split(';')
      .map((cookie) => cookie.trim().split('='))
      .filter(([key, value]) => key && value)
  );
  next();
});
app.get('/protected', verifyToken, (req, res) => {
  res.status(200).json({
    role_name: req.user.role_name
  });
});

describe('authJwt token precedence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const activeSessions = {
      101: buildActiveSession(101, 1),
      102: buildActiveSession(102, 2),
      103: buildActiveSession(103, 3),
      104: buildActiveSession(104, 4),
      105: buildActiveSession(105, 5)
    };

    mockAuthSessionFindByPk.mockImplementation(async (sessionId) => activeSessions[sessionId] ?? null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const signAccessToken = (payload) => jwt.sign(payload, TEST_JWT_SECRET, { expiresIn: '1h' });

  const employeeCookieToken = () =>
    signAccessToken({
      id: 1,
      email: 'employee@example.com',
      role_name: 'Employee',
      session_id: 101
    });

  const managementBearerToken = () =>
    signAccessToken({
      id: 2,
      email: 'management@example.com',
      role_name: 'Management',
      session_id: 102
    });

  it('uses the Authorization Bearer token when a cookie token is also present', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Cookie', [`token=${employeeCookieToken()}`])
      .set('Authorization', `Bearer ${managementBearerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.role_name).toBe('Management');
  });

  it('accepts a case-insensitive Bearer scheme while preserving header precedence', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Cookie', [`token=${employeeCookieToken()}`])
      .set('Authorization', `bearer ${managementBearerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.role_name).toBe('Management');
  });

  it.each(['Bearer', `Bearer ${managementBearerToken()} extra`])(
    'rejects malformed Authorization header %p instead of falling back to a cookie token',
    async (authorizationHeader) => {
      const res = await request(app)
        .get('/protected')
        .set('Cookie', [`token=${employeeCookieToken()}`])
        .set('Authorization', authorizationHeader);

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid authorization header. Use: Bearer <token>');
    }
  );

  it('rejects non-Bearer Authorization schemes instead of treating them as JWTs', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Cookie', [`token=${employeeCookieToken()}`])
      .set('Authorization', `Basic ${managementBearerToken()}`);

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid authorization header. Use: Bearer <token>');
  });

  it('rejects a valid token without role_name when role hydration fails', async () => {
    const loggerError = jest.spyOn(logger, 'error').mockImplementation(() => {});
    mockUserFindByPk.mockRejectedValueOnce(new Error('database unavailable'));
    const tokenWithoutRoleName = signAccessToken({
      id: 3,
      email: 'legacy@example.com',
      session_id: 103
    });

    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${tokenWithoutRoleName}`);

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Unable to resolve authenticated user role');
    expect(loggerError).toHaveBeenCalledWith('Unable to hydrate authenticated user role', {
      userId: 3,
      error: 'database unavailable'
    });
  });

  it('rejects a valid token without role_name when no role can be hydrated', async () => {
    const loggerError = jest.spyOn(logger, 'error').mockImplementation(() => {});
    mockUserFindByPk.mockResolvedValueOnce({ role: null });
    const tokenWithoutRoleName = signAccessToken({
      id: 5,
      email: 'norole@example.com',
      session_id: 105
    });

    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${tokenWithoutRoleName}`);

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Unable to resolve authenticated user role');
    expect(loggerError).toHaveBeenCalledWith('Authenticated user role could not be resolved', {
      userId: 5,
      hasUser: true,
      hasRole: false
    });
  });

  it('passes unexpected JWT verification failures to the error handler', async () => {
    const unexpectedError = new Error('jwt library unavailable');
    jest.spyOn(jwt, 'verify').mockImplementation(() => {
      throw unexpectedError;
    });
    const req = {
      headers: { authorization: 'Bearer token-value' },
      cookies: {}
    };
    const res = {
      cookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    const next = jest.fn();

    await verifyToken(req, res, next);

    expect(next).toHaveBeenCalledWith(unexpectedError);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('keeps protected-route verification stateful after successful decoding', async () => {
    const token = signAccessToken({
      id: 4,
      email: 'expiring@example.com',
      role_name: 'Management',
      session_id: 104
    });
    const req = {
      headers: { authorization: `Bearer ${token}` },
      cookies: {}
    };
    const res = {
      cookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    const next = jest.fn();

    await verifyToken(req, res, next);

    expect(mockAuthSessionFindByPk).toHaveBeenCalledWith(104);
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual(
      expect.objectContaining({
        id: 4,
        email: 'expiring@example.com',
        role_name: 'Management'
      })
    );
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
