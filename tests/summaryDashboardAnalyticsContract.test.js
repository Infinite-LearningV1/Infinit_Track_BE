import { jest } from '@jest/globals';

const mockBuildDashboardAnalytics = jest.fn();

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: {}
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  Attendance: {},
  User: {},
  Role: {},
  Location: {},
  AttendanceCategory: {},
  AttendanceStatus: {},
  Settings: {}
}));

jest.unstable_mockModule('../src/utils/workHourFormatter.js', () => ({
  formatWorkHour: jest.fn(),
  calculateWorkHour: jest.fn(),
  formatTimeOnly: jest.fn()
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() }
}));

jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
  default: {}
}));

jest.unstable_mockModule('../src/utils/dashboardAnalytics.js', () => ({
  buildDashboardAnalytics: mockBuildDashboardAnalytics
}));

const buildRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis()
});

const responseShell = {
  meta: {
    generated_at: null,
    timezone: 'Asia/Jakarta',
    requested_window: {
      period: 'custom',
      from: '2026-04-01',
      to: '2026-04-15'
    },
    section_windows: {
      executive_kpis: { from: '2026-04-01', to: '2026-04-15' },
      historical_trend: { from: '2026-04-01', to: '2026-04-15' },
      mode_mix: { from: '2026-04-01', to: '2026-04-15' },
      fuzzy_ahp_snapshot: { from: '2026-04-01', to: '2026-04-15' },
      today_locations: { mode: 'jakarta_today' }
    },
    sources: ['Attendance', 'AttendanceCategory', 'AttendanceStatus', 'Location', 'User']
  },
  executive_kpis: {
    total_attendance_records: 0,
    total_present: 0,
    total_alpha: 0,
    total_wfo: 0,
    total_wfh: 0,
    total_wfa: 0,
    discipline_average: null,
    discipline_users_analyzed: 0
  },
  historical_trend: {
    points: []
  },
  mode_mix: {
    totals: {
      wfo: 0,
      wfh: 0,
      wfa: 0
    },
    percentages: {
      wfo: 0,
      wfh: 0,
      wfa: 0
    }
  },
  today_locations: {
    date: '2026-05-03',
    timezone: 'Asia/Jakarta',
    total_users: 0,
    locations: []
  },
  fuzzy_ahp_snapshot: {
    discipline: {
      generated_at: null,
      window: { from: '2026-04-01', to: '2026-04-15' },
      weights: {},
      consistency: null,
      top_rank: null,
      distribution: {}
    },
    wfa: {
      generated_at: null,
      window: { from: '2026-04-01', to: '2026-04-15' },
      weights: {},
      consistency: null,
      top_rank: null,
      distribution: {}
    },
    smart_ac: {
      generated_at: null,
      window: { from: '2026-04-01', to: '2026-04-15' },
      weights: {},
      consistency: null,
      top_rank: null,
      distribution: {}
    }
  },
  insights: {
    items: []
  }
};

describe('summary dashboard analytics controller contract', () => {
  beforeEach(() => {
    mockBuildDashboardAnalytics.mockReset();
  });

  it('delegates validated query values to the dashboard analytics helper', async () => {
    mockBuildDashboardAnalytics.mockResolvedValueOnce(responseShell);

    const { getDashboardAnalytics } = await import('../src/controllers/summary.controller.js');
    const req = {
      query: {
        period: 'custom',
        from: '2026-04-01',
        to: '2026-04-15'
      }
    };
    const res = buildRes();
    const next = jest.fn();

    await getDashboardAnalytics(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockBuildDashboardAnalytics).toHaveBeenCalledWith({
      period: 'custom',
      from: '2026-04-01',
      to: '2026-04-15'
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: responseShell,
      message: 'Dashboard analytics retrieved successfully'
    });
  });

  it('uses controller defaults without duplicating validation', async () => {
    mockBuildDashboardAnalytics.mockResolvedValueOnce({
      ...responseShell,
      meta: {
        generated_at: null,
        timezone: 'Asia/Jakarta',
        requested_window: { period: '30d', from: null, to: null },
        section_windows: {
          executive_kpis: { from: '2026-04-04', to: '2026-05-03' },
          historical_trend: { from: '2026-04-04', to: '2026-05-03' },
          mode_mix: { from: '2026-04-04', to: '2026-05-03' },
          fuzzy_ahp_snapshot: { from: '2026-04-04', to: '2026-05-03' },
          today_locations: { mode: 'jakarta_today' }
        },
        sources: ['Attendance', 'AttendanceCategory', 'AttendanceStatus', 'Location', 'User']
      }
    });

    const { getDashboardAnalytics } = await import('../src/controllers/summary.controller.js');
    const req = { query: {} };
    const res = buildRes();
    const next = jest.fn();

    await getDashboardAnalytics(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockBuildDashboardAnalytics).toHaveBeenCalledWith({
      period: '30d',
      from: null,
      to: null
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('passes helper failures to the error handler', async () => {
    const error = new Error('helper failed');
    mockBuildDashboardAnalytics.mockRejectedValueOnce(error);

    const { getDashboardAnalytics } = await import('../src/controllers/summary.controller.js');
    const req = { query: { period: '7d' } };
    const res = buildRes();
    const next = jest.fn();

    await getDashboardAnalytics(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
