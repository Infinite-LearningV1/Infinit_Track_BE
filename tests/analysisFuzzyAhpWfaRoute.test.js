import express from 'express';
import { jest } from '@jest/globals';
import request from 'supertest';

const mockAnalyze = jest.fn();

const mockVerifyToken = jest.fn((req, res, next) => {
  if (!req.get('authorization')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  req.user = { id: 12, role_name: req.get('x-test-role') || 'Admin' };
  next();
});

const mockRoleGuard = jest.fn((allowedRoles) => (req, res, next) => {
  const userRole = req.user?.role_name || req.user?.role?.name;
  if (!allowedRoles.includes(userRole)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  next();
});

const mockUser = {
  findAll: jest.fn()
};
const mockAttendance = {
  findAll: jest.fn()
};
const mockLocation = {
  findAll: jest.fn()
};
const mockLocationEvent = {
  findOne: jest.fn()
};

jest.unstable_mockModule('../src/services/wfaRecommendation.service.js', () => ({
  analyze: mockAnalyze
}));

jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
  verifyToken: mockVerifyToken
}));

jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
  __esModule: true,
  default: mockRoleGuard
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  User: mockUser,
  Attendance: mockAttendance,
  Location: mockLocation,
  LocationEvent: mockLocationEvent
}));

const { default: analysisRoutes } = await import('../src/routes/analysis.routes.js');

const app = express();
app.use(express.json());
app.use('/api/analysis', analysisRoutes);

const expectValidationFailure = async (path) => {
  const res = await request(app).get(path).set('Authorization', 'Bearer test-token');

  expect(res.status).toBe(400);
  expect(res.body.success).toBe(false);
  expect(res.body.code).toBe('E_VALIDATION');
  expect(mockUser.findAll).not.toHaveBeenCalled();
  expect(mockAttendance.findAll).not.toHaveBeenCalled();
  expect(mockLocation.findAll).not.toHaveBeenCalled();

  return res;
};

describe('analysis WFA fuzzy ahp route validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAnalyze.mockResolvedValue({
      candidates: [],
      searchCriteria: {},
      methodology: {}
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns 400 when lat is missing', async () => {
    await expectValidationFailure(
      '/api/analysis/fuzzy-ahp/wfa?lon=119.872&schedule_date=2099-08-03&radius_meters=100'
    );
  });

  it('returns 400 when lon is missing', async () => {
    await expectValidationFailure(
      '/api/analysis/fuzzy-ahp/wfa?lat=-0.895&schedule_date=2099-08-03&radius_meters=100'
    );
  });

  it('returns 400 when schedule_date is missing', async () => {
    await expectValidationFailure('/api/analysis/fuzzy-ahp/wfa?lat=-0.895&lon=119.872');
  });

  it('returns 400 when schedule_date is not a strict future date', async () => {
    await expectValidationFailure(
      '/api/analysis/fuzzy-ahp/wfa?lat=-0.895&lon=119.872&schedule_date=2026-02-30'
    );
  });

  it('returns 400 when schedule_date is today or in the past in WIB', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-02T04:00:00.000Z'));

    await expectValidationFailure(
      '/api/analysis/fuzzy-ahp/wfa?lat=-0.895&lon=119.872&schedule_date=2026-08-02'
    );
    await expectValidationFailure(
      '/api/analysis/fuzzy-ahp/wfa?lat=-0.895&lon=119.872&schedule_date=2026-08-01'
    );

    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it('returns 400 when radius_meters is below minimum', async () => {
    await expectValidationFailure(
      '/api/analysis/fuzzy-ahp/wfa?lat=-0.895&lon=119.872&schedule_date=2099-08-03&radius_meters=99'
    );
  });

  it('returns 400 when radius_meters is above maximum', async () => {
    await expectValidationFailure(
      '/api/analysis/fuzzy-ahp/wfa?lat=-0.895&lon=119.872&schedule_date=2099-08-03&radius_meters=50001'
    );
  });

  it('returns 400 when radius_meters is not an integer', async () => {
    await expectValidationFailure(
      '/api/analysis/fuzzy-ahp/wfa?lat=-0.895&lon=119.872&schedule_date=2099-08-03&radius_meters=100.5'
    );
  });

  it('returns 401 when caller is unauthenticated', async () => {
    const res = await request(app).get(
      '/api/analysis/fuzzy-ahp/wfa?lat=-0.895&lon=119.872&schedule_date=2099-08-03&radius_meters=100'
    );

    expect(res.status).toBe(401);
    expect(mockUser.findAll).not.toHaveBeenCalled();
    expect(mockAttendance.findAll).not.toHaveBeenCalled();
    expect(mockLocation.findAll).not.toHaveBeenCalled();
  });

  it('returns 403 for non-admin callers', async () => {
    const res = await request(app)
      .get(
        '/api/analysis/fuzzy-ahp/wfa?lat=-0.895&lon=119.872&schedule_date=2099-08-03&radius_meters=100'
      )
      .set('Authorization', 'Bearer test-token')
      .set('x-test-role', 'User');

    expect(res.status).toBe(403);
    expect(mockUser.findAll).not.toHaveBeenCalled();
    expect(mockAttendance.findAll).not.toHaveBeenCalled();
    expect(mockLocation.findAll).not.toHaveBeenCalled();
  });

  it('returns 200 for Management callers with valid WFA parameters', async () => {
    const res = await request(app)
      .get(
        '/api/analysis/fuzzy-ahp/wfa?lat=-0.895&lon=119.872&schedule_date=2099-08-03&radius_meters=100'
      )
      .set('Authorization', 'Bearer test-token')
      .set('x-test-role', 'Management');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockAnalyze).toHaveBeenCalledWith({
      latitude: -0.895,
      longitude: 119.872,
      scheduleDate: '2099-08-03',
      radiusMeters: 100
    });
  });

  it('defaults radius_meters to 5000 when omitted', async () => {
    const res = await request(app)
      .get('/api/analysis/fuzzy-ahp/wfa?lat=-0.895&lon=119.872&schedule_date=2099-08-03')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-role', 'Management');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockAnalyze).toHaveBeenCalledWith({
      latitude: -0.895,
      longitude: 119.872,
      scheduleDate: '2099-08-03',
      radiusMeters: 5000
    });
  });
});
