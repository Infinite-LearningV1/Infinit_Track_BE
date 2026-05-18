import { jest } from '@jest/globals';

const mockFindSessionByPk = jest.fn();
const mockAuthSessionUpdate = jest.fn();
const mockSessionUpdate = jest.fn();
const mockVerify = jest.fn();
const mockSign = jest.fn();
const mockUserFindByPk = jest.fn();
const mockRoleFindByPk = jest.fn();
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

jest.unstable_mockModule('jsonwebtoken', () => ({
  default: {
    verify: mockVerify,
    sign: mockSign
  }
}));

jest.unstable_mockModule('../src/config/cloudinary.js', () => ({
  default: {}
}));

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: {
    transaction: jest.fn()
  }
}));

jest.unstable_mockModule('../src/config/index.js', () => ({
  default: {
    jwt: {
      secret: 'access-secret',
      refreshSecret: 'refresh-secret',
      accessTtl: 900,
      refreshTtl: 2592000,
      refreshInactivityWindowSeconds: 172800
    }
  }
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  User: {
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
    findByPk: mockFindSessionByPk,
    update: mockAuthSessionUpdate
  }
}));

jest.unstable_mockModule('../src/models/location.js', () => ({
  default: {}
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: mockLogger
}));

const { refresh } = await import('../src/controllers/auth.controller.js');

describe('Auth refresh contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthSessionUpdate.mockResolvedValue([1]);
  });

  it('rotates an active Android refresh session and returns new tokens in JSON', async () => {
    mockVerify.mockReturnValue({
      session_id: 77,
      jti: 'refresh-jti-old',
      id: 5,
      email: 'user@example.com',
      full_name: 'User Example',
      role_name: 'Admin',
      photo: 'photo-url'
    });

    mockFindSessionByPk.mockResolvedValue({
      session_id: 77,
      user_id: 5,
      refresh_jti: 'refresh-jti-old',
      client_type: 'android',
      revoked_at: null,
      last_activity_at: new Date(),
      expires_at: new Date(Date.now() + 3600_000),
      update: mockSessionUpdate
    });
    mockUserFindByPk.mockResolvedValue({
      id_users: 5,
      email: 'updated-user@example.com',
      full_name: 'Updated User',
      id_roles: 9,
      role: { role_name: 'Management' },
      photo_file: { photo_url: 'updated-photo-url' }
    });

    mockSign
      .mockReturnValueOnce('new-access-token')
      .mockReturnValueOnce('new-refresh-token');

    const req = {
      body: {
        refresh_token: 'incoming-refresh-token'
      },
      cookies: {},
      headers: {},
      get: jest.fn(() => 'okhttp')
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      cookie: jest.fn()
    };

    await refresh(req, res);

    expect(mockVerify).toHaveBeenCalledWith('incoming-refresh-token', 'refresh-secret');
    expect(mockFindSessionByPk).toHaveBeenCalledWith(77);
    expect(mockUserFindByPk).toHaveBeenCalledWith(5, expect.any(Object));
    expect(mockSign).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        session_id: 77,
        id: 5,
        email: 'updated-user@example.com',
        full_name: 'Updated User',
        role_name: 'Management',
        photo: 'updated-photo-url'
      }),
      'access-secret',
      expect.objectContaining({
        expiresIn: 900
      })
    );
    expect(mockAuthSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        refresh_jti: expect.any(String),
        last_activity_at: expect.any(Date),
        expires_at: expect.any(Date)
      }),
      {
        where: {
          session_id: 77,
          refresh_jti: 'refresh-jti-old',
          revoked_at: null
        }
      }
    );
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token'
      },
      message: 'Refresh successful'
    });
  });

  it('returns AUTH_REFRESH_INVALID when the refresh JWT is malformed', async () => {
    const invalidError = new Error('jwt malformed');
    invalidError.name = 'JsonWebTokenError';
    mockVerify.mockImplementation(() => {
      throw invalidError;
    });

    const req = {
      body: {
        refresh_token: 'invalid-refresh-token'
      },
      cookies: {},
      headers: {}
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      cookie: jest.fn()
    };

    await refresh(req, res);

    expect(mockFindSessionByPk).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'AUTH_REFRESH_INVALID',
      message: 'Refresh token invalid'
    });
    expect(mockLogger.warn).toHaveBeenCalledWith('Refresh rejected: jwt malformed');
  });

  it('returns AUTH_REFRESH_EXPIRED when the refresh JWT is expired', async () => {
    const expiredError = new Error('jwt expired');
    expiredError.name = 'TokenExpiredError';
    mockVerify.mockImplementation(() => {
      throw expiredError;
    });

    const req = {
      body: {
        refresh_token: 'expired-refresh-token'
      },
      cookies: {},
      headers: {}
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      cookie: jest.fn()
    };

    await refresh(req, res);

    expect(mockFindSessionByPk).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'AUTH_REFRESH_EXPIRED',
      message: 'Refresh session expired'
    });
    expect(mockLogger.warn).toHaveBeenCalledWith('Refresh expired: jwt expired');
  });

  it('returns AUTH_REFRESH_REVOKED when the refresh session is already revoked', async () => {
    mockVerify.mockReturnValue({
      session_id: 77,
      jti: 'refresh-jti-old',
      id: 5
    });
    mockFindSessionByPk.mockResolvedValue({
      session_id: 77,
      user_id: 5,
      refresh_jti: 'refresh-jti-old',
      revoked_at: new Date(),
      last_activity_at: new Date(),
      expires_at: new Date(Date.now() + 3600_000)
    });

    const req = {
      body: {
        refresh_token: 'incoming-refresh-token'
      },
      cookies: {},
      headers: {}
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      cookie: jest.fn()
    };

    await refresh(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'AUTH_REFRESH_REVOKED',
      message: 'Refresh session revoked'
    });
  });

  it('returns AUTH_REFRESH_EXPIRED when the refresh session is inactive for longer than the inactivity window', async () => {
    mockVerify.mockReturnValue({
      session_id: 77,
      jti: 'refresh-jti-old',
      id: 5
    });
    mockFindSessionByPk.mockResolvedValue({
      session_id: 77,
      user_id: 5,
      refresh_jti: 'refresh-jti-old',
      revoked_at: null,
      last_activity_at: new Date(Date.now() - 172_801_000),
      expires_at: new Date(Date.now() + 3600_000),
      update: mockSessionUpdate
    });

    const req = {
      body: {
        refresh_token: 'incoming-refresh-token'
      },
      cookies: {},
      headers: {}
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      cookie: jest.fn()
    };

    await refresh(req, res);

    expect(mockSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        revoked_at: expect.any(Date),
        revocation_reason: 'expired'
      })
    );
    expect(mockAuthSessionUpdate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'AUTH_REFRESH_EXPIRED',
      message: 'Refresh session expired'
    });
  });

  it('returns AUTH_REFRESH_INVALID when concurrent rotation already consumed the same refresh jti', async () => {
    mockVerify.mockReturnValue({
      session_id: 77,
      jti: 'refresh-jti-old',
      id: 5,
      email: 'user@example.com',
      full_name: 'User Example',
      role_name: 'Admin',
      photo: 'photo-url'
    });
    mockFindSessionByPk.mockResolvedValue({
      session_id: 77,
      user_id: 5,
      refresh_jti: 'refresh-jti-old',
      client_type: 'android',
      revoked_at: null,
      last_activity_at: new Date(),
      expires_at: new Date(Date.now() + 3600_000),
      update: mockSessionUpdate
    });
    mockUserFindByPk.mockResolvedValue({
      id_users: 5,
      email: 'updated-user@example.com',
      full_name: 'Updated User',
      id_roles: 9,
      role: { role_name: 'Management' },
      photo_file: { photo_url: 'updated-photo-url' }
    });
    mockAuthSessionUpdate.mockResolvedValue([0]);
    mockSign
      .mockReturnValueOnce('new-access-token')
      .mockReturnValueOnce('new-refresh-token');

    const req = {
      body: {
        refresh_token: 'incoming-refresh-token'
      },
      cookies: {},
      headers: {}
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      cookie: jest.fn()
    };

    await refresh(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'AUTH_REFRESH_INVALID',
      message: 'Refresh token invalid'
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Refresh rejected after CAS rotation miss',
      expect.objectContaining({
        session_id: 77,
        user_id: 5,
        refresh_jti: 'refresh-jti-old'
      })
    );
  });

  it('returns 500 when refresh cannot resolve a required role row', async () => {
    mockVerify.mockReturnValue({
      session_id: 77,
      jti: 'refresh-jti-old',
      id: 5
    });
    mockFindSessionByPk.mockResolvedValue({
      session_id: 77,
      user_id: 5,
      refresh_jti: 'refresh-jti-old',
      client_type: 'android',
      revoked_at: null,
      last_activity_at: new Date(),
      expires_at: new Date(Date.now() + 3600_000),
      update: mockSessionUpdate
    });
    mockUserFindByPk.mockResolvedValue({
      id_users: 5,
      email: 'updated-user@example.com',
      full_name: 'Updated User',
      id_roles: 9,
      role: null,
      photo_file: { photo_url: 'updated-photo-url' }
    });
    mockRoleFindByPk.mockResolvedValue(null);

    const req = {
      body: {
        refresh_token: 'incoming-refresh-token'
      },
      cookies: {},
      headers: {}
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      cookie: jest.fn()
    };

    await refresh(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Internal server error'
    });
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Refresh failed: Role 9 not found for user 5',
      expect.objectContaining({
        session_id: 77,
        user_id: 5,
        stack: expect.any(String)
      })
    );
    expect(mockAuthSessionUpdate).not.toHaveBeenCalled();
  });

  it('returns 500 when refresh token user state has no role claim', async () => {
    mockVerify.mockReturnValue({
      session_id: 77,
      jti: 'refresh-jti-old',
      id: 5
    });
    mockFindSessionByPk.mockResolvedValue({
      session_id: 77,
      user_id: 5,
      refresh_jti: 'refresh-jti-old',
      client_type: 'android',
      revoked_at: null,
      last_activity_at: new Date(),
      expires_at: new Date(Date.now() + 3600_000),
      update: mockSessionUpdate
    });
    mockUserFindByPk.mockResolvedValue({
      id_users: 5,
      email: 'updated-user@example.com',
      full_name: 'Updated User',
      id_roles: null,
      role: null,
      photo_file: { photo_url: 'updated-photo-url' }
    });

    const req = {
      body: {
        refresh_token: 'incoming-refresh-token'
      },
      cookies: {},
      headers: {}
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      cookie: jest.fn()
    };

    await refresh(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Internal server error'
    });
    expect(mockRoleFindByPk).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Refresh failed: Role claim missing for user 5',
      expect.objectContaining({
        session_id: 77,
        user_id: 5,
        stack: expect.any(String)
      })
    );
    expect(mockAuthSessionUpdate).not.toHaveBeenCalled();
  });

  it('returns 500 when refresh session lookup fails unexpectedly', async () => {
    mockVerify.mockReturnValue({
      session_id: 77,
      jti: 'refresh-jti-old',
      id: 5
    });
    mockFindSessionByPk.mockRejectedValue(new Error('database unavailable'));

    const req = {
      body: {
        refresh_token: 'incoming-refresh-token'
      },
      cookies: {},
      headers: {}
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      cookie: jest.fn()
    };

    await refresh(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Internal server error'
    });
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('error');
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Refresh failed: database unavailable',
      expect.objectContaining({
        session_id: 77,
        user_id: 5,
        stack: expect.any(String)
      })
    );
  });
});
