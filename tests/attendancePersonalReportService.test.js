import { jest } from '@jest/globals';

const mockUserFindByPk = jest.fn();
const mockAttendanceFindAll = jest.fn();

jest.unstable_mockModule('../src/models/index.js', () => ({
  Attendance: { findAll: mockAttendanceFindAll },
  AttendanceCategory: {},
  AttendanceStatus: {},
  Location: {},
  Position: {},
  Role: {},
  User: { findByPk: mockUserFindByPk }
}));

jest.unstable_mockModule('../src/utils/workHourFormatter.js', () => ({
  calculateWorkHour: jest.fn(() => 8),
  formatTimeOnly: jest.fn((value) => {
    if (!value) return null;
    const date = new Date(value);
    return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
  }),
  formatWorkHour: jest.fn((value) => {
    if (value == null || value <= 0) return '00:00';
    const hours = Math.floor(value);
    const minutes = Math.round((value - hours) * 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  })
}));

const { buildPersonalAttendanceReportPayload, buildPersonalAttendanceReportPeriod } = await import(
  '../src/services/attendanceReport.service.js'
);

describe('personal attendance report service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindByPk.mockResolvedValue({
      id_users: 42,
      full_name: 'Febri User',
      nip_nim: 'NIP-42',
      role: { role_name: 'User' },
      position: { position_name: 'Engineer' }
    });
    mockAttendanceFindAll.mockResolvedValue([]);
  });

  it('defaults to the current monthly period without UTC date drift', () => {
    const period = buildPersonalAttendanceReportPeriod({}, new Date('2026-07-07T00:30:00+07:00'));

    expect(period).toEqual(
      expect.objectContaining({
        type: 'monthly',
        label: 'This Month',
        start_date: '2026-07-01',
        end_date: '2026-07-31',
        timezone: 'Asia/Jakarta'
      })
    );
  });

  it('rejects invalid custom period before querying attendance', async () => {
    await expect(
      buildPersonalAttendanceReportPayload({
        userId: 42,
        query: { period: 'custom', start_date: 'bad-date', end_date: '2026-07-31' }
      })
    ).rejects.toMatchObject({ code: 'E_VALIDATION', statusCode: 400 });

    expect(mockAttendanceFindAll).not.toHaveBeenCalled();
  });

  it('scopes attendance rows to the authenticated user id and not query user_id', async () => {
    await buildPersonalAttendanceReportPayload({
      userId: 42,
      query: { period: 'monthly', user_id: 999 },
      now: new Date('2026-07-07T00:30:00+07:00')
    });

    expect(mockUserFindByPk).toHaveBeenCalledWith(42, expect.any(Object));
    expect(mockAttendanceFindAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 42,
          attendance_date: expect.any(Object)
        })
      })
    );
    expect(JSON.stringify(mockAttendanceFindAll.mock.calls[0][0].where)).not.toContain('999');
  });

  it('builds empty-period payload without fabricating attendance rate', async () => {
    const payload = await buildPersonalAttendanceReportPayload({
      userId: 42,
      query: { period: 'monthly' },
      now: new Date('2026-07-07T00:30:00+07:00')
    });

    expect(payload.empty_state).toEqual({
      is_empty: true,
      message: 'No attendance records are available for this period.'
    });
    expect(payload.summary.attendance_rate_percent).toBeNull();
    expect(payload.summary.attendance_rate_note).toContain('Unavailable');
  });

  it('keeps alpha rows from rendering misleading time range or work hours', async () => {
    mockAttendanceFindAll.mockResolvedValueOnce([
      {
        id_attendance: 10,
        user_id: 42,
        category_id: 1,
        status_id: 3,
        attendance_date: '2026-07-02',
        time_in: new Date('2026-07-02T00:00:00Z'),
        time_out: new Date('2026-07-03T00:00:00Z'),
        work_hour: 24,
        notes: 'Alpha',
        attendance_category: { category_name: 'Work From Office' },
        status: { attendance_status_name: 'alpha' },
        location: null
      }
    ]);

    const payload = await buildPersonalAttendanceReportPayload({
      userId: 42,
      query: { period: 'monthly' },
      now: new Date('2026-07-07T00:30:00+07:00')
    });

    expect(payload.summary.alpha).toBe(1);
    expect(payload.summary.total_work_hours).toBe(0);
    expect(payload.timeline[0]).toEqual(
      expect.objectContaining({
        status_key: 'alpha',
        time_range: '--:-- - --:--',
        work_hour: null,
        work_hour_raw: null
      })
    );
  });

  it('marks WFH mode distribution as Needs Verification for INF-164', async () => {
    mockAttendanceFindAll.mockResolvedValueOnce([
      {
        id_attendance: 11,
        user_id: 42,
        category_id: 2,
        status_id: 1,
        attendance_date: '2026-07-03',
        time_in: new Date('2026-07-03T08:00:00Z'),
        time_out: new Date('2026-07-03T17:00:00Z'),
        work_hour: 9,
        notes: '',
        attendance_category: { category_name: 'Work From Home' },
        status: { attendance_status_name: 'ontime' },
        location: { description: 'Home' }
      }
    ]);

    const payload = await buildPersonalAttendanceReportPayload({
      userId: 42,
      query: { period: 'monthly' },
      now: new Date('2026-07-07T00:30:00+07:00')
    });

    expect(payload.mode_distribution.wfh).toEqual(
      expect.objectContaining({
        count: 1,
        included: false,
        note: expect.stringContaining('Needs Verification')
      })
    );
  });
});
