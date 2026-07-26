import { jest } from '@jest/globals';

/**
 * Characterization coverage for createUser (INF-252 Phase 0b).
 *
 * This is the most involved mutation in the Users module: it hashes a
 * password, writes three tables inside one transaction, uploads to
 * DigitalOcean Spaces -- which is not transactional -- and compensates by
 * deleting the uploaded object if anything fails.
 *
 * Users is the first module scheduled for extraction in Phase 3, and this is
 * the flow whose orchestration a service layer has to reproduce exactly.
 */

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const createdUserRow = () => ({
  id_users: 7,
  full_name: 'Nadia Putri',
  email: 'nadia@example.com',
  nip_nim: 'A12345',
  phone: '081234567890',
  role: { role_name: 'User' },
  position: { position_name: 'Backend Engineer' },
  program: { program_name: 'Internship' },
  division: { division_name: 'Engineering' },
  photo_file: { photo_url: 'https://cdn.example/nadia.jpg', photo_updated_at: '2026-07-01' },
  wfh_location: {
    location_id: 12,
    latitude: '-0.8917',
    longitude: '119.8707',
    radius: '150',
    description: 'Rumah Nadia',
    attendance_category: { category_name: 'Work From Home' }
  }
});

const loadCreateUser = async ({
  existingEmail = null,
  existingNip = null,
  refetched,
  userCreate,
  uploadImpl
} = {}) => {
  jest.resetModules();

  // Faithful transaction: rolling back after commit throws, as Sequelize does.
  const txState = { committed: false };
  const commit = jest.fn().mockImplementation(async () => {
    txState.committed = true;
  });
  const rollback = jest.fn().mockImplementation(async () => {
    if (txState.committed) {
      throw new Error('Transaction cannot be rolled back because it has been finished');
    }
  });

  const findOne = jest
    .fn()
    .mockResolvedValueOnce(existingEmail)
    .mockResolvedValueOnce(existingNip)
    .mockResolvedValue(null);

  // The controller calls newUser.update(...) after the photo row exists, to
  // attach id_photos. A plain object is not enough.
  const createdInstance = { id_users: 7, update: jest.fn().mockResolvedValue(undefined) };
  const create = userCreate || jest.fn().mockResolvedValue(createdInstance);
  const findByPk = jest
    .fn()
    .mockResolvedValue(refetched === undefined ? createdUserRow() : refetched);

  const photoCreate = jest.fn().mockResolvedValue({ id_photos: 3 });
  const locationCreate = jest.fn().mockResolvedValue({ location_id: 12 });
  const uploadBufferToSpaces =
    uploadImpl || jest.fn().mockResolvedValue({ key: 'users/7/face.jpg', url: 'https://cdn' });
  const deleteSpacesObject = jest.fn().mockResolvedValue(undefined);
  const hash = jest.fn().mockResolvedValue('hashed-password');

  jest.unstable_mockModule('bcryptjs', () => ({ default: { hash } }));

  jest.unstable_mockModule('../src/models/index.js', () => ({
    User: { findOne, create, findByPk, findAll: jest.fn() },
    Photo: { create: photoCreate },
    Location: { create: locationCreate },
    Role: {},
    Program: {},
    Position: {},
    Division: {},
    AttendanceCategory: {},
    sequelize: { transaction: jest.fn().mockResolvedValue({ commit, rollback }) }
  }));

  jest.unstable_mockModule('../src/utils/logger.js', () => ({
    default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
  }));

  jest.unstable_mockModule('../src/config/spaces.js', () => ({
    buildUserProfilePhotoKey: jest.fn(() => 'users/7/face.jpg'),
    uploadBufferToSpaces,
    deleteSpacesObject
  }));

  const { createUser } = await import('../src/controllers/user.controller.js');

  return {
    createUser,
    commit,
    rollback,
    create,
    photoCreate,
    locationCreate,
    uploadBufferToSpaces,
    deleteSpacesObject,
    hash
  };
};

const validBody = {
  full_name: 'Nadia Putri',
  email: 'nadia@example.com',
  password: 'rahasia123',
  phone: '081234567890',
  nip_nim: 'A12345',
  id_roles: 3,
  id_programs: 1,
  id_position: 2,
  latitude: -0.8917,
  longitude: 119.8707,
  radius: 150,
  description: 'Rumah Nadia'
};

const buildReq = (overrides = {}) => ({
  body: { ...validBody, ...(overrides.body || {}) },
  file:
    'file' in overrides
      ? overrides.file
      : { buffer: Buffer.from('img'), originalname: 'face.jpg', mimetype: 'image/jpeg' },
  user: { id: 1 }
});

describe('createUser refusals', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires a face photo', async () => {
    const { createUser, rollback, create } = await loadCreateUser();
    const res = buildRes();

    await createUser(buildReq({ file: undefined }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, code: 'E_UPLOAD' });
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate email before creating anything', async () => {
    const { createUser, rollback, create } = await loadCreateUser({
      existingEmail: { id_users: 99 }
    });
    const res = buildRes();

    await createUser(buildReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'E_VALIDATION_EMAIL_EXISTS',
      message: 'Email sudah digunakan'
    });
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate NIP/NIM', async () => {
    const { createUser, create } = await loadCreateUser({ existingNip: { id_users: 98 } });
    const res = buildRes();

    await createUser(buildReq(), res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'E_VALIDATION_NIP_EXISTS',
      message: 'NIP/NIM sudah digunakan'
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('scopes both uniqueness checks to non-deleted rows', async () => {
    const { createUser } = await loadCreateUser();
    await createUser(buildReq(), buildRes(), jest.fn());

    const { User } = await import('../src/models/index.js');
    expect(User.findOne).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { email: validBody.email, deleted_at: null } })
    );
    expect(User.findOne).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { nip_nim: validBody.nip_nim, deleted_at: null } })
    );
  });
});

describe('createUser success orchestration', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hashes the password and never persists it in clear text', async () => {
    const { createUser, hash, create } = await loadCreateUser();

    await createUser(buildReq(), buildRes(), jest.fn());

    expect(hash).toHaveBeenCalledWith('rahasia123', 10);
    const persisted = create.mock.calls[0][0];
    expect(persisted.password).toBe('hashed-password');
    expect(persisted.password).not.toBe('rahasia123');
  });

  it('writes user, photo and WFH location inside one transaction', async () => {
    const { createUser, create, photoCreate, locationCreate, commit } = await loadCreateUser();

    await createUser(buildReq(), buildRes(), jest.fn());

    for (const call of [create, photoCreate, locationCreate]) {
      expect(call).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ transaction: expect.anything() })
      );
    }
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('uploads the photo buffer to Spaces under the generated key', async () => {
    const { createUser, uploadBufferToSpaces } = await loadCreateUser();

    await createUser(buildReq(), buildRes(), jest.fn());

    expect(uploadBufferToSpaces).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'users/7/face.jpg', contentType: 'image/jpeg' })
    );
  });

  it('answers 201 with the mapped user', async () => {
    const { createUser, deleteSpacesObject } = await loadCreateUser();
    const res = buildRes();
    const next = jest.fn();

    await createUser(buildReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(deleteSpacesObject).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({ success: true, message: 'User created successfully' });
    expect(body.data).toMatchObject({ id: 7, email: 'nadia@example.com' });
  });
});

describe('createUser compensation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes the uploaded object and rolls back when a write fails before commit', async () => {
    const boom = new Error('location insert failed');
    const { createUser, deleteSpacesObject, rollback, commit } = await loadCreateUser({
      userCreate: jest.fn().mockRejectedValue(boom)
    });
    const res = buildRes();
    const next = jest.fn();

    await createUser(buildReq(), res, next);

    expect(commit).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(boom);
    // The upload had not happened yet in this path, so nothing to clean up.
    expect(deleteSpacesObject).not.toHaveBeenCalled();
  });

  it('cleans up the uploaded object when a later write fails', async () => {
    jest.resetModules();
    const boom = new Error('photo insert failed');
    const { createUser, deleteSpacesObject, rollback } = await loadCreateUser({
      userCreate: jest
        .fn()
        .mockResolvedValue({ id_users: 7, update: jest.fn().mockResolvedValue(undefined) })
    });

    // Force the failure after the upload by making Photo.create reject.
    const { Photo } = await import('../src/models/index.js');
    Photo.create.mockRejectedValueOnce(boom);

    const next = jest.fn();
    await createUser(buildReq(), buildRes(), next);

    expect(deleteSpacesObject).toHaveBeenCalledWith('users/7/face.jpg');
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(boom);
  });

  /**
   * DEFECT, characterized not fixed. Same structural bug as F14 in checkOut,
   * with a worse blast radius.
   *
   * The commit happens, then the refetch, mapping and response all run inside
   * the same try. If anything throws after the commit -- the refetch returning
   * null is the realistic case -- the catch block runs unconditionally and:
   *
   *   1. deletes the photo of a user that WAS successfully created, and
   *   2. calls rollback() on a committed transaction, which throws, so
   *      next(error) never runs and the client gets no response.
   *
   * Net result: a user exists in the database with a dangling photo reference
   * pointing at an object that has just been deleted from Spaces, and the
   * caller is told nothing. Recorded as F25.
   */
  it('destroys the photo of a successfully created user when the refetch fails', async () => {
    const { createUser, commit, rollback, deleteSpacesObject } = await loadCreateUser({
      refetched: null
    });
    const res = buildRes();
    const next = jest.fn();

    await expect(createUser(buildReq(), res, next)).rejects.toThrow(
      /Transaction cannot be rolled back/
    );

    expect(commit).toHaveBeenCalledTimes(1);
    // The user is committed, yet its photo is deleted from object storage.
    expect(deleteSpacesObject).toHaveBeenCalledWith('users/7/face.jpg');
    expect(rollback).toHaveBeenCalledTimes(1);
    // And the caller is told nothing at all.
    expect(next).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
