// Role-based access control middleware
import logger from '../utils/logger.js';

export default (allowedRoles) => {
  return (req, res, next) => {
    // Check if user is authenticated (should be handled by verifyToken middleware first)
    if (!req.user) {
      return res.status(401).json({
        success: false,
        code: 'E_UNAUTHORIZED',
        message: 'Unauthorized: No user data'
      });
    } // Get role name from JWT token - support both old and new format
    const userRole = req.user.role_name || req.user.role?.name;

    if (!userRole || !allowedRoles.includes(userRole)) {
      logger.warn(
        `Role check failed - User role: "${userRole}", Required: ${allowedRoles.join(', ')}`
      );
      return res.status(403).json({
        success: false,
        code: 'E_FORBIDDEN',
        message: 'Forbidden: Insufficient role'
      });
    }

    logger.info(`Role check passed - User role: ${userRole}`);
    next();
  };
};
