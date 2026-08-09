import { jest } from '@jest/globals';

const mockFindAndCountAll = jest.fn();
const mockBuildQuery = jest.fn((query) => ({ marker: 'query', query }));
const mockMapRow = jest.fn((row) => ({ booking_id: row.booking_id }));

jest.unstable_mockModule('../src/models/index.js', () => ({
  Booking: { findAndCountAll: mockFindAndCountAll }
}));
jest.unstable_mockModule('../src/modules/booking/bookingManagement.query.js', () => ({
  buildBookingManagementListQuery: mockBuildQuery
}));
jest.unstable_mockModule('../src/modules/booking/bookingManagement.mapper.js', () => ({
  mapBookingManagementRow: mockMapRow
}));

const { listManagementBookings } = await import(
  '../src/modules/booking/bookingManagementRead.service.js'
);

beforeEach(() => {
  jest.clearAllMocks();
});

test('executes one paginated query and maps the returned booking rows', async () => {
  mockFindAndCountAll.mockResolvedValue({
    count: 11,
    rows: [{ booking_id: 1 }, { booking_id: 2 }]
  });
  const result = await listManagementBookings({
    page: 2,
    limit: 5,
    status: 'pending',
    search: 'Andi'
  });

  expect(mockBuildQuery).toHaveBeenCalledWith({
    page: 2,
    limit: 5,
    status: 'pending',
    search: 'Andi'
  });
  expect(mockFindAndCountAll).toHaveBeenCalledTimes(1);
  expect(mockFindAndCountAll).toHaveBeenCalledWith({
    marker: 'query',
    query: { page: 2, limit: 5, status: 'pending', search: 'Andi' }
  });
  expect(mockMapRow).toHaveBeenCalledTimes(2);
  expect(result).toEqual({
    bookings: [{ booking_id: 1 }, { booking_id: 2 }],
    pagination: {
      current_page: 2,
      total_pages: 3,
      total_items: 11,
      items_per_page: 5
    }
  });
});
test('returns stable empty pagination metadata', async () => {
  mockFindAndCountAll.mockResolvedValue({ count: 0, rows: [] });

  const result = await listManagementBookings({});

  expect(result).toEqual({
    bookings: [],
    pagination: {
      current_page: 1,
      total_pages: 0,
      total_items: 0,
      items_per_page: 10
    }
  });
});
