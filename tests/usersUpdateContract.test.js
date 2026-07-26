import { jest } from '@jest/globals';

/**
 * Characterization coverage for updateUser (INF-252 Phase 0b).
 *
 * The last Users mutation. Unlike createUser it runs without any transaction,
 * writing the user row and the WFH location as two independent operations --
 * recorded as F26 -- and it reports a NIP conflict in a different shape from
 * the one createUser uses, recorded as F27.
 *
 * Both are pinned as they are, not fixed.
 */

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const existingUserRow = (overrides = {}) => ({
  id_users: 7,
  nip_nim: 'A12345',
  update: jest.fn().mockResolvedValue(undefined),
  ...overrides
});

const refetchedRow = () => ({
  id_users: 7,
  full_name: 'Nadia Putri',
  email: 'nadia@example.com',
  nip_nim: 'A12345',
  phone: '081234567890',
  role: { role_name: 'User' },
  position: { position_name: 'Backend Engineer' },
  program: { program_name: 'Internship' },
  division: { division_name: 'Engineering' },
  photo_file: null,
  wfh_location: null
});

const loadUpdateUser = async ({
  user = existingUserRow(),
  conflictingUser = null,
  locationRow = { location_id: 12, update: jest.fn().mockResolvedValue(undefined) },
  locationCreated = false
} = {}) => {
  jest.resetModules();

  const transaction = jest.fn();
  const findByPk = jest.fn().mockResolvedValueOnce(user).mockResolvedValue(refetchedRow());
  const findOne = jest.fn().mockResolvedValue(conflictingUser);
  const findOrCreate = jest.fn().mockResolvedValue([locationRow, locationCreated]);
  const hash = jest.fn().mockResolvedValue('hashed-password');

  jest.unstable_mockModule('bcryptjs', () => ({ default: { hash } }));

  jest.unstable_mockModule('../src/models/index.js', () => ({
    User: { findByPk, findOne, create: jest.fn(), findAll: jest.fn() },
    Location: { findOrCreate, create: jest.fn(), findOne: jest.fn() },
    Photo: { create: jest.fn() },
    Role: {},
    Program: {},
    Position: {},
    Division: {},
    AttendanceCategory: {},
    sequelize: { transaction }
  }));

  jest.unstable_mockModule('../src/utils/logger.js', () => ({
    default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
  }));

  jest.unstable_mockModule('../src/config/spaces.js', () => ({
    buildUserProfilePhotoKey: jest.fn(),
    uploadBufferToSpaces: jest.fn(),
    deleteSpacesObject: jest.fn()
  }));

  const { updateUser } = await import('../src/controllers/user.controller.js');
  return { updateUser, user, findOne, findOrCreate, locationRow, hash, transaction };
};

const buildReq = (body = {}) => ({ params: { id: '7' }, body, user: { id: 1 } });

describe('updateUser refusals', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 404 when the user does not exist', async () => {
    const { updateUser } = await loadUpdateUser({ user: null });
    const res = buildRes();

    await updateUser(buildReq({ full_name: 'X' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false });
  });

  /**
   * F27, characterized not fixed.
   *
   * createUser answers a NIP conflict with
   *   { success: false, code: 'E_VALIDATION_NIP_EXISTS', message: 'NIP/NIM sudah digunakan' }
   * updateUser answers the same condition with no `code` field at all, and
   * smuggles the code into the message string in a different language.
   */
  it('reports a NIP conflict without a code field, embedding the code in the message', async () => {
    const { updateUser } = await loadUpdateUser({
      conflictingUser: { id_users: 99 }
    });
    const res = buildRes();

    await updateUser(buildReq({ nip_nim: 'B99999' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({
      success: false,
      message: 'E_VALIDATION_NIP_EXISTS: NIP/NIM already exists'
    });
    expect(body).not.toHaveProperty('code');
  });

  it('skips the uniqueness query when the NIP is unchanged', async () => {
    const { updateUser, findOne } = await loadUpdateUser({
      user: existingUserRow({ nip_nim: 'A12345' })
    });

    await updateUser(buildReq({ nip_nim: 'A12345' }), buildRes(), jest.fn());

    expect(findOne).not.toHaveBeenCalled();
  });

  it('excludes the current user from the uniqueness query', async () => {
    const { updateUser, findOne } = await loadUpdateUser();

    await updateUser(buildReq({ nip_nim: 'B99999' }), buildRes(), jest.fn());

    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ nip_nim: 'B99999', deleted_at: null })
      })
    );
  });
});

describe('updateUser partial semantics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes only the fields that were supplied', async () => {
    const { updateUser, user } = await loadUpdateUser();

    await updateUser(buildReq({ full_name: 'Nadia P.' }), buildRes(), jest.fn());

    expect(user.update).toHaveBeenCalledWith({ full_name: 'Nadia P.' });
  });

  it('hashes a supplied password', async () => {
    const { updateUser, user, hash } = await loadUpdateUser();

    await updateUser(buildReq({ password: 'rahasia123' }), buildRes(), jest.fn());

    expect(hash).toHaveBeenCalledWith('rahasia123', 10);
    expect(user.update).toHaveBeenCalledWith({ password: 'hashed-password' });
  });

  it('ignores a blank password rather than hashing it', async () => {
    const { updateUser, user, hash } = await loadUpdateUser();

    await updateUser(buildReq({ password: '   ' }), buildRes(), jest.fn());

    expect(hash).not.toHaveBeenCalled();
    expect(user.update).toHaveBeenCalledWith({});
  });

  it('never writes email, even when one is supplied', async () => {
    const { updateUser, user } = await loadUpdateUser();

    await updateUser(
      buildReq({ full_name: 'Nadia P.', email: 'baru@example.com' }),
      buildRes(),
      jest.fn()
    );

    expect(user.update.mock.calls[0][0]).not.toHaveProperty('email');
  });
});

describe('updateUser WFH location handling', () => {
  beforeEach(() => jest.clearAllMocks());

  it('touches no location when no location field is supplied', async () => {
    const { updateUser, findOrCreate } = await loadUpdateUser();

    await updateUser(buildReq({ full_name: 'Nadia P.' }), buildRes(), jest.fn());

    expect(findOrCreate).not.toHaveBeenCalled();
  });

  it('looks the location up by user and WFH category', async () => {
    const { updateUser, findOrCreate } = await loadUpdateUser();

    await updateUser(buildReq({ latitude: -0.9 }), buildRes(), jest.fn());

    expect(findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ user_id: '7', id_attendance_categories: 2 })
      })
    );
  });

  it('updates an existing location rather than leaving it stale', async () => {
    const locationRow = { location_id: 12, update: jest.fn().mockResolvedValue(undefined) };
    const { updateUser } = await loadUpdateUser({ locationRow, locationCreated: false });

    await updateUser(buildReq({ latitude: -0.9, radius: 200 }), buildRes(), jest.fn());

    expect(locationRow.update).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: -0.9, radius: 200 })
    );
  });

  it('does not re-update a location that findOrCreate just created', async () => {
    const locationRow = { location_id: 12, update: jest.fn() };
    const { updateUser } = await loadUpdateUser({ locationRow, locationCreated: true });

    await updateUser(buildReq({ latitude: -0.9 }), buildRes(), jest.fn());

    expect(locationRow.update).not.toHaveBeenCalled();
  });
});

describe('updateUser atomicity', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * F26, characterized not fixed.
   *
   * createUser wraps its three writes in one transaction. updateUser opens
   * none, so the user row and the WFH location are written independently. A
   * failure between them leaves the user half-updated with no rollback.
   */
  it('writes the user and the location without any transaction', async () => {
    const { updateUser, user, locationRow, transaction } = await loadUpdateUser();

    await updateUser(buildReq({ full_name: 'Nadia P.', latitude: -0.9 }), buildRes(), jest.fn());

    expect(user.update).toHaveBeenCalled();
    expect(locationRow.update).toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('leaves the user row updated when the location write fails', async () => {
    const locationRow = {
      location_id: 12,
      update: jest.fn().mockRejectedValue(new Error('location write failed'))
    };
    const { updateUser, user } = await loadUpdateUser({ locationRow });
    const next = jest.fn();

    await updateUser(buildReq({ full_name: 'Nadia P.', latitude: -0.9 }), buildRes(), next);

    // The user was already written and there is nothing to undo it.
    expect(user.update).toHaveBeenCalledWith({ full_name: 'Nadia P.' });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'location write failed' }));
  });
});

describe('updateUser success payload', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refetches and answers with the mapped user', async () => {
    const { updateUser } = await loadUpdateUser();
    const res = buildRes();
    const next = jest.fn();

    await updateUser(buildReq({ full_name: 'Nadia P.' }), res, next);

    expect(next).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ id: 7, email: 'nadia@example.com' });
  });
});
