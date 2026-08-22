import express from 'express';
import { jest } from '@jest/globals';
import request from 'supertest';

let currentRole = 'Admin';
const mockVerifyToken = jest.fn((req, _res, next) => {
  req.user = { id: 1, role_name: currentRole };
  next();
});
const mockRoleGuard = (allowedRoles) => (req, res, next) => {
  if (!allowedRoles.includes(currentRole)) {
    return res.status(403).json({ success: false, code: 'E_FORBIDDEN' });
  }
  next();
};

const mockListWfaReasons = jest.fn();
const mockCreateWfaReason = jest.fn();
const mockUpdateWfaReason = jest.fn();

jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({ verifyToken: mockVerifyToken }));
jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
  __esModule: true,
  default: mockRoleGuard
}));
jest.unstable_mockModule('../src/services/wfaSettings.service.js', () => ({
  readWfaRequestConfig: jest.fn(),
  listWfaReasons: mockListWfaReasons,
  createWfaReason: mockCreateWfaReason,
  updateWfaReason: mockUpdateWfaReason
}));

const { default: settingsRoutes } = await import('../src/routes/settings.routes.js');
const { errorHandler } = await import('../src/middlewares/errorHandler.js');

const app = express();
app.use(express.json());
app.use('/api/settings', settingsRoutes);
app.use(errorHandler);

const requestReason = {
  id: 1,
  label: 'Pertemuan dengan klien',
  is_active: true,
  is_other: false,
  sort_order: 10,
  created_at: new Date('2026-07-28T00:00:00.000Z'),
  updated_at: new Date('2026-07-28T00:00:00.000Z')
};

describe('WFA management reason catalog routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentRole = 'Admin';
    mockListWfaReasons.mockResolvedValue([requestReason]);
    mockCreateWfaReason.mockResolvedValue(requestReason);
    mockUpdateWfaReason.mockResolvedValue({ ...requestReason, is_active: false });
  });

  it.each([
    ['request', '/api/settings/wfa/request-reasons'],
    ['rejection', '/api/settings/wfa/rejection-reasons']
  ])('lists active and inactive %s reasons for management configuration', async (catalog, path) => {
    currentRole = 'Management';

    const res = await request(app).get(path);

    expect(res.status).toBe(200);
    expect(mockVerifyToken).toHaveBeenCalled();
    expect(mockListWfaReasons).toHaveBeenCalledWith({ catalog, includeInactive: true });
    expect(res.body).toEqual({
      success: true,
      data: {
        reasons: [
          {
            id: 1,
            label: 'Pertemuan dengan klien',
            is_active: true,
            is_other: false,
            sort_order: 10,
            created_at: '2026-07-28T00:00:00.000Z',
            updated_at: '2026-07-28T00:00:00.000Z'
          }
        ]
      }
    });
  });

  it.each([
    ['request', '/api/settings/wfa/request-reasons'],
    ['rejection', '/api/settings/wfa/rejection-reasons']
  ])('creates a normalized %s reason', async (catalog, path) => {
    const payload = { label: 'Kunjungan operasional', is_other: false, sort_order: 30 };

    const res = await request(app).post(path).send(payload);

    expect(res.status).toBe(201);
    expect(mockCreateWfaReason).toHaveBeenCalledWith({ catalog, payload });
    expect(res.body.success).toBe(true);
    expect(res.body.data.reason.id).toBe(1);
  });

  it.each([
    ['request', '/api/settings/wfa/request-reasons/1'],
    ['rejection', '/api/settings/wfa/rejection-reasons/1']
  ])('updates mutable %s reason fields', async (catalog, path) => {
    const payload = { is_active: false, sort_order: 50 };

    const res = await request(app).patch(path).send(payload);

    expect(res.status).toBe(200);
    expect(mockUpdateWfaReason).toHaveBeenCalledWith({ catalog, id: 1, payload });
    expect(res.body.data.reason.is_active).toBe(false);
  });

  it('rejects invalid create and immutable Other updates before the service', async () => {
    const invalidCreate = await request(app)
      .post('/api/settings/wfa/request-reasons')
      .send({ label: '', sort_order: -1 });
    const immutablePatch = await request(app)
      .patch('/api/settings/wfa/request-reasons/1')
      .send({ is_other: true });

    expect(invalidCreate.status).toBe(400);
    expect(immutablePatch.status).toBe(400);
    expect(mockCreateWfaReason).not.toHaveBeenCalled();
    expect(mockUpdateWfaReason).not.toHaveBeenCalled();
  });

  it('rejects invalid ids and empty patch bodies', async () => {
    const invalidId = await request(app)
      .patch('/api/settings/wfa/rejection-reasons/not-a-number')
      .send({ is_active: false });
    const emptyPatch = await request(app)
      .patch('/api/settings/wfa/rejection-reasons/1')
      .send({});

    expect(invalidId.status).toBe(400);
    expect(emptyPatch.status).toBe(400);
    expect(mockUpdateWfaReason).not.toHaveBeenCalled();
  });

  it('reuses Admin/Management authorization and denies User', async () => {
    currentRole = 'User';

    const res = await request(app).get('/api/settings/wfa/request-reasons');

    expect(res.status).toBe(403);
    expect(mockListWfaReasons).not.toHaveBeenCalled();
  });

  it.each([
    '/api/settings/wfa/request-reasons/1',
    '/api/settings/wfa/rejection-reasons/1'
  ])('does not expose a DELETE route at %s', async (path) => {
    const res = await request(app).delete(path);

    expect(res.status).toBe(404);
    expect(mockUpdateWfaReason).not.toHaveBeenCalled();
  });
});
