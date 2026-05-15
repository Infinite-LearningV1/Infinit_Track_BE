import { Op } from 'sequelize';
import { jest } from '@jest/globals';

const mockAttendanceFindAll = jest.fn();
const mockLocationEventFindAll = jest.fn();
const mockBuildDisciplineAnalysis = jest.fn();
const mockBuildWfaAnalysis = jest.fn();
const mockBuildSmartAcAnalysis = jest.fn();
const mockGetJakartaDateString = jest.fn(() => '2026-05-03');
const mockAttendanceCategoryModel = {};
const mockAttendanceStatusModel = {};
const mockLocationModel = {};
const mockUserModel = {};
jest.unstable_mockModule('../src/models/index.js', () => ({
  Attendance: { findAll: mockAttendanceFindAll },
  AttendanceCategory: mockAttendanceCategoryModel,
  AttendanceStatus: mockAttendanceStatusModel,
  Location: mockLocationModel,
  LocationEvent: { findAll: mockLocationEventFindAll },
  User: mockUserModel
}));

jest.unstable_mockModule('../src/controllers/analysis.controller.js', () => ({
  buildDisciplineAnalysis: mockBuildDisciplineAnalysis,
  buildWfaAnalysis: mockBuildWfaAnalysis,
  buildSmartAcAnalysis: mockBuildSmartAcAnalysis
}));

jest.unstable_mockModule('../src/utils/geofence.js', () => ({
  getJakartaDateString: mockGetJakartaDateString
}));

const { buildDashboardAnalytics } = await import('../src/utils/dashboardAnalytics.js');

describe('dashboard analytics helper contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('aggregates attendance metrics, geofence evidence, compact snapshots, and range-aware metadata', async () => {
    mockAttendanceFindAll.mockResolvedValueOnce([
      {
        attendance_date: '2026-04-01',
        user_id: 7,
        status: { attendance_status_name: 'Tepat Waktu' },
        attendance_category: { category_name: 'Work From Office' }
      },
      {
        attendance_date: '2026-04-02',
        user_id: 8,
        status: { attendance_status_name: 'Alpha' },
        attendance_category: { category_name: 'Work From Home' }
      },
      {
        attendance_date: '2026-04-03',
        user_id: 8,
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

    const result = await buildDashboardAnalytics({
      period: 'custom',
      from: '2026-04-01',
      to: '2026-04-03'
    });

    expect(mockAttendanceFindAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          attendance_date: {
            [Op.between]: ['2026-04-01', '2026-04-03']
          }
        },
        attributes: ['attendance_date', 'user_id'],
        include: [
          {
            model: mockAttendanceStatusModel,
            as: 'status',
            attributes: ['attendance_status_name']
          },
          {
            model: mockAttendanceCategoryModel,
            as: 'attendance_category',
            attributes: ['category_name']
          }
        ],
        order: [['attendance_date', 'ASC']]
      })
    );
    expect(mockLocationEventFindAll).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: ['user_id', 'event_type'],
        order: [['event_timestamp', 'ASC']]
      })
    );

    const disciplineWindow = mockBuildDisciplineAnalysis.mock.calls[0][0];
    const wfaWindow = mockBuildWfaAnalysis.mock.calls[0][0];
    const smartAcWindow = mockBuildSmartAcAnalysis.mock.calls[0][0];

    expect(disciplineWindow.startAt.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(disciplineWindow.endAt.toISOString()).toBe('2026-04-03T00:00:00.000Z');
    expect(wfaWindow.startAt.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(wfaWindow.endAt.toISOString()).toBe('2026-04-03T00:00:00.000Z');
    expect(smartAcWindow.startAt.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(smartAcWindow.endAt.toISOString()).toBe('2026-04-03T00:00:00.000Z');
    expect(result.meta).toEqual({
      generated_at: expect.any(String),
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
        geofence_evidence_context: { from: '2026-04-01', to: '2026-04-03' }
      },
      sources: ['Attendance', 'AttendanceCategory', 'AttendanceStatus', 'LocationEvent']
    });

    expect(result.executive_kpis).toEqual({
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
    });

    expect(result.historical_trend).toEqual({
      points: [
        { date: '2026-04-01', on_time: 1, late: 0, alpha: 0, present: 1, wfo: 1, wfh: 0, wfa: 0 },
        { date: '2026-04-02', on_time: 0, late: 0, alpha: 1, present: 0, wfo: 0, wfh: 1, wfa: 0 },
        { date: '2026-04-03', on_time: 0, late: 1, alpha: 0, present: 1, wfo: 0, wfh: 0, wfa: 1 }
      ]
    });

    expect(result.mode_mix).toEqual({
      totals: { wfo: 1, wfh: 1, wfa: 1 },
      percentages: { wfo: 33.33, wfh: 33.33, wfa: 33.33 }
    });

    expect(result).not.toHaveProperty('today_locations');

    expect(result.geofence_evidence_context).toEqual({
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
    });

    expect(result).not.toHaveProperty('map_context');

    expect(result.fuzzy_ahp_snapshot).toEqual({
      discipline: {
        status: 'ready',
        generated_at: expect.any(String),
        window: { from: '2026-04-01', to: '2026-04-03' },
        weights: {
          alpha_rate: 0.6,
          lateness_severity: 0.4
        },
        consistency: { CR: 0.021, threshold: 0.1, is_consistent: true },
        top_rank: {
          id: 7,
          name: 'Febri',
          score: 84,
          label: 'Tinggi'
        },
        distribution: {
          Tinggi: 1,
          Sedang: 1
        }
      },
      wfa: {
        status: 'ready',
        generated_at: expect.any(String),
        window: { from: '2026-04-01', to: '2026-04-03' },
        weights: {
          location_type: 0.55,
          distance_factor: 0.45
        },
        consistency: { CR: 0.018, threshold: 0.1, is_consistent: true },
        top_rank: {
          id: 31,
          name: 'Cafe Satu',
          score: 90,
          label: 'Sangat Tinggi'
        },
        distribution: {
          'Sangat Tinggi': 1,
          Tinggi: 1
        }
      },
      smart_ac: {
        status: 'ready',
        generated_at: expect.any(String),
        window: { from: '2026-04-01', to: '2026-04-03' },
        weights: {
          history: 0.4,
          context: 0.6
        },
        consistency: { CR: 0, threshold: 0.1, is_consistent: true },
        top_rank: {
          id: 8,
          name: 'Diana',
          score: 72,
          label: 'Tinggi'
        },
        distribution: {
          Tinggi: 1,
          Sedang: 1
        }
      }
    });

    expect(result.insights).toEqual({
      items: [
        {
          type: 'alpha_spike',
          title: 'Alpha rate elevated',
          message: 'Alpha reached 33.3% of attendance records in the selected window.',
          severity: 'high'
        }
      ]
    });
  });

  it('combines realistic WFA-dominant and no-office-today signals into dashboard insights', async () => {
    mockAttendanceFindAll.mockResolvedValueOnce([
      {
        attendance_date: '2026-04-01',
        user_id: 7,
        status: { attendance_status_name: 'Present' },
        attendance_category: { category_name: 'Work From Anywhere' }
      },
      {
        attendance_date: '2026-04-02',
        user_id: 8,
        status: { attendance_status_name: 'Present' },
        attendance_category: { category_name: 'Work From Anywhere' }
      },
      {
        attendance_date: '2026-04-03',
        user_id: 9,
        status: { attendance_status_name: 'Present' },
        attendance_category: { category_name: 'Work From Home' }
      }
    ]);

    mockLocationEventFindAll.mockResolvedValueOnce([]);
    mockBuildDisciplineAnalysis.mockResolvedValueOnce({
      ranking: [{ id: 7, name: 'Febri', score: 55, label: 'Sedang' }]
    });
    mockBuildWfaAnalysis.mockResolvedValueOnce({ ranking: [] });
    mockBuildSmartAcAnalysis.mockResolvedValueOnce({
      ranking: [{ id: 7, name: 'Febri', score: 40, label: 'Sedang' }]
    });
    const result = await buildDashboardAnalytics({
      period: 'custom',
      from: '2026-04-01',
      to: '2026-04-03'
    });

    expect(result.executive_kpis).toEqual({
      attendance_rate: 100,
      late_alpha_risk: 0,
      avg_discipline: 55,
      needs_attention: 1,
      raw_counts: {
        total_attendance_records: 3,
        total_present: 3,
        total_alpha: 0,
        total_late: 0,
        total_on_time: 3,
        total_wfo: 0,
        total_wfh: 1,
        total_wfa: 2,
        discipline_users_analyzed: 1
      }
    });

    expect(result.insights).toEqual({
      items: [
        {
          type: 'wfa_dominant',
          title: 'WFA is the dominant mode',
          message: 'WFA contributed 66.7% of recorded attendance modes.',
          severity: 'medium'
        },
        {
          type: 'discipline_drop',
          title: 'Discipline average needs attention',
          message: 'Average discipline score is 55.00 for the selected window.',
          severity: 'medium'
        }
      ]
    });
  });

  it('reports the default 30-day request separately from the executed historical and geofence windows', async () => {
    mockAttendanceFindAll.mockResolvedValueOnce([]);
    mockLocationEventFindAll.mockResolvedValueOnce([]);
    mockBuildDisciplineAnalysis.mockResolvedValueOnce({ ranking: [] });
    mockBuildWfaAnalysis.mockResolvedValueOnce({ ranking: [] });
    mockBuildSmartAcAnalysis.mockResolvedValueOnce({ ranking: [] });
    const result = await buildDashboardAnalytics();

    expect(result.meta.requested_window).toEqual({
      period: '30d',
      from: null,
      to: null
    });
    expect(result.meta.executed_window).toEqual({
      from: '2026-04-04',
      to: '2026-05-03'
    });
    expect(result.meta.section_windows).toEqual({
      executive_kpis: { from: '2026-04-04', to: '2026-05-03' },
      historical_trend: { from: '2026-04-04', to: '2026-05-03' },
      mode_mix: { from: '2026-04-04', to: '2026-05-03' },
      fuzzy_ahp_snapshot: { from: '2026-04-04', to: '2026-05-03' },
      geofence_evidence_context: { from: '2026-04-04', to: '2026-05-03' }
    });
    expect(result.fuzzy_ahp_snapshot).toEqual({
      discipline: {
        status: 'no_data',
        generated_at: expect.any(String),
        window: { from: '2026-04-04', to: '2026-05-03' },
        weights: {},
        consistency: null,
        top_rank: null,
        distribution: {}
      },
      wfa: {
        status: 'no_data',
        generated_at: expect.any(String),
        window: { from: '2026-04-04', to: '2026-05-03' },
        weights: {},
        consistency: null,
        top_rank: null,
        distribution: {}
      },
      smart_ac: {
        status: 'no_data',
        generated_at: expect.any(String),
        window: { from: '2026-04-04', to: '2026-05-03' },
        weights: {},
        consistency: null,
        top_rank: null,
        distribution: {}
      }
    });
    expect(result.geofence_evidence_context).toEqual({
      status: 'no_events',
      authority: 'context_only',
      final_attendance_authority: 'attendance_records',
      window: { from: '2026-04-04', to: '2026-05-03' },
      raw_counts: {
        total_events: 0,
        enter_events: 0,
        exit_events: 0,
        unique_users: 0
      }
    });
  });

  it('keeps early attendance present without inflating on-time metrics', async () => {
    mockAttendanceFindAll.mockResolvedValueOnce([
      {
        attendance_date: '2026-04-01',
        user_id: 7,
        status: { attendance_status_name: 'Early' },
        attendance_category: { category_name: 'Work From Office' }
      },
      {
        attendance_date: '2026-04-01',
        user_id: 8,
        status: { attendance_status_name: 'Lebih Awal' },
        attendance_category: { category_name: 'Work From Office' }
      }
    ]);
    mockLocationEventFindAll.mockResolvedValueOnce([]);
    mockBuildDisciplineAnalysis.mockResolvedValueOnce({ ranking: [] });
    mockBuildWfaAnalysis.mockResolvedValueOnce({ ranking: [] });
    mockBuildSmartAcAnalysis.mockResolvedValueOnce({ ranking: [] });
    const result = await buildDashboardAnalytics({
      period: 'custom',
      from: '2026-04-01',
      to: '2026-04-01'
    });

    expect(result.executive_kpis.raw_counts).toEqual({
      total_attendance_records: 2,
      total_present: 2,
      total_alpha: 0,
      total_late: 0,
      total_on_time: 0,
      total_wfo: 2,
      total_wfh: 0,
      total_wfa: 0,
      discipline_users_analyzed: 0
    });
    expect(result.historical_trend).toEqual({
      points: [{ date: '2026-04-01', on_time: 0, late: 0, alpha: 0, present: 2, wfo: 2, wfh: 0, wfa: 0 }]
    });
  });

  it('queries geofence evidence using Jakarta-day boundaries instead of UTC midnight', async () => {
    mockAttendanceFindAll.mockResolvedValueOnce([]);
    mockLocationEventFindAll.mockResolvedValueOnce([]);
    mockBuildDisciplineAnalysis.mockResolvedValueOnce({ ranking: [] });
    mockBuildWfaAnalysis.mockResolvedValueOnce({ ranking: [] });
    mockBuildSmartAcAnalysis.mockResolvedValueOnce({ ranking: [] });
    await buildDashboardAnalytics({
      period: 'custom',
      from: '2026-04-01',
      to: '2026-04-03'
    });

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
  });

  it('returns stable empty-state cards, zero-filled points, and contextual empty geofence evidence', async () => {
    mockAttendanceFindAll.mockResolvedValueOnce([]);
    mockLocationEventFindAll.mockResolvedValueOnce([]);
    mockBuildDisciplineAnalysis.mockResolvedValueOnce({ ranking: [] });
    mockBuildWfaAnalysis.mockResolvedValueOnce({ ranking: [] });
    mockBuildSmartAcAnalysis.mockResolvedValueOnce({ ranking: [] });
    const result = await buildDashboardAnalytics({
      period: 'custom',
      from: '2026-04-01',
      to: '2026-04-03'
    });

    expect(result.executive_kpis).toEqual({
      attendance_rate: 0,
      late_alpha_risk: 0,
      avg_discipline: null,
      needs_attention: 0,
      raw_counts: {
        total_attendance_records: 0,
        total_present: 0,
        total_alpha: 0,
        total_late: 0,
        total_on_time: 0,
        total_wfo: 0,
        total_wfh: 0,
        total_wfa: 0,
        discipline_users_analyzed: 0
      }
    });

    expect(result.historical_trend).toEqual({
      points: [
        { date: '2026-04-01', on_time: 0, late: 0, alpha: 0, present: 0, wfo: 0, wfh: 0, wfa: 0 },
        { date: '2026-04-02', on_time: 0, late: 0, alpha: 0, present: 0, wfo: 0, wfh: 0, wfa: 0 },
        { date: '2026-04-03', on_time: 0, late: 0, alpha: 0, present: 0, wfo: 0, wfh: 0, wfa: 0 }
      ]
    });

    expect(result.mode_mix).toEqual({
      totals: { wfo: 0, wfh: 0, wfa: 0 },
      percentages: { wfo: 0, wfh: 0, wfa: 0 }
    });

    expect(result).not.toHaveProperty('today_locations');

    expect(result.geofence_evidence_context).toEqual({
      status: 'no_events',
      authority: 'context_only',
      final_attendance_authority: 'attendance_records',
      window: { from: '2026-04-01', to: '2026-04-03' },
      raw_counts: {
        total_events: 0,
        enter_events: 0,
        exit_events: 0,
        unique_users: 0
      }
    });

    expect(result).not.toHaveProperty('map_context');

    expect(result.fuzzy_ahp_snapshot).toEqual({
      discipline: {
        status: 'no_data',
        generated_at: expect.any(String),
        window: { from: '2026-04-01', to: '2026-04-03' },
        weights: {},
        consistency: null,
        top_rank: null,
        distribution: {}
      },
      wfa: {
        status: 'no_data',
        generated_at: expect.any(String),
        window: { from: '2026-04-01', to: '2026-04-03' },
        weights: {},
        consistency: null,
        top_rank: null,
        distribution: {}
      },
      smart_ac: {
        status: 'no_data',
        generated_at: expect.any(String),
        window: { from: '2026-04-01', to: '2026-04-03' },
        weights: {},
        consistency: null,
        top_rank: null,
        distribution: {}
      }
    });

    expect(result.insights).toEqual({ items: [] });
  });
});
