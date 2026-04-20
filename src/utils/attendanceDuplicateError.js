export const isAttendanceDuplicateConstraintError = (error) => {
  if (!error || error.name !== 'SequelizeUniqueConstraintError') {
    return false;
  }

  const fields = Object.keys(error.fields || {});
  const errorPaths = (error.errors || []).map((item) => item.path);
  const combined = new Set([...fields, ...errorPaths]);

  return combined.has('user_id') && combined.has('attendance_date');
};

export const createAttendanceConflictError = (
  message = 'Attendance untuk user dan tanggal tersebut sudah ada.'
) => {
  const error = new Error(message);
  error.status = 409;
  return error;
};
