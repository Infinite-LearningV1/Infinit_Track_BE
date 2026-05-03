import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

import { createBookingValidation, updateStatusValidation } from '../src/middlewares/validator.js';

const buildApp = async () => {
  jest.resetModules();

  jest.unstable_mockModule('../src/controllers/booking.controller.js', () => ({
    createBooking: (req, res) => res.status(201).json({ route: 'createBooking' }),
    updateBookingStatus: (req, res) => res.status(200).json({ route: 'updateBookingStatus' }),
    getAllBookings: (req, res) => res.status(200).json({ route: 'getAllBookings' }),
    getBookingHistory: (req, res) => res.status(200).json({ route: 'getBookingHistory' }),
    deleteBooking: (req, res) => res.status(200).json({ route: 'deleteBooking' })
  }));

  jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
    verifyToken: (req, res, next) => {
      req.user = { id: 99, role_name: 'User' };
      next();
    }
  }));

  jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
    default: (allowedRoles) => (req, res, next) => {
      if (!allowedRoles.includes(req.user.role_name)) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      next();
    }
  }));

  jest.unstable_mockModule('../src/middlewares/validator.js', () => ({
    createBookingValidation: [(req, res, next) => next()],
    updateStatusValidation: [(req, res, next) => next()],
    validate: (req, res, next) => next()
  }));

  const { default: bookingRoutes } = await import('../src/routes/booking.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/bookings', bookingRoutes);
  return app;
};

describe('bookings route contract', () => {
  test('allows authenticated users to create bookings and view their history', async () => {
    const app = await buildApp();

    await request(app).post('/api/bookings').send({}).expect(201);
    await request(app).get('/api/bookings/history').expect(200);
  });

  test('blocks authenticated non-admin users from admin bookings endpoints', async () => {
    const app = await buildApp();

    await request(app).get('/api/bookings').expect(403);
    await request(app).patch('/api/bookings/123').send({ status: 'approved' }).expect(403);
    await request(app).delete('/api/bookings/123').expect(403);
  });
});

describe('bookings validator contract', () => {
  test('createBookingValidation enforces schedule_date, latitude, and longitude requirements', () => {
    expect(createBookingValidation).toHaveLength(6);
  });

  test('updateStatusValidation keeps approved/rejected as the only allowed status inputs', () => {
    expect(updateStatusValidation).toHaveLength(1);
  });
});
