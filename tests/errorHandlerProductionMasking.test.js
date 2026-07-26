import { jest } from '@jest/globals';

/**
 * Characterization test for the production 500-masking branch of errorHandler
 * (INF-252 Phase 1).
 *
 * This lives in its own file because the config module has to be mocked as
 * production at module scope. Re-mocking it inside the main errorHandler test
 * would require re-importing under a fresh module registry, which is not
 * reliably supported when combining jest.unstable_mockModule with ESM dynamic
 * imports. A separate file is simpler and actually works.
 */

const mockLoggerError = jest.fn();

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  __esModule: true,
  default: { error: mockLoggerError }
}));

jest.unstable_mockModule('../src/config/index.js', () => ({
  __esModule: true,
  default: { env: 'production' }
}));

const { errorHandler } = await import('../src/middlewares/errorHandler.js');

const createResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const req = { path: '/api/users', method: 'GET', ip: '127.0.0.1' };

describe('errorHandler in production', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('masks 500 messages', () => {
    const res = createResponse();
    const err = Object.assign(new Error('connection string leaked'), { status: 500 });

    errorHandler(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Internal server error'
    });
  });

  it('does not mask 4xx messages', () => {
    const res = createResponse();
    const err = Object.assign(new Error('User not found'), { status: 404 });

    errorHandler(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'User not found'
    });
  });

  it('omits the stack trace outside development', () => {
    const res = createResponse();
    const err = Object.assign(new Error('boom'), { status: 500, stack: 'stack-trace' });

    errorHandler(err, req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.not.objectContaining({ stack: expect.anything() })
    );
  });
});
