import { jest } from '@jest/globals';

const mockLoggerError = jest.fn();

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  __esModule: true,
  default: {
    error: mockLoggerError
  }
}));

jest.unstable_mockModule('../src/config/index.js', () => ({
  __esModule: true,
  default: {
    env: 'test'
  }
}));

const { errorHandler } = await import('../src/middlewares/errorHandler.js');

const createResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('errorHandler middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not log arbitrary details arrays for non-operational-settings errors', () => {
    const err = Object.assign(new Error('Unexpected downstream failure'), {
      status: 500,
      code: 'E_INTERNAL_TEST',
      details: [{ internal: 'should-not-log' }],
      stack: 'stack-trace'
    });
    const req = {
      path: '/api/settings/operational',
      method: 'GET',
      ip: '127.0.0.1'
    };
    const res = createResponse();

    errorHandler(err, req, res, jest.fn());

    expect(mockLoggerError).toHaveBeenCalledWith({
      message: 'Unexpected downstream failure',
      code: 'E_INTERNAL_TEST',
      stack: 'stack-trace',
      path: '/api/settings/operational',
      method: 'GET',
      ip: '127.0.0.1'
    });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Unexpected downstream failure'
    });
  });

  it('keeps operational settings integrity details in logs and responses', () => {
    const details = [{ field: 'geofenceRadiusDefaultM', issue: 'missing' }];
    const err = Object.assign(new Error('Operational settings are incomplete or invalid: geofenceRadiusDefaultM (missing)'), {
      status: 500,
      code: 'E_OPERATIONAL_SETTINGS_INVALID',
      details,
      stack: 'stack-trace'
    });
    const req = {
      path: '/api/settings/operational',
      method: 'GET',
      ip: '127.0.0.1'
    };
    const res = createResponse();

    errorHandler(err, req, res, jest.fn());

    expect(mockLoggerError).toHaveBeenCalledWith({
      message: 'Operational settings are incomplete or invalid: geofenceRadiusDefaultM (missing)',
      code: 'E_OPERATIONAL_SETTINGS_INVALID',
      details,
      stack: 'stack-trace',
      path: '/api/settings/operational',
      method: 'GET',
      ip: '127.0.0.1'
    });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Operational settings are incomplete or invalid: geofenceRadiusDefaultM (missing)',
      code: 'E_OPERATIONAL_SETTINGS_INVALID',
      details
    });
  });

  it('surfaces invalid research trigger reference conflicts to operators', () => {
    const conflicts = [{ type: 'invalid_reference', user_id: 62, target_date: '2026-07-02', mode: 'WFA' }];
    const err = Object.assign(new Error('Research attendance trigger memiliki conflict reference.'), {
      status: 409,
      code: 'E_INVALID_REFERENCE_STATE',
      target_date: '2026-07-02',
      endpoint_type: 'daily',
      conflicts,
      hint: 'Jalankan dry_run=true atau siapkan approved WFA booking/lokasi untuk user conflict.',
      stack: 'stack-trace'
    });
    const req = {
      path: '/api/attendance/research-trigger/daily',
      method: 'POST',
      ip: '127.0.0.1'
    };
    const res = createResponse();

    errorHandler(err, req, res, jest.fn());

    expect(mockLoggerError).toHaveBeenCalledWith({
      message: 'Research attendance trigger memiliki conflict reference.',
      code: 'E_INVALID_REFERENCE_STATE',
      conflicts,
      stack: 'stack-trace',
      path: '/api/attendance/research-trigger/daily',
      method: 'POST',
      ip: '127.0.0.1'
    });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Research attendance trigger memiliki conflict reference.',
      code: 'E_INVALID_REFERENCE_STATE',
      target_date: '2026-07-02',
      endpoint_type: 'daily',
      conflicts,
      hint: 'Jalankan dry_run=true atau siapkan approved WFA booking/lokasi untuk user conflict.'
    });
  });

  // Characterization cases (INF-252 Phase 1). These describe behavior that
  // already exists, so they must pass on first run. They exist to prove the
  // AppError branch added afterwards changes nothing here.

  it('maps SequelizeValidationError to 400 with field errors', () => {
    const err = Object.assign(new Error('Validation failed'), {
      name: 'SequelizeValidationError',
      errors: [
        { path: 'email', message: 'email must be unique' },
        { path: 'nip_nim', message: 'nip_nim cannot be null' }
      ]
    });
    const res = createResponse();

    errorHandler(err, { path: '/api/users', method: 'POST', ip: '127.0.0.1' }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Validation error',
      errors: [
        { field: 'email', message: 'email must be unique' },
        { field: 'nip_nim', message: 'nip_nim cannot be null' }
      ]
    });
  });

  it('maps SequelizeUniqueConstraintError to 400', () => {
    const err = Object.assign(new Error('duplicate'), {
      name: 'SequelizeUniqueConstraintError'
    });
    const res = createResponse();

    errorHandler(err, { path: '/api/users', method: 'POST', ip: '127.0.0.1' }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Resource already exists'
    });
  });

  it('maps JsonWebTokenError to 401', () => {
    const err = Object.assign(new Error('jwt malformed'), { name: 'JsonWebTokenError' });
    const res = createResponse();

    errorHandler(err, { path: '/api/users', method: 'GET', ip: '127.0.0.1' }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Invalid token' });
  });

  it('maps TokenExpiredError to 401', () => {
    const err = Object.assign(new Error('jwt expired'), { name: 'TokenExpiredError' });
    const res = createResponse();

    errorHandler(err, { path: '/api/users', method: 'GET', ip: '127.0.0.1' }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Token expired' });
  });
});
