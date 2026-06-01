import express from 'express';
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

const zeroDistribution = {
  'Sangat Tinggi': 0,
  Tinggi: 0,
  Sedang: 0,
  Rendah: 0,
  'Sangat Rendah': 0
};

describe('analysis discipline fuzzy ahp dedicated contract', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();

    mockUser.findAll.mockResolvedValue([{ id_users: 7, full_name: 'Andi' }]);
    mockAttendance.findAll.mockResolvedValue([
      {
        user_id: 7,
        status_id: 1,
        time_in: '2026-05-01T01:15:00.000Z',
        time_out: '2026-05-01T09:15:00.000Z',
        work_hour: 8,
        attendance_date: '2026-05-01',
        notes: ''
      }
    ]);
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
        avg_lateness_minutes: 15,
        lateness_frequency: 0,
        work_hour_consistency: 100
      }
    });
    mockFuzzyEngine.getWfaAhpWeights.mockReturnValue({
      location_type: 0.5,
      distance_factor: 0.3,
      amenity_score: 0.2,
      consistency_ratio: 0.025
    });
  });

  it('returns the dedicated discipline analysis contract', async () => {
    const res = await request(app).get(
      '/api/analysis/fuzzy-ahp/discipline?period=custom&from=2026-05-01&to=2026-05-01'
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        type: 'discipline',
        period: 'custom',
        timezone: 'Asia/Jakarta',
        generated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/),
        requested_window: {
          start_at: '2026-05-01T00:00:00+07:00',
          end_at: '2026-05-01T23:59:59+07:00'
        },
        executed_window: {
          start_at: '2026-05-01T00:00:00+07:00',
          end_at: '2026-05-01T23:59:59+07:00'
        },
        weights: expect.objectContaining({
          method: "Chang's Extent Analysis"
        }),
        consistency: expect.objectContaining({
          threshold: 0.1
        }),
        ranking: expect.any(Array)
      })
    );
    expect(res.body.data.executed_window.start_at).toMatch(/\+07:00$/);
    expect(res.body.data.executed_window.end_at).toMatch(/\+07:00$/);
  });

  it('returns empty real analysis when the selected window has no attendance rows even if users exist', async () => {
    mockUser.findAll.mockResolvedValue([
      { id_users: 7, full_name: 'Andi' },
      { id_users: 8, full_name: 'Budi' }
    ]);
    mockAttendance.findAll.mockResolvedValue([]);

    const res = await request(app).get(
      '/api/analysis/fuzzy-ahp/discipline?period=custom&from=2026-05-01&to=2026-05-01'
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        type: 'discipline',
        distribution: zeroDistribution,
        ranking: []
      })
    );
    expect(mockAttendance.findAll).toHaveBeenCalledTimes(1);
    expect(mockFuzzyEngine.calculateDisciplineIndex).not.toHaveBeenCalled();
  });

  it('excludes users without attendance from mixed discipline rankings and scoring', async () => {
    mockUser.findAll.mockResolvedValue([
      { id_users: 7, full_name: 'Andi' },
      { id_users: 8, full_name: 'Budi' }
    ]);
    mockAttendance.findAll.mockResolvedValue([
      {
        user_id: 7,
        status_id: 1,
        time_in: '2026-05-01T01:15:00.000Z',
        time_out: '2026-05-01T09:15:00.000Z',
        work_hour: 8,
        attendance_date: '2026-05-01',
        notes: ''
      }
    ]);
    mockFuzzyEngine.calculateDisciplineIndex.mockImplementation(async (metrics) => ({
      score: 87.5,
      label: 'Sangat Tinggi',
      breakdown: metrics
    }));

    const res = await request(app).get(
      '/api/analysis/fuzzy-ahp/discipline?period=custom&from=2026-05-01&to=2026-05-01'
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ranking).toHaveLength(1);
    expect(res.body.data.ranking[0]).toEqual(
      expect.objectContaining({
        user_id: 7,
        name: 'Andi',
        rank: 1,
        score: 87.5,
        label: 'Sangat Tinggi'
      })
    );
    expect(res.body.data.ranking[0]).not.toHaveProperty('id');
    expect(res.body.data.ranking.map((item) => item.user_id)).not.toContain(8);
    expect(res.body.data.distribution).toEqual({
      ...zeroDistribution,
      'Sangat Tinggi': 1
    });
    expect(mockFuzzyEngine.calculateDisciplineIndex).toHaveBeenCalledTimes(1);
    expect(mockFuzzyEngine.calculateDisciplineIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        alpha_rate: 0,
        avg_lateness_minutes: 15,
        lateness_frequency: 0,
        work_hour_consistency: 100
      }),
      expect.any(Object)
    );
  });
});
