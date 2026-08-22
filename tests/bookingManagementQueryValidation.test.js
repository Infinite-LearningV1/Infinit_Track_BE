import express from 'express';
import request from 'supertest';

import { validate } from '../src/middlewares/validator.js';
import { validateBookingManagementListQuery } from '../src/modules/booking/bookingManagement.validation.js';

const app = express();
app.get('/bookings', validateBookingManagementListQuery, validate, (req, res) =>
  res.json({ query: req.query })
);

test('normalizes the complete valid management booking query', async () => {
  const response = await request(app).get('/bookings').query({
    page: '2',
    limit: '20',
    status: 'pending',
    user_id: '42',
    date_from: '2026-08-10',
    date_to: '2026-08-31',
    search: '  Andi  ',
    sortBy: 'created_at',
    sortOrder: 'asc'
  });

  expect(response.status).toBe(200);
  expect(response.body.query).toMatchObject({
    page: 2,
    limit: 20,
    status: 'pending',
    user_id: 42,
    date_from: '2026-08-10',
    date_to: '2026-08-31',
    search: 'Andi',
    sortBy: 'created_at',
    sortOrder: 'asc'
  });
});

test('applies defaults when optional query keys are absent', async () => {
  const response = await request(app).get('/bookings');

  expect(response.status).toBe(200);
  expect(response.body.query).toMatchObject({ page: 1, limit: 10 });
});

test('treats whitespace-only search as no search term after trimming', async () => {
  const response = await request(app).get('/bookings?search=%20%20%20');

  expect(response.status).toBe(200);
  expect(response.body.query.search).toBe('');
});
test.each([
  ['empty page', '/bookings?page='],
  ['empty limit', '/bookings?limit='],
  ['page non-numeric', '/bookings?page=abc'],
  ['page unsafe for max-limit offset', '/bookings?page=90071992547411'],
  ['limit over maximum', '/bookings?limit=101'],
  ['invalid status', '/bookings?status=archived'],
  ['invalid user id', '/bookings?user_id=0'],
  ['datetime date_from', '/bookings?date_from=2026-08-10T12:00:00Z'],
  ['impossible date', '/bookings?date_to=2026-02-30'],
  ['reversed date range', '/bookings?date_from=2026-08-31&date_to=2026-08-10'],
  ['array value', '/bookings?page=1&page=2'],
  ['object-shaped key', '/bookings?search[x]=andi'],
  ['unknown key', '/bookings?foo=bar']
])('returns 400 E_VALIDATION for %s', async (_label, path) => {
  const response = await request(app).get(path);

  expect(response.status).toBe(400);
  expect(response.body).toMatchObject({ success: false, code: 'E_VALIDATION' });
});

test.each([
  '/bookings?sortBy=location&sortOrder=sideways',
  '/bookings?sortBy=created_at&sortOrder=ASC'
])('accepts deprecated compatibility sort inputs without normalizing or applying them: %s', async (path) => {
  const response = await request(app).get(path);
  expect(response.status).toBe(200);
});
