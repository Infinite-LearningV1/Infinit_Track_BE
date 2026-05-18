import express from 'express';

import { getFuzzyAhpAnalysis } from '../controllers/analysis.controller.js';
import { verifyToken } from '../middlewares/authJwt.js';
import roleGuard from '../middlewares/roleGuard.js';

const router = express.Router();

router.use(verifyToken);
router.get('/fuzzy-ahp', roleGuard(['Admin', 'Management']), getFuzzyAhpAnalysis);

export default router;
