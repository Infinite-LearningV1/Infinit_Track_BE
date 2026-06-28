import express from 'express';

import {
  getDashboardAnalytics,
  getSummaryReport,
  getSummaryReportExcel,
  getSummaryReportPdf
} from '../controllers/summary.controller.js';
import { verifyToken } from '../middlewares/authJwt.js';
import roleGuard from '../middlewares/roleGuard.js';
import { dashboardAnalyticsValidation } from '../middlewares/validator.js';

const router = express.Router();

const reportMiddlewares = [verifyToken, roleGuard(['Admin', 'Management'])];

router.get(
  '/dashboard-analytics',
  verifyToken,
  roleGuard(['Admin', 'Management']),
  dashboardAnalyticsValidation,
  getDashboardAnalytics
);

router.get('/reports', ...reportMiddlewares, getSummaryReport);
router.get('/reports/pdf', ...reportMiddlewares, getSummaryReportPdf);
router.get('/reports/excel', ...reportMiddlewares, getSummaryReportExcel);

export default router;
