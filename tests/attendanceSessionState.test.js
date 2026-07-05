
import {
  STATUS_TODAY_SESSION_STATES,
  deriveStatusTodaySessionState
} from '../src/utils/attendanceSessionState.js';

describe('deriveStatusTodaySessionState', () => {
  it('returns active state when attendance exists without time_out', () => {
    const result = deriveStatusTodaySessionState({
      currentAttendance: {
        id_attendance: 77,
        time_in: new Date('2026-07-05T08:00:00+07:00'),
        time_out: null
      },
      canCheckIn: false
    });

    expect(result).toEqual({
      attendanceSessionState: STATUS_TODAY_SESSION_STATES.active,
      activeAttendanceId: 77
    });
  });

  it('returns completed state when attendance exists with time_out', () => {
    const result = deriveStatusTodaySessionState({
      currentAttendance: {
        id_attendance: 78,
        time_in: new Date('2026-07-05T08:00:00+07:00'),
        time_out: new Date('2026-07-05T17:00:00+07:00')
      },
      canCheckIn: false
    });

    expect(result).toEqual({
      attendanceSessionState: STATUS_TODAY_SESSION_STATES.completed,
      activeAttendanceId: 78
    });
  });

  it('returns not_started when no attendance exists and check-in is available', () => {
    const result = deriveStatusTodaySessionState({
      currentAttendance: null,
      canCheckIn: true
    });

    expect(result).toEqual({
      attendanceSessionState: STATUS_TODAY_SESSION_STATES.not_started,
      activeAttendanceId: null
    });
  });

  it('returns unavailable when no attendance exists and check-in is blocked', () => {
    const result = deriveStatusTodaySessionState({
      currentAttendance: null,
      canCheckIn: false
    });

    expect(result).toEqual({
      attendanceSessionState: STATUS_TODAY_SESSION_STATES.unavailable,
      activeAttendanceId: null
    });
  });
});
