import express from 'express';

import { getCurrentUser, login, logout, refresh } from '../controllers/auth.controller.js';
import { verifyToken } from '../middlewares/authJwt.js';
import { loginRateLimit } from '../middlewares/security.js';
import { loginValidation, validate } from '../middlewares/validator.js';

const router = express.Router();

router.post('/login', loginRateLimit, loginValidation, validate, login);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', verifyToken, getCurrentUser);

export default router;
