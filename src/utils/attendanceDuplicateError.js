import {
  matchesAttendanceDailyTruthFields,
  matchesAttendanceDailyTruthConstraintName
} from './attendanceDuplicateContract.js';

const extractConstraintName = (error) => {
  const parentSqlMessage = error?.parent?.sqlMessage;
  if (typeof parentSqlMessage === 'string') {
    const match = parentSqlMessage.match(/for key '([^']+)'/i);
    if (match) {
      return match[1];
    }
  }

  return error?.parent?.constraint || error?.parent?.index || error?.parent?.key || '';
};

const getDuplicateFieldNames = (error) => {
  const fieldNames = [
    ...Object.keys(error?.fields || {}),
    ...(error?.errors || []).map((item) => item?.path).filter(Boolean)
  ];

  return fieldNames;
};

export const isAttendanceDuplicateConstraintError = (error) => {
  if (!error || error.name !== 'SequelizeUniqueConstraintError') {
    return false;
  }

  const fieldNames = getDuplicateFieldNames(error);
  if (matchesAttendanceDailyTruthFields(fieldNames)) {
    return true;
  }

  return matchesAttendanceDailyTruthConstraintName(extractConstraintName(error));
};

const DEFAULT_ATTENDANCE_CONFLICT_MESSAGE = 'Terjadi konflik data kehadiran.';

export const createAttendanceConflictError = (
  message = DEFAULT_ATTENDANCE_CONFLICT_MESSAGE
) => {
  const error = new Error(message);
  error.status = 409;
  return error;
};
