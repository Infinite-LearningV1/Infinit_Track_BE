import express from 'express';
import { Op } from 'sequelize';
import { jest } from '@jest/globals';
import request from 'supertest';

const mockGetJakartaDateString = jest.fn(() => '2026-05-03');
const mockAttendanceFindAll = jest.fn();
const mockLocationEventFindAll = jest.fn();
const mockBuildDisciplineAnalysis = jest.fn();
const mockBuildWfaAnalysis = jest.fn();
const mockBuildSmartAcAnalysis = jest.fn();
const mockBuildTodayLocationsSnapshot = jest.fn();
const mockVerifyToken = jest.fn((req, _res, next) => {
  req.user = { id: 1, role_name: 'Admin' };
  next();
});
const mockFormatTimeOnly = jest.fn((value) => {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value));
});

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: {}
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  Attendance: { findAll: mockAttendanceFindAll },
  User: {},
  Role: {},
  Location: {},
  AttendanceCategory: {},
  AttendanceStatus: {},
  Settings: {},
  Division: {},
  LocationEvent: { findAll: mockLocationEventFindAll }
}));

jest.unstable_mockModule('../src/models/user.model.js', () => ({
  default: { findOne: jest.fn() }
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() }
}));

jest.unstable_mockModule('../src/utils/workHourFormatter.js', () => ({
  formatWorkHour: jest.fn(),
  calculateWorkHour: jest.fn(),
  formatTimeOnly: mockFormatTimeOnly
}));

jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
  default: {}
}));

jest.unstable_mockModule('../src/utils/geofence.js', () => ({
  getJakartaDateString: mockGetJakartaDateString
}));

jest.unstable_mockModule('../src/controllers/analysis.controller.js', () => ({
  buildDisciplineAnalysis: mockBuildDisciplineAnalysis,
  buildWfaAnalysis: mockBuildWfaAnalysis,
  buildSmartAcAnalysis: mockBuildSmartAcAnalysis
}));

jest.unstable_mockModule('../src/utils/todayLocationsSnapshot.js', () => ({
  buildTodayLocationsSnapshot: mockBuildTodayLocationsSnapshot
}));

jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
  verifyToken: mockVerifyToken
}));

const { default: summaryRoutes } = await import('../src/routes/summary.routes.js');

const app = express();
app.use(express.json());
app.use('/api/summary', summaryRoutes);

describe('summary dashboard analytics seam', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('serves a real dashboard analytics payload through the route-controller-helper seam', async () => {
    mockAttendanceFindAll.mockResolvedValueOnce([
      {
        id_attendance: 101,
        attendance_date: '2026-04-01',
        user_id: 7,
        time_in: '2026-04-01T01:15:00.000Z',
        time_out: '2026-04-01T10:01:00.000Z',
        notes: '',
        user: { id_users: 7, full_name: 'Febri' },
        location: {
          location_id: 11,
          latitude: '-0.891700',
          longitude: '119.870700',
          radius: 100,
          description: 'Head Office'
        },
        status: { attendance_status_name: 'Tepat Waktu' },
        attendance_category: { category_name: 'Work From Office' }
      },
      {
        id_attendance: 102,
        attendance_date: '2026-04-02',
        user_id: 8,
        time_in: null,
        time_out: null,
        notes: '',
        user: { id_users: 8, full_name: 'Diana' },
        location: null,
        status: { attendance_status_name: 'Alpha' },
        attendance_category: { category_name: 'Work From Home' }
      },
      {
        id_attendance: 103,
        attendance_date: '2026-04-03',
        user_id: 8,
        time_in: '2026-04-03T01:20:00.000Z',
        time_out: null,
        notes: 'Cafe shift',
        user: { id_users: 8, full_name: 'Diana' },
        location: {
          location_id: 31,
          latitude: '-0.900100',
          longitude: '119.880200',
          radius: 150,
          description: 'Cafe Satu'
        },
        status: { attendance_status_name: 'Terlambat' },
        attendance_category: { category_name: 'Work From Anywhere' }
      }
    ]);

    mockLocationEventFindAll.mockResolvedValueOnce([
      { user_id: 7, event_type: 'ENTER' },
      { user_id: 8, event_type: 'EXIT' },
      { user_id: 8, event_type: 'EXIT' }
    ]);

    mockBuildDisciplineAnalysis.mockResolvedValueOnce({
      consistency: { CR: 0.021, threshold: 0.1, is_consistent: true },
      weights: {
        criteria: ['alpha_rate', 'lateness_severity'],
        values: [0.6, 0.4]
      },
      ranking: [
        { id: 9, name: 'Outsider', score: 99, label: 'Sangat Tinggi' },
        { id: 7, name: 'Febri', score: 84, label: 'Tinggi' },
        { id: 8, name: 'Diana', score: 80, label: 'Sedang' }
      ]
    });

    mockBuildWfaAnalysis.mockResolvedValueOnce({
      consistency: { CR: 0.018, threshold: 0.1, is_consistent: true },
      weights: {
        criteria: ['location_type', 'distance_factor'],
        values: [0.55, 0.45]
      },
      ranking: [
        { id: 31, name: 'Cafe Satu', score: 90, label: 'Sangat Tinggi' },
        { id: 32, name: 'Library Dua', score: 70, label: 'Tinggi' }
      ]
    });

    mockBuildSmartAcAnalysis.mockResolvedValueOnce({
      consistency: { CR: 0, threshold: 0.1, is_consistent: true },
      weights: {
        criteria: ['history', 'context'],
        values: [0.4, 0.6]
      },
      ranking: [
        { id: 99, name: 'Untracked User', score: 95, label: 'Sangat Tinggi' },
        { id: 8, name: 'Diana', score: 72, label: 'Tinggi' },
        { id: 7, name: 'Febri', score: 65, label: 'Sedang' }
      ]
    });

    mockBuildTodayLocationsSnapshot.mockResolvedValueOnce({
      date: '2026-05-03',
      timezone: 'Asia/Jakarta',
      snapshot_type: 'attendance_checkin_snapshot',
      is_live_tracking: false,
      total_users: 2,
      locations: [
        {
          user_id: 7,
          full_name: 'Febri',
          status: 'WFO',
          check_in_time: '08:15',
          latitude: -0.8917,
          longitude: 119.8707,
          photo: null
        },
        {
          user_id: 8,
          full_name: 'Diana',
          status: 'WFA',
          check_in_time: '08:45',
          latitude: -0.901,
          longitude: 119.875,
          photo: null
        }
      ]
    });

    const res = await request(app).get(
      '/api/summary/dashboard-analytics?period=custom&from=2026-04-01&to=2026-04-03'
    );

    expect(res.status).toBe(200);
    expect(mockVerifyToken).toHaveBeenCalled();
    expect(mockAttendanceFindAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          attendance_date: {
            [Op.between]: ['2026-04-01', '2026-04-03']
          }
        }
      })
    );
    expect(mockLocationEventFindAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          event_timestamp: {
            [Op.gte]: new Date('2026-03-31T17:00:00.000Z'),
            [Op.lt]: new Date('2026-04-03T17:00:00.000Z')
          }
        }
      })
    );
    expect(res.body).toMatchObject({
      success: true,
      requested_window: {
        period: 'custom',
        from: '2026-04-01',
        to: '2026-04-03'
      },
      executed_window: {
        from: '2026-04-01',
        to: '2026-04-03'
      },
      message: 'Dashboard analytics retrieved successfully',
      data: {
        meta: {
          timezone: 'Asia/Jakarta',
          requested_window: {
            period: 'custom',
            from: '2026-04-01',
            to: '2026-04-03'
          },
          executed_window: {
            from: '2026-04-01',
            to: '2026-04-03'
          },
          section_windows: {
            executive_kpis: { from: '2026-04-01', to: '2026-04-03' },
            historical_trend: { from: '2026-04-01', to: '2026-04-03' },
            mode_mix: { from: '2026-04-01', to: '2026-04-03' },
            fuzzy_ahp_snapshot: { from: '2026-04-01', to: '2026-04-03' },
            geofence_evidence_context: { from: '2026-04-01', to: '2026-04-03' },
            map_context: { from: '2026-04-01', to: '2026-04-03' },
            today_locations: { mode: 'jakarta_today' }
          }
        },
        executive_kpis: {
          attendance_rate: 66.67,
          late_alpha_risk: 66.67,
          avg_discipline: 82,
          needs_attention: 1,
          raw_counts: {
            total_attendance_records: 3,
            total_present: 2,
            total_alpha: 1,
            total_late: 1,
            total_on_time: 1,
            total_wfo: 1,
            total_wfh: 1,
            total_wfa: 1,
            discipline_users_analyzed: 2
          }
        },
        mode_mix: {
          totals: {
            wfo: 1,
            wfh: 1,
            wfa: 1
          },
          percentages: {
            wfo: 33.33,
            wfh: 33.33,
            wfa: 33.33
          }
        },
        today_locations: {
          snapshot_type: 'attendance_checkin_snapshot',
          is_live_tracking: false,
          total_users: 2
        },
        geofence_evidence_context: {
          status: 'available',
          authority: 'context_only',
          final_attendance_authority: 'attendance_records',
          window: { from: '2026-04-01', to: '2026-04-03' },
          raw_counts: {
            total_events: 3,
            enter_events: 1,
            exit_events: 2,
            unique_users: 2
          }
        },
        map_context: {
          status: 'ready',
          authority: 'context_only',
          source: 'attendance_snapshot',
          window: { from: '2026-04-01', to: '2026-04-03' },
          summary: {
            total_points: 2,
            wfo_points: 1,
            wfh_points: 0,
            wfa_points: 1
          },
          geofence_context: {
            status: 'available',
            authority: 'context_only',
            final_attendance_authority: 'attendance_records',
            window: { from: '2026-04-01', to: '2026-04-03' },
            raw_counts: {
              total_events: 3,
              enter_events: 1,
              exit_events: 2,
              unique_users: 2
            }
          },
          points: [
            {
              id: 'attendance:101',
              record_type: 'attendance_snapshot',
              attendance_id: 101,
              user_id: 7,
              user_name: 'Febri',
              mode: 'WFO',
              status: 'on_time',
              label: 'Febri - WFO - 2026-04-01',
              lat: -0.8917,
              lng: 119.8707,
              radius_m: 100,
              attendance_date: '2026-04-01',
              time_in: '08:15',
              time_out: '17:01',
              location_source: 'attendance.location',
              coordinate_quality: 'exact',
              description: 'Head Office'
            },
            {
              id: 'attendance:103',
              record_type: 'attendance_snapshot',
              attendance_id: 103,
              user_id: 8,
              user_name: 'Diana',
              mode: 'WFA',
              status: 'late',
              label: 'Diana - WFA - 2026-04-03',
              lat: -0.9001,
              lng: 119.8802,
              radius_m: 150,
              attendance_date: '2026-04-03',
              time_in: '08:20',
              time_out: null,
              location_source: 'attendance.location',
              coordinate_quality: 'exact',
              description: 'Cafe shift'
            }
          ]
        },
        fuzzy_ahp_snapshot: {
          discipline: {
            status: 'ready',
            top_rank: {
              id: 7,
              name: 'Febri',
              label: 'Tinggi'
            }
          },
          wfa: {
            status: 'ready',
            top_rank: {
              id: 31,
              name: 'Cafe Satu',
              label: 'Sangat Tinggi'
            }
          },
          smart_ac: {
            status: 'ready',
            top_rank: {
              id: 8,
              name: 'Diana',
              label: 'Tinggi'
            }
          }
        },
        insights: {
          items: [
            {
              type: 'alpha_spike',
              severity: 'high'
            }
          ]
        }
      }
    });
    expect(res.body.data.historical_trend.points).toEqual([
      {
        date: '2026-04-01',
        on_time: 1,
        late: 0,
        present: 1,
        alpha: 0,
        wfo: 1,
        wfh: 0,
        wfa: 0
      },
      {
        date: '2026-04-02',
        on_time: 0,
        late: 0,
        present: 0,
        alpha: 1,
        wfo: 0,
        wfh: 1,
        wfa: 0
      },
      {
        date: '2026-04-03',
        on_time: 0,
        late: 1,
        present: 1,
        alpha: 0,
        wfo: 0,
        wfh: 0,
        wfa: 1
      }
    ]);
  });
});
