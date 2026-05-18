import { jest } from '@jest/globals';

const mockVerify = jest.fn();
const mockUserFindByPk = jest.fn();

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
      accessTtl: 900
    }
  }
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  User: {
    findByPk: mockUserFindByPk
  },
  Role: {}
}));

const { verifyToken } = await import('../src/middlewares/authJwt.js');

describe('Auth middleware contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts a valid access token without consulting refresh-session state', async () => {
    mockVerify.mockReturnValue({
      id: 5,
      session_id: 77,
      role_name: 'Admin',
      email: 'user@example.com'
    });

    const req = {
      cookies: {
        token: 'valid-access-token'
      },
      headers: {}
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      cookie: jest.fn()
    };

    const next = jest.fn();

    await verifyToken(req, res, next);

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
