import express from 'express';

import { getSummaryReport } from '../controllers/summary.controller.js';
import { verifyToken } from '../middlewares/authJwt.js';
import roleGuard from '../middlewares/roleGuard.js';

const router = express.Router();

router.get('/', verifyToken, roleGuard(['Admin', 'Management']), getSummaryReport);

export default router;
