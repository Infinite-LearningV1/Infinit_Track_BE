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

export const basicRateLimit = (req, res, next) => {
  // Only apply rate limiting in production
  if (config.env !== 'production') {
    return next();
  }
  
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxRequests = 1000; // Max 1000 requests per 15 minutes per IP
  
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, { count: 1, resetTime: now + windowMs });
    return next();
  }
  
  const record = requestCounts.get(ip);
  
  if (now > record.resetTime) {
    // Reset window
    requestCounts.set(ip, { count: 1, resetTime: now + windowMs });
    return next();
  }
  
  if (record.count >= maxRequests) {
    return res.status(429).json({
      success: false,
      message: 'Too many requests, please try again later',
      retryAfter: Math.ceil((record.resetTime - now) / 1000)
    });
  }
  
  record.count++;
  next();
};

/**
 * CORS Configuration Validator
 * Ensures CORS is properly configured for the environment
 */
export const validateCorsOrigin = () => {
  const origin = config.cors.origin;
  
  if (config.env === 'production' && origin === '*') {
    console.warn('⚠️  WARNING: CORS origin is set to "*" in production!');
    console.warn('   This is a security risk. Set CORS_ORIGIN environment variable.');
  }
  
  if (config.env === 'production') {
    console.log(`✓ CORS configured for: ${origin}`);
  }
};

