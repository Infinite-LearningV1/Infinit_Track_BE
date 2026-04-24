import express from 'express';
import { jest } from '@jest/globals';
import request from 'supertest';

const mockVerifyToken = jest.fn((req, _res, next) => {
  req.user = { id: 12, role_name: 'Admin' };
  next();
});

let allowRole = true;
const mockRoleGuard = () => (_req, res, next) => {
  if (!allowRole) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  next();
};

const mockGetFuzzyAhpAnalysis = jest.fn((req, res) => {
  res.status(501).json({
    success: false,
    message: 'INF-129 analysis endpoint not implemented yet'
  });
});

jest.unstable_mockModule('../src/controllers/analysis.controller.js', () => ({
  getFuzzyAhpAnalysis: mockGetFuzzyAhpAnalysis
}));

jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
  verifyToken: mockVerifyToken
}));

jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
  __esModule: true,
  default: mockRoleGuard
}));

const { default: analysisRoutes } = await import('../src/routes/analysis.routes.js');
const { default: mainRoutes } = await import('../src/routes/index.js');

const scopedApp = express();
scopedApp.use('/api/analysis', analysisRoutes);

const mainApp = express();
mainApp.use(mainRoutes);

describe('analysis fuzzy ahp route shell', () => {
  afterEach(() => {
    jest.clearAllMocks();
    allowRole = true;
  });

  it('returns 501 shell response for valid discipline requests during task 1-2 wiring', async () => {
    const res = await request(scopedApp).get('/api/analysis/fuzzy-ahp?type=discipline&period=monthly');

    expect(res.status).toBe(501);
    expect(res.body).toEqual({
      success: false,
      message: 'INF-129 analysis endpoint not implemented yet'
    });
    expect(mockVerifyToken).toHaveBeenCalled();
    expect(mockGetFuzzyAhpAnalysis).toHaveBeenCalled();
  });

  it('mounts the analysis route into the main router under /api/analysis', async () => {
    const res = await request(mainApp).get('/api/analysis/fuzzy-ahp?type=discipline&period=monthly');

    expect(res.status).toBe(501);
    expect(mockGetFuzzyAhpAnalysis).toHaveBeenCalled();
  });

  it('returns 403 for callers outside Admin and Management', async () => {
    allowRole = false;

    const res = await request(scopedApp).get('/api/analysis/fuzzy-ahp?type=discipline&period=monthly');

    expect(res.status).toBe(403);
    expect(mockGetFuzzyAhpAnalysis).not.toHaveBeenCalled();
  });
});
