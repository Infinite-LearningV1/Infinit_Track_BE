import express from 'express';

import { getWfaRecommendations, getWfaAhpConfig, testFuzzyAhp } from '../controllers/wfa.controller.js';
import { getWfaRequestConfig } from '../controllers/wfaSettings.controller.js';
import { verifyToken } from '../middlewares/authJwt.js';
import roleGuard from '../middlewares/roleGuard.js';
import { validate, wfaRecommendationValidation } from '../middlewares/validator.js';

const router = express.Router();

// All WFA routes require authentication
router.use(verifyToken);

router.get('/request-config', getWfaRequestConfig);

// GET /api/wfa/recommendations - Get WFA recommendations based on user location
router.get('/recommendations', wfaRecommendationValidation, validate, getWfaRecommendations);

// GET /api/wfa/ahp-config - Get current Fuzzy AHP configuration
router.get('/ahp-config', getWfaAhpConfig);

// POST /api/wfa/test-ahp - Test Fuzzy AHP with custom values (Admin only)
router.post('/test-ahp', roleGuard(['Admin', 'Management']), testFuzzyAhp);

export default router;
