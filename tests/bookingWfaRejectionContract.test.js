import { jest } from '@jest/globals';

const transaction = {
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined)
};
const mockBookingFindByPk = jest.fn();
const mockResolveActiveWfaRejectionReason = jest.fn();
const bookingUpdate = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: {
    transaction: jest.fn().mockResolvedValue(transaction),
    fn: jest.fn(),
    col: jest.fn()
  }
}));
jest.unstable_mockModule('../src/models/index.js', () => ({
  Booking: { findByPk: mockBookingFindByPk },
  Location: {},
  BookingStatus: {},
  User: {},
  Photo: {},
  Position: {},
  Role: {},
  WfaRequestReason: {},
  WfaRejectionReason: {}
}));
jest.unstable_mockModule('../src/services/wfaSettings.service.js', () => ({
  readWfaRequestConfig: jest.fn(),
  resolveActiveWfaRequestReason: jest.fn(),
  resolveActiveWfaRejectionReason: mockResolveActiveWfaRejectionReason
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

const { updateBookingStatus } = await import('../src/controllers/booking.controller.js');

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const booking = {
  booking_id: 12,
  schedule_date: '2099-08-10',
  update: bookingUpdate
};

const updatedBooking = {
  booking_id: 12,
  schedule_date: '2099-08-10',
  user: { full_name: 'User WFA', email: 'wfa@example.com' },
  booking_status: { name_status: 'rejected' },
  location: {
    latitude: -0.9,
    longitude: 119.87,
    radius: 100,
    description: 'Lokasi klien'
  },
  processed_at: new Date('2026-07-28T00:00:00.000Z')
};

describe('Management WFA booking decision contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBookingFindByPk.mockResolvedValueOnce(booking).mockResolvedValueOnce(updatedBooking);
  });

  it('approves without rejection fields and clears stale structured rejection data', async () => {
    const res = buildRes();
    const next = jest.fn();

    await updateBookingStatus(
      { params: { id: '12' }, body: { status: 'approved' }, user: { id: 9 } },
      res,
      next
    );

    expect(mockResolveActiveWfaRejectionReason).not.toHaveBeenCalled();
    expect(bookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 1,
        rejection_reason_id: null,
        rejection_note: null,
        approved_by: 9,
        processed_at: expect.any(Date)
      }),
      { transaction }
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rejection_reason: null })
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('persists a resolved rejection reason and normalized note', async () => {
    const reason = { id: 5, label: 'Lainnya', is_other: true };
    mockResolveActiveWfaRejectionReason.mockResolvedValue({
      reason,
      normalizedNote: 'Keterangan khusus'
    });
    const res = buildRes();
    const next = jest.fn();

    await updateBookingStatus(
      {
        params: { id: '12' },
        body: {
          status: 'rejected',
          rejection_reason_id: 5,
          rejection_note: '  Keterangan khusus  '
        },
        user: { id: 9 }
      },
      res,
      next
    );

    expect(mockResolveActiveWfaRejectionReason).toHaveBeenCalledWith({
      reasonId: 5,
      note: '  Keterangan khusus  ',
      transaction
    });
    expect(bookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 2,
        rejection_reason_id: 5,
        rejection_note: 'Keterangan khusus',
        approved_by: 9,
        processed_at: expect.any(Date)
      }),
      { transaction }
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rejection_reason: {
            id: 5,
            label: 'Lainnya',
            is_other: true,
            note: 'Keterangan khusus'
          }
        })
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    'REJECTION_REASON_REQUIRED',
    'REJECTION_REASON_NOT_FOUND',
    'REJECTION_REASON_NOT_ACTIVE',
    'REJECTION_NOTE_REQUIRED'
  ])('rolls back and forwards %s from the reason service', async (code) => {
    const serviceError = Object.assign(new Error(code), { status: 400, code });
    mockResolveActiveWfaRejectionReason.mockRejectedValue(serviceError);
    const res = buildRes();
    const next = jest.fn();

    await updateBookingStatus(
      {
        params: { id: '12' },
        body: { status: 'rejected', rejection_reason_id: 5 },
        user: { id: 9 }
      },
      res,
      next
    );

    expect(transaction.rollback).toHaveBeenCalled();
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(bookingUpdate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(serviceError);
  });
});
