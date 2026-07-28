import { jest } from '@jest/globals';

process.env.GEOAPIFY_API_KEY = 'test-key';

const transaction = {
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined)
};
const mockBookingFindOne = jest.fn();
const mockBookingCreate = jest.fn();
const mockLocationFindByPk = jest.fn();
const mockLocationCreate = jest.fn();
const mockReadWfaRequestConfig = jest.fn();
const mockResolveActiveWfaRequestReason = jest.fn();
const mockCalculateWfaScore = jest.fn();

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: {
    transaction: jest.fn().mockResolvedValue(transaction),
    fn: jest.fn(),
    col: jest.fn()
  }
}));
jest.unstable_mockModule('../src/models/index.js', () => ({
  Booking: { findOne: mockBookingFindOne, create: mockBookingCreate },
  Location: { findByPk: mockLocationFindByPk, create: mockLocationCreate },
  BookingStatus: {},
  User: {},
  Position: {},
  Role: {},
  WfaRequestReason: {},
  WfaRejectionReason: {}
}));
jest.unstable_mockModule('../src/services/wfaSettings.service.js', () => ({
  readWfaRequestConfig: mockReadWfaRequestConfig,
  resolveActiveWfaRequestReason: mockResolveActiveWfaRequestReason,
  resolveActiveWfaRejectionReason: jest.fn()
}));
jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
  default: { calculateWfaScore: mockCalculateWfaScore }
}));
jest.unstable_mockModule('../src/utils/geofence.js', () => ({
  getJakartaDateString: jest.fn(() => '2026-07-28')
}));
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));
jest.unstable_mockModule('axios', () => ({
  default: {
    get: jest.fn().mockResolvedValue({
      data: {
        features: [
          {
            properties: { name: 'Lokasi server' },
            geometry: { type: 'Point', coordinates: [119.87, -0.9] }
          }
        ]
      }
    })
  }
}));

const { createBooking } = await import('../src/controllers/booking.controller.js');

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('server-authoritative WFA booking creation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBookingFindOne.mockResolvedValue(null);
    mockReadWfaRequestConfig.mockResolvedValue({ radiusMeters: 150, reasons: [] });
    mockResolveActiveWfaRequestReason.mockResolvedValue({
      reason: { id: 1, label: 'Pertemuan dengan klien', is_other: false },
      normalizedOtherReason: null
    });
    mockLocationCreate.mockResolvedValue({
      location_id: 20,
      latitude: -0.9,
      longitude: 119.87,
      radius: 150,
      description: 'Lokasi klien'
    });
    mockCalculateWfaScore.mockResolvedValue({ score: 82, label: 'Direkomendasikan' });
    mockBookingCreate.mockImplementation(async (payload) => ({
      booking_id: 30,
      ...payload
    }));
  });

  it('uses authenticated identity, server radius, server suitability, and pending status', async () => {
    const req = {
      user: { id: 9 },
      body: {
        schedule_date: '2026-08-10',
        request_reason_id: 1,
        request_other_reason: null,
        notes: '  Pertemuan project  ',
        latitude: -0.9,
        longitude: 119.87,
        description: 'Lokasi klien',
        radius: 9999,
        suitability_score: 999,
        suitability_label: 'client-controlled',
        user_id: 999,
        status: 'approved'
      }
    };
    const res = buildRes();
    const next = jest.fn();

    await createBooking(req, res, next);

    expect(mockReadWfaRequestConfig).toHaveBeenCalledWith(transaction);
    expect(mockResolveActiveWfaRequestReason).toHaveBeenCalledWith({
      reasonId: 1,
      otherReasonText: null,
      transaction
    });
    expect(mockLocationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 9, radius: 150 }),
      { transaction }
    );
    expect(mockBookingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 9,
        request_reason_id: 1,
        request_other_reason: null,
        radius_snapshot: 150,
        status: 3,
        notes: 'Pertemuan project',
        suitability_score: 82,
        suitability_label: 'Direkomendasikan'
      }),
      { transaction }
    );
    expect(mockBookingCreate.mock.calls[0][0]).not.toEqual(
      expect.objectContaining({ radius: 9999, user_id: 999, status: 1 })
    );
    expect(transaction.commit).toHaveBeenCalled();
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Booking WFA berhasil dibuat.',
      data: expect.objectContaining({
        booking_id: 30,
        schedule_date: '2026-08-10',
        status: 'pending',
        radius_snapshot: 150,
        suitability_score: 82,
        suitability_label: 'Direkomendasikan',
        request_reason: {
          id: 1,
          label: 'Pertemuan dengan klien',
          is_other: false,
          other_text: null
        },
        location: expect.objectContaining({ location_id: 20, radius: 150 })
      })
    });
  });

  it('returns INVALID_SCHEDULE_DATE before reading policy for an impossible date', async () => {
    const res = buildRes();
    const next = jest.fn();

    await createBooking(
      {
        user: { id: 9 },
        body: {
          schedule_date: '2026-02-30',
          request_reason_id: 1,
          latitude: -0.9,
          longitude: 119.87
        }
      },
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, code: 'INVALID_SCHEDULE_DATE' })
    );
    expect(mockReadWfaRequestConfig).not.toHaveBeenCalled();
    expect(mockBookingCreate).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
