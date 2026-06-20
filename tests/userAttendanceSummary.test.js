import { jest } from '@jest/globals';

const mockUserFindAll = jest.fn();
const mockDatabaseQuery = jest.fn();

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: { query: mockDatabaseQuery }
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  User: { findAll: mockUserFindAll },
  Role: {},
  Division: {}
}));

const {
  countExpectedWorkingDays,
  summarizeAttendanceRecords,
  buildUserAttendanceSummary
} = await import('../src/utils/userAttendanceSummary.js');

describe('userAttendanceSummary utility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDatabaseQuery.mockReset();
  });

  it('counts Jakarta weekdays for bounded date windows', () => {
    expect(
      countExpectedWorkingDays({
        startDate: '2026-05-04',
        endDate: '2026-05-10'
      })
    ).toBe(5);

    expect(
      countExpectedWorkingDays({
        startDate: '2026-05-01',
        endDate: '2026-05-31'
      })
    ).toBe(21);

    expect(
      countExpectedWorkingDays({
        startDate: '2026-01-01',
        endDate: '2026-12-31'
      })
    ).toBe(261);
  });

  it('summarizes one user into one row with explicit zeroes, latest-row selection, and valid attendance excluding early days', () => {
    const summary = summarizeAttendanceRecords({
      user: {
        id_users: 101,
        full_name: 'Rina',
        role: { role_name: 'User' },
        division: null
      },
      attendanceRows: [
        {
          attendance_date: '2026-05-09',
          time_in: '2026-05-09T09:00:00.000Z',
          status: { attendance_status_name: 'tepat waktu' },
          attendance_category: { category_name: 'WFO' }
        },
        {
          attendance_date: '2026-05-10',
          time_in: '2026-05-10T01:00:00.000Z',
          status: { attendance_status_name: 'Terlambat' },
          attendance_category: { category_name: 'Work From Home' }
        },
        {
          attendance_date: '2026-05-08',
          time_in: '2026-05-08T08:00:00.000Z',
          status: { attendance_status_name: 'Lebih Awal' },
          attendance_category: { category_name: 'work from anywhere' }
        },
        {
          attendance_date: '2026-05-07',
          time_in: '2026-05-07T08:00:00.000Z',
          status: { attendance_status_name: 'Alpha' },
          attendance_category: { category_name: 'WFO' }
        }
      ],
      expectedWorkingDays: 5
    });

    expect(summary).toEqual({
      user_id: 101,
      full_name: 'Rina',
      role_name: 'User',
      division: null,
      expected_working_days: 5,
      on_time_days: 1,
      late_days: 1,
      early_days: 1,
      alpha_days: 1,
      wfo_days: 2,
      wfh_days: 1,
      wfa_days: 1,
      valid_attendance_days: 2,
      attendance_coverage_label: '2/5',
      latest_attendance_status: 'Terlambat',
      latest_attendance_date: '2026-05-10',
      summary_note: 'Partial'
    });
  });

  it('builds per-user summaries over a bounded window with expected-day coverage semantics', async () => {
    mockUserFindAll.mockResolvedValueOnce([
      {
        id_users: 1,
        full_name: 'Ayu',
        role: { role_name: 'Admin' },
        division: { division_name: 'Ops' }
      },
      {
        id_users: 2,
        full_name: 'Bima',
        role: null,
        division: null
      }
    ]);

    mockDatabaseQuery.mockResolvedValueOnce([
      {
        user_id: 1,
        on_time_days: '1',
        late_days: '1',
        early_days: '0',
        alpha_days: '0',
        wfo_days: '1',
        wfh_days: '1',
        wfa_days: '0',
        latest_attendance_status: 'late',
        latest_attendance_date: '2026-05-06'
      }
    ]);

    const rows = await buildUserAttendanceSummary({
      startDate: '2026-05-01',
      endDate: '2026-05-31'
    });

    expect(rows).toEqual([
      {
        user_id: 1,
        full_name: 'Ayu',
        role_name: 'Admin',
        division: 'Ops',
        expected_working_days: 21,
        on_time_days: 1,
        late_days: 1,
        early_days: 0,
        alpha_days: 0,
        wfo_days: 1,
        wfh_days: 1,
        wfa_days: 0,
        valid_attendance_days: 2,
        attendance_coverage_label: '2/21',
        latest_attendance_status: 'late',
        latest_attendance_date: '2026-05-06',
        summary_note: 'Partial'
      },
      {
        user_id: 2,
        full_name: 'Bima',
        role_name: null,
        division: null,
        expected_working_days: 21,
        on_time_days: 0,
        late_days: 0,
        early_days: 0,
        alpha_days: 0,
        wfo_days: 0,
        wfh_days: 0,
        wfa_days: 0,
        valid_attendance_days: 0,
        attendance_coverage_label: '0/21',
        latest_attendance_status: null,
        latest_attendance_date: null,
        summary_note: 'Partial'
      }
    ]);
  });
});
