import { Booking } from '../../models/index.js';
import { mapBookingManagementRow } from './bookingManagement.mapper.js';
import { buildBookingManagementListQuery } from './bookingManagement.query.js';

export const listManagementBookings = async (query = {}) => {
  const page = query.page ?? 1;
  const limit = query.limit ?? 10;
  const normalizedQuery = { ...query, page, limit };
  const { count, rows } = await Booking.findAndCountAll(
    buildBookingManagementListQuery(normalizedQuery)
  );
  const totalPages = Math.ceil(count / limit);

  return {
    bookings: rows.map(mapBookingManagementRow),
    pagination: {
      current_page: page,
      total_pages: totalPages,
      total_records: count,
      records_per_page: limit,
      has_next_page: page < totalPages,
      has_prev_page: totalPages > 0 && page > 1,
      total_items: count,
      items_per_page: limit
    }
  };
};
