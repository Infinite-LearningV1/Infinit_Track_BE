import { jest } from '@jest/globals';

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const buildUser = (overrides = {}) => ({
  id_users: 5,
  full_name: 'Bob Doe',
  email: 'bob@example.com',
  nip_nim: 'B54321',
  phone: '089876543210',
  role: { role_name: 'Management' },
  position: { position_name: 'Manager' },
  program: { program_name: 'Program B' },
  division: { division_name: 'Division B' },
  photo_file: {
    photo_url: 'https://cdn.example.com/bob.jpg',
    photo_updated_at: new Date('2026-07-03T00:00:00.000Z')
  },
  wfh_location: {
    location_id: 22,
    latitude: '-6.914744',
    longitude: '107.609810',
    radius: '150',
    description: 'Rumah Bandung',
    attendance_category: { category_name: 'Work From Home' }
  },
  created_at: new Date('2026-07-01T10:00:00.000Z'),
  updated_at: new Date('2026-07-02T10:00:00.000Z'),
  ...overrides
});

const loadController = async ({ findOne }) => {
  jest.unstable_mockModule('../src/models/index.js', () => ({
    User: { findOne },
    Photo: {},
    Role: {},
    Program: {},
    Position: {},
    Division: {},
    AttendanceCategory: {},
    Location: {},
    sequelize: {}
  }));

  jest.unstable_mockModule('../src/config/spaces.js', () => ({
    buildUserProfilePhotoKey: jest.fn(),
    uploadBufferToSpaces: jest.fn(),
    deleteSpacesObject: jest.fn()
  }));

  jest.unstable_mockModule('../src/utils/logger.js', () => ({
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  }));

  return import('../src/controllers/user.controller.js');
};

describe('GET /users/:id detail projection contract (INF-261 + INF-251)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('detail keeps the full projection including phone, location, and timestamps', async () => {
    const findOne = jest.fn().mockResolvedValue(buildUser());
    const { getUserById } = await loadController({ findOne });

    const res = buildRes();
    const next = jest.fn();
    await getUserById({ params: { id: '5' }, user: { id: 1 } }, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data).toEqual({
      id: 5,
      full_name: 'Bob Doe',
      email: 'bob@example.com',
      role_name: 'Management',
      position_name: 'Manager',
      program_name: 'Program B',
      division_name: 'Division B',
      nip_nim: 'B54321',
      phone: '089876543210',
      photo: 'https://cdn.example.com/bob.jpg',
      photo_updated_at: new Date('2026-07-03T00:00:00.000Z'),
      location: {
        location_id: 22,
        latitude: -6.914744,
        longitude: 107.60981,
        radius: 150,
        description: 'Rumah Bandung',
        category_name: 'Work From Home'
      },
      created_at: new Date('2026-07-01T10:00:00.000Z'),
      updated_at: new Date('2026-07-02T10:00:00.000Z')
    });
  });

  test('detail keeps nullable photo evidence and an optional photo_file join', async () => {
    const findOne = jest.fn().mockResolvedValue(buildUser({ photo_file: null }));
    const { getUserById } = await loadController({ findOne });

    const res = buildRes();
    await getUserById({ params: { id: '5' }, user: { id: 1 } }, res, jest.fn());

    expect(res.json.mock.calls[0][0].data).toMatchObject({
      photo: null,
      photo_updated_at: null
    });

    const include = findOne.mock.calls[0][0].include;
    expect(include.find((entry) => entry.as === 'photo_file')).toMatchObject({
      attributes: ['photo_url', 'photo_updated_at'],
      required: false
    });
  });

  test('existing user without WFH location returns explicit 409 integrity error, not 404', async () => {
    const findOne = jest.fn().mockResolvedValue(buildUser({ wfh_location: null }));
    const { getUserById } = await loadController({ findOne });

    const res = buildRes();
    await getUserById({ params: { id: '5' }, user: { id: 1 } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.code).toBe('E_USER_LOCATION_INTEGRITY');
  });

  test('WFH association is a left join so a missing location is distinguishable from a missing user', async () => {
    const findOne = jest.fn().mockResolvedValue(buildUser());
    const { getUserById } = await loadController({ findOne });

    await getUserById({ params: { id: '5' }, user: { id: 1 } }, buildRes(), jest.fn());

    const include = findOne.mock.calls[0][0].include;
    const wfhInclude = include.find((entry) => entry.as === 'wfh_location');
    expect(wfhInclude.required).toBe(false);
  });

  test('missing user still returns 404 E_NOT_FOUND', async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const { getUserById } = await loadController({ findOne });

    const res = buildRes();
    await getUserById({ params: { id: '99' }, user: { id: 1 } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].code).toBe('E_NOT_FOUND');
  });
});
