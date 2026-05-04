import { body } from 'express-validator';

import {
  OPERATIONAL_SETTING_FIELDS,
  OPERATIONAL_SETTING_INTEGER_FIELDS,
  OPERATIONAL_SETTING_TIME_FIELDS,
  isOperationalSettingField,
  normalizeOperationalSettingTime
} from '../utils/settings.js';
import { validate } from './validator.js';

const hasAllowedOperationalSettingField = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }

  return OPERATIONAL_SETTING_FIELDS.some((field) => Object.hasOwn(payload, field));
};

export const operationalSettingsPatchValidation = [
  body()
    .custom((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Body must be an object');
      }

      return true;
    })
    .bail()
    .custom((value) => {
      const unknownFields = Object.keys(value).filter((field) => !isOperationalSettingField(field));

      if (unknownFields.length > 0) {
        throw new Error(`Unknown operational setting field: ${unknownFields[0]}`);
      }

      return true;
    })
    .bail()
    .custom((value) => {
      if (!hasAllowedOperationalSettingField(value)) {
        throw new Error(`At least one of these fields is required: ${OPERATIONAL_SETTING_FIELDS.join(', ')}`);
      }

      return true;
    }),
  ...OPERATIONAL_SETTING_INTEGER_FIELDS.map((field) =>
    body(field)
      .optional()
      .custom((value) => Number.isInteger(value) && value > 0)
      .withMessage(`${field} must be a positive integer`)
  ),
  ...OPERATIONAL_SETTING_TIME_FIELDS.map((field) =>
    body(field)
      .optional()
      .custom((value) => typeof value === 'string' && normalizeOperationalSettingTime(value) !== null)
      .withMessage(`${field} must use HH:mm or HH:mm:ss format`)
  ),
  validate
];
