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

const mockLogout = jest.fn((req, res) => {
  res.status(200).json({
    success: true,
    message: 'Logout successful'
  });
});

jest.unstable_mockModule('../src/controllers/auth.controller.js', () => ({
  login: jest.fn(),
  logout: mockLogout,
  refresh: jest.fn(),
  register: jest.fn(),
  getCurrentUser: jest.fn()
}));

jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
  verifyToken: mockVerifyToken
}));

jest.unstable_mockModule('../src/middlewares/validator.js', () => ({
  userRegistrationValidation: [],
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

  it('allows logout to proceed with refresh-token fallback even when access token is expired', async () => {
    const res = await request(app).post('/api/auth/logout').send({
      refresh_token: 'refresh-token-value'
    });

    expect(res.status).toBe(200);
    expect(mockLogout).toHaveBeenCalled();
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });
});
