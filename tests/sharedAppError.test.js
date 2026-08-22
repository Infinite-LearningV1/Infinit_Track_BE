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

/**
 * INF-256. Users already exposes E_VALIDATION_NIP_EXISTS and
 * E_VALIDATION_EMAIL_EXISTS. Migrating those paths to ValidationError without
 * an override would silently rewrite a client-visible code to E_VALIDATION --
 * a contract change with no test to catch it, since nothing asserts those
 * codes today.
 */
describe('endpoint-specific code overrides', () => {
  it('keeps the subclass default when no override is given', () => {
    expect(new ValidationError('invalid').code).toBe('E_VALIDATION');
  });

  it('accepts a more specific code without changing the status', () => {
    const err = new ValidationError('NIP/NIM sudah digunakan', undefined, {
      code: 'E_VALIDATION_NIP_EXISTS'
    });

    expect(err.code).toBe('E_VALIDATION_NIP_EXISTS');
    expect(err.status).toBe(400);
    expect(err).toBeInstanceOf(ValidationError);
  });

  it('carries details and an override together', () => {
    const details = [{ field: 'email', issue: 'taken' }];
    const err = new ValidationError('Email sudah digunakan', details, {
      code: 'E_VALIDATION_EMAIL_EXISTS'
    });

    expect(err.code).toBe('E_VALIDATION_EMAIL_EXISTS');
    expect(err.details).toBe(details);
  });

  it.each([
    [UnauthorizedError, 401, 'E_SESSION_EXPIRED'],
    [ForbiddenError, 403, 'E_ROLE_FORBIDDEN'],
    [NotFoundError, 404, 'E_USER_NOT_FOUND'],
    [ConflictError, 409, 'E_ALREADY_CHECKED_IN']
  ])('applies to every subclass, keeping status %#', (Klass, status, code) => {
    const err = new Klass('message', undefined, { code });

    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
  });

  it('ignores an empty options object', () => {
    expect(new NotFoundError('nope', undefined, {}).code).toBe('E_NOT_FOUND');
  });

  /**
   * The status is what defines the subclass, so it is deliberately NOT
   * overridable. Use AppError directly if a different status is needed.
   */
  it('does not let the status be overridden', () => {
    const err = new NotFoundError('nope', undefined, { code: 'E_X', status: 500 });
    expect(err.status).toBe(404);
  });
});
