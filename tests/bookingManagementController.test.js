import { jest } from '@jest/globals';

const mockListManagementBookings = jest.fn();
const Booking = {
  findAndCountAll: jest.fn().mockResolvedValue({ count: 0, rows: [] }),
  findAll: jest.fn(),
  findByPk: jest.fn()
};

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: {
    transaction: jest.fn(),
    fn: jest.fn((...args) => ({ args })),
    col: jest.fn((value) => value)
  }
}));
jest.unstable_mockModule('../src/models/index.js', () => ({
  Booking,
  Location: {},
  BookingStatus: {},
  User: {},
  Position: {},
  Role: {},
  WfaRequestReason: {},
  WfaRejectionReason: {}
}));
jest.unstable_mockModule('../src/modules/booking/bookingManagementRead.service.js', () => ({
  listManagementBookings: mockListManagementBookings
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
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({ default: {} }));

const { getAllBookings } = await import('../src/controllers/booking.controller.js');

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
});
test('delegates the validated management query and preserves the existing response envelope', async () => {
  mockListManagementBookings.mockResolvedValue({
    bookings: [{ booking_id: 42 }],
    pagination: {
      current_page: 2,
      total_pages: 3,
      total_items: 11,
      items_per_page: 5
    }
  });
  const req = {
    query: { page: 2, limit: 5, status: 'pending', search: 'Andi' }
  };
  const res = buildRes();
  const next = jest.fn();

  await getAllBookings(req, res, next);

  expect(mockListManagementBookings).toHaveBeenCalledWith(req.query);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({
    success: true,
    data: {
      bookings: [{ booking_id: 42 }],
      pagination: {
        current_page: 2,
        total_pages: 3,
        total_items: 11,
        items_per_page: 5
      }
    },
    message: 'Daftar booking berhasil diambil'
  });
  expect(next).not.toHaveBeenCalled();
});
test('forwards management read failures to the canonical error middleware', async () => {
  const error = new Error('database unavailable');
  mockListManagementBookings.mockRejectedValue(error);
  const res = buildRes();
  const next = jest.fn();

  await getAllBookings({ query: { page: 1, limit: 10 } }, res, next);

  expect(next).toHaveBeenCalledWith(error);
  expect(res.status).not.toHaveBeenCalled();
});
