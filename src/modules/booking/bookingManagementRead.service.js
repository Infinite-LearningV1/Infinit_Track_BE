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

  return {
    bookings: rows.map(mapBookingManagementRow),
    pagination: {
      current_page: page,
      total_pages: Math.ceil(count / limit),
      total_items: count,
      items_per_page: limit
    }
  };
};
