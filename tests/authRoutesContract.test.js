import express from 'express';
import { jest } from '@jest/globals';
import request from 'supertest';

const mockVerifyToken = jest.fn((req, res, _next) => {
  res.status(401).json({
    success: false,
    code: 'AUTH_ACCESS_TOKEN_EXPIRED',
    message: 'Access token expired',
    details: { refreshable: true }
  });
});

const mockLoginRateLimit = jest.fn((req, _res, next) => next());

const mockLogin = jest.fn((req, res) => {
  res.status(401).json({
    success: false,
    message: 'Invalid credentials'
  });
});

const mockLogout = jest.fn((req, res) => {
  res.status(200).json({
    success: true,
    message: 'Logout successful'
  });
});

jest.unstable_mockModule('../src/controllers/auth.controller.js', () => ({
  login: mockLogin,
  logout: mockLogout,
  refresh: jest.fn(),
  getCurrentUser: jest.fn()
}));

jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
  verifyToken: mockVerifyToken
}));

jest.unstable_mockModule('../src/middlewares/security.js', () => ({
  loginRateLimit: mockLoginRateLimit
}));

jest.unstable_mockModule('../src/middlewares/validator.js', () => ({
  loginValidation: [],
  validate: jest.fn((req, res, next) => next())
}));

const { default: authRoutes } = await import('../src/routes/auth.routes.js');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

describe('Auth route contract', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('does not expose public self-registration route', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'user@example.com',
      password: 'Password123'
    });

    expect(res.status).toBe(404);
  });

  it('runs dedicated login throttling before the login handler', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'user@example.com',
      password: 'wrong-password'
    });

    expect(res.status).toBe(401);
    expect(mockLoginRateLimit).toHaveBeenCalled();
    expect(mockLogin).toHaveBeenCalled();
  });

  it('requires verifyToken before logout', async () => {
    const res = await request(app).post('/api/auth/logout').send({
      refresh_token: 'refresh-token-value'
    });

    expect(res.status).toBe(401);
    expect(mockVerifyToken).toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
  });
});
