import express from 'express';
import fs from 'fs';
import { jest } from '@jest/globals';
import path from 'path';
import request from 'supertest';

const originalEnv = { ...process.env };

const buildApp = async ({ authorize = false } = {}) => {
  jest.resetModules();
  process.env = { ...originalEnv, NODE_ENV: 'test' };

  const verifyToken = authorize
    ? jest.fn((req, _res, next) => {
        req.user = { id: 1, role_name: 'Admin' };
        next();
      })
    : jest.fn((_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

  const mockRoleGuard = jest.fn(() => (_req, _res, next) => next());

  jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
    verifyToken
  }));

  jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
    __esModule: true,
    default: mockRoleGuard
  }));

  jest.unstable_mockModule('../src/routes/index.js', () => ({
    default: express.Router()
  }));

  const { default: app } = await import('../src/app.js');

  return { app, verifyToken, mockRoleGuard };
};

describe('published OpenAPI spec route', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('rejects anonymous access to raw OpenAPI YAML contract', async () => {
    const { app } = await buildApp();
    const response = await request(app).get('/docs/openapi.yaml');

    expect(response.status).toBe(401);
  });

  test('serves the raw OpenAPI YAML contract to authorized admin callers', async () => {
    const expectedSpec = fs.readFileSync(path.resolve(process.cwd(), 'docs/openapi.yaml'), 'utf8');
    const { app, verifyToken, mockRoleGuard } = await buildApp({ authorize: true });
    const response = await request(app).get('/docs/openapi.yaml');

    expect(response.status).toBe(200);
    expect(response.text).toBe(expectedSpec);
    expect(response.headers['content-type']).toMatch(/yaml|text\/plain/i);
    expect(verifyToken).toHaveBeenCalled();
    expect(mockRoleGuard).toHaveBeenCalledWith(['Admin', 'Management']);
  });

  test('rejects anonymous access to Swagger UI', async () => {
    const { app } = await buildApp();
    const response = await request(app).get('/docs/');

    expect(response.status).toBe(401);
  });
});
