import { sequelize, Settings } from '../models/index.js';
import {
  OPERATIONAL_SETTING_FIELDS,
  OPERATIONAL_SETTING_INTEGER_FIELDS,
  OPERATIONAL_SETTING_KEYS,
  OPERATIONAL_SETTING_TIME_FIELDS,
  assertOperationalSettingsIntegrity,
  getOperationalSettingsStoredValues,
  getOperationalSettingsStrict,
  normalizeOperationalSettingValue,
  normalizeOperationalSettings,
  serializeOperationalSettingValue
} from '../utils/settings.js';

const createValidationError = (message) => {
  const error = new Error(message);
  error.status = 400;
  return error;
};

const assertValidOperationalSettingsPayload = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createValidationError('Body must be an object');
  }

  const unknownFields = Object.keys(payload).filter((field) => !OPERATIONAL_SETTING_FIELDS.includes(field));
  if (unknownFields.length > 0) {
    throw createValidationError(`Unknown operational setting field: ${unknownFields[0]}`);
  }

  const providedFields = OPERATIONAL_SETTING_FIELDS.filter((field) => Object.hasOwn(payload, field));
  if (providedFields.length === 0) {
    throw createValidationError(
      `At least one of these fields is required: ${OPERATIONAL_SETTING_FIELDS.join(', ')}`
    );
  }

  for (const field of providedFields) {
    if (normalizeOperationalSettingValue(field, payload[field]) !== null) {
      continue;
    }

    if (OPERATIONAL_SETTING_INTEGER_FIELDS.includes(field)) {
      throw createValidationError(`${field} must be a positive integer`);
    }

    if (OPERATIONAL_SETTING_TIME_FIELDS.includes(field)) {
      throw createValidationError(`${field} must use HH:mm or HH:mm:ss format`);
    }
  }
};

const mapPayloadToCurrentState = (currentSettings, payload) => {
  return OPERATIONAL_SETTING_FIELDS.reduce((nextSettings, field) => {
    nextSettings[field] = Object.hasOwn(payload, field) ? payload[field] : currentSettings[field];
    return nextSettings;
  }, {});
};

const getProvidedOperationalSettingsFields = (payload) => {
  return OPERATIONAL_SETTING_FIELDS.filter((field) => Object.hasOwn(payload, field));
};

export const readOperationalSettings = async () => {
  return getOperationalSettingsStrict();
};

export const updateOperationalSettings = async (payload) => {
  assertValidOperationalSettingsPayload(payload);

  return sequelize.transaction(async (transaction) => {
    const currentStoredSettings = await getOperationalSettingsStoredValues(transaction);
    const providedFields = getProvidedOperationalSettingsFields(payload);
    const currentSettings = normalizeOperationalSettings(currentStoredSettings);
    const mergedSettings = mapPayloadToCurrentState(currentSettings, payload);
    const normalizedSettings = normalizeOperationalSettings(mergedSettings);
    const updatedAt = new Date();

    for (const field of providedFields) {
      const settingKey = OPERATIONAL_SETTING_KEYS[field];
      const nextValue = serializeOperationalSettingValue(field, normalizedSettings[field]);
      const currentStoredValue = currentStoredSettings[field];

      if (nextValue === currentStoredValue) {
        continue;
      }

      const existingSetting = await Settings.findByPk(settingKey, { transaction });

      if (existingSetting) {
        await existingSetting.update(
          {
            setting_value: nextValue,
            updated_at: updatedAt
          },
          { transaction }
        );
        continue;
      }

      await Settings.create(
        {
          setting_key: settingKey,
          setting_value: nextValue,
          description: null,
          updated_at: updatedAt
        },
        { transaction }
      );
    }

    const latestStoredSettings = await getOperationalSettingsStoredValues(transaction);
    assertOperationalSettingsIntegrity(latestStoredSettings);
    return normalizeOperationalSettings(latestStoredSettings);
  });
};
