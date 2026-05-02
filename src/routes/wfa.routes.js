import express from 'express';

import {
  getWfaRecommendations,
  getWfaAhpConfig,
  testFuzzyAhp,
  debugGeoapifyApi
} from '../controllers/wfa.controller.js';
import { verifyToken } from '../middlewares/authJwt.js';
import roleGuard from '../middlewares/roleGuard.js';

const router = express.Router();
const shouldEnableDebugRoutes = process.env.ENABLE_WFA_DEBUG_ROUTES === 'true';

if (shouldEnableDebugRoutes) {
  // Debug endpoint (temporary no auth for testing)
  router.get('/debug-geoapify', debugGeoapifyApi);

  // Temporary WFA recommendations without auth for testing
  router.get('/recommendations-test', getWfaRecommendations);
}

// All WFA routes require authentication
router.use(verifyToken);

// GET /api/wfa/recommendations - Get WFA recommendations based on user location
router.get('/recommendations', getWfaRecommendations);

// GET /api/wfa/ahp-config - Get current Fuzzy AHP configuration
router.get('/ahp-config', getWfaAhpConfig);

// POST /api/wfa/test-ahp - Test Fuzzy AHP with custom values (Admin only)
router.post('/test-ahp', roleGuard(['Admin', 'Management']), testFuzzyAhp);

export default router;
