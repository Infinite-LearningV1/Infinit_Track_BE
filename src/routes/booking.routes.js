import express from 'express';

import {
  createBooking,
  updateBookingStatus,
  getAllBookings,
  getBookingHistory,
  deleteBooking
} from '../controllers/booking.controller.js';
import { verifyToken } from '../middlewares/authJwt.js';
import roleGuard from '../middlewares/roleGuard.js';
import {
  createBookingValidation,
  updateStatusValidation,
  validate
} from '../middlewares/validator.js';
import { validateBookingManagementListQuery } from '../modules/booking/bookingManagement.validation.js';

const router = express.Router();

// Semua routes booking memerlukan autentikasi
router.use(verifyToken);

// POST /api/bookings - Membuat booking WFA (untuk semua user yang sudah login)
router.post('/', createBookingValidation, validate, createBooking);

// PATCH /api/bookings/:id - Update status booking (hanya admin dan management)
router.patch(
  '/:id',
  roleGuard(['Admin', 'Management']),
  updateStatusValidation,
  validate,
  updateBookingStatus
);

// GET /api/bookings - Mendapatkan semua booking (hanya admin dan management)
router.get(
  '/',
  roleGuard(['Admin', 'Management']),
  validateBookingManagementListQuery,
  validate,
  getAllBookings
);

// GET /api/bookings/history - Mendapatkan riwayat booking user dengan filter dan sorting
router.get('/history', getBookingHistory);

// DELETE /api/bookings/:id - Menghapus booking (hanya admin dan management)
router.delete('/:id', roleGuard(['Admin', 'Management']), deleteBooking);

export default router;
