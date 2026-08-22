import express from 'express';
import request from 'supertest';

import { validateCreateUser, validate } from '../src/middlewares/validator.js';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post('/users', validateCreateUser, validate, (_req, res) => res.json({ ok: true }));
  return app;
};

const validBody = {
  full_name: 'Test User',
  email: 'test.user@example.com',
  password: 'passw0rd1',
  phone: '081234567890',
  nip_nim: 'T12345',
  id_roles: 3,
  id_programs: 1,
  id_position: 1,
  latitude: -6.2,
  longitude: 106.8
};

describe('validateCreateUser WFH coordinate invariant (INF-251)', () => {
  test('accepts a complete payload with valid coordinates', async () => {
    const response = await request(buildApp()).post('/users').send(validBody);
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  test.each([
    ['latitude missing', { latitude: undefined }, 'Latitude wajib diisi'],
    ['longitude missing', { longitude: undefined }, 'Longitude wajib diisi'],
    ['latitude out of range', { latitude: 95 }, 'Latitude tidak valid'],
    ['longitude out of range', { longitude: 190 }, 'Longitude tidak valid'],
    ['latitude zero', { latitude: 0 }, 'Latitude tidak boleh 0'],
    ['longitude zero', { longitude: 0 }, 'Longitude tidak boleh 0']
  ])('rejects %s with deterministic 400 E_VALIDATION', async (_label, override, message) => {
    const body = { ...validBody, ...override };
    Object.keys(override).forEach((key) => {
      if (override[key] === undefined) delete body[key];
    });

    const response = await request(buildApp()).post('/users').send(body);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('E_VALIDATION');
    expect(response.body.errors.map((error) => error.msg)).toContain(message);
  });

  test('rejects invalid radius but allows omitted radius (canonical default 100)', async () => {
    const rejected = await request(buildApp())
      .post('/users')
      .send({ ...validBody, radius: -5 });
    expect(rejected.status).toBe(400);
    expect(rejected.body.errors.map((error) => error.msg)).toContain(
      'Radius harus lebih besar dari 0'
    );

    const accepted = await request(buildApp()).post('/users').send(validBody);
    expect(accepted.status).toBe(200);
  });
});
