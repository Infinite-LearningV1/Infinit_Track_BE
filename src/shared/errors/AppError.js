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

export class ValidationError extends AppError {
  constructor(message, details) {
    super(message, { code: 'E_VALIDATION', status: 400, details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message, details) {
    super(message, { code: 'E_UNAUTHORIZED', status: 401, details });
  }
}

export class ForbiddenError extends AppError {
  constructor(message, details) {
    super(message, { code: 'E_FORBIDDEN', status: 403, details });
  }
}

export class NotFoundError extends AppError {
  constructor(message, details) {
    super(message, { code: 'E_NOT_FOUND', status: 404, details });
  }
}

export class ConflictError extends AppError {
  constructor(message, details) {
    super(message, { code: 'E_CONFLICT', status: 409, details });
  }
}
