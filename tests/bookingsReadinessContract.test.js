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
  request_reason_id: 1,
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
    const payload = { ...validBookingPayload };
    delete payload.schedule_date;

    await request(app).post('/bookings').send(payload).expect(400);
  });

  test.each(['10-08-2026', '08-10-2026', '2026-02-30'])(
    'schedule_date %s returns INVALID_SCHEDULE_DATE',
    async (scheduleDate) => {
      const app = buildValidatorApp();

      const res = await request(app)
        .post('/bookings')
        .send({ ...validBookingPayload, schedule_date: scheduleDate });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_SCHEDULE_DATE');
    }
  );

  test('returns the documented Express Validator item for a calendar-invalid booking date', async () => {
    const response = await request(buildValidatorApp())
      .post('/bookings')
      .send({ ...validBookingPayload, schedule_date: '2026-02-30' })
      .expect(400);

    expect(response.body).toEqual({
      success: false,
      code: 'INVALID_SCHEDULE_DATE',
      message: 'schedule_date tidak merepresentasikan tanggal kalender yang valid',
      errors: [{
        type: 'field',
        value: '2026-02-30',
        msg: 'schedule_date tidak merepresentasikan tanggal kalender yang valid',
        path: 'schedule_date',
        location: 'body',
        code: 'INVALID_SCHEDULE_DATE'
      }]
    });
  });

  test('missing request_reason_id returns WFA_REQUEST_REASON_REQUIRED', async () => {
    const app = buildValidatorApp();
    const payload = { ...validBookingPayload };
    delete payload.request_reason_id;

    const res = await request(app).post('/bookings').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WFA_REQUEST_REASON_REQUIRED');
  });

  test('accepts compatibility radius and suitability fields without trusting their shape', async () => {
    const app = buildValidatorApp();

    await request(app)
      .post('/bookings')
      .send({
        ...validBookingPayload,
        radius: 9999,
        suitability_score: 999,
        suitability_label: 'client-controlled'
      })
      .expect(201);
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

  test('status approved passes without rejection fields', async () => {
    const app = buildValidatorApp();

    await request(app).patch('/bookings/123').send({ status: 'approved' }).expect(200);
  });

  test('status rejected requires rejection_reason_id', async () => {
    const app = buildValidatorApp();

    const res = await request(app).patch('/bookings/123').send({ status: 'rejected' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('REJECTION_REASON_REQUIRED');
  });

  test('status rejected accepts an integer reason and optional note', async () => {
    const app = buildValidatorApp();

    await request(app)
      .patch('/bookings/123')
      .send({ status: 'rejected', rejection_reason_id: 2, rejection_note: 'Konteks' })
      .expect(200);
  });

  test('any other status returns 400', async () => {
    const app = buildValidatorApp();

    await request(app).patch('/bookings/123').send({ status: 'pending' }).expect(400);
  });
});
