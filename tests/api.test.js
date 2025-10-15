import { jest } from '@jest/globals';
import request from 'supertest';

// Mock roleGuard BEFORE importing app so route uses the mocked middleware
const mockRoleGuard = () => (req, _res, next) => {
  req.user = { id: 1, role_name: 'Admin' };
  next();
};

jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
  __esModule: true,
  default: mockRoleGuard
}));

const { default: app } = await import('../src/app.js');

describe('FAHP Dynamic Test Endpoint', () => {
  it('POST /api/wfa/test-ahp returns expected JSON structure', async () => {
    const body = {
      place_data: {
        properties: {
          name: 'Coffee Lab',
          categories: ['cafe'],
          distance: 200,
          amenity_score: 90
        },
        geometry: { type: 'Point', coordinates: [106.8, -6.2] },
        userLocation: { lat: -6.2, lon: 106.8 }
      }
    };

    const res = await request(app).post('/api/wfa/test-ahp').send(body);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);

    // Ensure shape includes score, label, breakdown, weights, CR
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data.test_result');
    const result = res.body.data.test_result;
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('label');
    expect(result).toHaveProperty('breakdown');
    expect(result).toHaveProperty('weights');
    expect(result).toHaveProperty('CR');
  });
});
