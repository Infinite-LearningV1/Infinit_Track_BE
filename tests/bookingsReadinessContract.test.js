import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

import {
  createBookingValidation,
  updateStatusValidation,
  validate
} from '../src/middlewares/validator.js';

const buildApp = async ({ verifyTokenImpl } = {}) => {
  jest.resetModules();

  jest.unstable_mockModule('../src/controllers/booking.controller.js', () => ({
    createBooking: (req, res) => res.status(201).json({ route: 'createBooking' }),
    updateBookingStatus: (req, res) => res.status(200).json({ route: 'updateBookingStatus' }),
    getAllBookings: (req, res) => res.status(200).json({ route: 'getAllBookings' }),
    getBookingHistory: (req, res) => res.status(200).json({ route: 'getBookingHistory' }),
    deleteBooking: (req, res) => res.status(200).json({ route: 'deleteBooking' })
  }));

  jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
    verifyToken:
      verifyTokenImpl ||
      ((req, res, next) => {
        req.user = { id: 99, role_name: 'User' };
        next();
      })
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

const buildValidatorApp = () => {
  const app = express();
  app.use(express.json());
  app.post('/bookings', createBookingValidation, validate, (req, res) => {
    res.status(201).json({ ok: true });
  });
  app.patch('/bookings/:id', updateStatusValidation, validate, (req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
};

const validBookingPayload = {
  schedule_date: '2026-05-04',
  latitude: -6.2,
  longitude: 106.8
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

  test('requires verifyToken before representative booking routes can be reached', async () => {
    const app = await buildApp({
      verifyTokenImpl: (req, res) => res.status(401).json({ message: 'Unauthorized' })
    });

    await request(app).post('/api/bookings').send({}).expect(401);
    await request(app).get('/api/bookings/history').expect(401);
    await request(app).get('/api/bookings').expect(401);
    await request(app).patch('/api/bookings/123').send({ status: 'approved' }).expect(401);
    await request(app).delete('/api/bookings/123').expect(401);
  });
});

describe('bookings validator contract', () => {
  test('missing schedule_date returns 400', async () => {
    const app = buildValidatorApp();
    const { schedule_date, ...payload } = validBookingPayload;

    await request(app).post('/bookings').send(payload).expect(400);
  });

  test.each([
    ['missing', undefined],
    ['invalid', 'not-a-number'],
    ['zero', 0]
  ])('%s latitude returns 400', async (_caseName, latitude) => {
    const app = buildValidatorApp();
    const payload = { ...validBookingPayload };
    if (latitude === undefined) {
      delete payload.latitude;
    } else {
      payload.latitude = latitude;
    }

    await request(app).post('/bookings').send(payload).expect(400);
  });

  test.each([
    ['missing', undefined],
    ['invalid', 'not-a-number'],
    ['zero', 0]
  ])('%s longitude returns 400', async (_caseName, longitude) => {
    const app = buildValidatorApp();
    const payload = { ...validBookingPayload };
    if (longitude === undefined) {
      delete payload.longitude;
    } else {
      payload.longitude = longitude;
    }

    await request(app).post('/bookings').send(payload).expect(400);
  });

  test.each(['approved', 'rejected'])('status %s passes', async (status) => {
    const app = buildValidatorApp();

    await request(app).patch('/bookings/123').send({ status }).expect(200);
  });

  test('any other status returns 400', async () => {
    const app = buildValidatorApp();

    await request(app).patch('/bookings/123').send({ status: 'pending' }).expect(400);
  });
});
