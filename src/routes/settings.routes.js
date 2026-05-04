import express from 'express';

import {
  getOperationalSettings,
  patchOperationalSettings
} from '../controllers/settings.controller.js';
import { verifyToken } from '../middlewares/authJwt.js';
import roleGuard from '../middlewares/roleGuard.js';
import { operationalSettingsPatchValidation } from '../middlewares/settings.validator.js';

const router = express.Router();

router.use(verifyToken);

router.get('/operational', roleGuard(['Admin', 'Management']), getOperationalSettings);
router.patch(
  '/operational',
  roleGuard(['Admin', 'Management']),
  operationalSettingsPatchValidation,
  patchOperationalSettings
);

export default router;
