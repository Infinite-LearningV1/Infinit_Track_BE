import { jest } from '@jest/globals';

const listManagementAttendances = jest.fn();
const getManagementAttendanceDetail = jest.fn();

jest.unstable_mockModule('../src/modules/attendance/attendanceRead.service.js', () => ({
  listManagementAttendances,
  getManagementAttendanceDetail
}));

const { getAllAttendances, getAttendanceDetail } =
  await import('../src/controllers/attendance.controller.js');

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('attendance management read controllers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns service data in the existing list envelope', async () => {
    const expectedPagination = {
      current_page: 2,
      total_pages: 3,
      total_records: 21,
      records_per_page: 10,
      has_next_page: true,
      has_prev_page: true
    };
    listManagementAttendances.mockResolvedValueOnce({ data: [], pagination: expectedPagination });
    const res = buildRes();

    await getAllAttendances({ query: { page: 2, limit: 10 } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Data absensi berhasil diambil',
      data: [],
      pagination: expectedPagination
    });
  });

  it('returns a deterministic 404 when detail is missing', async () => {
    getManagementAttendanceDetail.mockResolvedValueOnce(null);
    const res = buildRes();

    await getAttendanceDetail({ params: { id: 999 } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Data absensi tidak ditemukan.'
    });
  });

  it('forwards a list service error to the error handler', async () => {
    const error = new Error('database unavailable');
    listManagementAttendances.mockRejectedValueOnce(error);
    const res = buildRes();
    const next = jest.fn();

    await getAllAttendances({ query: {} }, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.json).not.toHaveBeenCalled();
  });
});
