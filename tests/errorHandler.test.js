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
});
