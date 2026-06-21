import {
  ATTENDANCE_ALREADY_CHECKED_IN_MESSAGE,
  matchesAttendanceDailyTruthFields
} from './attendanceDuplicateContract.js';

export const isAttendanceDuplicateConstraintError = (error) => {
  if (!error || error.name !== 'SequelizeUniqueConstraintError') {
    return false;
  }

  const fields = Object.keys(error.fields || {});
  const errorPaths = (error.errors || []).map((item) => item.path);
  return matchesAttendanceDailyTruthFields([...fields, ...errorPaths]);
};

export const createAttendanceConflictError = (
  message = ATTENDANCE_ALREADY_CHECKED_IN_MESSAGE
) => {
  const error = new Error(message);
  error.status = 409;
  return error;
};
