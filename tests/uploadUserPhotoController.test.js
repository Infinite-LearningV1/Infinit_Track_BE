import { jest } from '@jest/globals';

describe('uploadUserPhoto controller', () => {
  const buildRes = () => {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('updates an existing photo row with Spaces metadata and returns Spaces URL', async () => {
    const user = { id_users: 10, id_photos: null };
    const photo = {
      id_photos: 5,
      photo_updated_at: new Date('2026-04-22T10:00:00.000Z'),
      update: jest.fn(async (payload) => {
        Object.assign(photo, payload);
        return photo;
      })
    };

    const uploadBufferToSpaces = jest.fn().mockResolvedValue({
      key: 'users/10/profile/123-profile.jpg',
      url: 'https://infinite-track-staging-sgp1.sgp1.digitaloceanspaces.com/users/10/profile/123-profile.jpg'
    });

    const buildUserProfilePhotoKey = jest
      .fn()
      .mockReturnValue('users/10/profile/123-profile.jpg');

    jest.unstable_mockModule('../src/models/index.js', () => ({
      User: { findByPk: jest.fn().mockResolvedValue(user) },
      Photo: {
        findByPk: jest.fn(),
        findOne: jest.fn().mockResolvedValue(photo),
        create: jest.fn()
      },
      Role: {},
      Program: {},
      Position: {},
      Division: {},
      AttendanceCategory: {},
      Location: {},
      sequelize: {}
    }));

    const deleteSpacesObject = jest.fn();
    jest.unstable_mockModule('../src/config/spaces.js', () => ({
      buildUserProfilePhotoKey,
      uploadBufferToSpaces,
      deleteSpacesObject
    }));

    const destroy = jest.fn().mockResolvedValue({ result: 'not found' });
    jest.unstable_mockModule('../src/config/cloudinary.js', () => ({
      default: { uploader: { destroy } }
    }));

    jest.unstable_mockModule('../src/utils/logger.js', () => ({
      default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    }));

    const { uploadUserPhoto } = await import('../src/controllers/user.controller.js');

    const req = {
      params: { id: '10' },
      file: {
        buffer: Buffer.from('fake-image'),
        originalname: 'profile.jpg',
        mimetype: 'image/jpeg'
      }
    };
    const res = buildRes();
    const next = jest.fn();

    await uploadUserPhoto(req, res, next);

    expect(buildUserProfilePhotoKey).toHaveBeenCalledWith('10', 'profile.jpg');
    expect(uploadBufferToSpaces).toHaveBeenCalledWith({
      key: 'users/10/profile/123-profile.jpg',
      buffer: req.file.buffer,
      contentType: 'image/jpeg'
    });
    expect(photo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        photo_url:
          'https://infinite-track-staging-sgp1.sgp1.digitaloceanspaces.com/users/10/profile/123-profile.jpg',
        storage_provider: 'spaces',
        storage_key: 'users/10/profile/123-profile.jpg',
        photo_updated_at: expect.any(Date)
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          photo:
            'https://infinite-track-staging-sgp1.sgp1.digitaloceanspaces.com/users/10/profile/123-profile.jpg',
          old_photo_deleted: false
        })
      })
    );
    expect(next).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });

  test('deletes legacy Cloudinary asset when replacing a photo that has old public_id metadata', async () => {
    const user = { id_users: 20, id_photos: 12 };
    const oldPhoto = { public_id: 'legacy-cloudinary-public-id' };
    const photo = {
      id_photos: 12,
      photo_updated_at: new Date('2026-04-22T10:00:00.000Z'),
      update: jest.fn(async (payload) => {
        Object.assign(photo, payload);
        return photo;
      })
    };

    const uploadBufferToSpaces = jest.fn().mockResolvedValue({
      key: 'users/20/profile/456-profile.jpg',
      url: 'https://infinite-track-staging-sgp1.sgp1.digitaloceanspaces.com/users/20/profile/456-profile.jpg'
    });

    const buildUserProfilePhotoKey = jest
      .fn()
      .mockReturnValue('users/20/profile/456-profile.jpg');

    jest.unstable_mockModule('../src/models/index.js', () => ({
      User: { findByPk: jest.fn().mockResolvedValue(user) },
      Photo: {
        findByPk: jest.fn().mockResolvedValue(oldPhoto),
        findOne: jest.fn().mockResolvedValue(photo),
        create: jest.fn()
      },
      Role: {},
      Program: {},
      Position: {},
      Division: {},
      AttendanceCategory: {},
      Location: {},
      sequelize: {}
    }));

    const deleteSpacesObject = jest.fn();
    jest.unstable_mockModule('../src/config/spaces.js', () => ({
      buildUserProfilePhotoKey,
      uploadBufferToSpaces,
      deleteSpacesObject
    }));

    const destroy = jest.fn().mockResolvedValue({ result: 'ok' });
    jest.unstable_mockModule('../src/config/cloudinary.js', () => ({
      default: { uploader: { destroy } }
    }));

    jest.unstable_mockModule('../src/utils/logger.js', () => ({
      default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    }));

    const { uploadUserPhoto } = await import('../src/controllers/user.controller.js');

    const req = {
      params: { id: '20' },
      file: {
        buffer: Buffer.from('fake-image'),
        originalname: 'profile.jpg',
        mimetype: 'image/jpeg'
      }
    };
    const res = buildRes();
    const next = jest.fn();

    await uploadUserPhoto(req, res, next);

    expect(destroy).toHaveBeenCalledWith('legacy-cloudinary-public-id');
    expect(photo.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        photo_url:
          'https://infinite-track-staging-sgp1.sgp1.digitaloceanspaces.com/users/20/profile/456-profile.jpg',
        storage_provider: 'spaces',
        storage_key: 'users/20/profile/456-profile.jpg',
        photo_updated_at: expect.any(Date)
      })
    );
    expect(photo.update).toHaveBeenNthCalledWith(2, { public_id: null });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          old_photo_deleted: true
        })
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('keeps legacy public_id when Cloudinary cleanup fails during replacement', async () => {
    const user = { id_users: 21, id_photos: 13 };
    const oldPhoto = { public_id: 'legacy-cloudinary-public-id' };
    const photo = {
      id_photos: 13,
      photo_updated_at: new Date('2026-04-22T10:00:00.000Z'),
      update: jest.fn(async (payload) => {
        Object.assign(photo, payload);
        return photo;
      })
    };

    const uploadBufferToSpaces = jest.fn().mockResolvedValue({
      key: 'users/21/profile/789-profile.jpg',
      url: 'https://infinite-track-staging-sgp1.sgp1.digitaloceanspaces.com/users/21/profile/789-profile.jpg'
    });

    const buildUserProfilePhotoKey = jest
      .fn()
      .mockReturnValue('users/21/profile/789-profile.jpg');

    jest.unstable_mockModule('../src/models/index.js', () => ({
      User: { findByPk: jest.fn().mockResolvedValue(user) },
      Photo: {
        findByPk: jest.fn().mockResolvedValue(oldPhoto),
        findOne: jest.fn().mockResolvedValue(photo),
        create: jest.fn()
      },
      Role: {},
      Program: {},
      Position: {},
      Division: {},
      AttendanceCategory: {},
      Location: {},
      sequelize: {}
    }));

    const deleteSpacesObject = jest.fn();
    jest.unstable_mockModule('../src/config/spaces.js', () => ({
      buildUserProfilePhotoKey,
      uploadBufferToSpaces,
      deleteSpacesObject
    }));

    const destroy = jest.fn().mockRejectedValue(new Error('cloudinary unavailable'));
    jest.unstable_mockModule('../src/config/cloudinary.js', () => ({
      default: { uploader: { destroy } }
    }));

    jest.unstable_mockModule('../src/utils/logger.js', () => ({
      default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    }));

    const { uploadUserPhoto } = await import('../src/controllers/user.controller.js');

    const req = {
      params: { id: '21' },
      file: {
        buffer: Buffer.from('fake-image'),
        originalname: 'profile.jpg',
        mimetype: 'image/jpeg'
      }
    };
    const res = buildRes();
    const next = jest.fn();

    await uploadUserPhoto(req, res, next);

    expect(destroy).toHaveBeenCalledWith('legacy-cloudinary-public-id');
    expect(photo.update).toHaveBeenCalledWith(
      expect.not.objectContaining({
        public_id: null
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          old_photo_deleted: false
        })
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('deletes orphaned Spaces object when metadata persistence fails after upload', async () => {
    const user = { id_users: 30, id_photos: null };
    const persistenceError = new Error('photo update failed');
    const photo = {
      id_photos: 30,
      photo_updated_at: new Date('2026-04-22T10:00:00.000Z'),
      update: jest.fn().mockRejectedValue(persistenceError)
    };

    const uploadBufferToSpaces = jest.fn().mockResolvedValue({
      key: 'users/30/profile/999-profile.jpg',
      url: 'https://infinite-track-staging-sgp1.sgp1.digitaloceanspaces.com/users/30/profile/999-profile.jpg'
    });

    const buildUserProfilePhotoKey = jest
      .fn()
      .mockReturnValue('users/30/profile/999-profile.jpg');

    jest.unstable_mockModule('../src/models/index.js', () => ({
      User: { findByPk: jest.fn().mockResolvedValue(user) },
      Photo: {
        findByPk: jest.fn(),
        findOne: jest.fn().mockResolvedValue(photo),
        create: jest.fn()
      },
      Role: {},
      Program: {},
      Position: {},
      Division: {},
      AttendanceCategory: {},
      Location: {},
      sequelize: {}
    }));

    const deleteSpacesObject = jest.fn().mockResolvedValue({});
    jest.unstable_mockModule('../src/config/spaces.js', () => ({
      buildUserProfilePhotoKey,
      uploadBufferToSpaces,
      deleteSpacesObject
    }));

    jest.unstable_mockModule('../src/config/cloudinary.js', () => ({
      default: { uploader: { destroy: jest.fn() } }
    }));

    jest.unstable_mockModule('../src/utils/logger.js', () => ({
      default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    }));

    const { uploadUserPhoto } = await import('../src/controllers/user.controller.js');

    const req = {
      params: { id: '30' },
      file: {
        buffer: Buffer.from('fake-image'),
        originalname: 'profile.jpg',
        mimetype: 'image/jpeg'
      }
    };
    const res = buildRes();
    const next = jest.fn();

    await uploadUserPhoto(req, res, next);

    expect(deleteSpacesObject).toHaveBeenCalledWith('users/30/profile/999-profile.jpg');
    expect(next).toHaveBeenCalledWith(persistenceError);
    expect(res.json).not.toHaveBeenCalled();
  });
});
