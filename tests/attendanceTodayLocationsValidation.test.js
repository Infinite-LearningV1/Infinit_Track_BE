import express from 'express';
import { jest } from '@jest/globals';
import request from 'supertest';

jest.unstable_mockModule('../src/models/user.model.js', () => ({
  default: { findOne: jest.fn() }
}));

const { todayLocationsValidation } = await import('../src/middlewares/validator.js');

const app = express();
app.get('/today-locations', todayLocationsValidation, (_req, res) => {
  res.status(200).json({ success: true });
});

describe('today-locations query validation', () => {
  it.each([
    ['period', { period: '30d' }],
    ['from', { from: '2026-04-01' }],
    ['to', { to: '2026-04-30' }],
    ['historical range', { period: 'custom', from: '2026-04-01', to: '2026-04-30' }],
    ['unknown query', { foo: 'bar' }]
  ])('rejects unsupported %s query parameters before the handler', async (_label, query) => {
    const res = await request(app).get('/today-locations').query(query);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'E_VALIDATION',
      message: 'today-locations accepts only limit query parameter'
    });
  });

  it('accepts a valid limit query parameter', async () => {
    const res = await request(app).get('/today-locations').query({ limit: '5' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});
