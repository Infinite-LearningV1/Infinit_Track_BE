import express from 'express';
import request from 'supertest';

import {
  validateAttendanceId,
  validateAttendanceListQuery
} from '../src/modules/attendance/attendance.validation.js';
import { validate } from '../src/middlewares/validator.js';

const app = express();
app.get('/attendance', validateAttendanceListQuery, validate, (req, res) =>
  res.json({ query: req.query })
);
app.get('/attendance/:id', validateAttendanceId, validate, (req, res) =>
  res.json({ id: req.params.id })
);

test('normalizes the complete valid attendance query', async () => {
  const response = await request(app).get('/attendance').query({
    page: '2', limit: '20', search: '  andi@example.com  ',
    from: '2026-07-01', to: '2026-07-31', mode: 'wfh', status: 'late',
    checkout_state: 'completed', sortBy: 'full_name', sortOrder: 'asc'
  });
  expect(response.status).toBe(200);
  expect(response.body.query).toMatchObject({
    page: 2, limit: 20, search: 'andi@example.com', sortOrder: 'ASC'
  });
});

test.each([
  ['page non-numeric', '/attendance?page=abc'],
  ['limit over maximum', '/attendance?limit=101'],
  ['impossible from date', '/attendance?from=2026-02-30'],
  ['reversed range', '/attendance?from=2026-07-31&to=2026-07-01'],
  ['invalid mode', '/attendance?mode=hybrid'],
  ['invalid status', '/attendance?status=present'],
  ['invalid checkout state', '/attendance?checkout_state=closed'],
  ['unsupported sort key', '/attendance?sortBy=id_attendance'],
  ['invalid sort order', '/attendance?sortOrder=sideways'],
  ['array value', '/attendance?page=1&page=2'],
  ['object-shaped key', '/attendance?page[x]=1'],
  ['unknown key', '/attendance?user_id=7']
])('returns 400 E_VALIDATION for %s', async (_label, path) => {
  const response = await request(app).get(path);
  expect(response.status).toBe(400);
  expect(response.body).toMatchObject({ success: false, code: 'E_VALIDATION' });
});

test.each(['/attendance/0', '/attendance/abc'])('rejects invalid detail ID %s', async (path) => {
  const response = await request(app).get(path);
  expect(response.status).toBe(400);
  expect(response.body.code).toBe('E_VALIDATION');
});
