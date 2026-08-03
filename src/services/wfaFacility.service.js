import { Op } from 'sequelize';

import { FACILITY_CRITERIA } from '../analytics/config.fahp.js';
import Settings from '../models/settings.model.js';
import { AppError } from '../shared/errors/AppError.js';
import fuzzyEngine from '../utils/fuzzyAhpEngine.js';
import { evaluateOpeningHoursCoverage } from '../utils/wfaOpeningHours.js';

const REQUIRED_KEYS = ['attendance.checkin.start_time', 'attendance.checkin.end_time'];
const STRICT_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const FACILITY_DETAILS_FIELDS = Object.freeze({
  internet_access: 'internet_access',
  air_conditioning: 'air_conditioning',
  toilets: 'toilets',
  opening_hours: 'opening_hours',
  wheelchair_accessibility: 'wheelchair'
});
const AVAILABLE_VALUES = new Set(['true', 'yes', 'available', 'limited', 'customers', 'designated']);
const UNAVAILABLE_VALUES = new Set(['false', 'no', 'unavailable']);

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const configUnavailableError = () =>
  new AppError('Konfigurasi jam check-in WFA belum tersedia.', {
    code: 'WFA_CONFIG_UNAVAILABLE',
    status: 500
  });

export const normalizeFacilityValue = (value) => {
  if (value === true) return 1;
  if (value === false) return 0;
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();
  if (AVAILABLE_VALUES.has(normalized)) return 1;
  if (UNAVAILABLE_VALUES.has(normalized)) return 0;
  return null;
};

export const readStrictWfaCheckinWindow = async ({ transaction = null } = {}) => {
  const settings = await Settings.findAll({
    where: {
      setting_key: {
        [Op.in]: REQUIRED_KEYS
      }
    },
    transaction
  });
  const values = new Map(settings.map(({ setting_key: key, setting_value: value }) => [key, value]));
  const startTime = values.get(REQUIRED_KEYS[0]);
  const endTime = values.get(REQUIRED_KEYS[1]);

  if (!STRICT_TIME_PATTERN.test(startTime) || !STRICT_TIME_PATTERN.test(endTime)) {
    throw configUnavailableError();
  }

  return { startTime, endTime };
};

export const scoreFacilityEvidence = ({
  detailsProperties = {},
  scheduleDate,
  checkinWindow,
  weights = fuzzyEngine.getFacilityAhpWeights()
}) => {
  const facilities = {
    internet_access: normalizeFacilityValue(detailsProperties[FACILITY_DETAILS_FIELDS.internet_access]),
    air_conditioning: normalizeFacilityValue(detailsProperties[FACILITY_DETAILS_FIELDS.air_conditioning]),
    toilets: normalizeFacilityValue(detailsProperties[FACILITY_DETAILS_FIELDS.toilets]),
    opening_hours: evaluateOpeningHoursCoverage({
      expression: detailsProperties[FACILITY_DETAILS_FIELDS.opening_hours],
      scheduleDate,
      startTime: checkinWindow.startTime,
      endTime: checkinWindow.endTime
    }),
    wheelchair_accessibility: normalizeFacilityValue(detailsProperties[FACILITY_DETAILS_FIELDS.wheelchair_accessibility])
  };
  const knownEntries = FACILITY_CRITERIA.map((criterion, index) => ({
    criterion,
    value: facilities[criterion],
    weight: weights.values[index]
  })).filter(({ value }) => value !== null);
  const knownWeight = knownEntries.reduce((sum, item) => sum + item.weight, 0);
  const facilityScore = knownEntries.length
    ? round2(knownEntries.reduce((sum, item) => sum + item.value * (item.weight / knownWeight), 0) * 100)
    : null;

  return {
    facilities,
    knownFields: knownEntries.length,
    facilityConfidence: knownEntries.length * 20,
    facilityScore,
    facilityCr: weights.consistency_ratio
  };
};
