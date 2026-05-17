import helmet from 'helmet';
import config from '../config/index.js';

/**
 * Security Headers Middleware
 * 
 * Implements security best practices:
 * - Helmet for standard security headers
 * - CSP for XSS protection
 * - HSTS for HTTPS enforcement
 * - X-Frame-Options for clickjacking protection
 * - Proper CORS configuration
 */

export const securityHeaders = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // For Swagger UI
      scriptSrc: ["'self'", "'unsafe-inline'"], // For Swagger UI
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  
  // HTTP Strict Transport Security (HSTS)
  // Force HTTPS for 1 year
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  
  // Prevent clickjacking
  frameguard: {
    action: 'deny'
  },
  
  // Disable client-side caching for sensitive data
  noCache: false, // Allow caching for performance
  
  // Hide X-Powered-By header
  hidePoweredBy: true,
  
  // Prevent MIME type sniffing
  noSniff: true,
  
  // XSS Protection (legacy browsers)
  xssFilter: true,
  
  // Referrer Policy
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin'
  }
});

/**
 * Additional Security Middleware
 */
export const additionalSecurity = (req, res, next) => {
  // Add custom security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  
  // Remove sensitive info from errors
  res.removeHeader('X-Powered-By');
  
  next();
};

/**
 * Rate Limiting Configuration (Manual implementation)
 * For production, consider using express-rate-limit package
 */
const requestCounts = new Map();
const loginAttemptCounts = new Map();

function getRequestSource(req) {
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
}

function pruneExpiredEntries(store, now) {
  for (const [key, record] of store) {
    if (now > record.resetTime) {
      store.delete(key);
    }
  }
}

function checkRateLimit(store, key, { windowMs, maxRequests }) {
  const now = Date.now();
  pruneExpiredEntries(store, now);

  const record = store.get(key);

  if (!record) {
    store.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true };
  }

  if (record.count >= maxRequests) {
    return {
      allowed: false,
      retryAfter: Math.ceil((record.resetTime - now) / 1000)
    };
  }

  record.count += 1;
  return { allowed: true };
}

export const basicRateLimit = (req, res, next) => {
  if (config.env !== 'production') {
    return next();
  }

  const result = checkRateLimit(requestCounts, getRequestSource(req), {
    windowMs: 15 * 60 * 1000,
    maxRequests: 1000
  });

  if (!result.allowed) {
    return res.status(429).json({
      success: false,
      message: 'Too many requests, please try again later',
      retryAfter: result.retryAfter
    });
  }

  next();
};

export const loginRateLimit = (req, res, next) => {
  if (config.env !== 'production') {
    return next();
  }

  const email = String(req.body?.email || '')
    .trim()
    .toLowerCase();
  const rateLimitKey = email ? `${getRequestSource(req)}:${email}` : getRequestSource(req);
  const result = checkRateLimit(loginAttemptCounts, rateLimitKey, {
    windowMs: 15 * 60 * 1000,
    maxRequests: 10
  });

  if (!result.allowed) {
    return res.status(429).json({
      success: false,
      code: 'AUTH_RATE_LIMITED',
      message: 'Too many login attempts, please try again later',
      retryAfter: result.retryAfter
    });
  }

  next();
};

/**
 * CORS Configuration Validator
 * Ensures CORS is properly configured for the environment
 */
export const validateCorsOrigin = () => {
  const origin = config.cors.origin;

  if (config.env !== 'production') {
    return;
  }

  if (!origin || origin === '*') {
    throw new Error(
      'CORS_ORIGIN must be set explicitly in production; wildcard or empty origins are not allowed.'
    );
  }

  console.log(`✓ CORS configured for: ${origin}`);
};

