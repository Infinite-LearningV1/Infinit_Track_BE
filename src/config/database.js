import { Sequelize } from 'sequelize';

import config from './index.js';

const sequelize = new Sequelize(config.db.database, config.db.username, config.db.password, {
  host: config.db.host,
  port: config.db.port,
  dialect: 'mysql',
  logging: false,
  timezone: '+07:00', // Jakarta timezone
  dialectOptions: {
    timezone: '+07:00',
    dateStrings: true,
    typeCast: true,
    ...(config.db.ssl
      ? {
          ssl: {
            require: true,
            rejectUnauthorized: config.db.sslRejectUnauthorized
          }
        }
      : {})
  },
  define: {
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
    timestamps: true
  }
});
export default sequelize;
