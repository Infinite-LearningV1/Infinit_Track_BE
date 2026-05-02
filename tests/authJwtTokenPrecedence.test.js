import { jest } from '@jest/globals';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import config from '../src/config/index.js';
import { verifyToken } from '../src/middlewares/authJwt.js';
import { User } from '../src/models/index.js';
import logger from '../src/utils/logger.js';

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
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const employeeCookieToken = () =>
    jwt.sign({ id: 1, email: 'employee@example.com', role_name: 'Employee' }, config.jwt.secret, {
      expiresIn: '1h'
    });

  const managementBearerToken = () =>
    jwt.sign({ id: 2, email: 'management@example.com', role_name: 'Management' }, config.jwt.secret, {
      expiresIn: '1h'
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
    jest.spyOn(User, 'findByPk').mockRejectedValueOnce(new Error('database unavailable'));
    const tokenWithoutRoleName = jwt.sign({ id: 3, email: 'legacy@example.com' }, config.jwt.secret, {
      expiresIn: '1h'
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
    jest.spyOn(User, 'findByPk').mockResolvedValueOnce({ role: null });
    const tokenWithoutRoleName = jwt.sign({ id: 5, email: 'norole@example.com' }, config.jwt.secret, {
      expiresIn: '1h'
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

  it('passes unexpected post-verification failures to the error handler instead of reporting an invalid token', async () => {
    const unexpectedError = new Error('cookie writer unavailable');
    const expiringToken = jwt.sign(
      { id: 4, email: 'expiring@example.com', role_name: 'Management' },
      config.jwt.secret,
      { expiresIn: '1s' }
    );
    const req = {
      headers: { authorization: `Bearer ${expiringToken}` },
      cookies: {}
    };
    const res = {
      cookie: jest.fn(() => {
        throw unexpectedError;
      }),
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    const next = jest.fn();

    await verifyToken(req, res, next);

    expect(next).toHaveBeenCalledWith(unexpectedError);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
