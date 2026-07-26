import {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError
} from '../src/shared/errors/AppError.js';

describe('AppError taxonomy', () => {
  it('carries message, code and status', () => {
    const err = new AppError('boom', { code: 'E_TEST', status: 500 });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('boom');
    expect(err.code).toBe('E_TEST');
    expect(err.status).toBe(500);
  });

  it('omits details when none are given', () => {
    const err = new AppError('boom', { code: 'E_TEST', status: 500 });
    expect('details' in err).toBe(false);
  });

  it('keeps details when given', () => {
    const details = [{ field: 'email', issue: 'required' }];
    const err = new AppError('boom', { code: 'E_TEST', status: 400, details });
    expect(err.details).toBe(details);
  });

  it('names each subclass after itself', () => {
    expect(new NotFoundError('nope').name).toBe('NotFoundError');
  });

  // Argument order matters: the title placeholders consume the first three
  // entries, so the class constructor goes last.
  it.each([
    ['ValidationError', 400, 'E_VALIDATION', ValidationError],
    ['UnauthorizedError', 401, 'E_UNAUTHORIZED', UnauthorizedError],
    ['ForbiddenError', 403, 'E_FORBIDDEN', ForbiddenError],
    ['NotFoundError', 404, 'E_NOT_FOUND', NotFoundError],
    ['ConflictError', 409, 'E_CONFLICT', ConflictError]
  ])('%s maps to status %i and code %s', (_name, status, code, Klass) => {
    const err = new Klass('message');
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
  });

  it('lets a subclass carry details', () => {
    const details = [{ field: 'nip_nim', issue: 'taken' }];
    expect(new ValidationError('invalid', details).details).toBe(details);
  });
});
