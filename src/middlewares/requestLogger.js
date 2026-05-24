import { randomUUID } from 'crypto';
import logger from '../utils/logger.js';

/**
 * Request Logger Middleware
 *
 * Features:
 * - Generates unique request ID for correlation
 * - Logs all incoming requests with metadata
 * - Tracks request duration
 * - Attaches request ID to response headers
 * - Propagates request ID through the request lifecycle
 */

export const requestLogger = (req, res, next) => {
  // Generate or use existing request ID
  const requestId = req.headers['x-request-id'] || randomUUID();

  // Attach request ID to request object for use in controllers
  req.requestId = requestId;

  // Attach to response headers for client tracking
  res.setHeader('X-Request-ID', requestId);

  // Capture request start time
  const startTime = Date.now();

  logger.info('HTTP request started', {
    type: 'request',
    requestId,
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'],
    userId: req.user?.id || null
  });

  // Capture response using event listeners
  const originalSend = res.send;
  res.send = function (data) {
    res.send = originalSend;

    const duration = Date.now() - startTime;

    logger.info('HTTP request completed', {
      type: 'response',
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userId: req.user?.id || null
    });

    return res.send(data);
  };

  // Handle errors
  res.on('error', (error) => {
    const duration = Date.now() - startTime;

    logger.error('HTTP request failed during response stream', {
      type: 'response_error',
      requestId,
      method: req.method,
      path: req.path,
      error: error.message,
      duration: `${duration}ms`
    });
  });

  next();
};

/**
 * Create child logger with request context
 * Use this in controllers to maintain request correlation
 *
 * Example:
 * const log = createRequestLogger(req);
 * log.info('User action completed', { userId, action });
 */
export const createRequestLogger = (req) => {
  const requestId = req.requestId;

  return {
    info: (message, meta = {}) => {
      logger.info(message, { ...meta, requestId });
    },
    warn: (message, meta = {}) => {
      logger.warn(message, { ...meta, requestId });
    },
    error: (message, meta = {}) => {
      logger.error(message, { ...meta, requestId });
    },
    debug: (message, meta = {}) => {
      logger.debug(message, { ...meta, requestId });
    }
  };
};
