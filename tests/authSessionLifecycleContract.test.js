import { jest } from '@jest/globals';

const mockValidationResult = jest.fn();
const mockCompare = jest.fn();
const mockSign = jest.fn();
const mockVerify = jest.fn();
const mockUserFindOne = jest.fn();
const mockUserFindByPk = jest.fn();
const mockAuthSessionCreate = jest.fn();
const mockAuthSessionFindByPk = jest.fn();
const mockAuthSessionUpdate = jest.fn();
const mockSessionUpdate = jest.fn();
const mockTransaction = {
  LOCK: {
    UPDATE: 'UPDATE'
  },
  commit: jest.fn(),
  rollback: jest.fn()
};
const mockSequelizeTransaction = jest.fn();
const mockLocationFindOne = jest.fn();
const mockRoleFindByPk = jest.fn();
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

jest.unstable_mockModule('express-validator', () => ({
  validationResult: mockValidationResult
}));

jest.unstable_mockModule('jsonwebtoken', () => ({
  default: {
    sign: mockSign,
    verify: mockVerify
  }
}));

jest.unstable_mockModule('bcryptjs', () => ({
  default: {
    compare: mockCompare
  }
}));

jest.unstable_mockModule('../src/config/index.js', () => ({
  default: {
    jwt: {
      secret: 'access-secret',
      refreshSecret: 'refresh-secret',
      ttl: 900,
      accessTtl: 900,
      refreshTtl: 2592000,
      refreshInactivityWindowSeconds: 172800
    }
  }
}));

jest.unstable_mockModule('../src/config/cloudinary.js', () => ({
  default: {}
}));

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: {
    transaction: mockSequelizeTransaction
  }
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  User: {
    findOne: mockUserFindOne,
    findByPk: mockUserFindByPk
  },
  Photo: {},
  Role: {
    findByPk: mockRoleFindByPk
  },
  Program: {},
  Position: {},
  Division: {},
  AttendanceCategory: {},
  AuthSession: {
    create: mockAuthSessionCreate,
    findByPk: mockAuthSessionFindByPk,
    update: mockAuthSessionUpdate
  }
}));

jest.unstable_mockModule('../src/models/location.js', () => ({
  default: {
    findOne: mockLocationFindOne
  }
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: mockLogger
}));

const { login, logout } = await import('../src/controllers/auth.controller.js');

function createLoginUser(overrides = {}) {
  return {
    id_users: 5,
    full_name: 'User Example',
    email: 'user@example.com',
    password: 'hashed-password',
    role: { role_name: 'Admin' },
    position: null,
    program: null,
    division: null,
    nip_nim: 'EMP-001',
    phone: '08123',
    photo_file: null,
    ...overrides
  };
}

function createLoginRequest(userAgent, headers = {}) {
  return {
    body: {
      email: 'user@example.com',
      password: 'password123'
    },
    headers,
    cookies: {},
    get: jest.fn((header) => (header === 'User-Agent' ? userAgent : ''))
  };
}

function createResponse() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis()
  };
}

describe('Auth session lifecycle contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidationResult.mockReturnValue({
      isEmpty: () => true,
      array: () => []
    });
    mockCompare.mockResolvedValue(true);
    mockUserFindByPk.mockResolvedValue(createLoginUser());
    mockLocationFindOne.mockResolvedValue(null);
    mockAuthSessionUpdate.mockResolvedValue([0]);
    mockTransaction.commit.mockResolvedValue(undefined);
    mockTransaction.rollback.mockResolvedValue(undefined);
    mockSequelizeTransaction.mockResolvedValue(mockTransaction);
    mockRoleFindByPk.mockReset();
    mockVerify.mockReset();
  });

  it('creates a refresh-backed web session and sets both auth cookies on login', async () => {
    mockUserFindOne.mockResolvedValue(createLoginUser());
    mockAuthSessionCreate.mockResolvedValue({ session_id: 77 });
    mockSign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');

    const req = createLoginRequest('Mozilla/5.0');
    const res = createResponse();

    await login(req, res);

    expect(mockAuthSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 5,
        client_type: 'web',
        user_agent: 'Mozilla/5.0',
        refresh_jti: expect.any(String),
        last_activity_at: expect.any(Date),
        expires_at: expect.any(Date)
      }),
      { transaction: mockTransaction }
    );
    expect(res.cookie).toHaveBeenNthCalledWith(
      1,
      'token',
      'access-token',
      expect.objectContaining({
        httpOnly: true,
        maxAge: 900000
      })
    );
    expect(res.cookie).toHaveBeenNthCalledWith(
      2,
      'refresh_token',
      'refresh-token',
      expect.objectContaining({
        httpOnly: true,
        maxAge: 2592000000
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          id: 5,
          token: 'access-token',
          auth: {
            access_token: 'access-token'
          }
        })
      })
    );
  });

  it('creates a refresh-backed android session and returns refresh token in JSON on login', async () => {
    mockUserFindOne.mockResolvedValue(createLoginUser());
    mockAuthSessionCreate.mockResolvedValue({ session_id: 78 });
    mockSign.mockReturnValueOnce('android-access-token').mockReturnValueOnce('android-refresh-token');

    const req = createLoginRequest('okhttp/4.12.0');
    const res = createResponse();

    await login(req, res);

    expect(mockAuthSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 5,
        client_type: 'android',
        user_agent: 'okhttp/4.12.0',
        refresh_jti: expect.any(String),
        last_activity_at: expect.any(Date),
        expires_at: expect.any(Date)
      }),
      { transaction: mockTransaction }
    );
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          id: 5,
          token: 'android-access-token',
          refresh_token: 'android-refresh-token',
          auth: {
            access_token: 'android-access-token',
            refresh_token: 'android-refresh-token'
          }
        })
      })
    );
  });

  it('keeps iPhone browser login on the web cookie flow', async () => {
    mockUserFindOne.mockResolvedValue(createLoginUser());
    mockAuthSessionCreate.mockResolvedValue({ session_id: 79 });
    mockSign.mockReturnValueOnce('iphone-access-token').mockReturnValueOnce('iphone-refresh-token');

    const req = createLoginRequest(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    );
    const res = createResponse();

    await login(req, res);

    expect(mockAuthSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 5,
        client_type: 'web'
      }),
      { transaction: mockTransaction }
    );
    expect(res.cookie).toHaveBeenCalledTimes(2);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          id: 5
        })
      })
    );
  });

  it('prefers explicit web client header when user agent does not look like a browser', async () => {
    mockUserFindOne.mockResolvedValue(createLoginUser());
    mockAuthSessionCreate.mockResolvedValue({ session_id: 80 });
    mockSign.mockReturnValueOnce('header-web-access-token').mockReturnValueOnce('header-web-refresh-token');

    const req = createLoginRequest('InfiniteTrackWeb/1.0', {
      'x-client-type': 'web'
    });
    const res = createResponse();

    await login(req, res);

    expect(mockAuthSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 5,
        client_type: 'web',
        user_agent: 'InfiniteTrackWeb/1.0'
      }),
      { transaction: mockTransaction }
    );
    expect(res.cookie).toHaveBeenCalledTimes(2);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          auth: {
            access_token: 'header-web-access-token'
          }
        })
      })
    );
    expect(res.json.mock.calls[0][0].data.auth).not.toHaveProperty('refresh_token');
    expect(res.json.mock.calls[0][0].data).not.toHaveProperty('refresh_token');
  });

  it('uses explicit mobile client header for native JSON transport', async () => {
    mockUserFindOne.mockResolvedValue(createLoginUser());
    mockAuthSessionCreate.mockResolvedValue({ session_id: 81 });
    mockSign.mockReturnValueOnce('mobile-access-token').mockReturnValueOnce('mobile-refresh-token');

    const req = createLoginRequest('Mozilla/5.0', {
      'x-client-type': 'mobile'
    });
    const res = createResponse();

    await login(req, res);

    expect(mockAuthSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 5,
        client_type: 'mobile',
        user_agent: 'Mozilla/5.0'
      }),
      { transaction: mockTransaction }
    );
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          token: 'mobile-access-token',
          refresh_token: 'mobile-refresh-token',
          auth: {
            access_token: 'mobile-access-token',
            refresh_token: 'mobile-refresh-token'
          }
        })
      })
    );
  });

  it('keeps android client header as a backward-compatible native alias', async () => {
    mockUserFindOne.mockResolvedValue(createLoginUser());
    mockAuthSessionCreate.mockResolvedValue({ session_id: 82 });
    mockSign.mockReturnValueOnce('alias-access-token').mockReturnValueOnce('alias-refresh-token');

    const req = createLoginRequest('Mozilla/5.0', {
      'x-client-type': 'android'
    });
    const res = createResponse();

    await login(req, res);

    expect(mockAuthSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 5,
        client_type: 'android',
        user_agent: 'Mozilla/5.0'
      }),
      { transaction: mockTransaction }
    );
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          auth: {
            access_token: 'alias-access-token',
            refresh_token: 'alias-refresh-token'
          }
        })
      })
    );
  });

  it('uses resolved fallback role name in login response and token payload when eager-loaded role is missing', async () => {
    mockUserFindOne.mockResolvedValue(
      createLoginUser({
        id_roles: 9,
        role: null
      })
    );
    mockRoleFindByPk.mockResolvedValue({ role_name: 'Management' });
    mockAuthSessionCreate.mockResolvedValue({ session_id: 79 });
    mockSign.mockReturnValueOnce('fallback-access-token').mockReturnValueOnce('fallback-refresh-token');

    const req = createLoginRequest('okhttp/4.12.0');
    const res = createResponse();

    await login(req, res);

    expect(mockRoleFindByPk).toHaveBeenCalledWith(9);
    expect(mockSign).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        role_name: 'Management'
      }),
      'access-secret',
      expect.objectContaining({
        expiresIn: 900
      })
    );
    expect(mockSign).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        role_name: 'Management'
      }),
      'refresh-secret',
      expect.objectContaining({
        expiresIn: 2592000
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          role_name: 'Management',
          token: 'fallback-access-token',
          refresh_token: 'fallback-refresh-token',
          auth: {
            access_token: 'fallback-access-token',
            refresh_token: 'fallback-refresh-token'
          }
        })
      })
    );
  });

  it('revokes previous active sessions for the same user and client type before login creates a new session', async () => {
    mockUserFindOne.mockResolvedValue(createLoginUser());
    mockAuthSessionCreate.mockResolvedValue({ session_id: 83 });
    mockSign.mockReturnValueOnce('replacement-access-token').mockReturnValueOnce('replacement-refresh-token');

    const req = createLoginRequest('Mozilla/5.0', {
      'x-client-type': 'web'
    });
    const res = createResponse();

    await login(req, res);

    expect(mockAuthSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        revoked_at: expect.any(Date),
        revocation_reason: 'replaced_by_new_login'
      }),
      {
        where: {
          user_id: 5,
          client_type: 'web',
          revoked_at: null
        },
        transaction: mockTransaction
      }
    );
    expect(mockUserFindByPk).toHaveBeenCalledWith(5, {
      lock: mockTransaction.LOCK.UPDATE,
      transaction: mockTransaction
    });
    expect(mockUserFindByPk.mock.invocationCallOrder[0]).toBeLessThan(
      mockAuthSessionUpdate.mock.invocationCallOrder[0]
    );
    expect(mockAuthSessionUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mockAuthSessionCreate.mock.invocationCallOrder[0]
    );
    expect(mockAuthSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 5,
        client_type: 'web'
      }),
      { transaction: mockTransaction }
    );
    expect(mockTransaction.commit).toHaveBeenCalledTimes(1);
    expect(mockTransaction.rollback).not.toHaveBeenCalled();
  });

  it('only revokes active sessions for the resolved client type when another client type logs in', async () => {
    mockUserFindOne.mockResolvedValue(createLoginUser());
    mockAuthSessionCreate.mockResolvedValue({ session_id: 84 });
    mockSign.mockReturnValueOnce('mobile-replacement-access-token').mockReturnValueOnce('mobile-replacement-refresh-token');

    const req = createLoginRequest('okhttp/4.12.0', {
      'x-client-type': 'mobile'
    });
    const res = createResponse();

    await login(req, res);

    expect(mockAuthSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        revoked_at: expect.any(Date),
        revocation_reason: 'replaced_by_new_login'
      }),
      {
        where: {
          user_id: 5,
          client_type: 'mobile',
          revoked_at: null
        },
        transaction: mockTransaction
      }
    );
    expect(mockAuthSessionUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 5,
          client_type: 'web'
        })
      })
    );
  });

  it('returns generic login failure when session persistence breaks after valid credentials', async () => {
    const sessionError = new Error('auth_sessions table missing');
    mockUserFindOne.mockResolvedValue(createLoginUser());
    mockAuthSessionCreate.mockRejectedValue(sessionError);

    const req = createLoginRequest('Mozilla/5.0');
    const res = createResponse();

    await login(req, res);

    expect(mockCompare).toHaveBeenCalledWith('password123', 'hashed-password');
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'E_LOGIN',
      message: 'Terjadi kesalahan pada server'
    });
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Login error: auth_sessions table missing',
      expect.objectContaining({
        stack: expect.any(String)
      })
    );
  });

  it('preserves the original login error when rollback also fails', async () => {
    const sessionError = new Error('auth_sessions table missing');
    const rollbackError = new Error('rollback connection lost');
    mockUserFindOne.mockResolvedValue(createLoginUser());
    mockAuthSessionCreate.mockRejectedValue(sessionError);
    mockTransaction.rollback.mockRejectedValue(rollbackError);

    const req = createLoginRequest('Mozilla/5.0');
    const res = createResponse();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Login session replacement rollback failed: rollback connection lost',
      expect.objectContaining({
        original_error: 'auth_sessions table missing',
        stack: expect.any(String),
        user_id: 5,
        client_type: 'web'
      })
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Login error: auth_sessions table missing',
      expect.objectContaining({
        stack: expect.any(String)
      })
    );
  });

  it('revokes the authenticated refresh session and clears both auth cookies on logout', async () => {
    mockAuthSessionFindByPk.mockResolvedValue({
      update: mockSessionUpdate
    });

    const req = {
      user: {
        session_id: 77
      }
    };
    const res = createResponse();

    await logout(req, res);

    expect(mockAuthSessionFindByPk).toHaveBeenCalledWith(77);
    expect(mockSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        revoked_at: expect.any(Date),
        revocation_reason: 'logout'
      })
    );
    expect(res.clearCookie).toHaveBeenCalledWith('token');
    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Logout successful'
    });
  });

  it('revokes the refresh session on logout even when only refresh token is available', async () => {
    mockVerify.mockReturnValue({
      session_id: 88
    });
    mockAuthSessionFindByPk.mockResolvedValue({
      update: mockSessionUpdate
    });

    const req = {
      body: {
        refresh_token: 'refresh-token'
      },
      cookies: {},
      headers: {}
    };
    const res = createResponse();

    await logout(req, res);

    expect(mockVerify).toHaveBeenCalledWith('refresh-token', 'refresh-secret');
    expect(mockAuthSessionFindByPk).toHaveBeenCalledWith(88);
    expect(mockSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        revoked_at: expect.any(Date),
        revocation_reason: 'logout'
      })
    );
    expect(res.clearCookie).toHaveBeenCalledWith('token');
    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Logout successful'
    });
  });

  it('clears cookies and logs when logout tokens cannot identify a session', async () => {
    const invalidRefreshError = new Error('jwt malformed');
    invalidRefreshError.name = 'JsonWebTokenError';
    mockVerify.mockImplementation(() => {
      throw invalidRefreshError;
    });

    const req = {
      body: {
        refresh_token: 'invalid-refresh-token'
      },
      cookies: {},
      headers: {}
    };
    const res = createResponse();

    await logout(req, res);

    expect(mockAuthSessionFindByPk).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Logout refresh token could not identify session: jwt malformed'
    );
    expect(res.clearCookie).toHaveBeenCalledWith('token');
    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Logout successful'
    });
  });

  it('clears cookies and returns generic 500 when logout session lookup fails after session identification', async () => {
    const next = jest.fn();
    mockAuthSessionFindByPk.mockRejectedValue(new Error('database unavailable'));

    const req = {
      user: {
        session_id: 77
      }
    };
    const res = createResponse();

    await logout(req, res, next);

    expect(mockAuthSessionFindByPk).toHaveBeenCalledWith(77);
    expect(res.clearCookie).toHaveBeenCalledWith('token');
    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Internal server error'
    });
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Logout failed after session identification: database unavailable',
      expect.objectContaining({
        session_id: 77,
        user_id: null,
        stack: expect.any(String)
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('surfaces unexpected logout token verification failures', async () => {
    const unexpectedError = new Error('crypto unavailable');
    const next = jest.fn();
    mockVerify.mockImplementation(() => {
      throw unexpectedError;
    });

    const req = {
      body: {
        refresh_token: 'refresh-token'
      },
      cookies: {},
      headers: {}
    };
    const res = createResponse();

    await logout(req, res, next);

    expect(mockAuthSessionFindByPk).not.toHaveBeenCalled();
    expect(res.clearCookie).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(unexpectedError);
  });
});
