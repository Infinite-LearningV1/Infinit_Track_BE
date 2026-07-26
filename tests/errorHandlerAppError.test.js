import { jest } from '@jest/globals';

const mockLoggerError = jest.fn();

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  __esModule: true,
  default: { error: mockLoggerError }
}));

jest.unstable_mockModule('../src/config/index.js', () => ({
  __esModule: true,
  default: { env: 'test' }
}));

const { errorHandler } = await import('../src/middlewares/errorHandler.js');
const { NotFoundError, ValidationError, ConflictError } = await import(
  '../src/shared/errors/AppError.js'
);

const createResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const req = { path: '/api/users/9', method: 'GET', ip: '127.0.0.1' };

describe('errorHandler AppError branch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders an AppError through the typed path', () => {
    const res = createResponse();

    errorHandler(new NotFoundError('User not found'), req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'User not found',
      code: 'E_NOT_FOUND'
    });
  });

  it('passes details through', () => {
    const details = [{ field: 'email', issue: 'required' }];
    const res = createResponse();

    errorHandler(new ValidationError('Validation error', details), req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Validation error',
      code: 'E_VALIDATION',
      details
    });
  });

  it('exposes the code on a 409 conflict', () => {
    const res = createResponse();

    errorHandler(new ConflictError('Already checked in today'), req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Already checked in today',
      code: 'E_CONFLICT'
    });
  });

  it('still logs an AppError exactly like any other error', () => {
    const err = new NotFoundError('User not found');
    err.stack = 'stack-trace';
    const res = createResponse();

    errorHandler(err, req, res, jest.fn());

    expect(mockLoggerError).toHaveBeenCalledWith({
      message: 'User not found',
      code: 'E_NOT_FOUND',
      stack: 'stack-trace',
      path: '/api/users/9',
      method: 'GET',
      ip: '127.0.0.1'
    });
  });
});
