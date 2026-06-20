import { jest } from '@jest/globals';

const mockUserFindAll = jest.fn();
const mockAttendanceFindAll = jest.fn();
const mockGetDisciplineAhpWeights = jest.fn();
const mockCalculateDisciplineIndex = jest.fn();

jest.unstable_mockModule('../src/models/index.js', () => ({
  User: { findAll: mockUserFindAll },
  Attendance: { findAll: mockAttendanceFindAll },
  Role: {}
}));

jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
  default: {
    getDisciplineAhpWeights: mockGetDisciplineAhpWeights,
    calculateDisciplineIndex: mockCalculateDisciplineIndex
  }
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

const makeRes = () => {
  const res = {
    status: jest.fn(() => res),
    json: jest.fn(() => res)
  };
  return res;
};

describe('getAllDisciplineIndices performance contract', () => {
  beforeEach(() => {
    jest.resetModules();
    mockUserFindAll.mockReset();
    mockAttendanceFindAll.mockReset();
    mockGetDisciplineAhpWeights.mockReset();
    mockCalculateDisciplineIndex.mockReset();
  });

  test('uses one users query and one scoped attendance query for N users', async () => {
    const users = [
      {
        id_users: 1,
        full_name: 'A User',
        nip_nim: 'A001',
        email: 'a@example.test',
        role: { role_name: 'User' }
      },
      {
        id_users: 2,
        full_name: 'B User',
        nip_nim: 'B001',
        email: 'b@example.test',
        role: { role_name: 'Management' }
      },
      {
        id_users: 3,
        full_name: 'C User',
        nip_nim: 'C001',
        email: 'c@example.test',
        role: { role_name: 'User' }
      }
    ];

    mockUserFindAll.mockResolvedValue(users);
    mockAttendanceFindAll.mockResolvedValue([
      {
        user_id: 1,
        attendance_date: '2026-05-01',
        time_in: new Date('2026-05-01T08:00:00+07:00'),
        work_hour: 8,
        status_id: 1
      },
      {
        user_id: 2,
        attendance_date: '2026-05-01',
        time_in: new Date('2026-05-01T09:30:00+07:00'),
        work_hour: 7,
        status_id: 2
      },
      {
        user_id: 3,
        attendance_date: '2026-05-01',
        time_in: new Date('2026-05-01T10:00:00+07:00'),
        work_hour: 0,
        status_id: 3
      }
    ]);
    mockGetDisciplineAhpWeights.mockReturnValue({ criteria_weights: { attendance: 1 } });
    mockCalculateDisciplineIndex.mockImplementation(async (metrics) => ({
      score: Math.max(0, 100 - metrics.absenteeism_rate - metrics.lateness_frequency),
      label: `score-${metrics.total_attendances}`,
      breakdown: { metrics }
    }));

    const { getAllDisciplineIndices } = await import('../src/controllers/discipline.controller.js');
    const req = {
      user: { role_name: 'Admin' },
      query: { months: '1', page: '1', limit: '20', sort: 'score_desc' }
    };
    const res = makeRes();
    const next = jest.fn();

    await getAllDisciplineIndices(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockUserFindAll).toHaveBeenCalledTimes(1);
    expect(mockAttendanceFindAll).toHaveBeenCalledTimes(1);
    expect(mockAttendanceFindAll.mock.calls[0][0].where.user_id).toBeDefined();
    expect(mockCalculateDisciplineIndex).toHaveBeenCalledTimes(users.length);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('keeps score-desc ranking stable with mocked FAHP service', async () => {
    mockUserFindAll.mockResolvedValue([
      {
        id_users: 1,
        full_name: 'Low Score',
        nip_nim: 'L001',
        email: 'low@example.test',
        role: { role_name: 'User' }
      },
      {
        id_users: 2,
        full_name: 'High Score',
        nip_nim: 'H001',
        email: 'high@example.test',
        role: { role_name: 'User' }
      }
    ]);
    mockAttendanceFindAll.mockResolvedValue([
      {
        user_id: 1,
        attendance_date: '2026-05-01',
        time_in: new Date('2026-05-01T10:00:00+07:00'),
        work_hour: 0,
        status_id: 3
      },
      {
        user_id: 2,
        attendance_date: '2026-05-01',
        time_in: new Date('2026-05-01T08:00:00+07:00'),
        work_hour: 8,
        status_id: 1
      }
    ]);
    mockGetDisciplineAhpWeights.mockReturnValue({ criteria_weights: { attendance: 1 } });
    mockCalculateDisciplineIndex.mockImplementation(async (metrics) => ({
      score: metrics.alpha_days > 0 ? 10 : 90,
      label: metrics.alpha_days > 0 ? 'Low' : 'High',
      breakdown: { metrics }
    }));

    const { getAllDisciplineIndices } = await import('../src/controllers/discipline.controller.js');
    const res = makeRes();

    await getAllDisciplineIndices(
      { user: { role_name: 'Admin' }, query: { sort: 'score_desc', page: '1', limit: '20' } },
      res,
      jest.fn()
    );

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.discipline_indices.map((row) => row.user_id)).toEqual([2, 1]);
    expect(payload.data.discipline_indices.map((row) => row.discipline_score)).toEqual([90, 10]);
  });
});
