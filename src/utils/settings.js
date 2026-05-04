import { Op } from 'sequelize';

import { Settings } from '../models/index.js';

export const OPERATIONAL_SETTING_KEYS = {
  geofenceRadiusDefaultM: 'attendance.geofence.radius_default_m',
  autoCheckoutIdleMin: 'attendance.auto_checkout.idle_min',
  autoCheckoutTBufferMin: 'attendance.auto_checkout.tbuffer_min',
  lateCheckoutToleranceMin: 'attendance.auto_checkout.late_tolerance_min',
  defaultShiftEnd: 'checkout.fallback_time'
};

export const OPERATIONAL_SETTING_DEFAULTS = {
  geofenceRadiusDefaultM: 100,
  autoCheckoutIdleMin: 10,
  autoCheckoutTBufferMin: 30,
  lateCheckoutToleranceMin: 15,
  defaultShiftEnd: '17:00:00'
};

export const OPERATIONAL_SETTING_FIELDS = Object.freeze(Object.keys(OPERATIONAL_SETTING_KEYS));

export const OPERATIONAL_SETTING_FIELDS_BY_DB_KEY = Object.freeze(
  Object.fromEntries(
    Object.entries(OPERATIONAL_SETTING_KEYS).map(([field, settingKey]) => [settingKey, field])
  )
);

export const OPERATIONAL_SETTING_INTEGER_FIELDS = Object.freeze([
  'geofenceRadiusDefaultM',
  'autoCheckoutIdleMin',
  'autoCheckoutTBufferMin',
  'lateCheckoutToleranceMin'
]);

export const OPERATIONAL_SETTING_TIME_FIELDS = Object.freeze(['defaultShiftEnd']);

export const isOperationalSettingField = (field) => OPERATIONAL_SETTING_FIELDS.includes(field);

export const normalizeOperationalSettingTime = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const withSecondsMatch = value.match(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/);
  if (withSecondsMatch) {
    return value;
  }

  const withoutSecondsMatch = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (withoutSecondsMatch) {
    return `${value}:00`;
  }

  return null;
};

export const normalizeOperationalSettingValue = (field, value) => {
  if (OPERATIONAL_SETTING_INTEGER_FIELDS.includes(field)) {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== ''
          ? Number(value)
          : Number.NaN;

    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  if (OPERATIONAL_SETTING_TIME_FIELDS.includes(field)) {
    return normalizeOperationalSettingTime(value);
  }

  return null;
};

export const serializeOperationalSettingValue = (field, value) => {
  const normalizedValue = normalizeOperationalSettingValue(field, value);
  return normalizedValue === null ? null : String(normalizedValue);
};

export const normalizeOperationalSettings = (settings = {}) => {
  return OPERATIONAL_SETTING_FIELDS.reduce((normalizedSettings, field) => {
    const normalizedValue = normalizeOperationalSettingValue(field, settings[field]);

    normalizedSettings[field] = normalizedValue ?? OPERATIONAL_SETTING_DEFAULTS[field];
    return normalizedSettings;
  }, {});
};

export const getOperationalSettingsIntegrityIssues = (settings = {}) => {
  return OPERATIONAL_SETTING_FIELDS.reduce((issues, field) => {
    if (!Object.hasOwn(settings, field)) {
      issues.push({ field, issue: 'missing' });
      return issues;
    }

    if (normalizeOperationalSettingValue(field, settings[field]) !== null) {
      return issues;
    }

    issues.push({ field, issue: 'invalid', value: settings[field] });
    return issues;
  }, []);
};

export const createOperationalSettingsIntegrityError = (issues) => {
  const error = new Error(
    `Operational settings are incomplete or invalid: ${issues.map(({ field, issue }) => `${field} (${issue})`).join(', ')}`
  );
  error.status = 500;
  error.code = 'E_OPERATIONAL_SETTINGS_INVALID';
  error.details = issues;
  return error;
};

export const assertOperationalSettingsIntegrity = (settings = {}) => {
  const issues = getOperationalSettingsIntegrityIssues(settings);

  if (issues.length > 0) {
    throw createOperationalSettingsIntegrityError(issues);
  }
};

const mapOperationalSettingsRowsToStoredValues = (settings = []) => {
  return settings.reduce((result, setting) => {
    const field = OPERATIONAL_SETTING_FIELDS_BY_DB_KEY[setting.setting_key];

    if (field) {
      result[field] = setting.setting_value;
    }

    return result;
  }, {});
};

export const getOperationalSettingsStoredValues = async (transaction = null) => {
  const settings = await Settings.findAll({
    where: {
      setting_key: {
        [Op.in]: Object.values(OPERATIONAL_SETTING_KEYS)
      }
    },
    transaction
  });

  return mapOperationalSettingsRowsToStoredValues(settings);
};

export const getOperationalSettings = async (transaction = null) => {
  const settingsByField = await getOperationalSettingsStoredValues(transaction);
  return normalizeOperationalSettings(settingsByField);
};

export const getOperationalSettingsStrict = async (transaction = null) => {
  const settingsByField = await getOperationalSettingsStoredValues(transaction);
  assertOperationalSettingsIntegrity(settingsByField);
  return normalizeOperationalSettings(settingsByField);
};

/**
 * Helper function to get attendance settings from database
 * @param {Array} settingKeys - Array of setting keys to retrieve
 * @param {Transaction} transaction - Optional database transaction
 * @returns {Object} Settings object with key-value pairs
 */
export const getAttendanceSettings = async (settingKeys = [], transaction = null) => {
  // Default setting keys if none provided
  const defaultKeys = [
    'attendance.checkin.start_time',
    'attendance.checkin.end_time',
    'attendance.checkin.late_time',
    'workday.holiday_checkin_enabled',
    'workday.weekend_checkin_enabled',
    'workday.holiday_region'
  ];

  const keysToFetch = settingKeys.length > 0 ? settingKeys : defaultKeys;

  const settings = await Settings.findAll({
    where: {
      setting_key: {
        [Op.in]: keysToFetch
      }
    },
    transaction
  });

  // Convert settings array to object for easy access
  const settingsMap = {};
  settings.forEach((setting) => {
    settingsMap[setting.setting_key] = setting.setting_value;
  });

  // Set default values if settings not found
  return {
    checkinStartTime: settingsMap['attendance.checkin.start_time'] || '08:00:00',
    checkinEndTime: settingsMap['attendance.checkin.end_time'] || '18:00:00',
    checkinLateTime: settingsMap['attendance.checkin.late_time'] || '09:00:00',
    holidayCheckinEnabled: settingsMap['workday.holiday_checkin_enabled'] === 'true',
    weekendCheckinEnabled: settingsMap['workday.weekend_checkin_enabled'] === 'true',
    holidayRegion: settingsMap['workday.holiday_region'] || 'ID'
  };
};

/**
 * Helper function to get Jakarta timezone date
 * @returns {Object} Object containing localTime and todayDate
 */
export const getJakartaTime = () => {
  const today = new Date();
  const jakartaOffset = 7 * 60; // UTC+7 dalam menit
  const localTime = new Date(today.getTime() + jakartaOffset * 60000);
  const todayDate = localTime.toISOString().split('T')[0]; // YYYY-MM-DD format

  return {
    localTime,
    todayDate
  };
};

/**
 * Helper function to convert time string to minutes
 * @param {string} timeString - Time in format "HH:MM:SS" or "HH:MM"
 * @returns {number} Total minutes
 */
export const timeToMinutes = (timeString) => {
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * Helper function to check if current time is within working hours
 * @param {Date} currentTime - Current time
 * @param {string} startTime - Start time in format "HH:MM:SS"
 * @param {string} endTime - End time in format "HH:MM:SS"
 * @returns {boolean} True if within working hours
 */
export const isWithinWorkingHours = (currentTime, startTime, endTime) => {
  const currentHour = currentTime.getHours();
  const currentMinute = currentTime.getMinutes();
  const currentTimeMinutes = currentHour * 60 + currentMinute;

  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  return currentTimeMinutes >= startMinutes && currentTimeMinutes <= endMinutes;
};

/**
 * Helper function to determine attendance status (ontime vs late)
 * @param {Date} currentTime - Current time
 * @param {string} lateTime - Late time threshold in format "HH:MM:SS"
 * @returns {number} Status ID (1 = ontime, 2 = late)
 */
export const determineAttendanceStatus = (currentTime, lateTime) => {
  const currentHour = currentTime.getHours();
  const currentMinute = currentTime.getMinutes();
  const currentTimeMinutes = currentHour * 60 + currentMinute;

  const lateTimeMinutes = timeToMinutes(lateTime);

  return currentTimeMinutes > lateTimeMinutes ? 2 : 1; // 2 = late, 1 = ontime
};
