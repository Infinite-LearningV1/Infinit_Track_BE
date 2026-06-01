import express from 'express';
import { Op } from 'sequelize';
import { jest } from '@jest/globals';
import request from 'supertest';

const mockVerifyToken = jest.fn((req, _res, next) => {
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

const mockFuzzyEngine = {
  getDisciplineAhpWeights: jest.fn(),
  calculateDisciplineIndex: jest.fn(),
  getWfaAhpWeights: jest.fn(),
  calculateWfaScore: jest.fn(),
  categorizePlace: jest.fn(() => 'other')
};

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

jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
  __esModule: true,
  default: mockFuzzyEngine
}));

const { default: analysisRoutes } = await import('../src/routes/analysis.routes.js');

const app = express();
app.use(express.json());
app.use('/api/analysis', analysisRoutes);

const expectValidationFailure = async (path) => {
  const res = await request(app).get(path);

  expect(res.status).toBe(400);
  expect(res.body.success).toBe(false);
  expect(res.body.code).toBe('E_VALIDATION');
  expect(mockUser.findAll).not.toHaveBeenCalled();
  expect(mockAttendance.findAll).not.toHaveBeenCalled();

  return res;
};

describe('analysis discipline fuzzy ahp route validation', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();

    mockUser.findAll.mockResolvedValue([]);
    mockAttendance.findAll.mockResolvedValue([]);
    mockLocation.findAll.mockResolvedValue([]);
    mockLocationEvent.findOne.mockResolvedValue(null);
    mockFuzzyEngine.getDisciplineAhpWeights.mockReturnValue({
      alpha_rate: 0.45,
      lateness_severity: 0.25,
      lateness_frequency: 0.18,
      work_focus: 0.12,
      consistency_ratio: 0.037
    });
    mockFuzzyEngine.calculateDisciplineIndex.mockResolvedValue({
      score: 87.5,
      label: 'Sangat Tinggi',
      breakdown: {
        alpha_rate: 0,
        avg_lateness_minutes: 3,
        lateness_frequency: 5,
        work_hour_consistency: 95
      }
    });
    mockFuzzyEngine.getWfaAhpWeights.mockReturnValue({
      location_type: 0.5,
      distance_factor: 0.3,
      amenity_score: 0.2,
      consistency_ratio: 0.025
    });
  });

  it('returns 400 when period is invalid', async () => {
    await expectValidationFailure('/api/analysis/fuzzy-ahp/discipline?period=yearly');
  });

  it('returns 400 when custom period is missing from and to', async () => {
    const res = await expectValidationFailure('/api/analysis/fuzzy-ahp/discipline?period=custom');

    expect(res.body.message).toBe('from and to are required when period is custom');
  });

  it('returns 400 when custom from date is impossible', async () => {
    const res = await expectValidationFailure(
      '/api/analysis/fuzzy-ahp/discipline?period=custom&from=2026-02-31&to=2026-03-02'
    );

    expect(res.body.message).toBe('from and to must be valid dates');
  });

  it('returns 400 when custom to date is impossible', async () => {
    const res = await expectValidationFailure(
      '/api/analysis/fuzzy-ahp/discipline?period=custom&from=2026-02-01&to=2026-02-31'
    );

    expect(res.body.message).toBe('from and to must be valid dates');
  });

  it('returns 400 when custom inclusive range is greater than 365 days', async () => {
    await expectValidationFailure(
      '/api/analysis/fuzzy-ahp/discipline?period=custom&from=2025-01-01&to=2026-01-01'
    );
  });

  it('returns 400 when custom to date is before from date', async () => {
    await expectValidationFailure(
      '/api/analysis/fuzzy-ahp/discipline?period=custom&from=2026-05-10&to=2026-05-01'
    );
  });

  it('returns dedicated discipline contract for valid monthly period', async () => {
    const res = await request(app).get('/api/analysis/fuzzy-ahp/discipline?period=monthly');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: expect.objectContaining({
        period: 'monthly',
        timezone: 'Asia/Jakarta',
        generated_at: expect.stringMatching(/\+07:00$/),
        requested_window: {
          start_at: null,
          end_at: null
        },
        executed_window: {
          start_at: expect.stringMatching(/\+07:00$/),
          end_at: expect.stringMatching(/\+07:00$/)
        },
        entity_kind: 'user',
        consistency: expect.objectContaining({
          CR: 0.037,
          threshold: 0.1,
          is_consistent: true
        }),
        weights: {
          criteria: ['alpha_rate', 'lateness_severity', 'lateness_frequency', 'work_focus'],
          values: [0.45, 0.25, 0.18, 0.12],
          method: "Chang's Extent Analysis"
        },
        distribution: {
          'Sangat Tinggi': 0,
          Tinggi: 0,
          Sedang: 0,
          Rendah: 0,
          'Sangat Rendah': 0
        },
        ranking: []
      }),
      message: 'Discipline Fuzzy AHP analysis retrieved successfully'
    });
    expect(mockUser.findAll).toHaveBeenCalledTimes(1);
    expect(mockAttendance.findAll).not.toHaveBeenCalled();
  });

  it('starts weekly executed window at Monday 00:00:00 WIB when generated mid-week', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-06T05:34:56.000Z'));

    const res = await request(app).get('/api/analysis/fuzzy-ahp/discipline?period=weekly');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.executed_window.start_at).toBe('2026-05-04T00:00:00+07:00');
  });

  it('returns dedicated discipline contract for valid custom period and queries the requested WIB date range', async () => {
    mockUser.findAll.mockResolvedValue([{ id_users: 7, full_name: 'Andi' }]);
    mockAttendance.findAll.mockResolvedValue([
      {
        user_id: 7,
        status_id: 1,
        time_in: '2026-05-01T01:00:00.000Z',
        time_out: '2026-05-01T09:00:00.000Z',
        work_hour: 8,
        attendance_date: '2026-05-01',
        notes: ''
      }
    ]);

    const res = await request(app).get(
      '/api/analysis/fuzzy-ahp/discipline?period=custom&from=2026-05-01&to=2026-05-10'
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        period: 'custom',
        requested_window: {
          start_at: '2026-05-01T00:00:00+07:00',
          end_at: '2026-05-10T23:59:59+07:00'
        },
        executed_window: {
          start_at: '2026-05-01T00:00:00+07:00',
          end_at: '2026-05-10T23:59:59+07:00'
        },
        ranking: [
          expect.objectContaining({
            rank: 1,
            id: 7,
            name: 'Andi',
            score: 87.5,
            label: 'Sangat Tinggi'
          })
        ]
      })
    );
    expect(mockAttendance.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          attendance_date: expect.objectContaining({})
        })
      })
    );
    const attendanceDateRange = mockAttendance.findAll.mock.calls[0][0].where.attendance_date;
    expect(attendanceDateRange[Op.between]).toEqual(['2026-05-01', '2026-05-10']);
  });

  it('sends lateness duration and percentage-style work hour consistency to the FAHP engine', async () => {
    mockUser.findAll.mockResolvedValue([{ id_users: 7, full_name: 'Andi' }]);
    mockAttendance.findAll.mockResolvedValue([
      {
        user_id: 7,
        status_id: 1,
        time_in: '2026-05-01T01:00:00.000Z',
        time_out: '2026-05-01T09:00:00.000Z',
        work_hour: 8,
        attendance_date: '2026-05-01',
        notes: ''
      },
      {
        user_id: 7,
        status_id: 1,
        time_in: '2026-05-04T00:45:00.000Z',
        time_out: '2026-05-04T08:15:00.000Z',
        work_hour: 7.5,
        attendance_date: '2026-05-04',
        notes: ''
      }
    ]);

    const res = await request(app).get(
      '/api/analysis/fuzzy-ahp/discipline?period=custom&from=2026-05-01&to=2026-05-04'
    );

    expect(res.status).toBe(200);
    expect(mockFuzzyEngine.calculateDisciplineIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        avg_lateness_minutes: 0,
        work_hour_consistency: 50
      }),
      expect.any(Object)
    );
  });

  it('returns 403 for non-admin callers', async () => {
    const res = await request(app)
      .get('/api/analysis/fuzzy-ahp/discipline?period=monthly')
      .set('x-test-role', 'User');

    expect(res.status).toBe(403);
    expect(mockUser.findAll).not.toHaveBeenCalled();
  });
});
