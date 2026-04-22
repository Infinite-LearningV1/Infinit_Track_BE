import dotenv from 'dotenv';
dotenv.config();

// Validate critical environment variables
const requiredEnvVars = ['JWT_SECRET', 'DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0 && process.env.NODE_ENV === 'production') {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

export default {
  port: process.env.PORT || 3000,
  env: process.env.NODE_ENV || 'development',
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    ttl: parseInt(process.env.JWT_TTL_SECONDS || '86400', 10),
    accessTtl: parseInt(
      process.env.JWT_ACCESS_TTL_SECONDS || process.env.JWT_TTL_SECONDS || '86400',
      10
    ),
    refreshTtl: parseInt(process.env.JWT_REFRESH_TTL_SECONDS || '2592000', 10),
    refreshInactivityWindowSeconds: parseInt(
      process.env.JWT_REFRESH_INACTIVITY_WINDOW_SECONDS || '172800',
      10
    )
  },
  db: {
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    dialect: 'mysql',
    ssl: String(process.env.DB_SSL || 'false').toLowerCase() === 'true',
    sslRejectUnauthorized:
      String(process.env.DB_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() === 'true'
  },
  geofence: {
    radiusDefaultM: parseInt(process.env.GEOFENCE_RADIUS_DEFAULT_M || '100', 10)
  },
  autoCheckout: {
    idleMinutes: parseInt(process.env.AUTO_CHECKOUT_IDLE_MIN || '10', 10),
    tBufferMinutes: parseInt(process.env.AUTO_CHECKOUT_TBUFFER_MIN || '30', 10)
  }
};
