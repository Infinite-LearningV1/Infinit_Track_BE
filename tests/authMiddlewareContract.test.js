import { jest } from '@jest/globals';

const mockVerify = jest.fn();
const mockUserFindByPk = jest.fn();
const mockAuthSessionFindByPk = jest.fn();

jest.unstable_mockModule('jsonwebtoken', () => ({
  default: {
    verify: mockVerify,
    sign: jest.fn()
  }
}));

jest.unstable_mockModule('../src/config/index.js', () => ({
  default: {
    jwt: {
      secret: 'access-secret',
      ttl: 900,
      accessTtl: 900,
      refreshInactivityWindowSeconds: 172800
    }
  }
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  User: {
    findByPk: mockUserFindByPk
  },
  Role: {},
  AuthSession: {
    findByPk: mockAuthSessionFindByPk
  }
}));

const { verifyToken } = await import('../src/middlewares/authJwt.js');

function buildSession(overrides = {}) {
  return {
    session_id: 77,
    user_id: 5,
    revoked_at: null,
    last_activity_at: new Date(),
    expires_at: new Date(Date.now() + 60_000),
    ...overrides
  };
}

function buildRequest(token) {
  return {
    cookies: { token },
    headers: {}
  };
}

function buildResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    cookie: jest.fn()
  };
}

describe('Auth middleware contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts a valid access token only when the linked auth session remains active', async () => {
    mockVerify.mockReturnValue({
      id: 5,
      session_id: 77,
      role_name: 'Admin',
      email: 'user@example.com'
    });
    mockAuthSessionFindByPk.mockResolvedValue(buildSession());

    const req = buildRequest('valid-access-token');
    const res = buildResponse();

    const next = jest.fn();

    await verifyToken(req, res, next);

    expect(mockAuthSessionFindByPk).toHaveBeenCalledWith(77);
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual(
      expect.objectContaining({
        id: 5,
        session_id: 77,
        role_name: 'Admin'
      })
    );
    expect(mockUserFindByPk).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a valid access token when the linked auth session was already revoked', async () => {
    mockVerify.mockReturnValue({
      id: 5,
      session_id: 77,
      role_name: 'Admin',
      email: 'user@example.com'
    });
    mockAuthSessionFindByPk.mockResolvedValue(buildSession({
      revoked_at: new Date()
    }));

    const req = buildRequest('revoked-session-access-token');
    const res = buildResponse();
    const next = jest.fn();

    await verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockAuthSessionFindByPk).toHaveBeenCalledWith(77);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid token' });
  });

  it('rejects a decoded access token when no linked auth session id is present', async () => {
    mockVerify.mockReturnValue({
      id: 5,
      role_name: 'Admin',
      email: 'user@example.com'
    });

    const req = buildRequest('legacy-access-token');
    const res = buildResponse();

    const next = jest.fn();

    await verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockAuthSessionFindByPk).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid token' });
  });

  it('rejects a decoded access token when the linked auth session is already expired', async () => {
    mockVerify.mockReturnValue({
      id: 5,
      session_id: 88,
      role_name: 'Admin',
      email: 'user@example.com'
    });
    mockAuthSessionFindByPk.mockResolvedValue(
      buildSession({
        session_id: 88,
        expires_at: new Date(Date.now() - 60_000)
      })
    );

    const req = buildRequest('expired-session-access-token');
    const res = buildResponse();

    const next = jest.fn();

    await verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockAuthSessionFindByPk).toHaveBeenCalledWith(88);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid token' });
  });

  it('rejects a decoded access token when the linked auth session is inactive beyond the refresh inactivity window', async () => {
    mockVerify.mockReturnValue({
      id: 5,
      session_id: 89,
      role_name: 'Admin',
      email: 'user@example.com'
    });
    mockAuthSessionFindByPk.mockResolvedValue(
      buildSession({
        session_id: 89,
        last_activity_at: new Date(Date.now() - 172801000)
      })
    );

    const req = buildRequest('inactive-session-access-token');
    const res = buildResponse();

    const next = jest.fn();

    await verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockAuthSessionFindByPk).toHaveBeenCalledWith(89);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid token' });
  });

  it('returns a refreshable 401 contract when the access token is expired', async () => {
    mockVerify.mockImplementation(() => {
      const error = new Error('jwt expired');
      error.name = 'TokenExpiredError';
      throw error;
    });

    const req = {
      cookies: {},
      headers: {
        authorization: 'Bearer expired-access-token'
      }
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      cookie: jest.fn()
    };

    const next = jest.fn();

    await verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'AUTH_ACCESS_TOKEN_EXPIRED',
      message: 'Access token expired',
      details: { refreshable: true }
    });
  });
});
