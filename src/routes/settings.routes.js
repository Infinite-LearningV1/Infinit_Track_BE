import express from 'express';

import {
  getOperationalSettings,
  patchOperationalSettings
} from '../controllers/settings.controller.js';
import {
  createWfaRejectionReason,
  createWfaRequestReason,
  listWfaRejectionReasons,
  listWfaRequestReasons,
  updateWfaRejectionReason,
  updateWfaRequestReason
} from '../controllers/wfaSettings.controller.js';
import { verifyToken } from '../middlewares/authJwt.js';
import roleGuard from '../middlewares/roleGuard.js';
import { operationalSettingsPatchValidation } from '../middlewares/settings.validator.js';
import { validate } from '../middlewares/validator.js';
import {
  createWfaReasonValidation,
  updateWfaReasonValidation,
  wfaReasonIdValidation
} from '../middlewares/wfaSettings.validator.js';

const router = express.Router();

router.use(verifyToken);

router.get('/operational', roleGuard(['Admin', 'Management']), getOperationalSettings);
router.patch(
  '/operational',
  roleGuard(['Admin', 'Management']),
  operationalSettingsPatchValidation,
  patchOperationalSettings
);

router.get('/wfa/request-reasons', roleGuard(['Admin', 'Management']), listWfaRequestReasons);
router.post(
  '/wfa/request-reasons',
  roleGuard(['Admin', 'Management']),
  createWfaReasonValidation,
  validate,
  createWfaRequestReason
);
router.patch(
  '/wfa/request-reasons/:id',
  roleGuard(['Admin', 'Management']),
  wfaReasonIdValidation,
  updateWfaReasonValidation,
  validate,
  updateWfaRequestReason
);
router.get('/wfa/rejection-reasons', roleGuard(['Admin', 'Management']), listWfaRejectionReasons);
router.post(
  '/wfa/rejection-reasons',
  roleGuard(['Admin', 'Management']),
  createWfaReasonValidation,
  validate,
  createWfaRejectionReason
);
router.patch(
  '/wfa/rejection-reasons/:id',
  roleGuard(['Admin', 'Management']),
  wfaReasonIdValidation,
  updateWfaReasonValidation,
  validate,
  updateWfaRejectionReason
);

export default router;
