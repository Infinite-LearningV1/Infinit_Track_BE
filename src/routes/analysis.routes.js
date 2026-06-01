import express from 'express';

import {
  getDisciplineFahp,
  getFuzzyAhpAnalysis,
  getSmartAcFahp,
  getWfaFahp
} from '../controllers/analysis.controller.js';
import { verifyToken } from '../middlewares/authJwt.js';
import roleGuard from '../middlewares/roleGuard.js';
import { disciplineFahpValidation, validate, wfaFahpValidation } from '../middlewares/validator.js';

const router = express.Router();

router.use(verifyToken);
router.get('/fuzzy-ahp', roleGuard(['Admin', 'Management']), getFuzzyAhpAnalysis);
router.get(
  '/fuzzy-ahp/discipline',
  roleGuard(['Admin', 'Management']),
  disciplineFahpValidation,
  validate,
  getDisciplineFahp
);
router.get(
  '/fuzzy-ahp/wfa',
  roleGuard(['Admin', 'Management']),
  wfaFahpValidation,
  validate,
  getWfaFahp
);
router.get('/fuzzy-ahp/smart-ac', roleGuard(['Admin', 'Management']), getSmartAcFahp);

export default router;
