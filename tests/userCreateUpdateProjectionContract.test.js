import { jest } from '@jest/globals';

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const fullUserRecord = (overrides = {}) => ({
  id_users: 7,
  full_name: 'Cindy Doe',
  email: 'cindy@example.com',
  nip_nim: 'C11111',
  phone: '081200000000',
  role: { role_name: 'User' },
  position: { position_name: 'Analyst' },
  program: { program_name: 'Program C' },
  division: { division_name: 'Division C' },
  photo_file: {
    photo_url: 'https://cdn.example.com/cindy.jpg',
    photo_updated_at: new Date('2026-07-05T00:00:00.000Z')
  },
  wfh_location: {
    location_id: 31,
    latitude: '-6.200000',
    longitude: '106.800000',
    radius: '100',
    description: null,
    attendance_category: { category_name: 'Work From Home' }
  },
  created_at: new Date('2026-07-05T10:00:00.000Z'),
  updated_at: new Date('2026-07-05T10:00:00.000Z'),
  ...overrides
});

const loadController = async (models) => {
  jest.unstable_mockModule('../src/models/index.js', () => ({
    Photo: {},
    Role: {},
    Program: {},
    Position: {},
    Division: {},
    AttendanceCategory: {},
    Location: {},
    sequelize: {},
    ...models
  }));

  jest.unstable_mockModule('../src/config/spaces.js', () => ({
    buildUserProfilePhotoKey: jest.fn().mockReturnValue('users/7/profile/photo.jpg'),
    uploadBufferToSpaces: jest.fn().mockResolvedValue({
      key: 'users/7/profile/photo.jpg',
      url: 'https://spaces.example.com/users/7/profile/photo.jpg'
    }),
    deleteSpacesObject: jest.fn()
  }));

  jest.unstable_mockModule('../src/utils/logger.js', () => ({
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  }));

  return import('../src/controllers/user.controller.js');
};

const createUserBody = {
  full_name: 'Cindy Doe',
  email: 'cindy@example.com',
  password: 'passw0rd1',
  phone: '081200000000',
  nip_nim: 'C11111',
  id_roles: 3,
  id_programs: 1,
  id_position: 1,
  latitude: -6.2,
  longitude: 106.8
};

describe('POST /users create contract (INF-251)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  const buildCreateMocks = ({ locationCreate }) => {
    const transaction = { commit: jest.fn(), rollback: jest.fn() };
    const newUser = { id_users: 7, update: jest.fn() };

    return {
      transaction,
      models: {
        sequelize: { transaction: jest.fn().mockResolvedValue(transaction) },
        User: {
          findOne: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue(newUser),
          findByPk: jest.fn().mockResolvedValue(fullUserRecord())
        },
        Photo: { create: jest.fn().mockResolvedValue({ id_photos: 3 }) },
        Location: { create: locationCreate }
      }
    };
  };

  test('creates WFH location without fabricated description and with canonical radius default', async () => {
    const locationCreate = jest.fn().mockResolvedValue({ location_id: 31 });
    const { transaction, models } = buildCreateMocks({ locationCreate });
    const { createUser } = await loadController(models);

    const res = buildRes();
    const next = jest.fn();
    await createUser(
      {
        body: { ...createUserBody },
        file: { buffer: Buffer.from('img'), originalname: 'photo.jpg', mimetype: 'image/jpeg' },
        user: { id: 1 }
      },
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(locationCreate).toHaveBeenCalledWith(
      {
        user_id: 7,
        id_attendance_categories: 2,
        latitude: -6.2,
        longitude: 106.8,
        radius: 100,
        description: null
      },
      { transaction }
    );
    expect(transaction.commit).toHaveBeenCalled();
  });

  test('keeps a provided description instead of overwriting it', async () => {
    const locationCreate = jest.fn().mockResolvedValue({ location_id: 31 });
    const { models } = buildCreateMocks({ locationCreate });
    const { createUser } = await loadController(models);

    await createUser(
      {
        body: { ...createUserBody, description: '  Rumah utama  ' },
        file: { buffer: Buffer.from('img'), originalname: 'photo.jpg', mimetype: 'image/jpeg' },
        user: { id: 1 }
      },
      buildRes(),
      jest.fn()
    );

    expect(locationCreate.mock.calls[0][0].description).toBe('Rumah utama');
  });

  test('create response includes created_at and updated_at metadata', async () => {
    const locationCreate = jest.fn().mockResolvedValue({ location_id: 31 });
    const { models } = buildCreateMocks({ locationCreate });
    const { createUser } = await loadController(models);

    const res = buildRes();
    await createUser(
      {
        body: { ...createUserBody },
        file: { buffer: Buffer.from('img'), originalname: 'photo.jpg', mimetype: 'image/jpeg' },
        user: { id: 1 }
      },
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.created_at).toEqual(new Date('2026-07-05T10:00:00.000Z'));
    expect(payload.data.updated_at).toEqual(new Date('2026-07-05T10:00:00.000Z'));
    expect(payload.data.photo).toBe('https://cdn.example.com/cindy.jpg');
    expect(payload.data.photo_updated_at).toEqual(new Date('2026-07-05T00:00:00.000Z'));
  });

  test('failed WFH location write rolls back the whole user transaction', async () => {
    const locationCreate = jest.fn().mockRejectedValue(new Error('locations insert failed'));
    const { transaction, models } = buildCreateMocks({ locationCreate });
    const { createUser } = await loadController(models);

    const res = buildRes();
    const next = jest.fn();
    await createUser(
      {
        body: { ...createUserBody },
        file: { buffer: Buffer.from('img'), originalname: 'photo.jpg', mimetype: 'image/jpeg' },
        user: { id: 1 }
      },
      res,
      next
    );

    expect(transaction.rollback).toHaveBeenCalled();
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('PATCH /users/:id update contract (INF-251)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('update response includes created_at and updated_at metadata', async () => {
    const existingUser = {
      id_users: 7,
      nip_nim: 'C11111',
      update: jest.fn()
    };
    const findByPk = jest
      .fn()
      .mockResolvedValueOnce(existingUser)
      .mockResolvedValueOnce(fullUserRecord());

    const { updateUser } = await loadController({
      User: { findByPk, findOne: jest.fn().mockResolvedValue(null) },
      Location: { findOrCreate: jest.fn().mockResolvedValue([{ update: jest.fn() }, true]) }
    });

    const res = buildRes();
    const next = jest.fn();
    await updateUser(
      { params: { id: '7' }, body: { full_name: 'Cindy Updated' }, user: { id: 1 } },
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.created_at).toEqual(new Date('2026-07-05T10:00:00.000Z'));
    expect(payload.data.updated_at).toEqual(new Date('2026-07-05T10:00:00.000Z'));
    expect(payload.data.photo).toBe('https://cdn.example.com/cindy.jpg');
    expect(payload.data.photo_updated_at).toEqual(new Date('2026-07-05T00:00:00.000Z'));
  });
});
