import express from 'express';
import { jest } from '@jest/globals';
import { Op } from 'sequelize';
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
  findAll: jest.fn(),
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
  getSmartAcAhpWeights: jest.fn(),
  calculateWfaScore: jest.fn(),
  getWfaScoreLabel: jest.fn((score) => {
    if (score < 25) return 'Rendah';
    if (score < 50) return 'Cukup';
    if (score < 75) return 'Baik';
    return 'Sangat Baik';
  }),
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
  AuthSession: {},
  sequelize: {}
}));

jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
  __esModule: true,
  default: mockFuzzyEngine
}));

const { getFuzzyAhpAnalysis } = await import('../src/controllers/analysis.controller.js');
const { buildDisciplineAnalysis, buildSmartAcAnalysis } = await import('../src/services/fuzzyAhpAnalysis.service.js');
const { default: analysisRoutes } = await import('../src/routes/analysis.routes.js');
const { default: mainRoutes } = await import('../src/routes/index.js');

const WIB_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+07:00$/;

function expectWibTimestamp(value) {
  expect(value).toEqual(expect.stringMatching(WIB_TIMESTAMP_PATTERN));
  expect(value.endsWith('Z')).toBe(false);
}

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
    mockLocationEvent.findAll.mockResolvedValue([]);
    mockLocationEvent.findOne.mockResolvedValue(null);
    mockBooking.findAll.mockResolvedValue([]);
    mockSettings.findOne.mockResolvedValue(null);

    mockFuzzyEngine.getDisciplineAhpWeights.mockReturnValue({
      alpha_rate: 0.45,
      lateness_severity: 0.25,
      lateness_frequency: 0.18,
      work_focus: 0.12,
      consistency_ratio: 0.037,
      consistency_index: 0.025,
      lambda_max: 4.075
    });
    mockFuzzyEngine.calculateDisciplineIndex.mockResolvedValue({
      score: 87.5,
      label: 'Sangat Baik',
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
      consistency_ratio: 0.025,
      consistency_index: 0.014,
      lambda_max: 3.028
    });
    mockFuzzyEngine.getSmartAcAhpWeights.mockReturnValue({
      history: 0.31,
      checkin_pattern: 0.27,
      context: 0.18,
      transition: 0.24,
      consistency_ratio: 0.041,
      consistency_index: 0.037,
      lambda_max: 4.111
    });
    mockFuzzyEngine.calculateWfaScore.mockResolvedValue({
      score: 76.4,
      label: 'Sangat Baik'
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
    mockUser.findAll.mockResolvedValue([{ id_users: 7, full_name: 'Andi' }]);
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

    expect(next).not.toHaveBeenCalled();
    expect(mockFuzzyEngine.calculateDisciplineIndex).toHaveBeenCalledWith(
      expect.objectContaining({ avg_lateness_minutes: 39 }),
      expect.any(Object)
    );
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
            CR: 0.037,
            CI: 0.025,
            lambda_max: 4.075,
            threshold: expect.any(Number),
            is_consistent: expect.any(Boolean),
            verdict: expect.any(String)
          }),
          ranking: expect.arrayContaining([
            expect.objectContaining({
              rank: 1,
              id: 7,
              name: 'Andi',
              score: expect.any(Number),
              label: 'Sangat Baik',
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
          scope: 'place_catalog_static',
          window_applied: false,
          data_source: expect.objectContaining({
            type: 'location_catalog_static',
            assumptions: expect.arrayContaining([
              expect.objectContaining({ field: 'amenity_score', value: 50 }),
              expect.objectContaining({ field: 'distance', value: 1000 })
            ]),
            warning: expect.stringContaining('static')
          }),
          consistency: expect.objectContaining({
            CR: 0.025,
            CI: 0.014,
            lambda_max: 3.028
          }),
          ranking: expect.arrayContaining([
            expect.objectContaining({
              rank: 1,
              id: 11,
              name: 'Cafe A',
              score: expect.any(Number),
              label: 'Sangat Baik',
              breakdown: expect.objectContaining({
                location_type: expect.any(String),
                amenity_score: 50,
                distance: 1000
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

    expect(mockFuzzyEngine.getSmartAcAhpWeights).toHaveBeenCalledTimes(1);
    expect(mockLocationEvent.findOne).not.toHaveBeenCalled();
    expect(mockFuzzyEngine.weightedPrediction).toHaveBeenCalledTimes(1);
    expect(mockFuzzyEngine.weightedPrediction.mock.calls[0][0].TRANSITION).toBeNull();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          type: 'smart_ac',
          entity_kind: 'user',
          consistency: expect.objectContaining({
            CR: 0.041,
            CI: 0.037,
            lambda_max: 4.111
          }),
          weights: expect.objectContaining({
            criteria: ['history', 'checkin_pattern', 'context', 'transition'],
            values: [0.31, 0.27, 0.18, 0.24],
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
            'Sangat Baik': 0,
            Baik: 0,
            Cukup: 0,
            Rendah: 0
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
    expectWibTimestamp(res.body.data.generated_at);
    expectWibTimestamp(res.body.data.window.start_at);
    expectWibTimestamp(res.body.data.window.end_at);
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

  it('fetches discipline attendances with one scoped query for all ranked users', async () => {
    mockUser.findAll.mockResolvedValue([
      { id_users: 7, full_name: 'Andi' },
      { id_users: 9, full_name: 'Sinta' }
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
        user_id: 9,
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

    expect(next).not.toHaveBeenCalled();
    expect(mockAttendance.findAll).toHaveBeenCalledTimes(1);
    expect(mockAttendance.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: expect.any(Object),
          attendance_date: expect.any(Object)
        })
      })
    );
  });

  it('uses WIB date-only bounds for discipline attendance queries', async () => {
    mockUser.findAll.mockResolvedValue([{ id_users: 7, full_name: 'Andi' }]);
    mockAttendance.findAll.mockResolvedValue([]);

    await buildDisciplineAnalysis({
      startAt: new Date('2026-04-30T17:00:00.000Z'),
      endAt: new Date('2026-05-01T10:00:00.000Z')
    });

    const attendanceDate = mockAttendance.findAll.mock.calls[0][0].where.attendance_date;

    expect(attendanceDate[Op.between]).toEqual(['2026-05-01', '2026-05-01']);
  });

  it('uses deterministic Smart AC attendance and context-event sources', async () => {
    mockUser.findAll.mockResolvedValue([{ id_users: 9, full_name: 'Sinta' }]);
    mockAttendance.findAll.mockResolvedValue([
      {
        user_id: 9,
        location_id: 31,
        time_in: '2026-05-01T01:00:00.000Z',
        time_out: '2026-05-01T10:00:00.000Z',
        attendance_date: '2026-05-01',
        work_hour: 8,
        notes: '[Smart AC] pred=17:00:00, used=17:15:00, basis=HIST,CONTEXT, dur=08:15:00',
        attendance_category: {
          category_name: 'WFO'
        }
      }
    ]);
    mockLocationEvent.findOne.mockResolvedValue({
      event_timestamp: '2026-05-01T09:15:00.000Z'
    });

    await buildSmartAcAnalysis({
      startAt: new Date('2026-04-30T17:00:00.000Z'),
      endAt: new Date('2026-05-01T10:00:00.000Z')
    });

    const attendanceQuery = mockAttendance.findAll.mock.calls[0][0];
    const eventQuery = mockLocationEvent.findOne.mock.calls[0][0];

    expect(attendanceQuery.where.attendance_date[Op.between]).toEqual(['2026-05-01', '2026-05-01']);
    expect(attendanceQuery.order).toEqual([
      ['attendance_date', 'DESC'],
      ['time_in', 'DESC']
    ]);
    expect(eventQuery.where).toEqual(
      expect.objectContaining({
        user_id: 9,
        event_type: 'EXIT',
        location_id: 31
      })
    );
    expect(eventQuery.where.event_timestamp[Op.gte]).toEqual(new Date('2026-05-01T01:00:00.000Z'));
    expect(eventQuery.where.event_timestamp[Op.lte]).toEqual(new Date('2026-05-01T23:59:59.999Z'));
    expect(eventQuery.order).toEqual([['event_timestamp', 'DESC']]);
  });

  it('returns 403 for callers outside Admin and Management', async () => {
    allowRole = false;

    const res = await request(scopedApp).get('/api/analysis/fuzzy-ahp?type=discipline&period=monthly');

    expect(res.status).toBe(403);
  });
});
