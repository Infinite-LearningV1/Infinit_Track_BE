import express from 'express';

import { getWfaRecommendations, getWfaAhpConfig, testFuzzyAhp } from '../controllers/wfa.controller.js';
import { verifyToken } from '../middlewares/authJwt.js';
import roleGuard from '../middlewares/roleGuard.js';

const router = express.Router();

// All WFA routes require authentication
router.use(verifyToken);

// GET /api/wfa/recommendations - Get WFA recommendations based on user location
router.get('/recommendations', getWfaRecommendations);

// GET /api/wfa/ahp-config - Get current Fuzzy AHP configuration
router.get('/ahp-config', getWfaAhpConfig);

// POST /api/wfa/test-ahp - Test Fuzzy AHP with custom values (Admin only)
router.post('/test-ahp', roleGuard(['Admin', 'Management']), testFuzzyAhp);

export default router;
