import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const buildApp = async () => {
  jest.resetModules();

  jest.unstable_mockModule('../src/controllers/booking.controller.js', () => ({
    createBooking: (_req, res) => res.status(201).json({ route: 'create' }),
    updateBookingStatus: (_req, res) => res.status(200).json({ route: 'update' }),
    getAllBookings: (_req, res) => res.status(200).json({ route: 'list' }),
    getBookingHistory: (_req, res) => res.status(200).json({ route: 'history' }),
    deleteBooking: (_req, res) => res.status(200).json({ route: 'delete' })
  }));

  jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
    verifyToken: (req, _res, next) => {
      req.user = { id: 99, role_name: 'Admin' };
      next();
    }
  }));

  jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
    default: () => (_req, _res, next) => next()
  }));
  jest.unstable_mockModule('../src/middlewares/validator.js', () => ({
    createBookingValidation: [(_req, _res, next) => next()],
    updateStatusValidation: [(_req, _res, next) => next()],
    validate: (_req, _res, next) => next()
  }));

  jest.unstable_mockModule('../src/modules/booking/bookingManagement.validation.js', () => ({
    validateBookingManagementListQuery: [
      (req, res, next) => req.query.reject === '1'
        ? res.status(400).json({ code: 'BOOKING_QUERY_VALIDATED' })
        : next()
    ]
  }));

  const { default: bookingRoutes } = await import('../src/routes/booking.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/bookings', bookingRoutes);
  return app;
};

test('runs management booking query validation before the list controller', async () => {
  const app = await buildApp();

  const response = await request(app).get('/api/bookings?reject=1').expect(400);

  expect(response.body).toEqual({ code: 'BOOKING_QUERY_VALIDATED' });
});
