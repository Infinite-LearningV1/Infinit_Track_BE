import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const validQuery = 'lat=-0.895&lng=119.872&schedule_date=2099-08-10';

const buildApp = async () => {
  jest.resetModules();
  const getWfaRecommendations = jest.fn((req, res) =>
    res.status(200).json({ route: 'recommendations' })
  );

  jest.unstable_mockModule('../src/controllers/wfa.controller.js', () => ({
    getWfaRecommendations,
    getWfaAhpConfig: (req, res) => res.status(200).json({ route: 'ahp-config' }),
    testFuzzyAhp: (req, res) => res.status(200).json({ route: 'test-ahp' })
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
  return { app, getWfaRecommendations };
};

describe('WFA recommendation route contract', () => {
  it('runs the shared validation before exposing canonical recommendations', async () => {
    const { app, getWfaRecommendations } = await buildApp();

    await request(app).get(`/api/wfa/recommendations?${validQuery}`).expect(200, {
      route: 'recommendations'
    });

    expect(getWfaRecommendations).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing schedule date', 'lat=-0.895&lng=119.872'],
    ['malformed schedule date', 'lat=-0.895&lng=119.872&schedule_date=2099-02-30'],
    ['nonfuture schedule date', 'lat=-0.895&lng=119.872&schedule_date=2020-08-10']
  ])('rejects %s before the controller', async (_name, query) => {
    const { app, getWfaRecommendations } = await buildApp();

    const response = await request(app).get(`/api/wfa/recommendations?${query}`).expect(400);

    expect(response.body).toMatchObject({ success: false, code: 'E_VALIDATION' });
    expect(getWfaRecommendations).not.toHaveBeenCalled();
  });

  it('does not mount retired unauthenticated WFA routes', async () => {
    const { app } = await buildApp();

    await request(app).get('/api/wfa/debug-geoapify').expect(404);
    await request(app).get('/api/wfa/recommendations-test').expect(404);
  });
});
