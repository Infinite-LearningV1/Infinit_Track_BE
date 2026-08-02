import { jest } from '@jest/globals';
import { Op } from 'sequelize';

const mockSettingsFindAll = jest.fn();

jest.unstable_mockModule('../src/models/settings.model.js', () => ({
  default: { findAll: mockSettingsFindAll }
}));

const {
  normalizeFacilityValue,
  readStrictWfaCheckinWindow,
  scoreFacilityEvidence
} = await import('../src/services/wfaFacility.service.js');

const equalWeights = {
  criteria: ['internet_access', 'air_conditioning', 'toilets', 'opening_hours', 'wheelchair_accessibility'],
  values: [0.2, 0.2, 0.2, 0.2, 0.2],
  consistency_ratio: 0
};

beforeEach(() => {
  jest.clearAllMocks();
});

test.each([true, 'true', 'yes', 'available', 'limited', 'customers', 'designated'])(
  'normalizes %p as available',
  (value) => expect(normalizeFacilityValue(value)).toBe(1)
);

test.each([false, 'false', 'no', 'unavailable'])(
  'normalizes %p as unavailable',
  (value) => expect(normalizeFacilityValue(value)).toBe(0)
);

test.each([undefined, null, '', 'unknown', {}, []])('normalizes %p as unknown', (value) =>
  expect(normalizeFacilityValue(value)).toBeNull()
);

test('reads only the strict WFA check-in settings', async () => {
  mockSettingsFindAll.mockResolvedValue([
    { setting_key: 'attendance.checkin.start_time', setting_value: '08:00:00' },
    { setting_key: 'attendance.checkin.end_time', setting_value: '17:00:00' }
  ]);

  await expect(readStrictWfaCheckinWindow({ transaction: { id: 'tx' } })).resolves.toEqual({
    startTime: '08:00:00',
    endTime: '17:00:00'
  });
  expect(mockSettingsFindAll).toHaveBeenCalledWith({
    where: {
      setting_key: {
        [Op.in]: ['attendance.checkin.start_time', 'attendance.checkin.end_time']
      }
    },
    transaction: { id: 'tx' }
  });
});

test.each([
  [[]],
  [[{ setting_key: 'attendance.checkin.start_time', setting_value: '8:00:00' }]],
  [[
    { setting_key: 'attendance.checkin.start_time', setting_value: '08:00:00' },
    { setting_key: 'attendance.checkin.end_time', setting_value: '24:00:00' }
  ]]
])('rejects unavailable or invalid WFA check-in settings', async (settings) => {
  mockSettingsFindAll.mockResolvedValue(settings);

  await expect(readStrictWfaCheckinWindow()).rejects.toMatchObject({
    code: 'WFA_CONFIG_UNAVAILABLE',
    status: 500,
    message: 'Konfigurasi jam check-in WFA belum tersedia.'
  });
});

test('scores one known facility with renormalized weight and no final-decision field', () => {
  const result = scoreFacilityEvidence({
    detailsProperties: { internet_access: 'yes' },
    scheduleDate: '2026-08-03',
    checkinWindow: { startTime: '08:00:00', endTime: '17:00:00' },
    weights: equalWeights
  });

  expect(result).toMatchObject({
    facilities: {
      internet_access: 1,
      air_conditioning: null,
      toilets: null,
      opening_hours: null,
      wheelchair_accessibility: null
    },
    knownFields: 1,
    facilityConfidence: 20,
    facilityScore: 100,
    facilityCr: 0
  });
  expect(result).not.toHaveProperty('finalDecision');
  expect(result).not.toHaveProperty('finalScore');
});

test('renormalizes two known facility weights and keeps confidence as a gate only', () => {
  const result = scoreFacilityEvidence({
    detailsProperties: { internet_access: 'yes', air_conditioning: 'no' },
    scheduleDate: '2026-08-03',
    checkinWindow: { startTime: '08:00:00', endTime: '17:00:00' },
    weights: {
      ...equalWeights,
      values: [0.5, 0.1, 0.2, 0.1, 0.1]
    }
  });

  expect(result).toMatchObject({ knownFields: 2, facilityConfidence: 40, facilityScore: 83.33, facilityCr: 0 });
  expect(result).not.toHaveProperty('finalDecision');
});

test('does not invent facility availability from unapproved details fields or objects', () => {
  const result = scoreFacilityEvidence({
    detailsProperties: {
      name: 'Cafe with great rating',
      categories: ['catering.cafe'],
      rating: 5,
      website: 'https://example.test',
      internet_access: {},
      air_conditioning: [],
      toilets: 'unknown',
      opening_hours: 'not-valid-opening-hours',
      wheelchair: null
    },
    scheduleDate: '2026-08-03',
    checkinWindow: { startTime: '08:00:00', endTime: '17:00:00' },
    weights: equalWeights
  });

  expect(result).toEqual({
    facilities: {
      internet_access: null,
      air_conditioning: null,
      toilets: null,
      opening_hours: null,
      wheelchair_accessibility: null
    },
    knownFields: 0,
    facilityConfidence: 0,
    facilityScore: null,
    facilityCr: 0
  });
});

test('keeps parser-unknown opening hours as unknown facility evidence', () => {
  const result = scoreFacilityEvidence({
    detailsProperties: { opening_hours: 'Mo 08:00-17:00 unknown' },
    scheduleDate: '2026-08-03',
    checkinWindow: { startTime: '08:00:00', endTime: '17:00:00' },
    weights: equalWeights
  });

  expect(result).toMatchObject({
    facilities: { opening_hours: null },
    knownFields: 0,
    facilityConfidence: 0,
    facilityScore: null
  });
});
