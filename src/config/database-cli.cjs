const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const resolveEnvPath = (startDir = process.cwd()) => {
  for (
    let currentDir = path.resolve(startDir), parentDir = '';
    currentDir !== parentDir;
    parentDir = currentDir, currentDir = path.dirname(currentDir)
  ) {
    const candidate = path.join(currentDir, '.env');

    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
};

const envPath = resolveEnvPath();

dotenv.config(envPath ? { path: envPath } : undefined);

const dbPort = parseInt(process.env.DB_PORT || '3306', 10);
const sslEnabled = process.env.DB_SSL === 'true';
const sslRejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';

module.exports = {
  // Integration-test environment (INF-252 Phase 0c). Used only by
  // `npm run migrate` with NODE_ENV=test against a disposable database --
  // an ephemeral MySQL service in CI, or a throwaway container locally.
  // Purely additive: development, staging and production are unaffected.
  test: {
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: dbPort,
    dialect: 'mysql',
    migrationStorageTableName: 'sequelizemeta',
    dialectOptions: {
      charset: 'utf8mb4',
      ssl: false
    }
  },
  development: {
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: dbPort,
    dialect: 'mysql',
    migrationStorageTableName: 'sequelizemeta',
    dialectOptions: {
      charset: 'utf8mb4',
      ssl: sslEnabled
        ? {
            rejectUnauthorized: sslRejectUnauthorized
          }
        : false
    }
  },
  staging: {
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: dbPort,
    dialect: 'mysql',
    dialectOptions: {
      charset: 'utf8mb4',
      ssl: sslEnabled
        ? {
            rejectUnauthorized: sslRejectUnauthorized
          }
        : false
    }
  },
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: dbPort,
    dialect: 'mysql',
    dialectOptions: {
      charset: 'utf8mb4',
      ssl: sslEnabled
        ? {
            rejectUnauthorized: sslRejectUnauthorized
          }
        : false
    }
  }
};
