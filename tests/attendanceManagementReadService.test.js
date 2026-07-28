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

  const row = {
    id_attendance: 42,
    attendance_date: '2026-07-28',
    time_in: new Date(2026, 6, 28, 8, 2),
    time_out: new Date(2026, 6, 28, 17, 5),
    work_hour: 9.05,
    category_id: 1,
    status_id: 1,
    notes: 'Verified',
    booking_id: 55,
    user: {
      id_users: 7,
      full_name: 'Andi Saputra',
      nip_nim: 'EMP-007',
      email: 'andi@example.com',
      role: { role_name: 'User' }
    },
    attendance_category: { category_name: 'Work From Office' },
    status: { attendance_status_name: 'Tepat Waktu' },
    location: {
      location_id: 1,
      description: 'Palu Office',
      latitude: '-0.900291',
      longitude: '119.877998',
      radius: '100'
    }
  };

  it('maps populated list rows and uses the normalized query options', async () => {
    findAndCountAll.mockResolvedValueOnce({ count: 1, rows: [row] });

    const result = await listManagementAttendances({
      page: 2,
      limit: 20,
      search: 'Andi'
    });

    expect(findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
      limit: 20,
      offset: 20,
      distinct: true
    }));
    expect(result.data).toEqual([expect.objectContaining({
      id_attendance: 42,
      user: { id: 7, full_name: 'Andi Saputra', nip_nim: 'EMP-007', role: 'User' },
      time_in: '08:02',
      time_out: '17:05',
      mode: { key: 'wfo', label: 'WFO' },
      status: { key: 'ontime', label: 'On Time' }
    })]);
  });

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

  it('maps populated detail and requests the full detail projection', async () => {
    findByPk.mockResolvedValueOnce(row);

    const result = await getManagementAttendanceDetail(42);

    expect(findByPk).toHaveBeenCalledWith(42, expect.objectContaining({
      attributes: expect.arrayContaining(['notes', 'booking_id']),
      include: expect.arrayContaining([
        expect.objectContaining({ as: 'user' }),
        expect.objectContaining({ as: 'location' }),
        expect.objectContaining({ as: 'status' }),
        expect.objectContaining({ as: 'attendance_category' })
      ])
    }));
    expect(result).toMatchObject({
      id_attendance: 42,
      notes: 'Verified',
      booking_id: 55,
      user: { email: 'andi@example.com' },
      location: { latitude: -0.900291, longitude: 119.877998, radius: 100 }
    });
  });
});
