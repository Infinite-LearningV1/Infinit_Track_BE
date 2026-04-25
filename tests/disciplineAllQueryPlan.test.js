import { jest } from '@jest/globals';

const mockUserFindAll = jest.fn();
const mockAttendanceFindAll = jest.fn();
const mockGetDisciplineAhpWeights = jest.fn(() => ({ lateness: 0.25 }));
const mockCalculateDisciplineIndex = jest.fn(async () => ({
  score: 82,
  label: 'Tinggi'
}));
const mockLoggerInfo = jest.fn();

jest.unstable_mockModule('../src/models/index.js', () => ({
  Attendance: { findAll: mockAttendanceFindAll },
  User: { findAll: mockUserFindAll },
  Role: {}
}));

jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
  default: {
    getDisciplineAhpWeights: mockGetDisciplineAhpWeights,
    calculateDisciplineIndex: mockCalculateDisciplineIndex
  }
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: mockLoggerInfo, warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

const buildRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis()
});

describe('discipline all query plan', () => {
  beforeEach(() => {
    jest.resetModules();
    mockUserFindAll.mockReset();
    mockAttendanceFindAll.mockReset();
    mockGetDisciplineAhpWeights.mockClear();
    mockCalculateDisciplineIndex.mockClear();
    mockLoggerInfo.mockClear();
  });

  test('loads attendance once for all users instead of once per user', async () => {
    mockUserFindAll.mockResolvedValue([
      {
        id_users: 7,
        full_name: 'Febri',
        nip_nim: '001',
        email: 'f@example.com',
        role: { role_name: 'User' }
      },
      {
        id_users: 8,
        full_name: 'Diana',
        nip_nim: '002',
        email: 'd@example.com',
        role: { role_name: 'User' }
      }
    ]);

    mockAttendanceFindAll.mockResolvedValue([
      {
        user_id: 7,
        attendance_date: '2026-04-01',
        time_in: new Date('2026-04-01T08:10:00+07:00'),
        work_hour: 8,
        status_id: 1
      },
      {
        user_id: 8,
        attendance_date: '2026-04-01',
        time_in: new Date('2026-04-01T09:10:00+07:00'),
        work_hour: 7.5,
        status_id: 2
      }
    ]);

    const { getAllDisciplineIndices } = await import('../src/controllers/discipline.controller.js');

    const req = {
      user: { id: 1, role_name: 'Admin' },
      query: { months: '1', page: '1', limit: '20', sort: 'score_desc' }
    };
    const res = buildRes();
    const next = jest.fn();

    await getAllDisciplineIndices(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockUserFindAll).toHaveBeenCalledTimes(1);
    expect(mockAttendanceFindAll).toHaveBeenCalledTimes(1);
    expect(mockLoggerInfo).toHaveBeenCalledWith('Fetched 2 attendance records in 1 query');
    expect(mockCalculateDisciplineIndex).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
