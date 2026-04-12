import express from 'express';

import {
  getAttendanceHistory,
  getAttendanceStatus,
  checkIn,
  checkOut,
  debugCheckInTime,
  deleteAttendance,
  getAllAttendances,
  manualAutoCheckout,
  getAutoCheckoutSettings,
  manualResolveWfaBookings,
  // new test triggers
  manualGeneralAlphaForDate,
  manualResolveWfaForDate,
  manualSmartAutoCheckoutForDate,
  logLocationEvent,
  getSmartEngineConfig,
  getEnhancedAutoCheckoutSettings,
  testTimezone
} from '../controllers/attendance.controller.js';
import { verifyToken } from '../middlewares/authJwt.js';
import roleGuard from '../middlewares/roleGuard.js';
import {
  checkInValidation,
  checkOutValidation,
  validate,
  locationEventValidation
} from '../middlewares/validator.js';

const router = express.Router();

// Timezone test endpoint (untuk debugging timezone fix) - NO AUTH untuk testing
router.get('/test-timezone', testTimezone);

// All attendance routes require authentication
router.use(verifyToken);

// Location event endpoint - for logging geofence enter/exit events
router.post('/location-event', locationEventValidation, validate, logLocationEvent);

// GET / - Get all attendances for admin/management with search and pagination
router.get('/', roleGuard(['Admin', 'Management']), getAllAttendances);

router.post('/check-in', checkInValidation, validate, checkIn);
router.post('/checkout/:id', checkOutValidation, validate, checkOut);
router.get('/history', getAttendanceHistory);
router.get('/status-today', getAttendanceStatus);
router.get('/debug-checkin-time', debugCheckInTime); // Debug endpoint

// Manual auto checkout endpoint (Admin only)
router.post('/manual-auto-checkout', roleGuard(['Admin', 'Management']), manualAutoCheckout);

// (Removed) Process past attendance records endpoint

// Get auto checkout settings endpoint (for debugging)
router.get('/auto-checkout-settings', roleGuard(['Admin', 'Management']), getAutoCheckoutSettings);

// Manual resolve WFA bookings endpoint (Admin only)
router.post(
  '/manual-resolve-wfa-bookings',
  roleGuard(['Admin', 'Management']),
  manualResolveWfaBookings
);

// Removed legacy manual-create-general-alpha; use /manual-general-alpha with target_date

// Test triggers for specific date (Admin only)
router.post('/manual-general-alpha', roleGuard(['Admin', 'Management']), manualGeneralAlphaForDate);
router.post(
  '/manual-resolve-wfa-for-date',
  roleGuard(['Admin', 'Management']),
  manualResolveWfaForDate
);

router.post(
  '/manual-smart-auto-checkout',
  roleGuard(['Admin', 'Management']),
  manualSmartAutoCheckoutForDate
);

// Test-only endpoint: weighted prediction (Admin only)
router.post('/test-weighted-prediction', roleGuard(['Admin', 'Management']), (req, res, next) => {
  // lazy import to avoid circular issues
  import('../controllers/attendance.controller.js').then((m) =>
    m.testWeightedPrediction(req, res, next)
  );
});

// DELETE endpoint for admin and management to delete attendance record
router.delete('/:id', verifyToken, roleGuard(['Admin', 'Management']), deleteAttendance);

// (Removed) Smart checkout prediction endpoint
router.get('/smart-config', roleGuard(['Admin', 'Management']), getSmartEngineConfig);
router.get(
  '/enhanced-auto-checkout-settings',
  roleGuard(['Admin', 'Management']),
  getEnhancedAutoCheckoutSettings
);

export default router;
