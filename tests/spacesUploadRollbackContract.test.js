import { jest } from '@jest/globals';

describe('Spaces upload rollback contract', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
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
      AttendanceCategory: {}
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

    const req = {
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

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      cookie: jest.fn().mockReturnThis()
    };

    await register(req, res);

    expect(uploadBufferToSpaces).toHaveBeenCalled();
    expect(deleteSpacesObject).toHaveBeenCalledWith('users/77/profile/register-photo.jpg');
    expect(transaction.rollback).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
