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

    return {
      attendanceSessionState: isCompleted
        ? STATUS_TODAY_SESSION_STATES.completed
        : STATUS_TODAY_SESSION_STATES.active,
      activeAttendanceId: isCompleted ? null : (currentAttendance.id_attendance ?? null)
    };
  }

  return {
    attendanceSessionState: canCheckIn
      ? STATUS_TODAY_SESSION_STATES.not_started
      : STATUS_TODAY_SESSION_STATES.unavailable,
    activeAttendanceId: null
  };
}
