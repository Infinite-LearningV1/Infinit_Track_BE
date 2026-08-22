import express from 'express';

import {
  createUser,
  getAllUsers,
  getUserById,
  uploadUserPhoto,
  updateUser,
  deleteUser
} from '../controllers/user.controller.js';
import { verifyToken } from '../middlewares/authJwt.js';
import roleGuard from '../middlewares/roleGuard.js';
import {
  validateUpdateUser,
  validateCreateUser,
  validateListUsers,
  validate,
  upload
} from '../middlewares/validator.js';

const router = express.Router();

// GET /users - user directory list (admin and management only).
// Slim projection; supports the INF-250 server-driven query matrix.
router.get(
  '/',
  verifyToken,
  roleGuard(['Admin', 'Management']),
  validateListUsers,
  validate,
  getAllUsers
);

// GET /users/:id - Get user by ID with full profile details (admin and management only)
router.get('/:id', verifyToken, roleGuard(['Admin', 'Management']), getUserById);

// POST /users - Create new user (admin and management only)
router.post(
  '/',
  verifyToken,
  roleGuard(['Admin', 'Management']),
  upload.single('face_photo'),
  validateCreateUser,
  validate,
  createUser
);

// POST /users/:id/photo - Admin Upload Foto Wajah User (admin and management only)
router.post(
  '/:id/photo',
  verifyToken,
  roleGuard(['Admin', 'Management']),
  upload.single('face_photo'),
  uploadUserPhoto
);

// PATCH /users/:id - Update user (admin and management only)
router.patch(
  '/:id',
  verifyToken,
  roleGuard(['Admin', 'Management']),
  validateUpdateUser,
  validate,
  updateUser
);

// DELETE /users/:id - Soft delete user (admin only)
router.delete('/:id', verifyToken, roleGuard(['Admin']), deleteUser);

export default router;
