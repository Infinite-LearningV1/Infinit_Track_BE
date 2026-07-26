import { jest } from '@jest/globals';

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const buildUser = (overrides = {}) => ({
  id_users: 1,
  full_name: 'Alice Doe',
  email: 'alice@example.com',
  nip_nim: 'A12345',
  phone: '081234567890',
  role: { role_name: 'User' },
  position: { position_name: 'Engineer' },
  program: { program_name: 'Program A' },
  division: { division_name: 'Division A' },
  photo_file: {
    photo_url: 'https://cdn.example.com/photo.jpg',
    photo_updated_at: new Date('2026-07-01T00:00:00.000Z')
  },
  wfh_location: {
    location_id: 10,
    latitude: '-6.200000',
    longitude: '106.800000',
    radius: '100',
    description: 'Rumah utama',
    attendance_category: { category_name: 'Work From Home' }
  },
  created_at: new Date('2026-07-01T10:00:00.000Z'),
  updated_at: new Date('2026-07-02T10:00:00.000Z'),
  ...overrides
});

const loadController = async ({ findAll }) => {
  jest.unstable_mockModule('../src/models/index.js', () => ({
    User: { findAll },
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

describe('GET /users list projection contract (INF-261 + INF-251)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('list row exposes slim projection with location status and timestamps', async () => {
    const findAll = jest.fn().mockResolvedValue([buildUser()]);
    const { getAllUsers } = await loadController({ findAll });

    const res = buildRes();
    const next = jest.fn();
    await getAllUsers({ query: {} }, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);

    const row = payload.data[0];
    expect(row).toEqual({
      id: 1,
      full_name: 'Alice Doe',
      email: 'alice@example.com',
      role_name: 'User',
      position_name: 'Engineer',
      program_name: 'Program A',
      division_name: 'Division A',
      nip_nim: 'A12345',
      photo: 'https://cdn.example.com/photo.jpg',
      photo_updated_at: new Date('2026-07-01T00:00:00.000Z'),
      location_status: 'configured',
      created_at: new Date('2026-07-01T10:00:00.000Z'),
      updated_at: new Date('2026-07-02T10:00:00.000Z')
    });
  });

  test('list row never leaks phone or raw coordinate fields', async () => {
    const findAll = jest.fn().mockResolvedValue([buildUser()]);
    const { getAllUsers } = await loadController({ findAll });

    const res = buildRes();
    await getAllUsers({ query: {} }, res, jest.fn());

    const row = res.json.mock.calls[0][0].data[0];
    expect(row).not.toHaveProperty('phone');
    expect(row).not.toHaveProperty('location');
    expect(row).not.toHaveProperty('latitude');
    expect(row).not.toHaveProperty('longitude');
    expect(row).not.toHaveProperty('radius');
    expect(row).not.toHaveProperty('description');
  });

  test('user without WFH location stays visible and is flagged as integrity error', async () => {
    const findAll = jest
      .fn()
      .mockResolvedValue([buildUser({ id_users: 2, wfh_location: null })]);
    const { getAllUsers } = await loadController({ findAll });

    const res = buildRes();
    await getAllUsers({ query: {} }, res, jest.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].id).toBe(2);
    expect(payload.data[0].location_status).toBe('integrity_error');
  });

  test('WFH association is a left join so invalid users are not silently hidden', async () => {
    const findAll = jest.fn().mockResolvedValue([]);
    const { getAllUsers } = await loadController({ findAll });

    await getAllUsers({ query: {} }, buildRes(), jest.fn());

    const include = findAll.mock.calls[0][0].include;
    const wfhInclude = include.find((entry) => entry.as === 'wfh_location');
    expect(wfhInclude.required).toBe(false);
  });
});
