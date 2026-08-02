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
  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs the shared validation before exposing canonical recommendations', async () => {
    const { app, getWfaRecommendations } = await buildApp();

    await request(app).get(`/api/wfa/recommendations?${validQuery}`).expect(200, {
      route: 'recommendations'
    });

    expect(getWfaRecommendations).toHaveBeenCalledTimes(1);
  });

  it('keeps a missing schedule date as a standard required-field validation error', async () => {
    const { app, getWfaRecommendations } = await buildApp();

    const response = await request(app)
      .get('/api/wfa/recommendations?lat=-0.895&lng=119.872')
      .expect(400);

    expect(response.body).toMatchObject({ success: false, code: 'E_VALIDATION' });
    expect(response.body.errors).toEqual([
      expect.objectContaining({ path: 'schedule_date', msg: 'schedule_date is required' })
    ]);
    expect(response.body.errors[0]).not.toHaveProperty('code');
    expect(getWfaRecommendations).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid calendar date', '2099-02-30', 'INVALID_SCHEDULE_DATE'],
    ['past date', '2026-08-01', 'PAST_DATE_NOT_ALLOWED'],
    ['same-day date', '2026-08-02', 'SAME_DAY_NOT_ALLOWED']
  ])('preserves %s code in the validation error item', async (_name, scheduleDate, code) => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-02T04:00:00.000Z'));
    const { app, getWfaRecommendations } = await buildApp();

    const response = await request(app)
      .get(
        `/api/wfa/recommendations?lat=-0.895&lng=119.872&schedule_date=${scheduleDate}`
      )
      .expect(400);

    expect(response.body).toMatchObject({ success: false, code: 'E_VALIDATION' });
    expect(response.body.errors).toEqual([
      expect.objectContaining({ path: 'schedule_date', code })
    ]);
    expect(getWfaRecommendations).not.toHaveBeenCalled();
  });

  it('does not mount retired unauthenticated WFA routes', async () => {
    const { app } = await buildApp();

    await request(app).get('/api/wfa/debug-geoapify').expect(404);
    await request(app).get('/api/wfa/recommendations-test').expect(404);
  });
});
