import { jest } from '@jest/globals';

const mockLoggerWarn = jest.fn();
const mockLoggerInfo = jest.fn();

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  __esModule: true,
  default: {
    warn: mockLoggerWarn,
    info: mockLoggerInfo
  }
}));

const { default: roleGuard } = await import('../src/middlewares/roleGuard.js');

const createResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('roleGuard middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when req.user is missing', () => {
    const req = {};
    const res = createResponse();
    const next = jest.fn();

    roleGuard(['Admin'])(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'E_UNAUTHORIZED',
      message: 'Unauthorized: No user data'
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows access when role_name matches an allowed role', () => {
    const req = { user: { role_name: 'Admin' } };
    const res = createResponse();
    const next = jest.fn();

    roleGuard(['Admin', 'Management'])(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith('Role check passed - User role: Admin');
  });

  it('allows access when nested role.name matches an allowed role', () => {
    const req = { user: { role: { name: 'Management' } } };
    const res = createResponse();
    const next = jest.fn();

    roleGuard(['Admin', 'Management'])(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith('Role check passed - User role: Management');
  });

  it('returns 403 with stable contract when user role is not allowed', () => {
    const req = { user: { role_name: 'User' } };
    const res = createResponse();
    const next = jest.fn();

    roleGuard(['Admin', 'Management'])(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'E_FORBIDDEN',
      message: 'Forbidden: Insufficient role'
    });
    expect(next).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Role check failed - User role: "User", Required: Admin, Management'
    );
  });

  it('returns 403 when no supported role field is present', () => {
    const req = { user: { id: 1 } };
    const res = createResponse();
    const next = jest.fn();

    roleGuard(['Admin'])(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'E_FORBIDDEN',
      message: 'Forbidden: Insufficient role'
    });
    expect(next).not.toHaveBeenCalled();
  });
});
