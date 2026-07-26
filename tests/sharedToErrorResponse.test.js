import { AppError, ValidationError, NotFoundError } from '../src/shared/errors/AppError.js';
import { toErrorResponse } from '../src/shared/http/toErrorResponse.js';

describe('toErrorResponse', () => {
  it('produces the existing envelope shape', () => {
    const result = toErrorResponse(new NotFoundError('User not found'), { env: 'test' });
    expect(result).toEqual({
      status: 404,
      body: { success: false, message: 'User not found', code: 'E_NOT_FOUND' }
    });
  });

  it('includes details when present', () => {
    const details = [{ field: 'email', issue: 'required' }];
    const result = toErrorResponse(new ValidationError('Validation error', details), {
      env: 'test'
    });
    expect(result.body.details).toBe(details);
  });

  it('omits details when absent', () => {
    const result = toErrorResponse(new ValidationError('Validation error'), { env: 'test' });
    expect('details' in result.body).toBe(false);
  });

  it('masks 5xx messages in production', () => {
    const err = new AppError('connection string leaked', { code: 'E_INTERNAL', status: 500 });
    const result = toErrorResponse(err, { env: 'production' });
    expect(result.body.message).toBe('Internal server error');
  });

  it('does not mask 4xx messages in production', () => {
    const result = toErrorResponse(new NotFoundError('User not found'), { env: 'production' });
    expect(result.body.message).toBe('User not found');
  });

  it('does not mask 5xx messages outside production', () => {
    const err = new AppError('boom', { code: 'E_INTERNAL', status: 500 });
    expect(toErrorResponse(err, { env: 'development' }).body.message).toBe('boom');
  });

  it('does not mutate the error it is given', () => {
    const err = new NotFoundError('User not found');
    toErrorResponse(err, { env: 'production' });
    expect(err.message).toBe('User not found');
  });
});
