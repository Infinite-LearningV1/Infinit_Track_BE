import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

import { AppError } from '../src/shared/errors/AppError.js';
import { toErrorResponse } from '../src/shared/http/toErrorResponse.js';

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
const mockAssertWfaEligibility = jest.fn();
const mockScoreBookingLocation = jest.fn();
const mockTransaction = jest.fn().mockResolvedValue(transaction);

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: {
    transaction: mockTransaction,
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
jest.unstable_mockModule('../src/services/wfaEligibility.service.js', () => ({
  assertWfaEligibility: mockAssertWfaEligibility
}));
jest.unstable_mockModule('../src/services/wfaRecommendation.service.js', () => ({
  scoreBookingLocation: mockScoreBookingLocation
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
const { createBooking } = await import('../src/controllers/booking.controller.js');

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const validPayload = {
  schedule_date: '2026-08-10',
  request_reason_id: 1,
  request_other_reason: null,
  notes: '  Pertemuan project  ',
  latitude: -0.9,
  longitude: 119.87,
  description: 'Lokasi klien'
};

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post('/api/bookings', (req, res, next) => {
    req.user = { id: 9 };
    return createBooking(req, res, next);
  });
  app.use((error, _req, res, _next) => {
    const { status, body } = toErrorResponse(error, { env: 'test' });
    return res.status(status).json(body);
  });
  return app;
};

describe('server-authoritative WFA booking creation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockResolvedValue(transaction);
    mockAssertWfaEligibility.mockResolvedValue('2026-08-10');
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
    mockScoreBookingLocation.mockResolvedValue({
      status: 'ranked',
      suitabilityScore: 82,
      suitabilityLabel: 'Direkomendasikan',
      candidate: {
        place_id: 'ranked-place',
        final_score: 82,
        final_label: 'Direkomendasikan'
      }
    });
    mockBookingCreate.mockImplementation(async (payload) => ({
      booking_id: 30,
      ...payload
    }));
  });

  it('uses authenticated identity, server radius, server suitability, and pending status', async () => {
    const req = {
      user: { id: 9 },
      body: {
        ...validPayload,
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

    expect(mockAssertWfaEligibility).toHaveBeenCalledWith({
      userId: 9,
      scheduleDate: '2026-08-10',
      checkDuplicate: true
    });
    expect(mockScoreBookingLocation).toHaveBeenCalledWith({
      userId: 9,
      latitude: -0.9,
      longitude: 119.87,
      scheduleDate: '2026-08-10'
    });
    expect(mockReadWfaRequestConfig).toHaveBeenNthCalledWith(1);
    expect(mockReadWfaRequestConfig).toHaveBeenNthCalledWith(2, transaction);
    expect(mockReadWfaRequestConfig).toHaveBeenCalledWith(transaction);
    expect(mockResolveActiveWfaRequestReason).toHaveBeenNthCalledWith(1, {
      reasonId: 1,
      otherReasonText: null
    });
    expect(mockResolveActiveWfaRequestReason).toHaveBeenNthCalledWith(2, {
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
        suitability_status: 'ranked',
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

  it('persists nullable suitability and reports insufficient status when discovery succeeds with no place', async () => {
    mockScoreBookingLocation.mockResolvedValue({
      status: 'insufficient_facility_data',
      suitabilityScore: null,
      suitabilityLabel: null,
      candidate: null
    });
    const req = {
      user: { id: 9 },
      body: validPayload
    };
    const res = buildRes();

    await createBooking(req, res, jest.fn());

    expect(mockBookingCreate).toHaveBeenCalledWith(
      expect.objectContaining({ suitability_score: null, suitability_label: null }),
      { transaction }
    );
    expect(res.json.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        suitability_score: null,
        suitability_label: null,
        suitability_status: 'insufficient_facility_data'
      })
    );
  });

  it('returns WFA_SCORING_UNAVAILABLE without opening a write transaction or writing rows', async () => {
    mockScoreBookingLocation.mockRejectedValue(
      new AppError('Penilaian lokasi WFA tidak tersedia.', {
        code: 'WFA_SCORING_UNAVAILABLE',
        status: 503
      })
    );

    const response = await request(buildApp()).post('/api/bookings').send(validPayload).expect(503);

    expect(response.body).toEqual({
      success: false,
      message: 'Penilaian lokasi WFA tidak tersedia.',
      code: 'WFA_SCORING_UNAVAILABLE'
    });
    expect(mockLocationCreate).not.toHaveBeenCalled();
    expect(mockBookingCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rechecks pending or approved duplicates inside the transaction before writing', async () => {
    mockBookingFindOne.mockResolvedValue({ booking_id: 99, status: 3 });

    const response = await request(buildApp()).post('/api/bookings').send(validPayload).expect(409);

    expect(response.body).toEqual({
      success: false,
      code: 'DUPLICATE_BOOKING',
      message: 'Validasi booking gagal.',
      errors: [
        {
          field: 'schedule_date',
          code: 'DUPLICATE_BOOKING',
          message: 'Anda sudah memiliki booking pada tanggal tersebut.'
        }
      ]
    });
    expect(mockScoreBookingLocation).toHaveBeenCalled();
    expect(mockScoreBookingLocation.mock.invocationCallOrder[0]).toBeLessThan(
      mockTransaction.mock.invocationCallOrder[0]
    );
    expect(mockBookingFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 9,
          schedule_date: '2026-08-10'
        }),
        transaction
      })
    );
    expect(mockLocationCreate).not.toHaveBeenCalled();
    expect(mockBookingCreate).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('returns INVALID_SCHEDULE_DATE before reading policy for an impossible date', async () => {
    mockAssertWfaEligibility.mockRejectedValue(
      new AppError('Tanggal WFA tidak valid.', {
        code: 'INVALID_SCHEDULE_DATE',
        status: 400,
        details: [{ field: 'schedule_date', code: 'INVALID_SCHEDULE_DATE' }]
      })
    );
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

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'INVALID_SCHEDULE_DATE', status: 400 })
    );
    expect(mockReadWfaRequestConfig).not.toHaveBeenCalled();
    expect(mockBookingCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });
});
