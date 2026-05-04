import { Op } from 'sequelize';
import { jest } from '@jest/globals';

const mockGetJakartaDateString = jest.fn(() => '2026-05-03');
const mockAttendanceFindAll = jest.fn();
const mockBuildDisciplineAnalysis = jest.fn();
const mockBuildWfaAnalysis = jest.fn();
const mockBuildSmartAcAnalysis = jest.fn();
const mockBuildTodayLocationsSnapshot = jest.fn();

jest.unstable_mockModule('../src/utils/geofence.js', () => ({
  getJakartaDateString: mockGetJakartaDateString
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  Attendance: { findAll: mockAttendanceFindAll },
  AttendanceCategory: {},
  AttendanceStatus: {}
}));

jest.unstable_mockModule('../src/controllers/analysis.controller.js', () => ({
  buildDisciplineAnalysis: mockBuildDisciplineAnalysis,
  buildWfaAnalysis: mockBuildWfaAnalysis,
  buildSmartAcAnalysis: mockBuildSmartAcAnalysis
}));

jest.unstable_mockModule('../src/utils/todayLocationsSnapshot.js', () => ({
  buildTodayLocationsSnapshot: mockBuildTodayLocationsSnapshot
}));

const { buildDashboardAnalytics } = await import('../src/utils/dashboardAnalytics.js');

describe('dashboard analytics helper contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('aggregates attendance metrics, compact snapshots, and keeps today locations on Jakarta today', async () => {
    mockAttendanceFindAll.mockResolvedValueOnce([
      {
        attendance_date: '2026-04-01',
        user_id: 7,
        status: { attendance_status_name: 'Present' },
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
        user_id: 7,
        status: { attendance_status_name: 'Present' },
        attendance_category: { category_name: 'Work From Anywhere' }
      }
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
          check_in_time: '08:20',
          latitude: -0.9001,
          longitude: 119.8802,
          photo: null
        }
      ]
    });

    const result = await buildDashboardAnalytics({
      period: 'custom',
      from: '2026-04-01',
      to: '2026-04-03'
    });

    expect(mockGetJakartaDateString).toHaveBeenCalledTimes(1);
    expect(mockAttendanceFindAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          attendance_date: {
            [Op.between]: ['2026-04-01', '2026-04-03']
          }
        },
        attributes: ['attendance_date', 'user_id', 'status_id', 'category_id'],
        order: [
          ['attendance_date', 'ASC'],
          ['id_attendance', 'ASC']
        ]
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
    expect(mockBuildTodayLocationsSnapshot).toHaveBeenCalledWith();

    expect(result.meta).toEqual({
      generated_at: null,
      timezone: 'Asia/Jakarta',
      requested_window: {
        period: 'custom',
        from: '2026-04-01',
        to: '2026-04-03'
      },
      section_windows: {
        executive_kpis: { from: '2026-04-01', to: '2026-04-03' },
        historical_trend: { from: '2026-04-01', to: '2026-04-03' },
        mode_mix: { from: '2026-04-01', to: '2026-04-03' },
        fuzzy_ahp_snapshot: { from: '2026-04-01', to: '2026-04-03' },
        today_locations: { mode: 'jakarta_today' }
      },
      sources: ['Attendance', 'AttendanceCategory', 'AttendanceStatus', 'Location', 'User']
    });

    expect(result.executive_kpis).toEqual({
      total_attendance_records: 3,
      total_present: 2,
      total_alpha: 1,
      total_wfo: 1,
      total_wfh: 1,
      total_wfa: 1,
      discipline_average: 82,
      discipline_users_analyzed: 2
    });

    expect(result.historical_trend).toEqual({
      points: [
        { date: '2026-04-01', present: 1, alpha: 0, wfo: 1, wfh: 0, wfa: 0 },
        { date: '2026-04-02', present: 0, alpha: 1, wfo: 0, wfh: 1, wfa: 0 },
        { date: '2026-04-03', present: 1, alpha: 0, wfo: 0, wfh: 0, wfa: 1 }
      ]
    });

    expect(result.mode_mix.totals).toEqual({ wfo: 1, wfh: 1, wfa: 1 });
    expect(result.mode_mix.percentages.wfo).toBeCloseTo(33.3333333333);
    expect(result.mode_mix.percentages.wfh).toBeCloseTo(33.3333333333);
    expect(result.mode_mix.percentages.wfa).toBeCloseTo(33.3333333333);

    expect(result.today_locations).toEqual({
      date: '2026-05-03',
      timezone: 'Asia/Jakarta',
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
          check_in_time: '08:20',
          latitude: -0.9001,
          longitude: 119.8802,
          photo: null
        }
      ]
    });

    expect(result.fuzzy_ahp_snapshot).toEqual({
      discipline: {
        generated_at: null,
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
        generated_at: null,
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
        generated_at: null,
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

    mockBuildDisciplineAnalysis.mockResolvedValueOnce({
      ranking: [{ id: 7, name: 'Febri', score: 55, label: 'Sedang' }]
    });
    mockBuildWfaAnalysis.mockResolvedValueOnce({ ranking: [] });
    mockBuildSmartAcAnalysis.mockResolvedValueOnce({
      ranking: [{ id: 7, name: 'Febri', score: 40, label: 'Sedang' }]
    });
    mockBuildTodayLocationsSnapshot.mockResolvedValueOnce({
      date: '2026-05-03',
      timezone: 'Asia/Jakarta',
      total_users: 2,
      locations: [
        {
          user_id: 7,
          full_name: 'Febri',
          status: 'WFH',
          check_in_time: '08:15',
          latitude: -0.8917,
          longitude: 119.8707,
          photo: null
        },
        {
          user_id: 8,
          full_name: 'Diana',
          status: 'WFA',
          check_in_time: '08:20',
          latitude: -0.9001,
          longitude: 119.8802,
          photo: null
        }
      ]
    });

    const result = await buildDashboardAnalytics({
      period: 'custom',
      from: '2026-04-01',
      to: '2026-04-03'
    });

    expect(result.executive_kpis).toEqual({
      total_attendance_records: 3,
      total_present: 3,
      total_alpha: 0,
      total_wfo: 0,
      total_wfh: 1,
      total_wfa: 2,
      discipline_average: 55,
      discipline_users_analyzed: 1
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
        },
        {
          type: 'location_coverage_low',
          title: 'No office-based check-ins today',
          message: 'Today location snapshot only shows WFH or WFA check-ins.',
          severity: 'low'
        }
      ]
    });
  });

  it('reports the default 30-day request separately from the executed historical window', async () => {
    mockAttendanceFindAll.mockResolvedValueOnce([]);
    mockBuildDisciplineAnalysis.mockResolvedValueOnce({ ranking: [] });
    mockBuildWfaAnalysis.mockResolvedValueOnce({ ranking: [] });
    mockBuildSmartAcAnalysis.mockResolvedValueOnce({ ranking: [] });
    mockBuildTodayLocationsSnapshot.mockResolvedValueOnce({
      date: '2026-05-03',
      timezone: 'Asia/Jakarta',
      total_users: 0,
      locations: []
    });

    const result = await buildDashboardAnalytics();

    expect(result.meta.requested_window).toEqual({
      period: '30d',
      from: null,
      to: null
    });
    expect(result.meta.section_windows).toEqual({
      executive_kpis: { from: '2026-04-04', to: '2026-05-03' },
      historical_trend: { from: '2026-04-04', to: '2026-05-03' },
      mode_mix: { from: '2026-04-04', to: '2026-05-03' },
      fuzzy_ahp_snapshot: { from: '2026-04-04', to: '2026-05-03' },
      today_locations: { mode: 'jakarta_today' }
    });
    expect(result.fuzzy_ahp_snapshot).toEqual({
      discipline: {
        generated_at: null,
        window: { from: '2026-04-04', to: '2026-05-03' },
        weights: {},
        consistency: null,
        top_rank: null,
        distribution: {}
      },
      wfa: {
        generated_at: null,
        window: { from: '2026-04-04', to: '2026-05-03' },
        weights: {},
        consistency: null,
        top_rank: null,
        distribution: {}
      },
      smart_ac: {
        generated_at: null,
        window: { from: '2026-04-04', to: '2026-05-03' },
        weights: {},
        consistency: null,
        top_rank: null,
        distribution: {}
      }
    });
  });

  it('returns stable empty-state cards and zero-filled daily points', async () => {
    mockAttendanceFindAll.mockResolvedValueOnce([]);
    mockBuildDisciplineAnalysis.mockResolvedValueOnce({ ranking: [] });
    mockBuildWfaAnalysis.mockResolvedValueOnce({ ranking: [] });
    mockBuildSmartAcAnalysis.mockResolvedValueOnce({ ranking: [] });
    mockBuildTodayLocationsSnapshot.mockResolvedValueOnce({
      date: '2026-05-03',
      timezone: 'Asia/Jakarta',
      total_users: 0,
      locations: []
    });

    const result = await buildDashboardAnalytics({
      period: 'custom',
      from: '2026-04-01',
      to: '2026-04-03'
    });

    expect(result.executive_kpis).toEqual({
      total_attendance_records: 0,
      total_present: 0,
      total_alpha: 0,
      total_wfo: 0,
      total_wfh: 0,
      total_wfa: 0,
      discipline_average: null,
      discipline_users_analyzed: 0
    });

    expect(result.historical_trend).toEqual({
      points: [
        { date: '2026-04-01', present: 0, alpha: 0, wfo: 0, wfh: 0, wfa: 0 },
        { date: '2026-04-02', present: 0, alpha: 0, wfo: 0, wfh: 0, wfa: 0 },
        { date: '2026-04-03', present: 0, alpha: 0, wfo: 0, wfh: 0, wfa: 0 }
      ]
    });

    expect(result.mode_mix).toEqual({
      totals: { wfo: 0, wfh: 0, wfa: 0 },
      percentages: { wfo: 0, wfh: 0, wfa: 0 }
    });

    expect(result.today_locations).toEqual({
      date: '2026-05-03',
      timezone: 'Asia/Jakarta',
      total_users: 0,
      locations: []
    });

    expect(result.fuzzy_ahp_snapshot).toEqual({
      discipline: {
        generated_at: null,
        window: { from: '2026-04-01', to: '2026-04-03' },
        weights: {},
        consistency: null,
        top_rank: null,
        distribution: {}
      },
      wfa: {
        generated_at: null,
        window: { from: '2026-04-01', to: '2026-04-03' },
        weights: {},
        consistency: null,
        top_rank: null,
        distribution: {}
      },
      smart_ac: {
        generated_at: null,
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
