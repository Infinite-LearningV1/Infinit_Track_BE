'use strict';

const MIGRATION_MARKER_PREFIX = '[INF-141 bootstrap]';

const OPERATIONAL_SETTINGS = [
  {
    key: 'attendance.geofence.radius_default_m',
    envKey: 'GEOFENCE_RADIUS_DEFAULT_M',
    defaultValue: '100',
    description: 'Default geofence radius in meters for attendance validation.'
  },
  {
    key: 'attendance.auto_checkout.idle_min',
    envKey: 'AUTO_CHECKOUT_IDLE_MIN',
    defaultValue: '10',
    description: 'Idle window in minutes used by auto-checkout operational logic.'
  },
  {
    key: 'attendance.auto_checkout.tbuffer_min',
    envKey: 'AUTO_CHECKOUT_TBUFFER_MIN',
    defaultValue: '30',
    description: 'Time buffer in minutes used by auto-checkout operational logic.'
  },
  {
    key: 'attendance.auto_checkout.late_tolerance_min',
    envKey: 'LATE_CHECKOUT_TOLERANCE_MIN',
    defaultValue: '15',
    description: 'Tolerance in minutes after fallback shift end before missed checkout flagging.'
  },
  {
    key: 'checkout.fallback_time',
    envKey: 'DEFAULT_SHIFT_END',
    defaultValue: '17:00:00',
    description: 'Fallback shift end time used when auto-checkout prediction cannot determine checkout time.'
  }
];

const normalizeTimeValue = (value) => {
  const raw = String(value || '').trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
  if (/^\d{2}:\d{2}$/.test(raw)) return `${raw}:00`;
  return null;
};

const normalizeSettingValue = ({ envKey, defaultValue }) => {
  const envValue = process.env[envKey];
  const rawValue = envValue == null || envValue === '' ? defaultValue : envValue;

  if (envKey === 'DEFAULT_SHIFT_END') {
    return normalizeTimeValue(rawValue) || defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : defaultValue;
};

/** @type {import('sequelize-cli').Migration} */
const migration = {
  async up(queryInterface) {
    const keys = OPERATIONAL_SETTINGS.map((setting) => setting.key);
    const [existingRows] = await queryInterface.sequelize.query(
      'SELECT setting_key FROM settings WHERE setting_key IN (:keys)',
      { replacements: { keys } }
    );
    const existingKeys = new Set(existingRows.map((row) => row.setting_key));
    const now = new Date();

    const rowsToInsert = OPERATIONAL_SETTINGS.filter((setting) => !existingKeys.has(setting.key)).map(
      (setting) => ({
        setting_key: setting.key,
        setting_value: normalizeSettingValue(setting),
        description: `${MIGRATION_MARKER_PREFIX} ${setting.description}`,
        updated_at: now
      })
    );

    if (rowsToInsert.length > 0) {
      await queryInterface.bulkInsert('settings', rowsToInsert);
    }
  },

  async down(queryInterface, Sequelize) {
    const keys = OPERATIONAL_SETTINGS.map((setting) => setting.key);

    await queryInterface.bulkDelete('settings', {
      [Sequelize.Op.and]: [
        {
          setting_key: {
            [Sequelize.Op.in]: keys
          }
        },
        {
          description: {
            [Sequelize.Op.like]: `${MIGRATION_MARKER_PREFIX} %`
          }
        }
      ]
    });
  }
};

export default migration;

if (typeof module !== 'undefined') {
  module.exports = migration;
}
