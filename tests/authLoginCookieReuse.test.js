import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';

const employeeCookieToken = jwt.sign(
  {
    id: 1,
    email: 'employee@example.com',
    full_name: 'Employee User',
    role_name: 'User'
  },
  'test-secret',
  { expiresIn: '2h' }
);

const mockUser = {
  id_users: 2,
  email: 'management@example.com',
  password: 'hashed-password',
  full_name: 'Management User',
  id_roles: 2,
  role: { id_roles: 2, role_name: 'Management' },
  program: null,
  position: null,
  division: null,
  photo_file: null,
  nip_nim: 'MGT-001',
  phone: '08123456789'
};

jest.unstable_mockModule('express-validator', () => ({
  validationResult: jest.fn(() => ({
    isEmpty: () => true,
    array: () => []
  }))
}));

jest.unstable_mockModule('bcryptjs', () => ({
  default: {
    compare: jest.fn(async () => true)
  }
}));

const mockUserFindOne = jest.fn(async () => mockUser);
const mockUserFindByPk = jest.fn(async () => mockUser);
const mockTransaction = {
  LOCK: {
    UPDATE: 'UPDATE'
  },
  commit: jest.fn(async () => undefined),
  rollback: jest.fn(async () => undefined)
};
const mockSequelizeTransaction = jest.fn(async () => mockTransaction);
const mockAuthSession = {
  create: jest.fn(async (payload) => ({
    session_id: 42,
    refresh_jti: payload.refresh_jti
  })),
  update: jest.fn(async () => [0])
};

jest.unstable_mockModule('../src/config/index.js', () => ({
  default: {
    jwt: {
      secret: 'test-secret',
      refreshSecret: 'refresh-secret',
      ttl: 7200,
      accessTtl: 7200,
      refreshTtl: 2592000,
      refreshInactivityWindowSeconds: 172800
    }
  }
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  User: {
    findOne: mockUserFindOne,
    findByPk: mockUserFindByPk
  },
  Photo: {},
  Role: {
    findByPk: jest.fn()
  },
  Program: {},
  Position: {},
  Division: {},
  AttendanceCategory: {},
  AuthSession: mockAuthSession
}));

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: {
    transaction: mockSequelizeTransaction
  }
}));

jest.unstable_mockModule('../src/models/location.js', () => ({
  default: {
    findOne: jest.fn(async () => null)
  }
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn()
  }
}));

jest.unstable_mockModule('../src/config/spaces.js', () => ({
  buildUserProfilePhotoKey: jest.fn(),
  uploadBufferToSpaces: jest.fn(),
  deleteSpacesObject: jest.fn()
}));

const { login } = await import('../src/controllers/auth.controller.js');

function createRequest() {
  return {
    body: {
      email: 'management@example.com',
      password: 'correct-password'
    },
    cookies: {
      token: employeeCookieToken
    },
    headers: {},
    get: jest.fn(() => 'Mozilla/5.0')
  };
}

function createResponse() {
  return {
    cookie: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
  };
}

describe('auth login cookie token reuse', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not reuse a valid cookie token that belongs to a different authenticated user', async () => {
    const req = createRequest();
    const res = createResponse();

    await login(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          id: 2,
          email: 'management@example.com',
          role_name: 'Management',
          token: expect.any(String)
        })
      })
    );

    const responseBody = res.json.mock.calls[0][0];

    expect(responseBody.data.token).not.toBe(employeeCookieToken);

    const decodedResponseToken = jwt.verify(responseBody.data.token, 'test-secret');
    expect(decodedResponseToken).toEqual(
      expect.objectContaining({
        id: 2,
        email: 'management@example.com',
        full_name: 'Management User',
        role_name: 'Management'
      })
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'token',
      responseBody.data.token,
      expect.objectContaining({
        httpOnly: true,
        maxAge: 7200000
      })
    );
  });

  it('ignores an existing cookie token and issues fresh login credentials', async () => {
    const verifySpy = jest.spyOn(jwt, 'verify').mockImplementation(() => {
      throw new jwt.NotBeforeError('jwt not active', new Date());
    });

    const req = createRequest();
    const res = createResponse();

    await login(req, res);

    expect(verifySpy).not.toHaveBeenCalled();
    expect(mockAuthSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 2,
        client_type: 'web'
      }),
      { transaction: mockTransaction }
    );
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          token: expect.any(String)
        })
      })
    );
    expect(res.cookie).toHaveBeenCalled();
  });

  it('does not fail login when an existing cookie token would be unreadable', async () => {
    const verifySpy = jest.spyOn(jwt, 'verify').mockImplementation(() => {
      throw new Error('jwt library unavailable');
    });

    const req = createRequest();
    const res = createResponse();

    await login(req, res);

    expect(verifySpy).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          token: expect.any(String)
        })
      })
    );
    expect(res.cookie).toHaveBeenCalled();
  });
});
