import express from 'express';
import request from 'supertest';

import { validateListUsers, validate } from '../src/middlewares/validator.js';

/**
 * Validation contract for the INF-262 GET /users query parameters
 * (INF-250 matrix): every invalid value is a deterministic 400 E_VALIDATION,
 * never a 500 — including the array-shaped parameters that used to crash
 * sortOrder.toUpperCase (defect pinned by usersListSortContract F49).
 */

const buildApp = () => {
  const app = express();
  app.get('/users', validateListUsers, validate, (req, res) => res.json({ ok: true, query: req.query }));
  return app;
};

describe('validateListUsers (INF-262)', () => {
  test('accepts a request without any query parameters (legacy mode)', async () => {
    const response = await request(buildApp()).get('/users');
    expect(response.status).toBe(200);
  });

  test('accepts the full valid parameter matrix', async () => {
    const response = await request(buildApp()).get('/users').query({
      page: 2,
      limit: 50,
      search: 'nadia',
      role: 3,
      program: 1,
      division: 2,
      position: 4,
      location_status: 'configured',
      sortBy: 'full_name',
      sortOrder: 'asc'
    });
    expect(response.status).toBe(200);
  });

  test.each([
    ['page=0', { page: 0 }],
    ['page negative', { page: -1 }],
    ['page non-numeric', { page: 'abc' }],
    ['limit=0', { limit: 0 }],
    ['limit above cap 100', { limit: 101 }],
    ['limit non-numeric', { limit: 'xyz' }],
    ['role non-numeric', { role: 'admin' }],
    ['program non-numeric', { program: 'x' }],
    ['division non-numeric', { division: 'x' }],
    ['position non-numeric', { position: 'x' }],
    ['location_status unknown', { location_status: 'banana' }],
    ['sortBy outside whitelist', { sortBy: 'password' }],
    ['sortOrder invalid', { sortOrder: 'sideways' }]
  ])('rejects %s with 400 E_VALIDATION', async (_label, query) => {
    const response = await request(buildApp()).get('/users').query(query);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('E_VALIDATION');
  });

  test('rejects an array sortOrder with 400 instead of crashing to a 500', async () => {
    const response = await request(buildApp()).get('/users?sortOrder[]=x');
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('E_VALIDATION');
  });

  test('rejects an array sortBy with 400', async () => {
    const response = await request(buildApp()).get('/users?sortBy[]=x');
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('E_VALIDATION');
  });

  test('coerces page and limit to integers and uppercases sortOrder', async () => {
    const response = await request(buildApp())
      .get('/users')
      .query({ page: '2', limit: '10', sortOrder: 'asc' });

    expect(response.status).toBe(200);
    expect(response.body.query.page).toBe(2);
    expect(response.body.query.limit).toBe(10);
    expect(response.body.query.sortOrder).toBe('ASC');
  });
});
