import { Attendance } from '../../models/index.js';
import { mapAttendanceDetail, mapAttendanceListRow } from './attendance.mapper.js';
import { buildAttendanceDetailQuery, buildAttendanceListQuery } from './attendance.query.js';

export const listManagementAttendances = async (query = {}) => {
  const page = query.page ?? 1;
  const limit = query.limit ?? 10;
  const { count, rows } = await Attendance.findAndCountAll(
    buildAttendanceListQuery({ ...query, page, limit })
  );
  const totalPages = Math.ceil(count / limit);

  return {
    data: rows.map(mapAttendanceListRow),
    pagination: {
      current_page: page,
      total_pages: totalPages,
      total_records: count,
      records_per_page: limit,
      has_next_page: page < totalPages,
      has_prev_page: totalPages > 0 && page > 1
    }
  };
};

export const getManagementAttendanceDetail = async (id) => {
  const row = await Attendance.findByPk(id, buildAttendanceDetailQuery());
  return row ? mapAttendanceDetail(row) : null;
};
