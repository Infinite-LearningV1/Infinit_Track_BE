import express from 'express';

import { getDashboardAnalytics, getSummaryReport } from '../controllers/summary.controller.js';
import { verifyToken } from '../middlewares/authJwt.js';
import roleGuard from '../middlewares/roleGuard.js';
import { dashboardAnalyticsValidation } from '../middlewares/validator.js';

const router = express.Router();

function registerSummaryReportRoute(path) {
  router.get(path, verifyToken, roleGuard(['Admin', 'Management']), getSummaryReport);
}

router.get(
  '/dashboard-analytics',
  verifyToken,
  roleGuard(['Admin', 'Management']),
  dashboardAnalyticsValidation,
  getDashboardAnalytics
);

registerSummaryReportRoute('/reports');
registerSummaryReportRoute('/');

export default router;
