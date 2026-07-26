/**
 * Typed application errors (ADR-009, Phase 1).
 *
 * These are additive: `errorHandler` renders an AppError through the typed
 * path, while every legacy error keeps its existing behavior. The envelope
 * produced for an AppError is deliberately identical to the convention
 * already in use, so no client observes a new response shape.
 */
export class AppError extends Error {
  constructor(message, { code, status, details } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;

    if (details !== undefined) {
      this.details = details;
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target);
    }
  }
}

/**
 * Every subclass accepts an optional `{ code }` override.
 *
 * Existing endpoints already expose codes more specific than the subclass
 * default -- Users returns E_VALIDATION_NIP_EXISTS and
 * E_VALIDATION_EMAIL_EXISTS. Migrating those paths without an override would
 * silently rewrite a client-visible code, so the override exists to keep the
 * taxonomy usable without changing a contract on the way in.
 *
 * The status is deliberately NOT overridable: it is what defines the subclass.
 * Construct AppError directly when a different status is needed.
 */
const resolveCode = (defaultCode, options) => options?.code ?? defaultCode;

export class ValidationError extends AppError {
  constructor(message, details, options) {
    super(message, { code: resolveCode('E_VALIDATION', options), status: 400, details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message, details, options) {
    super(message, { code: resolveCode('E_UNAUTHORIZED', options), status: 401, details });
  }
}

export class ForbiddenError extends AppError {
  constructor(message, details, options) {
    super(message, { code: resolveCode('E_FORBIDDEN', options), status: 403, details });
  }
}

export class NotFoundError extends AppError {
  constructor(message, details, options) {
    super(message, { code: resolveCode('E_NOT_FOUND', options), status: 404, details });
  }
}

export class ConflictError extends AppError {
  constructor(message, details, options) {
    super(message, { code: resolveCode('E_CONFLICT', options), status: 409, details });
  }
}
