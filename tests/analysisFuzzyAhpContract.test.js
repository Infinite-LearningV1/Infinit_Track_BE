import express from 'express';
import { Op } from 'sequelize';
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

const mockUser = {
  findAll: jest.fn(),
  findByPk: jest.fn()
};
const mockRole = {};
const mockAttendance = {
  findAll: jest.fn()
};
const mockLocation = {
  findAll: jest.fn()
};
const mockLocationEvent = {
  findOne: jest.fn()
};
const mockBooking = {
  findAll: jest.fn()
};
const mockSettings = {
  findOne: jest.fn()
};

const mockFuzzyEngine = {
  getDisciplineAhpWeights: jest.fn(),
  calculateDisciplineIndex: jest.fn(),
  getWfaAhpWeights: jest.fn(),
  calculateWfaScore: jest.fn(),
  weightedPrediction: jest.fn(),
  categorizePlace: jest.fn((place) => {
    const name = (place?.properties?.name || '').toLowerCase();
    if (name.includes('cafe')) return 'cafe';
    if (name.includes('library')) return 'library';
    if (name.includes('hotel')) return 'hotel';
    if (name.includes('restaurant')) return 'restaurant';
    return 'other';
  })
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
  Role: mockRole,
  Attendance: mockAttendance,
  Location: mockLocation,
  LocationEvent: mockLocationEvent,
  Booking: mockBooking,
  Settings: mockSettings,
  AttendanceCategory: {},
  AttendanceStatus: {},
  BookingStatus: {},
  Division: {},
  Program: {},
  Position: {},
  Photo: {},
  sequelize: {}
}));

jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
  __esModule: true,
  default: mockFuzzyEngine
}));

const { getFuzzyAhpAnalysis } = await import('../src/controllers/analysis.controller.js');
const { default: analysisRoutes } = await import('../src/routes/analysis.routes.js');
const { default: mainRoutes } = await import('../src/routes/index.js');

const scopedApp = express();
scopedApp.use('/api/analysis', analysisRoutes);

const mainApp = express();
mainApp.use(mainRoutes);

const makeRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis()
});

describe('analysis fuzzy ahp contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    allowRole = true;

    mockUser.findAll.mockResolvedValue([]);
    mockAttendance.findAll.mockResolvedValue([]);
    mockLocation.findAll.mockResolvedValue([]);
    mockLocationEvent.findOne.mockResolvedValue(null);
    mockBooking.findAll.mockResolvedValue([]);
    mockSettings.findOne.mockResolvedValue(null);

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
    mockFuzzyEngine.calculateWfaScore.mockResolvedValue({
      score: 76.4,
      label: 'Tinggi'
    });

    mockFuzzyEngine.weightedPrediction.mockReturnValue(new Date('2026-04-21T10:15:00.000Z'));
  });

  it('returns 400 when type is missing or invalid', async () => {
    const req = {
      query: { type: 'invalid', period: 'monthly' },
      user: { id: 12, role_name: 'Admin' }
    };
    const res = makeRes();
    const next = jest.fn();

    await getFuzzyAhpAnalysis(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'type must be one of: wfa, discipline, smart_ac'
    });
  });

  it('returns user-ranked analysis for discipline mode', async () => {
    mockUser.findAll.mockResolvedValue([
      { id_users: 7, full_name: 'Andi' },
      { id_users: 8, full_name: 'Budi' }
    ]);
    mockAttendance.findAll.mockResolvedValue([
      {
        user_id: 7,
        status_id: 1,
        time_in: '2026-04-01T01:03:00.000Z',
        time_out: '2026-04-01T09:00:00.000Z',
        work_hour: 7.6,
        attendance_date: '2026-04-01',
        notes: ''
      },
      {
        user_id: 7,
        status_id: 2,
        time_in: '2026-04-02T02:15:00.000Z',
        time_out: '2026-04-02T10:00:00.000Z',
        work_hour: 7.75,
        attendance_date: '2026-04-02',
        notes: ''
      }
    ]);

    const req = {
      query: { type: 'discipline', period: 'monthly' },
      user: { id: 12, role_name: 'Admin' }
    };
    const res = makeRes();
    const next = jest.fn();

    await getFuzzyAhpAnalysis(req, res, next);

    expect(mockAttendance.findAll).toHaveBeenCalledTimes(1);
    expect(mockAttendance.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: {
            [Op.in]: [7, 8]
          }
        })
      })
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          type: 'discipline',
          entity_kind: 'user',
          weights: expect.objectContaining({
            criteria: ['alpha_rate', 'lateness_severity', 'lateness_frequency', 'work_focus'],
            values: expect.any(Array),
            method: expect.any(String)
          }),
          consistency: expect.objectContaining({
            CR: expect.any(Number),
            CI: expect.any(Number),
            lambda_max: expect.any(Number),
            threshold: 0.1,
            is_consistent: expect.any(Boolean),
            verdict: 'Matriks perbandingan konsisten (CR < 0.10)'
          }),
          ranking: expect.arrayContaining([
            expect.objectContaining({
              rank: 1,
              id: 7,
              name: 'Andi',
              score: expect.any(Number),
              label: expect.any(String),
              breakdown: expect.objectContaining({
                alpha_rate: expect.any(Number),
                avg_lateness_minutes: expect.any(Number),
                lateness_frequency: expect.any(Number),
                work_hour_consistency: expect.any(Number)
              })
            })
          ])
        })
      })
    );
  });

  it('returns place-ranked analysis for wfa mode', async () => {
    mockLocation.findAll.mockResolvedValue([
      {
        location_id: 11,
        description: 'Cafe A',
        latitude: '-6.200000',
        longitude: '106.800000'
      }
    ]);

    const req = {
      query: { type: 'wfa', period: 'monthly' },
      user: { id: 12, role_name: 'Admin' }
    };
    const res = makeRes();
    const next = jest.fn();

    await getFuzzyAhpAnalysis(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          type: 'wfa',
          entity_kind: 'place',
          ranking: expect.arrayContaining([
            expect.objectContaining({
              rank: 1,
              id: 11,
              name: 'Cafe A',
              score: expect.any(Number),
              label: expect.any(String),
              breakdown: expect.objectContaining({
                location_type: expect.any(String),
                amenity_score: expect.any(Number),
                distance: expect.any(Number)
              })
            })
          ])
        })
      })
    );
  });

  it('returns user-ranked analysis for smart_ac mode', async () => {
    mockUser.findAll.mockResolvedValue([{ id_users: 9, full_name: 'Sinta' }]);
    mockAttendance.findAll.mockResolvedValue([
      {
        time_in: '2026-04-21T01:00:00.000Z',
        time_out: '2026-04-21T10:00:00.000Z',
        attendance_date: '2026-04-21',
        work_hour: 8,
        notes: '[Smart AC] pred=17:00:00, used=17:15:00, basis=HIST,TRANSITION, dur=08:15:00'
      }
    ]);
    mockLocationEvent.findOne.mockResolvedValue({
      event_timestamp: '2026-04-21T09:15:00.000Z'
    });

    const req = {
      query: { type: 'smart_ac', period: 'monthly' },
      user: { id: 12, role_name: 'Admin' }
    };
    const res = makeRes();
    const next = jest.fn();

    await getFuzzyAhpAnalysis(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const response = res.json.mock.calls[0][0];
    const [rankedUser] = response.data.ranking;

    expect(rankedUser.breakdown).toEqual({
      history_checkout_minutes: 1020,
      checkin_pattern_minutes: 480,
      context_checkout_minutes: 975,
      transition_checkout_minutes: 15
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          type: 'smart_ac',
          entity_kind: 'user',
          weights: expect.objectContaining({
            criteria: ['history', 'checkin_pattern', 'context', 'transition'],
            values: expect.any(Array),
            method: expect.any(String)
          }),
          ranking: expect.arrayContaining([
            expect.objectContaining({
              rank: 1,
              id: 9,
              name: 'Sinta',
              score: expect.any(Number),
              label: expect.any(String),
              breakdown: expect.objectContaining({
                history_checkout_minutes: expect.any(Number),
                checkin_pattern_minutes: expect.any(Number),
                context_checkout_minutes: expect.any(Number),
                transition_checkout_minutes: expect.any(Number)
              })
            })
          ])
        })
      })
    );
  });

  it('returns 200 with empty ranking and zeroed distribution when no valid entities exist', async () => {
    const req = {
      query: { type: 'discipline', period: 'monthly' },
      user: { id: 12, role_name: 'Admin' }
    };
    const res = makeRes();
    const next = jest.fn();

    await getFuzzyAhpAnalysis(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          ranking: [],
          distribution: {
            'Sangat Tinggi': 0,
            Tinggi: 0,
            Sedang: 0,
            Rendah: 0,
            'Sangat Rendah': 0
          }
        })
      })
    );
  });

  it('uses the real controller through /api/analysis/fuzzy-ahp', async () => {
    mockUser.findAll.mockResolvedValue([{ id_users: 7, full_name: 'Andi' }]);
    mockAttendance.findAll.mockResolvedValue([
      {
        status_id: 1,
        time_in: '2026-04-01T01:03:00.000Z',
        time_out: '2026-04-01T09:00:00.000Z',
        work_hour: 7.6,
        attendance_date: '2026-04-01',
        notes: ''
      }
    ]);

    const res = await request(scopedApp).get('/api/analysis/fuzzy-ahp?type=discipline&period=monthly');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.type).toBe('discipline');
    expect(mockVerifyToken).toHaveBeenCalled();
  });

  it('mounts the analysis route into the main router under /api/analysis', async () => {
    mockUser.findAll.mockResolvedValue([{ id_users: 7, full_name: 'Andi' }]);
    mockAttendance.findAll.mockResolvedValue([
      {
        status_id: 1,
        time_in: '2026-04-01T01:03:00.000Z',
        time_out: '2026-04-01T09:00:00.000Z',
        work_hour: 7.6,
        attendance_date: '2026-04-01',
        notes: ''
      }
    ]);

    const res = await request(mainApp).get('/api/analysis/fuzzy-ahp?type=discipline&period=monthly');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.type).toBe('discipline');
  });

  it('returns 403 for callers outside Admin and Management', async () => {
    allowRole = false;

    const res = await request(scopedApp).get('/api/analysis/fuzzy-ahp?type=discipline&period=monthly');

    expect(res.status).toBe(403);
  });
});
