import jwt from 'jsonwebtoken';

import config from '../config/index.js';
import { User, Role } from '../models/index.js';
import logger from '../utils/logger.js';

const isJwtError = (error, expectedName) => error?.name === expectedName;

export const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  let token = req.cookies?.token;

  if (authHeader) {
    const [scheme, value, extra] = authHeader.trim().split(/\s+/);

    if (scheme?.toLowerCase() !== 'bearer' || !value || extra) {
      return res.status(401).json({ message: 'Invalid authorization header. Use: Bearer <token>' });
    }

    token = value;
  }

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch (error) {
    if (isJwtError(error, 'TokenExpiredError')) {
      return res.status(401).json({
        success: false,
        code: 'AUTH_ACCESS_TOKEN_EXPIRED',
        message: 'Access token expired',
        details: { refreshable: true }
      });
    }

    if (isJwtError(error, 'JsonWebTokenError') || isJwtError(error, 'NotBeforeError')) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    logger.error('Unexpected JWT verification failure', {
      error: error.message,
      path: req.path,
      method: req.method
    });
    return next(error);
  }

  try {
    if (!decoded.role_name && decoded.id) {
      try {
        const userWithRole = await User.findByPk(decoded.id, {
          include: [
            {
              model: Role,
              as: 'role',
              attributes: ['role_name']
            }
          ]
        });

        if (!userWithRole || !userWithRole.role?.role_name) {
          logger.error('Authenticated user role could not be resolved', {
            userId: decoded.id,
            hasUser: Boolean(userWithRole),
            hasRole: Boolean(userWithRole?.role)
          });
          return res.status(401).json({ message: 'Unable to resolve authenticated user role' });
        }

        decoded.role_name = userWithRole.role.role_name;
        logger.info('Hydrated missing role_name in authenticated token', {
          userId: decoded.id,
          roleName: decoded.role_name
        });
      } catch (dbError) {
        logger.error('Unable to hydrate authenticated user role', {
          userId: decoded.id,
          error: dbError.message
        });
        return res.status(401).json({ message: 'Unable to resolve authenticated user role' });
      }
    }

    req.user = decoded;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};
