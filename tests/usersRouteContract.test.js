import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

import { validateCreateUser, validateUpdateUser, validate } from '../src/middlewares/validator.js';

/**
 * Characterization coverage for the /api/users route contract
 * (INF-252 Phase 0b).
 *
 * Before this file, five of six Users endpoints had no behavioral test at all
 * -- the only references to /api/users in the suite came from OpenAPI contract
 * tests, which assert documentation rather than behavior. Users is the first
 * module scheduled for extraction, so its current behavior is pinned here
 * first. See docs/architecture/api-contract-inventory.md.
 *
 * Two apps, deliberately separate:
 *   buildApp          - controller mocked, exercises auth -> RBAC -> routing
 *   buildValidatorApp - real validation chain, exercises input rules
 *
 * They are split because migration moves them to different homes: route wiring
 * to user.routes.js, input rules to user.validation.js.
 */

const CONTROLLER_ROUTES = {
  getAllUsers: 'getAllUsers',
  getUserById: 'getUserById',
  createUser: 'createUser',
  uploadUserPhoto: 'uploadUserPhoto',
  updateUser: 'updateUser',
  deleteUser: 'deleteUser'
};

const buildApp = async ({ role = 'Admin', verifyTokenImpl } = {}) => {
  jest.resetModules();

  jest.unstable_mockModule('../src/controllers/user.controller.js', () =>
    Object.fromEntries(
      Object.keys(CONTROLLER_ROUTES).map((name) => [
        name,
        (req, res) => res.status(200).json({ route: name })
      ])
    )
  );

  jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
    verifyToken:
      verifyTokenImpl ||
      ((req, res, next) => {
        req.user = { id: 99, role_name: role };
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
    validateCreateUser: [(req, res, next) => next()],
    validateUpdateUser: [(req, res, next) => next()],
    validate: (req, res, next) => next(),
    upload: { single: () => (req, res, next) => next() }
  }));

  const { default: usersRoutes } = await import('../src/routes/users.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/users', usersRoutes);
  return app;
};

const buildValidatorApp = () => {
  const app = express();
  app.use(express.json());
  app.post('/users', validateCreateUser, validate, (req, res) => res.status(201).json({ ok: true }));
  app.patch('/users/:id', validateUpdateUser, validate, (req, res) =>
    res.status(200).json({ ok: true })
  );
  return app;
};

const validCreatePayload = {
  full_name: 'Test User',
  email: 'test.user@example.com',
  password: 'rahasia123',
  phone: '081234567890',
  nip_nim: 'A12345',
  id_roles: 3,
  id_programs: 1,
  id_position: 2,
  latitude: -0.8917,
  longitude: 119.8707
};

describe('users route contract', () => {
  test('routes every endpoint to its controller for an Admin', async () => {
    const app = await buildApp({ role: 'Admin' });

    await request(app).get('/api/users').expect(200, { route: 'getAllUsers' });
    await request(app).get('/api/users/7').expect(200, { route: 'getUserById' });
    await request(app).post('/api/users').send({}).expect(200, { route: 'createUser' });
    await request(app).post('/api/users/7/photo').expect(200, { route: 'uploadUserPhoto' });
    await request(app).patch('/api/users/7').send({}).expect(200, { route: 'updateUser' });
    await request(app).delete('/api/users/7').expect(200, { route: 'deleteUser' });
  });

  test('allows Management everywhere except delete', async () => {
    const app = await buildApp({ role: 'Management' });

    await request(app).get('/api/users').expect(200);
    await request(app).get('/api/users/7').expect(200);
    await request(app).post('/api/users').send({}).expect(200);
    await request(app).post('/api/users/7/photo').expect(200);
    await request(app).patch('/api/users/7').send({}).expect(200);

    // Delete is Admin-only.
    await request(app).delete('/api/users/7').expect(403);
  });

  test('denies a plain User on every endpoint', async () => {
    const app = await buildApp({ role: 'User' });

    await request(app).get('/api/users').expect(403);
    await request(app).get('/api/users/7').expect(403);
    await request(app).post('/api/users').send({}).expect(403);
    await request(app).post('/api/users/7/photo').expect(403);
    await request(app).patch('/api/users/7').send({}).expect(403);
    await request(app).delete('/api/users/7').expect(403);
  });

  test('rejects unauthenticated requests before reaching the controller', async () => {
    const app = await buildApp({
      verifyTokenImpl: (req, res) => res.status(401).json({ success: false, message: 'Unauthorized' })
    });

    await request(app).get('/api/users').expect(401);
    await request(app).get('/api/users/7').expect(401);
    await request(app).post('/api/users').send({}).expect(401);
    await request(app).patch('/api/users/7').send({}).expect(401);
    await request(app).delete('/api/users/7').expect(401);
  });
});

describe('users validation contract', () => {
  test('accepts a complete create payload', async () => {
    await request(buildValidatorApp()).post('/users').send(validCreatePayload).expect(201);
  });

  test('rejects a create payload with no body', async () => {
    const res = await request(buildValidatorApp()).post('/users').send({}).expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('E_VALIDATION');
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.message).toBe('Nama lengkap wajib diisi');
  });

  test.each([
    ['latitude', 'Latitude wajib diisi'],
    ['longitude', 'Longitude wajib diisi']
  ])('requires %s on create', async (field, message) => {
    const payload = { ...validCreatePayload };
    delete payload[field];

    const res = await request(buildValidatorApp()).post('/users').send(payload).expect(400);
    expect(res.body.message).toBe(message);
  });

  test.each([
    ['latitude', 'Latitude tidak boleh 0'],
    ['longitude', 'Longitude tidak boleh 0']
  ])('rejects a zero %s on create', async (field, message) => {
    const res = await request(buildValidatorApp())
      .post('/users')
      .send({ ...validCreatePayload, [field]: 0 })
      .expect(400);

    expect(res.body.message).toBe(message);
  });

  test('rejects a password without a digit', async () => {
    const res = await request(buildValidatorApp())
      .post('/users')
      .send({ ...validCreatePayload, password: 'rahasiaaa' })
      .expect(400);

    expect(res.body.message).toBe('Password wajib kombinasi angka dan huruf');
  });

  test('rejects a non-numeric phone', async () => {
    const res = await request(buildValidatorApp())
      .post('/users')
      .send({ ...validCreatePayload, phone: '0812-3456' })
      .expect(400);

    expect(res.body.message).toBe('Nomor telepon hanya boleh berisi angka');
  });

  test('accepts an empty update payload because every field is optional', async () => {
    await request(buildValidatorApp()).patch('/users/7').send({}).expect(200);
  });

  test('rejects a non-numeric phone on update', async () => {
    const res = await request(buildValidatorApp())
      .patch('/users/7')
      .send({ phone: 'not-a-number' })
      .expect(400);

    expect(res.body.code).toBe('E_VALIDATION');
    expect(res.body.message).toBe('Phone must be numeric');
  });
});
