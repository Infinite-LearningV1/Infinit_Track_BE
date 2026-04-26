require('dotenv').config();

const getPort = () => (process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined);

module.exports = {
  development: {
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: getPort(),
    dialect: 'mysql',
    migrationStorageTableName: 'sequelizemeta',
    dialectOptions: {
      charset: 'utf8mb4',
      ssl:
        process.env.DB_SSL === 'true'
          ? {
              rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
            }
          : false
    }
  },
  staging: {
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: getPort(),
    dialect: 'mysql',
    dialectOptions: {
      charset: 'utf8mb4',
      ssl:
        process.env.DB_SSL === 'true'
          ? {
              rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
            }
          : false
    }
  },
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: getPort(),
    dialect: 'mysql',
    dialectOptions: {
      charset: 'utf8mb4',
      ssl:
        process.env.DB_SSL === 'true'
          ? {
              rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
            }
          : false
    }
  }
};
