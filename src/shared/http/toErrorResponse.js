/**
 * Translates a typed AppError into an HTTP status and response body.
 *
 * Pure by design: the environment is passed in rather than imported, so
 * production masking can be tested without mocking the config module.
 *
 * The body shape deliberately matches the envelope already used across the
 * API -- { success, message, code?, details? } -- so routing an error through
 * this path changes nothing a client can observe.
 */
const MASKED_MESSAGE = 'Internal server error';

export const toErrorResponse = (err, { env } = {}) => {
  const status = err.status || 500;
  const shouldMask = status >= 500 && env === 'production';

  const body = {
    success: false,
    message: shouldMask ? MASKED_MESSAGE : err.message
  };

  if (err.code) {
    body.code = err.code;
  }

  if (err.details !== undefined) {
    body.details = err.details;
  }

  return { status, body };
};
