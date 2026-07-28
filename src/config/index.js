import './loadEnv.js';

// Validate critical environment variables
const requiredEnvVars = ['JWT_SECRET', 'DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0 && process.env.NODE_ENV === 'production') {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

const env = process.env.NODE_ENV || 'development';
const rawCorsOrigin = process.env.CORS_ORIGIN || (env === 'production' ? '' : '*');
const corsOrigin =
  env === 'production' && rawCorsOrigin.includes(',')
    ? rawCorsOrigin
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : rawCorsOrigin;

export default {
  port: process.env.PORT || 3000,
  env,
  cors: {
    origin: corsOrigin,
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
    port: parseInt(process.env.DB_PORT || '3306', 10),
    dialect: 'mysql',
    ssl: String(process.env.DB_SSL || 'false').toLowerCase() === 'true',
    sslRejectUnauthorized:
      String(process.env.DB_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() === 'true'
  },
  researchAttendanceTriggerEnabled:
    String(process.env.RESEARCH_ATTENDANCE_TRIGGER_ENABLED || 'false').toLowerCase() === 'true'
};
