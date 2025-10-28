import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

/**
 * Structured Logger with Winston
 *
 * Features:
 * - JSON formatted logs for production
 * - Daily rotating log files (14 day retention)
 * - Colored console output for development
 * - Request correlation via requestId
 * - Error stack traces captured
 */

// Custom format for better readability
const customFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]`;

  if (metadata.requestId) {
    msg += ` [${metadata.requestId}]`;
  }

  msg += `: ${message}`;

  // Add metadata if present
  const metaKeys = Object.keys(metadata).filter(
    (key) => key !== 'requestId' && key !== 'level' && key !== 'timestamp'
  );

  if (metaKeys.length > 0) {
    const meta = {};
    metaKeys.forEach((key) => {
      meta[key] = metadata[key];
    });
    msg += ` ${JSON.stringify(meta)}`;
  }

  return msg;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'infinit-track-backend',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    // File transport - JSON for parsing
    new DailyRotateFile({
      filename: 'logs/app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      format: winston.format.json()
    }),
    // Error-only log file
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      level: 'error',
      format: winston.format.json()
    }),
    // Console transport - human readable
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        customFormat
      )
    })
  ]
});

// Create a stream for Morgan HTTP logger integration (if needed)
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  }
};

export default logger;
