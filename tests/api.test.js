import { jest } from '@jest/globals';
import request from 'supertest';

// Mock verifyToken to authenticate the request
const mockVerifyToken = (req, _res, next) => {
  req.user = { id: 1, role_name: 'Admin' };
  next();
};

// Mock roleGuard to allow Admin access
const mockRoleGuard = () => (req, _res, next) => {
  next();
};

jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
  verifyToken: mockVerifyToken
}));

jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
  __esModule: true,
  default: mockRoleGuard
}));

jest.unstable_mockModule('../src/config/cloudinary.js', () => ({
  default: {}
}));

const { default: app } = await import('../src/app.js');

describe('FAHP Dynamic Test Endpoint', () => {
  it('POST /api/wfa/test-ahp returns compact evidence payload', async () => {
    const body = {
      scenario: 'WFA - Sangat Baik',
      expected: 'Sangat Baik',
      place_data: {
        properties: {
          name: 'Coffee Lab',
          categories: ['cafe'],
          distance: 200,
          facility_score: 90
        },
        geometry: { type: 'Point', coordinates: [106.8, -6.2] },
        userLocation: { lat: -6.2, lon: 106.8 }
      }
    };

    const res = await request(app).post('/api/wfa/test-ahp').send(body);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body.data).toMatchObject({
      scenario: 'WFA - Sangat Baik',
      expected: 'Sangat Baik',
      category: 'Sangat Baik',
      match: true
    });
    expect(res.body.data).toHaveProperty('weights.location_type');
    expect(res.body.data).toHaveProperty('weights.distance_factor');
    expect(res.body.data).toHaveProperty('weights.facility_score');
    expect(res.body.data).toHaveProperty('cr');
    expect(res.body.data).toHaveProperty('score');
    expect(res.body.data).not.toHaveProperty('test_result');
    expect(res.body.data).not.toHaveProperty('interpretation');
  });

  it('POST /api/wfa/test-ahp returns Rendah with canonical CR for low-suitability places', async () => {
    const body = {
      scenario: 'WFA - Rendah',
      expected: 'Rendah',
      place_data: {
        properties: {
          name: 'Remote Industrial Yard',
          categories: ['industrial'],
          distance: 3000,
          facility_score: 0
        },
        geometry: { type: 'Point', coordinates: [106.8, -6.2] },
        userLocation: { lat: -6.2, lon: 106.8 }
      }
    };

    const res = await request(app).post('/api/wfa/test-ahp').send(body);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body.data).toMatchObject({
      scenario: 'WFA - Rendah',
      expected: 'Rendah',
      category: 'Rendah',
      match: true
    });
    expect(res.body.data.cr).toBeCloseTo(0.058, 3);
    expect(res.body.data).not.toHaveProperty('test_result');
    expect(res.body.data).not.toHaveProperty('interpretation');
  });

  it('POST /api/wfa/test-ahp returns null CR for custom weights', async () => {
    const body = {
      scenario: 'WFA - Custom Weights',
      custom_weights: {
        location_type: 0.4,
        distance_factor: 0.35,
        facility_score: 0.25
      },
      place_data: {
        properties: {
          name: 'Coffee Lab',
          categories: ['cafe'],
          distance: 200,
          facility_score: 90
        },
        geometry: { type: 'Point', coordinates: [106.8, -6.2] },
        userLocation: { lat: -6.2, lon: 106.8 }
      }
    };

    const res = await request(app).post('/api/wfa/test-ahp').send(body);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body.data).toMatchObject({
      scenario: 'WFA - Custom Weights',
      cr: null
    });
    expect(res.body.data.weights).toMatchObject({
      location_type: 0.4,
      distance_factor: 0.35,
      facility_score: 0.25
    });
  });

  it('POST /api/wfa/test-ahp rejects the retired amenity_score input', async () => {
    const res = await request(app)
      .post('/api/wfa/test-ahp')
      .send({ place_data: { properties: { amenity_score: 90, distance: 200 } } });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'E_VALIDATION' });
  });

  it('POST /api/wfa/test-ahp rejects retired amenity_score custom weights', async () => {
    const res = await request(app)
      .post('/api/wfa/test-ahp')
      .send({
        custom_weights: {
          location_type: 0.4,
          distance_factor: 0.35,
          facility_score: 0.25,
          amenity_score: 0.1
        },
        place_data: { properties: { facility_score: 90, distance: 200 } }
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'E_VALIDATION' });
  });

  it('POST /api/discipline/test-ahp returns compact evidence payload', async () => {
    const body = {
      scenario: 'Discipline - Baik',
      expected: 'Baik',
      metrics: {
        alpha_rate: 30,
        avg_lateness_minutes: 25,
        lateness_frequency: 35,
        work_hour_consistency: 50
      }
    };

    const res = await request(app).post('/api/discipline/test-ahp').send(body);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body.data).toMatchObject({
      scenario: 'Discipline - Baik',
      expected: 'Baik',
      category: 'Baik',
      match: true
    });
    expect(res.body.data).toHaveProperty('weights.alpha_rate');
    expect(res.body.data).toHaveProperty('weights.lateness_severity');
    expect(res.body.data).toHaveProperty('weights.lateness_frequency');
    expect(res.body.data).toHaveProperty('weights.work_focus');
    expect(res.body.data).toHaveProperty('cr');
    expect(res.body.data).toHaveProperty('score');
    expect(res.body.data).not.toHaveProperty('discipline_result');
    expect(res.body.data).not.toHaveProperty('methodology');
  });

  it('POST /api/attendance/test-weighted-prediction returns compact evidence payload', async () => {
    const body = {
      scenario: 'Auto Checkout - Normal',
      expected_range: '17:00-18:00',
      targetDate: '2026-05-19',
      timeIn: '2026-05-19T08:00:00+07:00',
      candidates: {
        HIST: '17:30:00',
        CHECKIN: '17:15:00',
        CONTEXT: '17:45:00',
        TRANSITION: '17:20:00'
      }
    };

    const res = await request(app).post('/api/attendance/test-weighted-prediction').send(body);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body.data).toMatchObject({
      scenario: 'Auto Checkout - Normal',
      expected_range: '17:00-18:00',
      match: true
    });
    expect(res.body.data).toHaveProperty('weights.HIST');
    expect(res.body.data).toHaveProperty('weights.CHECKIN');
    expect(res.body.data).toHaveProperty('weights.CONTEXT');
    expect(res.body.data).toHaveProperty('weights.TRANSITION');
    expect(res.body.data).toHaveProperty('cr');
    expect(res.body.data).toHaveProperty('predicted_checkout');
    expect(res.body.data).not.toHaveProperty('input');
    expect(res.body.data).not.toHaveProperty('result_time');
    expect(res.body.data).not.toHaveProperty('CR_threshold');
    expect(res.body.data).not.toHaveProperty('is_consistent');
  });

  it('POST /api/attendance/test-weighted-prediction returns null CR for custom weights', async () => {
    const body = {
      scenario: 'Auto Checkout - Custom Weights',
      expected_range: '17:00-18:00',
      targetDate: '2026-05-19',
      timeIn: '2026-05-19T08:00:00+07:00',
      weights: [0.4, 0.25, 0.2, 0.15],
      candidates: {
        HIST: '17:30:00',
        CHECKIN: '17:15:00',
        CONTEXT: '17:45:00',
        TRANSITION: '17:20:00'
      }
    };

    const res = await request(app).post('/api/attendance/test-weighted-prediction').send(body);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body.data).toMatchObject({
      scenario: 'Auto Checkout - Custom Weights',
      expected_range: '17:00-18:00',
      cr: null,
      match: true
    });
    expect(res.body.data).toHaveProperty('predicted_checkout');
  });
});
