export const STATUS_TODAY_SESSION_STATES = Object.freeze({
  not_started: Object.freeze({
    id: 1,
    key: 'not_started',
    label: 'Not Started'
  }),
  active: Object.freeze({
    id: 2,
    key: 'active',
    label: 'Active Session'
  }),
  completed: Object.freeze({
    id: 3,
    key: 'completed',
    label: 'Completed Today'
  }),
  unavailable: Object.freeze({
    id: 4,
    key: 'unavailable',
    label: 'Unavailable'
  })
});

export function deriveStatusTodaySessionState({ currentAttendance, canCheckIn }) {
  if (currentAttendance) {
    const isCompleted = Boolean(currentAttendance.time_out);
    const stateKey = isCompleted ? 'completed' : 'active';

    return {
      stateKey,
      attendanceSessionState: STATUS_TODAY_SESSION_STATES[stateKey],
      activeAttendanceId: isCompleted ? null : (currentAttendance.id_attendance ?? null)
    };
  }

  const stateKey = canCheckIn ? 'not_started' : 'unavailable';

  return {
    stateKey,
    attendanceSessionState: STATUS_TODAY_SESSION_STATES[stateKey],
    activeAttendanceId: null
  };
}

export function mapAttendanceSessionStateRow(row) {
  if (!row) return null;

  return {
    id: row.id_attendance_session_state,
    key: row.state_key,
    label: row.state_label
  };
}

export async function resolveAttendanceSessionState({ AttendanceSessionStateModel, stateKey }) {
  const fallbackState = STATUS_TODAY_SESSION_STATES[stateKey] ?? STATUS_TODAY_SESSION_STATES.unavailable;

  if (!AttendanceSessionStateModel?.findOne) {
    return fallbackState;
  }

  try {
    const stateRow = await AttendanceSessionStateModel.findOne({
      where: {
        state_key: stateKey,
        is_active: true
      }
    });

    return mapAttendanceSessionStateRow(stateRow) ?? fallbackState;
  } catch (_error) {
    return fallbackState;
  }
}
