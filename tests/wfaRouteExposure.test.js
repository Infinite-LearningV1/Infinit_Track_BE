import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const buildApp = async ({ nodeEnv, enableDebugRoutes } = {}) => {
  jest.resetModules();
  process.env.NODE_ENV = nodeEnv;

  if (enableDebugRoutes === undefined) {
    delete process.env.ENABLE_WFA_DEBUG_ROUTES;
  } else {
    process.env.ENABLE_WFA_DEBUG_ROUTES = enableDebugRoutes;
  }

  jest.unstable_mockModule('../src/controllers/wfa.controller.js', () => ({
    getWfaRecommendations: (req, res) => res.status(200).json({ route: 'recommendations' }),
    getWfaAhpConfig: (req, res) => res.status(200).json({ route: 'ahp-config' }),
    testFuzzyAhp: (req, res) => res.status(200).json({ route: 'test-ahp' }),
    debugGeoapifyApi: (req, res) => res.status(200).json({ route: 'debug-geoapify' })
  }));
  jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
    verifyToken: (req, res, next) => next()
  }));
  jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
    default: () => (req, res, next) => next()
  }));

  const { default: wfaRoutes } = await import('../src/routes/wfa.routes.js');
  const app = express();
  app.use('/api/wfa', wfaRoutes);
  return app;
};

describe('WFA route exposure policy', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnableDebugRoutes = process.env.ENABLE_WFA_DEBUG_ROUTES;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalEnableDebugRoutes === undefined) {
      delete process.env.ENABLE_WFA_DEBUG_ROUTES;
    } else {
      process.env.ENABLE_WFA_DEBUG_ROUTES = originalEnableDebugRoutes;
    }
  });

  test('does not mount temporary no-auth WFA routes by default in production-like environments', async () => {
    const app = await buildApp({ nodeEnv: 'staging' });

    await request(app).get('/api/wfa/debug-geoapify').expect(404);
    await request(app).get('/api/wfa/recommendations-test').expect(404);
  });

  test('mounts temporary no-auth WFA routes only when explicit debug flag is enabled', async () => {
    const app = await buildApp({ nodeEnv: 'staging', enableDebugRoutes: 'true' });

    await request(app).get('/api/wfa/debug-geoapify').expect(200);
    await request(app).get('/api/wfa/recommendations-test').expect(200);
  });
});
