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

const normalizeTimeOrDefault = (value, fallback) => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const withSecondsMatch = value.match(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/);
  if (withSecondsMatch) {
    return value;
  }

  const withoutSecondsMatch = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (withoutSecondsMatch) {
    return `${value}:00`;
  }

  return fallback;
};

const toPositiveIntOrDefault = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const getOperationalSettings = async (transaction = null) => {
  try {
    const keys = Object.values(OPERATIONAL_SETTING_KEYS);

    const settings = await Settings.findAll({
      where: {
        setting_key: {
          [Op.in]: keys
        }
      },
      transaction
    });

    const settingsMap = {};
    settings.forEach((setting) => {
      settingsMap[setting.setting_key] = setting.setting_value;
    });

    const defaultShiftEnd = settingsMap[OPERATIONAL_SETTING_KEYS.defaultShiftEnd];

    return {
      geofenceRadiusDefaultM: toPositiveIntOrDefault(
        settingsMap[OPERATIONAL_SETTING_KEYS.geofenceRadiusDefaultM],
        OPERATIONAL_SETTING_DEFAULTS.geofenceRadiusDefaultM
      ),
      autoCheckoutIdleMin: toPositiveIntOrDefault(
        settingsMap[OPERATIONAL_SETTING_KEYS.autoCheckoutIdleMin],
        OPERATIONAL_SETTING_DEFAULTS.autoCheckoutIdleMin
      ),
      autoCheckoutTBufferMin: toPositiveIntOrDefault(
        settingsMap[OPERATIONAL_SETTING_KEYS.autoCheckoutTBufferMin],
        OPERATIONAL_SETTING_DEFAULTS.autoCheckoutTBufferMin
      ),
      lateCheckoutToleranceMin: toPositiveIntOrDefault(
        settingsMap[OPERATIONAL_SETTING_KEYS.lateCheckoutToleranceMin],
        OPERATIONAL_SETTING_DEFAULTS.lateCheckoutToleranceMin
      ),
      defaultShiftEnd: normalizeTimeOrDefault(
        defaultShiftEnd,
        OPERATIONAL_SETTING_DEFAULTS.defaultShiftEnd
      )
    };
  } catch (error) {
    throw new Error(`Failed to get operational settings: ${error.message}`);
  }
};

/**
 * Helper function to get attendance settings from database
 * @param {Array} settingKeys - Array of setting keys to retrieve
 * @param {Transaction} transaction - Optional database transaction
 * @returns {Object} Settings object with key-value pairs
 */
export const getAttendanceSettings = async (settingKeys = [], transaction = null) => {
  try {
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
  } catch (error) {
    throw new Error(`Failed to get attendance settings: ${error.message}`);
  }
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
