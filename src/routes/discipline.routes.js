/**
 * Discipline Index Routes
 * Routes untuk mengakses fitur indeks kedisiplinan karyawan
 * menggunakan Fuzzy AHP Engine
 */

import express from 'express';

import { verifyToken } from '../middlewares/authJwt.js';
import roleGuard from '../middlewares/roleGuard.js';
import {
  getUserDisciplineIndex,
  getAllDisciplineIndices,
  getDisciplineConfig,
  testDisciplineAhp
} from '../controllers/discipline.controller.js';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(verifyToken);

/**
 * @route GET /api/discipline/user/:userId
 * @desc Get discipline index for a specific user
 * @access Private (Admin/Management/Own data only)
 */
router.get('/user/:userId', getUserDisciplineIndex);

/**
 * @route GET /api/discipline/all
 * @desc Get discipline indices for all users
 * @access Private (Admin/Management only)
 */
router.get('/all', getAllDisciplineIndices);

/**
 * @route GET /api/discipline/config
 * @desc Get discipline calculation configuration and weights
 * @access Private (Admin/Management only)
 */
router.get('/config', getDisciplineConfig);

/**
 * @route POST /api/discipline/test-ahp
 * @desc Compute discipline index from manual metrics (no DB)
 * @access Private (Admin/Management only)
 */
router.post('/test-ahp', roleGuard(['Admin', 'Management']), testDisciplineAhp);

export default router;
