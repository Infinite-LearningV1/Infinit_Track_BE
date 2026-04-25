require('dotenv').config();

module.exports = {
  development: {
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    dialect: 'mysql',
    migrationStorageTableName: 'sequelizemeta',
    dialectOptions: {
      charset: 'utf8mb4'
    }
  },
  staging: {
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    dialect: 'mysql',
    dialectOptions: {
      charset: 'utf8mb4',
      ssl:
        process.env.DB_SSL === 'true'
          ? {
              rejectUnauthorized: true
            }
          : false
    }
  },
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    dialect: 'mysql',
    dialectOptions: {
      charset: 'utf8mb4',
      ssl:
        process.env.DB_SSL === 'true'
          ? {
              rejectUnauthorized: true
            }
          : false
    }
  }
};
