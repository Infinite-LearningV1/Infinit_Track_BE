import { jest } from '@jest/globals';

const findAndCountAll = jest.fn();
const findByPk = jest.fn();

jest.unstable_mockModule('../src/models/index.js', () => ({
  Attendance: { findAndCountAll, findByPk },
  User: {},
  Role: {},
  Location: {},
  AttendanceStatus: {},
  AttendanceCategory: {}
}));

const { getManagementAttendanceDetail, listManagementAttendances } =
  await import('../src/modules/attendance/attendanceRead.service.js');

describe('attendance management read service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns accurate empty out-of-range pagination', async () => {
    findAndCountAll.mockResolvedValueOnce({ count: 21, rows: [] });

    const result = await listManagementAttendances({ page: 5, limit: 10 });

    expect(result).toEqual({
      data: [],
      pagination: {
        current_page: 5,
        total_pages: 3,
        total_records: 21,
        records_per_page: 10,
        has_next_page: false,
        has_prev_page: true
      }
    });
  });

  it('returns null when detail is missing', async () => {
    findByPk.mockResolvedValueOnce(null);

    await expect(getManagementAttendanceDetail(999)).resolves.toBeNull();
  });
});
