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
});
