export const ATTENDANCE_DAILY_TRUTH_FIELDS = Object.freeze(['user_id', 'attendance_date']);

export const ATTENDANCE_DAILY_TRUTH_CONSTRAINT_NAMES = Object.freeze(['uq_attendance_user_date']);

export const ATTENDANCE_ALREADY_CHECKED_IN_MESSAGE = 'Anda sudah melakukan check-in hari ini.';
export const ATTENDANCE_CONFLICT_MESSAGE = 'Terjadi konflik data kehadiran.';

export const matchesAttendanceDailyTruthFields = (fieldNames = []) => {
  const availableFields = new Set(fieldNames.filter(Boolean));
  return ATTENDANCE_DAILY_TRUTH_FIELDS.every((field) => availableFields.has(field));
};

export const matchesAttendanceDailyTruthConstraintName = (constraintName = '') => {
  if (typeof constraintName !== 'string') {
    return false;
  }

  const normalizedConstraintName = constraintName.trim().toLowerCase();
  const matchingConstraintName = ATTENDANCE_DAILY_TRUTH_CONSTRAINT_NAMES[0];
  const matchingPattern = new RegExp(
    `(?:^|[._-])${matchingConstraintName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[._-])`,
    'i'
  );

  return matchingPattern.test(normalizedConstraintName);
};

export const buildDuplicateSafeJobSummary = ({
  label,
  requested,
  skipped,
  created = null
}) => {
  if (typeof created === 'number') {
    return `Duplicate-safe ${label} insert completed. Requested: ${requested}, created: ${created}, skipped: ${skipped}.`;
  }

  return `Duplicate-safe ${label} insert completed. Requested: ${requested}, skipped: ${skipped}, created count unavailable because ignoreDuplicates was used.`;
};
