import express from 'express';
import { jest } from '@jest/globals';
import request from 'supertest';

const mockReadWfaRequestConfig = jest.fn();
const mockVerifyToken = jest.fn((req, _res, next) => {
  req.user = { id: 1, role_name: 'User' };
  next();
});

jest.unstable_mockModule('../src/services/wfaSettings.service.js', () => ({
  readWfaRequestConfig: mockReadWfaRequestConfig,
  listWfaReasons: jest.fn(),
  createWfaReason: jest.fn(),
  updateWfaReason: jest.fn()
}));
jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({ verifyToken: mockVerifyToken }));
jest.unstable_mockModule('../src/controllers/wfa.controller.js', () => ({
  getWfaRecommendations: jest.fn(),
  getWfaAhpConfig: jest.fn(),
  testFuzzyAhp: jest.fn()
}));

const { default: wfaRoutes } = await import('../src/routes/wfa.routes.js');
const { errorHandler } = await import('../src/middlewares/errorHandler.js');

const app = express();
app.use(express.json());
app.use('/api/wfa', wfaRoutes);
app.use(errorHandler);

describe('GET /api/wfa/request-config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadWfaRequestConfig.mockResolvedValue({
      radiusMeters: 100,
      reasons: [
        { id: 1, label: 'Pertemuan dengan klien', isOther: false, sortOrder: 10 }
      ]
    });
  });

  it('requires an authenticated session and returns the employee config projection', async () => {
    const res = await request(app).get('/api/wfa/request-config');

    expect(res.status).toBe(200);
    expect(mockVerifyToken).toHaveBeenCalled();
    expect(mockReadWfaRequestConfig).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual({
      success: true,
      data: {
        radius_meters: 100,
        reasons: [
          {
            id: 1,
            label: 'Pertemuan dengan klien',
            is_other: false,
            sort_order: 10
          }
        ]
      }
    });
  });

  it('does not call the service when authentication fails', async () => {
    mockVerifyToken.mockImplementationOnce((_req, res, _next) => {
      res.status(401).json({ success: false, code: 'E_UNAUTHORIZED' });
    });

    const res = await request(app).get('/api/wfa/request-config');

    expect(res.status).toBe(401);
    expect(mockReadWfaRequestConfig).not.toHaveBeenCalled();
  });

  it('forwards stable service failures to the shared error handler', async () => {
    mockReadWfaRequestConfig.mockRejectedValueOnce(
      Object.assign(new Error('Konfigurasi WFA belum tersedia.'), {
        status: 500,
        code: 'WFA_CONFIG_UNAVAILABLE',
        details: []
      })
    );

    const res = await request(app).get('/api/wfa/request-config');

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      success: false,
      code: 'WFA_CONFIG_UNAVAILABLE',
      message: 'Konfigurasi WFA belum tersedia.'
    });
  });
});
