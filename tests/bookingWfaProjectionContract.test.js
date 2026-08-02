import { jest } from '@jest/globals';

const mockFindAndCountAll = jest.fn();
const WfaRequestReason = { modelName: 'WfaRequestReason' };
const WfaRejectionReason = { modelName: 'WfaRejectionReason' };

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: {
    transaction: jest.fn(),
    fn: jest.fn((...args) => ({ args })),
    col: jest.fn((value) => value)
  }
}));
jest.unstable_mockModule('../src/models/index.js', () => ({
  Booking: { findAndCountAll: mockFindAndCountAll },
  Location: {},
  BookingStatus: {},
  User: {},
  Position: {},
  Role: {},
  WfaRequestReason,
  WfaRejectionReason
}));
jest.unstable_mockModule('../src/services/wfaSettings.service.js', () => ({
  readWfaRequestConfig: jest.fn(),
  resolveActiveWfaRequestReason: jest.fn(),
  resolveActiveWfaRejectionReason: jest.fn()
}));
jest.unstable_mockModule('../src/services/wfaEligibility.service.js', () => ({
  assertWfaEligibility: jest.fn()
}));
jest.unstable_mockModule('../src/services/wfaRecommendation.service.js', () => ({
  scoreBookingLocation: jest.fn()
}));
jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({ default: {} }));
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

const { getAllBookings } = await import('../src/controllers/booking.controller.js');

const commonBooking = {
  user: {
    id_users: 9,
    full_name: 'User WFA',
    email: 'wfa@example.com',
    nip_nim: 'EMP-9',
    role: { role_name: 'User' },
    position: { position_name: 'Engineer' }
  },
  schedule_date: '2026-08-10',
  booking_status: { name_status: 'rejected' },
  location: {
    location_id: 20,
    latitude: '-0.9',
    longitude: '119.87',
    radius: '100',
    description: 'Lokasi klien'
  },
  notes: '',
  suitability_score: '82',
  suitability_label: 'Direkomendasikan',
  created_at: new Date('2026-07-28T00:00:00.000Z'),
  processed_at: null,
  approved_by: null
};

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('WFA booking read projection', () => {
  it('projects structured reasons and falls back to location radius for legacy rows', async () => {
    mockFindAndCountAll.mockResolvedValue({
      count: 2,
      rows: [
        {
          ...commonBooking,
          booking_id: 31,
          request_reason: {
            id: 1,
            label: 'Pertemuan dengan klien',
            is_other: false
          },
          request_other_reason: null,
          rejection_reason_detail: {
            id: 2,
            label: 'Lokasi tidak memenuhi ketentuan',
            is_other: false
          },
          rejection_note: 'Di luar area operasional',
          radius_snapshot: 150
        },
        {
          ...commonBooking,
          booking_id: 32,
          suitability_score: null,
          suitability_label: null,
          request_reason: null,
          request_other_reason: null,
          rejection_reason_detail: null,
          rejection_note: null,
          radius_snapshot: null
        }
      ]
    });
    const res = buildRes();
    const next = jest.fn();

    await getAllBookings({ query: {} }, res, next);

    const query = mockFindAndCountAll.mock.calls[0][0];
    expect(query.include).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: WfaRequestReason, as: 'request_reason' }),
        expect.objectContaining({ model: WfaRejectionReason, as: 'rejection_reason_detail' })
      ])
    );
    const response = res.json.mock.calls[0][0];
    expect(response.data.bookings[0]).toMatchObject({
      request_reason: {
        id: 1,
        label: 'Pertemuan dengan klien',
        is_other: false,
        other_text: null
      },
      rejection_reason: {
        id: 2,
        label: 'Lokasi tidak memenuhi ketentuan',
        is_other: false,
        note: 'Di luar area operasional'
      },
      radius_snapshot: 150
    });
    expect(response.data.bookings[1]).toMatchObject({
      request_reason: null,
      rejection_reason: null,
      radius_snapshot: 100,
      suitability_score: null,
      suitability_label: null
    });
    expect(next).not.toHaveBeenCalled();
  });
});
