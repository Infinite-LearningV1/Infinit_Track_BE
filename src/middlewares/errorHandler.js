import logger from '../utils/logger.js';
import config from '../config/index.js';

const PUBLIC_ERROR_CODES = new Set([
  'E_OPERATIONAL_SETTINGS_INVALID',
  'E_INVALID_REFERENCE_STATE'
]);

export const errorHandler = (err, req, res, _next) => {
  const logPayload = {
    message: err.message,
    code: err.code,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip
  };

  if (err.code === 'E_OPERATIONAL_SETTINGS_INVALID' && Array.isArray(err.details)) {
    logPayload.details = err.details;
  }

  if (err.code === 'E_INVALID_REFERENCE_STATE' && Array.isArray(err.conflicts)) {
    logPayload.conflicts = err.conflicts;
  }

  logger.error(logPayload);

  // Sequelize validation errors
  if (err.name === 'SequelizeValidationError') {
    const errors = err.errors.map((e) => ({ field: e.path, message: e.message }));
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors
    });
  }

  // Sequelize unique constraint errors
  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(400).json({
      success: false,
      message: 'Resource already exists'
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }

  // Default error - only show stack in development
  const statusCode = err.status || err.statusCode || 500;
  const response = {
    success: false,
    message:
      statusCode === 500 && config.env === 'production'
        ? 'Internal server error'
        : err.message || 'Internal server error'
  };

  if (err.code && (statusCode < 500 || PUBLIC_ERROR_CODES.has(err.code))) {
    response.code = err.code;
  }

  if (err.code === 'E_OPERATIONAL_SETTINGS_INVALID' && Array.isArray(err.details)) {
    response.details = err.details;
  }

  if (err.code === 'E_INVALID_REFERENCE_STATE') {
    if (err.target_date) {
      response.target_date = err.target_date;
    }

    if (err.endpoint_type) {
      response.endpoint_type = err.endpoint_type;
    }

    if (Array.isArray(err.conflicts)) {
      response.conflicts = err.conflicts;
    }

    if (err.hint) {
      response.hint = err.hint;
    }
  }

  // Only include stack trace in development
  if (config.env === 'development') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};
