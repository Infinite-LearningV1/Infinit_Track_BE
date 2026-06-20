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

const mockUser = { findAll: jest.fn() };
const mockAttendance = { findAll: jest.fn() };
const mockLocation = { findByPk: jest.fn() };
const mockLocationEvent = { findOne: jest.fn() };
const mockBooking = { findOne: jest.fn() };

const mockFuzzyEngine = {
  getDisciplineAhpWeights: jest.fn(),
  calculateDisciplineIndex: jest.fn(),
  getWfaAhpWeights: jest.fn(),
  calculateWfaScore: jest.fn(),
  categorizePlace: jest.fn(),
  getSmartAcAhpWeights: jest.fn()
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
  LocationEvent: mockLocationEvent,
  Booking: mockBooking
}));

jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
  __esModule: true,
  default: mockFuzzyEngine
}));

const { default: analysisRoutes } = await import('../src/routes/analysis.routes.js');

const app = express();
app.use(express.json());
app.use('/api/analysis', analysisRoutes);

const requestSmartAc = () => request(app).get('/api/analysis/fuzzy-ahp/smart-ac').set('Authorization', 'Bearer test-token');

describe('analysis Smart AC fuzzy ahp dedicated contract', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout'] }).setSystemTime(
      new Date('2026-05-06T02:34:56.000Z')
    );
    jest.clearAllMocks();

    mockFuzzyEngine.getSmartAcAhpWeights.mockReturnValue({
      history: 0.43,
      checkin_pattern: 0.24,
      context: 0.12,
      transition: 0.21,
      consistency_ratio: 0.043,
      consistency_index: 0.038,
      lambda_max: 4.114
    });
    mockUser.findAll.mockResolvedValue([
      { id_users: 9, full_name: 'Sinta' },
      { id_users: 10, full_name: 'Rudi' }
    ]);
    mockAttendance.findAll.mockResolvedValue([
      {
        id_attendance: 501,
        user_id: 9,
        category_id: 1,
        location_id: 11,
        booking_id: null,
        attendance_date: '2026-05-06',
        time_in: '2026-05-06T01:00:00.000Z',
        time_out: null
      },
      {
        id_attendance: 502,
        user_id: 10,
        category_id: 1,
        location_id: 12,
        booking_id: null,
        attendance_date: '2026-05-06',
        time_in: '2026-05-06T01:10:00.000Z',
        time_out: null
      }
    ]);
    mockLocation.findByPk.mockImplementation(async (locationId) => ({
      location_id: locationId,
      description: locationId === 11 ? 'Palu Office' : 'Branch Office'
    }));
    mockBooking.findOne.mockResolvedValue(null);
    mockLocationEvent.findOne.mockImplementation(async ({ where }) => {
      if (where.user_id === 9 && where.location_id === 11 && where.event_type === 'EXIT') {
        return {
          id: 701,
          user_id: 9,
          location_id: 11,
          event_type: 'EXIT',
          event_timestamp: '2026-05-06T09:20:00.000Z'
        };
      }
      return null;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns today-WIB Smart AC ranking using latest attendance and matching exit evidence', async () => {
    const res = await requestSmartAc();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: expect.objectContaining({
        type: 'smart_ac',
        target_date: '2026-05-06',
        timezone: 'Asia/Jakarta',
        executed_window: {
          start_at: '2026-05-06T00:00:00+07:00',
          end_at: '2026-05-06T23:59:59+07:00'
        },
        consistency: expect.objectContaining({
          CR: 0.043,
          CI: 0.038,
          lambda_max: 4.114,
          threshold: 0.1,
          is_consistent: true
        }),
        weights: {
          criteria: ['history', 'checkin_pattern', 'context', 'transition'],
          values: [0.43, 0.24, 0.12, 0.21],
          method: "Chang's Extent Analysis"
        },
        ranking: [
          expect.objectContaining({
            rank: 1,
            user_id: 9,
            name: 'Sinta',
            predicted_time_out: '16:20',
            needs_data: false,
            evidence_summary: {
              latest_attendance: {
                attendance_id: 501,
                attendance_date: '2026-05-06',
                time_in: '2026-05-06T08:00:00+07:00',
                time_out: null,
                category_id: 1,
                location_id: 11,
                booking_id: null
              },
              expected_location: {
                source: 'wfo_attendance_location',
                location_id: 11,
                description: 'Palu Office'
              },
              latest_exit_event: {
                event_id: 701,
                event_type: 'EXIT',
                location_id: 11,
                event_timestamp: '2026-05-06T16:20:00+07:00'
              }
            }
          }),
          expect.objectContaining({
            rank: 2,
            user_id: 10,
            name: 'Rudi',
            predicted_time_out: null,
            needs_data: true,
            evidence_summary: expect.objectContaining({
              latest_attendance: expect.objectContaining({
                attendance_id: 502,
                attendance_date: '2026-05-06',
                location_id: 12
              }),
              expected_location: expect.objectContaining({
                source: 'wfo_attendance_location',
                location_id: 12
              }),
              latest_exit_event: null
            })
          })
        ]
      }),
      message: 'Smart AC Fuzzy AHP analysis retrieved successfully'
    });

    expect(mockFuzzyEngine.getSmartAcAhpWeights).toHaveBeenCalledTimes(1);
    expect(mockAttendance.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ attendance_date: '2026-05-06' })
      })
    );
    expect(mockLocationEvent.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 9,
          event_type: 'EXIT',
          location_id: 11,
          event_timestamp: {
            [Op.gte]: new Date('2026-05-06T01:00:00.000Z'),
            [Op.lte]: new Date('2026-05-06T16:59:59.999Z')
          }
        }),
        order: [['event_timestamp', 'DESC']]
      })
    );
  });

  it('prefers WFO attendance location over same-day approved WFA booking evidence', async () => {
    mockUser.findAll.mockResolvedValue([{ id_users: 9, full_name: 'Sinta' }]);
    mockAttendance.findAll.mockResolvedValue([
      {
        id_attendance: 501,
        user_id: 9,
        category_id: 1,
        location_id: 11,
        booking_id: null,
        attendance_date: '2026-05-06',
        time_in: '2026-05-06T01:00:00.000Z',
        time_out: null
      }
    ]);
    mockBooking.findOne.mockResolvedValue({ booking_id: 901, user_id: 9, location_id: 99, schedule_date: '2026-05-06', status: 1 });
    mockLocation.findByPk.mockImplementation(async (locationId) => ({
      location_id: locationId,
      description: locationId === 11 ? 'Palu Office' : 'Approved WFA Place'
    }));

    const res = await requestSmartAc();

    expect(res.status).toBe(200);
    expect(res.body.data.ranking).toEqual([
      expect.objectContaining({
        user_id: 9,
        predicted_time_out: '16:20',
        needs_data: false,
        evidence_summary: expect.objectContaining({
          latest_attendance: expect.objectContaining({
            attendance_id: 501,
            location_id: 11,
            booking_id: null
          }),
          expected_location: {
            source: 'wfo_attendance_location',
            location_id: 11,
            description: 'Palu Office'
          },
          latest_exit_event: expect.objectContaining({
            event_id: 701,
            location_id: 11
          })
        })
      })
    ]);
    expect(mockLocationEvent.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 9,
          location_id: 11,
          event_type: 'EXIT'
        })
      })
    );
  });

  it('uses same-day approved WFA booking as expected-location evidence when attendance is absent', async () => {
    mockUser.findAll.mockResolvedValue([{ id_users: 10, full_name: 'Rudi' }]);
    mockAttendance.findAll.mockResolvedValue([]);
    mockBooking.findOne.mockResolvedValue({ booking_id: 902, user_id: 10, location_id: 77, schedule_date: '2026-05-06', status: 1 });
    mockLocation.findByPk.mockImplementation(async (locationId) => ({
      location_id: locationId,
      description: locationId === 77 ? 'Client Site' : 'Unknown Location'
    }));

    const res = await requestSmartAc();

    expect(res.status).toBe(200);
    expect(res.body.data.ranking).toEqual([
      expect.objectContaining({
        user_id: 10,
        predicted_time_out: null,
        needs_data: true,
        evidence_summary: {
          latest_attendance: null,
          expected_location: {
            source: 'approved_wfa_booking',
            location_id: 77,
            description: 'Client Site'
          },
          latest_exit_event: null
        }
      })
    ]);
    expect(mockLocationEvent.findOne).not.toHaveBeenCalled();
  });

  it('returns 403 for callers outside Admin and Management', async () => {
    const res = await request(app).get('/api/analysis/fuzzy-ahp/smart-ac').set('x-test-role', 'User');

    expect(res.status).toBe(403);
    expect(mockAttendance.findAll).not.toHaveBeenCalled();
  });
});
