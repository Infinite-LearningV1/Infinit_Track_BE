import { jest } from '@jest/globals';

function buildRegisterRequest() {
  return {
    body: {
      email: 'new.user@example.com',
      password: 'Password123!',
      id_roles: 1,
      id_position: 2,
      full_name: 'New User',
      nipNim: '123456',
      phoneNumber: '08123',
      id_divisions: 3,
      id_programs: 4,
      latitude: '-6.2',
      longitude: '106.8',
      radius: 100,
      description: 'WFH'
    },
    file: {
      buffer: Buffer.from('fake-image'),
      originalname: 'register-photo.jpg',
      mimetype: 'image/jpeg'
    },
    headers: {},
    get: jest.fn(() => 'Mozilla/5.0')
  };
}

function buildResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis()
  };
}

describe('Spaces upload rollback contract', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('register issues a protected-route-compatible access token with a linked auth session', async () => {
    const transaction = {
      rollback: jest.fn(),
      commit: jest.fn()
    };

    const user = {
      id_users: 77,
      email: 'new.user@example.com',
      full_name: 'New User',
      update: jest.fn()
    };

    const userWithRole = {
      id_users: 77,
      email: 'new.user@example.com',
      full_name: 'New User',
      role: { role_name: 'Employee' }
    };

    const User = {
      findOne: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
      create: jest.fn().mockResolvedValue(user),
      findByPk: jest.fn().mockResolvedValue(userWithRole)
    };

    const Photo = {
      create: jest.fn().mockResolvedValue({ id_photos: 15 })
    };

    const Location = {
      create: jest.fn().mockResolvedValue({
        location_id: 9,
        latitude: -6.2,
        longitude: 106.8,
        radius: 100,
        description: 'WFH'
      })
    };

    const AuthSession = {
      create: jest.fn().mockResolvedValue({ session_id: 321 })
    };

    const uploadBufferToSpaces = jest.fn().mockResolvedValue({
      key: 'users/77/profile/register-photo.jpg',
      url: 'https://infinite-track-staging-sgp1.sgp1.digitaloceanspaces.com/users/77/profile/register-photo.jpg'
    });

    const deleteSpacesObject = jest.fn().mockResolvedValue(undefined);
    const buildUserProfilePhotoKey = jest
      .fn()
      .mockReturnValue('users/77/profile/register-photo.jpg');
    const hash = jest.fn().mockResolvedValue('hashed');
    const sign = jest
      .fn()
      .mockReturnValueOnce('register-access-token')
      .mockReturnValueOnce('register-refresh-token');

    jest.unstable_mockModule('../src/config/database.js', () => ({
      default: { transaction: jest.fn().mockResolvedValue(transaction) }
    }));

    jest.unstable_mockModule('../src/models/index.js', () => ({
      User,
      Photo,
      Role: {},
      Program: {},
      Position: {},
      Division: {},
      AttendanceCategory: {},
      AuthSession
    }));

    jest.unstable_mockModule('../src/models/location.js', () => ({
      default: Location
    }));

    jest.unstable_mockModule('../src/config/spaces.js', () => ({
      buildUserProfilePhotoKey,
      uploadBufferToSpaces,
      deleteSpacesObject
    }));

    jest.unstable_mockModule('../src/config/index.js', () => ({
      default: {
        jwt: {
          secret: 'test-secret',
          refreshSecret: 'refresh-secret',
          ttl: 900,
          accessTtl: 900,
          refreshTtl: 2592000
        }
      }
    }));

    jest.unstable_mockModule('bcryptjs', () => ({
      default: { hash }
    }));

    jest.unstable_mockModule('jsonwebtoken', () => ({
      default: { sign }
    }));

    jest.unstable_mockModule('../src/utils/logger.js', () => ({
      default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    }));

    const { register } = await import('../src/controllers/auth.controller.js');

    const req = buildRegisterRequest();
    const res = buildResponse();

    await register(req, res);

    expect(AuthSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 77,
        client_type: 'web',
        user_agent: 'Mozilla/5.0',
        refresh_jti: expect.any(String),
        last_activity_at: expect.any(Date),
        expires_at: expect.any(Date)
      }),
      { transaction }
    );
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 321,
        id: 77,
        email: 'new.user@example.com',
        full_name: 'New User',
        role_name: 'Employee',
        photo:
          'https://infinite-track-staging-sgp1.sgp1.digitaloceanspaces.com/users/77/profile/register-photo.jpg'
      }),
      'test-secret',
      { expiresIn: 900 }
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'token',
      'register-access-token',
      expect.objectContaining({ httpOnly: true })
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'register-refresh-token',
      expect.objectContaining({ httpOnly: true })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(transaction.commit).toHaveBeenCalled();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  test('register deletes uploaded Spaces object when photo persistence fails after upload', async () => {
    const transaction = {
      rollback: jest.fn(),
      commit: jest.fn()
    };

    const user = {
      id_users: 77,
      email: 'new.user@example.com',
      full_name: 'New User',
      update: jest.fn()
    };

    const User = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(user),
      findByPk: jest.fn()
    };

    const Photo = {
      create: jest.fn().mockRejectedValue(new Error('photo create failed'))
    };

    const uploadBufferToSpaces = jest.fn().mockResolvedValue({
      key: 'users/77/profile/register-photo.jpg',
      url: 'https://infinite-track-staging-sgp1.sgp1.digitaloceanspaces.com/users/77/profile/register-photo.jpg'
    });

    const deleteSpacesObject = jest.fn().mockResolvedValue(undefined);
    const buildUserProfilePhotoKey = jest
      .fn()
      .mockReturnValue('users/77/profile/register-photo.jpg');

    jest.unstable_mockModule('../src/config/database.js', () => ({
      default: { transaction: jest.fn().mockResolvedValue(transaction) }
    }));

    jest.unstable_mockModule('../src/models/index.js', () => ({
      User,
      Photo,
      Role: {},
      Program: {},
      Position: {},
      Division: {},
      AttendanceCategory: {},
      AuthSession: {}
    }));

    jest.unstable_mockModule('../src/models/location.js', () => ({
      default: { create: jest.fn() }
    }));

    jest.unstable_mockModule('../src/config/spaces.js', () => ({
      buildUserProfilePhotoKey,
      uploadBufferToSpaces,
      deleteSpacesObject
    }));

    jest.unstable_mockModule('../src/config/index.js', () => ({
      default: { jwt: { secret: 'test-secret', ttl: '1h' } }
    }));

    jest.unstable_mockModule('bcryptjs', () => ({
      default: { hash: jest.fn().mockResolvedValue('hashed') }
    }));

    jest.unstable_mockModule('jsonwebtoken', () => ({
      default: { sign: jest.fn().mockReturnValue('jwt-token') }
    }));

    jest.unstable_mockModule('../src/utils/logger.js', () => ({
      default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    }));

    const { register } = await import('../src/controllers/auth.controller.js');

    const req = buildRegisterRequest();
    const res = buildResponse();

    await register(req, res);

    expect(uploadBufferToSpaces).toHaveBeenCalled();
    expect(deleteSpacesObject).toHaveBeenCalledWith('users/77/profile/register-photo.jpg');
    expect(transaction.rollback).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
