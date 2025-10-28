import logger from '../utils/logger.js';
import config from '../config/index.js';

export const errorHandler = (err, req, res, _next) => {
  // Log error with context
  logger.error({
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip
  });

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

  // Only include stack trace in development
  if (config.env === 'development') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};
