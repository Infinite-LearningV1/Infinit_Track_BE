import express from 'express';
import { jest } from '@jest/globals';
import request from 'supertest';

const mockVerifyToken = jest.fn((req, _res, next) => {
  req.user = { id: 1, role_name: 'Admin' };
  next();
});

let currentRole = 'Admin';
const mockRoleGuard = (allowedRoles) => (req, res, next) => {
  req.user = { ...(req.user || {}), role_name: currentRole };

  if (!allowedRoles.includes(currentRole)) {
    return res.status(403).json({
      success: false,
      code: 'E_FORBIDDEN',
      message: 'Forbidden: Insufficient role'
    });
  }

  next();
};

const mockReadOperationalSettings = jest.fn();
const mockUpdateOperationalSettings = jest.fn();

jest.unstable_mockModule('../src/services/operationalSettings.service.js', () => ({
  readOperationalSettings: mockReadOperationalSettings,
  updateOperationalSettings: mockUpdateOperationalSettings
}));

jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
  verifyToken: mockVerifyToken
}));

jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
  __esModule: true,
  default: mockRoleGuard
}));

const { default: settingsRoutes } = await import('../src/routes/settings.routes.js');
const { default: mainRoutes } = await import('../src/routes/index.js');
const { errorHandler } = await import('../src/middlewares/errorHandler.js');

const scopedApp = express();
scopedApp.use(express.json());
scopedApp.use('/api/settings', settingsRoutes);
scopedApp.use(errorHandler);

const mainApp = express();
mainApp.use(express.json());
mainApp.use(mainRoutes);
mainApp.use(errorHandler);

const buildOperationalSettings = (overrides = {}) => ({
  geofenceRadiusDefaultM: 100,
  autoCheckoutIdleMin: 10,
  autoCheckoutTBufferMin: 30,
  lateCheckoutToleranceMin: 15,
  defaultShiftEnd: '17:00:00',
  ...overrides
});

describe('settings operational routes contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentRole = 'Admin';

    mockReadOperationalSettings.mockResolvedValue(buildOperationalSettings());
    mockUpdateOperationalSettings.mockResolvedValue(buildOperationalSettings());
  });

  it('allows admin to read operational settings as a raw typed object', async () => {
    const res = await request(scopedApp).get('/api/settings/operational');

    expect(res.status).toBe(200);
    expect(mockVerifyToken).toHaveBeenCalled();
    expect(mockReadOperationalSettings).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual(buildOperationalSettings());
    expect(res.body.success).toBeUndefined();
    expect(res.body.data).toBeUndefined();
    expect(res.body.AHP_CR_THRESHOLD).toBeUndefined();
  });

  it('allows management to read operational settings', async () => {
    currentRole = 'Management';

    const res = await request(scopedApp).get('/api/settings/operational');

    expect(res.status).toBe(200);
    expect(mockReadOperationalSettings).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual(buildOperationalSettings());
  });

  it('allows admin to partially update operational settings and returns latest full state', async () => {
    mockUpdateOperationalSettings.mockResolvedValue(
      buildOperationalSettings({
        autoCheckoutIdleMin: 12,
        defaultShiftEnd: '18:00:00'
      })
    );

    const payload = {
      autoCheckoutIdleMin: 12,
      defaultShiftEnd: '18:00'
    };

    const res = await request(scopedApp).patch('/api/settings/operational').send(payload);

    expect(res.status).toBe(200);
    expect(mockUpdateOperationalSettings).toHaveBeenCalledWith(payload);
    expect(res.body).toEqual(
      buildOperationalSettings({
        autoCheckoutIdleMin: 12,
        defaultShiftEnd: '18:00:00'
      })
    );
  });

  it('allows admin to send a no-op patch and still returns the latest full state', async () => {
    const payload = {
      autoCheckoutIdleMin: 10,
      defaultShiftEnd: '17:00:00'
    };

    const res = await request(scopedApp).patch('/api/settings/operational').send(payload);

    expect(res.status).toBe(200);
    expect(mockUpdateOperationalSettings).toHaveBeenCalledWith(payload);
    expect(res.body).toEqual(buildOperationalSettings());
  });

  it('allows management to partially update operational settings', async () => {
    currentRole = 'Management';
    mockUpdateOperationalSettings.mockResolvedValue(
      buildOperationalSettings({
        geofenceRadiusDefaultM: 150
      })
    );

    const res = await request(scopedApp)
      .patch('/api/settings/operational')
      .send({ geofenceRadiusDefaultM: 150 });

    expect(res.status).toBe(200);
    expect(mockUpdateOperationalSettings).toHaveBeenCalledWith({ geofenceRadiusDefaultM: 150 });
    expect(res.body).toEqual(
      buildOperationalSettings({
        geofenceRadiusDefaultM: 150
      })
    );
  });

  it('returns 401 when authentication fails before the handler', async () => {
    mockVerifyToken.mockImplementationOnce((_req, res, _next) => {
      res.status(401).json({ message: 'Invalid token' });
    });

    const res = await request(scopedApp).get('/api/settings/operational');

    expect(res.status).toBe(401);
    expect(mockReadOperationalSettings).not.toHaveBeenCalled();
    expect(res.body).toEqual({ message: 'Invalid token' });
  });

  it('returns 403 for callers outside Admin and Management', async () => {
    currentRole = 'User';

    const res = await request(scopedApp).get('/api/settings/operational');

    expect(res.status).toBe(403);
    expect(mockReadOperationalSettings).not.toHaveBeenCalled();
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('E_FORBIDDEN');
  });

  it('rejects empty patch body with validation error shape', async () => {
    const res = await request(scopedApp).patch('/api/settings/operational').send({});

    expect(res.status).toBe(400);
    expect(mockUpdateOperationalSettings).not.toHaveBeenCalled();
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: 'E_VALIDATION',
        message: expect.stringContaining('At least one of these fields is required'),
        errors: expect.any(Array)
      })
    );
  });

  it('rejects non-object patch bodies', async () => {
    const res = await request(scopedApp).patch('/api/settings/operational').send([]);

    expect(res.status).toBe(400);
    expect(mockUpdateOperationalSettings).not.toHaveBeenCalled();
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: 'E_VALIDATION',
        message: 'Body must be an object',
        errors: expect.any(Array)
      })
    );
  });

  it('rejects unknown patch fields', async () => {
    const res = await request(scopedApp)
      .patch('/api/settings/operational')
      .send({ ahpCrThreshold: 0.2 });

    expect(res.status).toBe(400);
    expect(mockUpdateOperationalSettings).not.toHaveBeenCalled();
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: 'E_VALIDATION',
        message: 'Unknown operational setting field: ahpCrThreshold',
        errors: expect.any(Array)
      })
    );
  });

  it('rejects invalid numeric patch values', async () => {
    const res = await request(scopedApp)
      .patch('/api/settings/operational')
      .send({ autoCheckoutIdleMin: 0 });

    expect(res.status).toBe(400);
    expect(mockUpdateOperationalSettings).not.toHaveBeenCalled();
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: 'E_VALIDATION',
        message: 'autoCheckoutIdleMin must be a positive integer',
        errors: expect.any(Array)
      })
    );
  });

  it('rejects invalid time patch values', async () => {
    const res = await request(scopedApp)
      .patch('/api/settings/operational')
      .send({ defaultShiftEnd: '6pm' });

    expect(res.status).toBe(400);
    expect(mockUpdateOperationalSettings).not.toHaveBeenCalled();
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: 'E_VALIDATION',
        message: 'defaultShiftEnd must use HH:mm or HH:mm:ss format',
        errors: expect.any(Array)
      })
    );
  });

  it('returns 500 when the stored operational settings state is incomplete or invalid', async () => {
    mockReadOperationalSettings.mockRejectedValueOnce(
      Object.assign(new Error('Operational settings are incomplete or invalid: geofenceRadiusDefaultM (missing)'), {
        status: 500,
        code: 'E_OPERATIONAL_SETTINGS_INVALID',
        details: [{ field: 'geofenceRadiusDefaultM', issue: 'missing' }]
      })
    );

    const res = await request(scopedApp).get('/api/settings/operational');

    expect(res.status).toBe(500);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: 'E_OPERATIONAL_SETTINGS_INVALID',
        message: 'Operational settings are incomplete or invalid: geofenceRadiusDefaultM (missing)',
        details: [{ field: 'geofenceRadiusDefaultM', issue: 'missing' }]
      })
    );
  });

  it('returns 500 when a patch leaves the full stored operational settings state invalid', async () => {
    mockUpdateOperationalSettings.mockRejectedValueOnce(
      Object.assign(new Error('Operational settings are incomplete or invalid: geofenceRadiusDefaultM (invalid)'), {
        status: 500,
        code: 'E_OPERATIONAL_SETTINGS_INVALID',
        details: [{ field: 'geofenceRadiusDefaultM', issue: 'invalid', value: 'not-a-number' }]
      })
    );

    const res = await request(scopedApp)
      .patch('/api/settings/operational')
      .send({ autoCheckoutIdleMin: 12 });

    expect(res.status).toBe(500);
    expect(mockUpdateOperationalSettings).toHaveBeenCalledWith({ autoCheckoutIdleMin: 12 });
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: 'E_OPERATIONAL_SETTINGS_INVALID',
        message: 'Operational settings are incomplete or invalid: geofenceRadiusDefaultM (invalid)',
        details: [{ field: 'geofenceRadiusDefaultM', issue: 'invalid', value: 'not-a-number' }]
      })
    );
  });

  it('does not expose arbitrary details arrays for non-operational-settings errors', async () => {
    mockReadOperationalSettings.mockRejectedValueOnce(
      Object.assign(new Error('Unexpected downstream failure'), {
        status: 500,
        code: 'E_INTERNAL_TEST',
        details: [{ internal: 'should-not-leak' }]
      })
    );

    const res = await request(scopedApp).get('/api/settings/operational');

    expect(res.status).toBe(500);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        message: 'Unexpected downstream failure'
      })
    );
    expect(res.body.code).toBeUndefined();
    expect(res.body.details).toBeUndefined();
  });

  it('mounts the settings route into the main router under /api/settings', async () => {
    const res = await request(mainApp).get('/api/settings/operational');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(buildOperationalSettings());
    expect(mockReadOperationalSettings).toHaveBeenCalledTimes(1);
  });
});
