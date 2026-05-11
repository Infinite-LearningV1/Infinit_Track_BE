import fs from 'fs';
import path from 'path';
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import yaml from 'yamljs';

function expectLivenessResponse(response) {
  expect(response.status).toBe(200);
  expect(response.body).toEqual(
    expect.objectContaining({
      status: 'OK',
      timestamp: expect.any(String)
    })
  );
}

function expectNotReadyResponse(response, { database, scheduler, missing }) {
  expect(response.status).toBe(503);
  expect(response.body).toEqual(
    expect.objectContaining({
      status: 'NOT_READY',
      ready: false,
      timestamp: expect.any(String),
      components: {
        database,
        scheduler
      },
      missing
    })
  );
}

function expectReadyResponse(response) {
  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    status: 'OK',
    ready: true,
    timestamp: expect.any(String),
    components: {
      database: 'ready',
      scheduler: 'ready'
    },
    missing: []
  });
}

function readOpenApiSpec() {
  const openApiPath = path.resolve(process.cwd(), 'docs/openapi.yaml');
  const openApiSource = fs.readFileSync(openApiPath, 'utf8');

  return yaml.parse(openApiSource);
}

async function markSchedulerReadyFromMock() {
  const { markSchedulerReady } = await import('../src/utils/readinessState.js');
  markSchedulerReady();
  return { started: true, taskCount: 4 };
}

async function loadAppHarness({ authenticateImpl, schedulerStartImpl } = {}) {
  jest.resetModules();

  const authenticate = authenticateImpl ?? jest.fn().mockResolvedValue(undefined);
  const ensureSchedulerStarted = schedulerStartImpl ?? jest.fn(markSchedulerReadyFromMock);

  jest.unstable_mockModule('../src/config/database.js', () => ({
    default: { authenticate }
  }));

  jest.unstable_mockModule('../src/utils/schedulerLifecycle.js', () => ({
    ensureSchedulerStarted
  }));

  jest.unstable_mockModule('../src/utils/logger.js', () => ({
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn()
    }
  }));

  const { getLiveness, getReadiness } = await import('../src/controllers/health.controller.js');
  const readinessState = await import('../src/utils/readinessState.js');
  const app = express();
  app.get('/livez', getLiveness);
  app.get('/health', getReadiness);

  return {
    app,
    authenticate,
    ensureSchedulerStarted,
    ...readinessState
  };
}

describe('health and readiness contract', () => {
  let healthyAppHarness;

  beforeAll(async () => {
    healthyAppHarness = await loadAppHarness();
  }, 15000);

  beforeEach(() => {
    healthyAppHarness.resetReadinessState();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    jest.resetModules();
  });

  test('returns process liveness from /livez without probing dependencies', async () => {
    const { app, authenticate, ensureSchedulerStarted } = healthyAppHarness;

    const response = await request(app).get('/livez');

    expect(authenticate).not.toHaveBeenCalled();
    expect(ensureSchedulerStarted).not.toHaveBeenCalled();
    expectLivenessResponse(response);
  });

  test('starts scheduler recovery from /health when the database probe succeeds', async () => {
    const { app, authenticate, ensureSchedulerStarted } = healthyAppHarness;

    const response = await request(app).get('/health');

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(ensureSchedulerStarted).toHaveBeenCalledWith({ source: 'health' });
    expectReadyResponse(response);
  });

  test('returns 200 from /health without scheduler recovery when scheduler is already ready', async () => {
    const { app, authenticate, ensureSchedulerStarted, markSchedulerReady } = healthyAppHarness;

    markSchedulerReady();

    const response = await request(app).get('/health');

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(ensureSchedulerStarted).not.toHaveBeenCalled();
    expectReadyResponse(response);
  });

  test('returns 503 from /health when scheduler recovery fails after a successful database probe', async () => {
    const schedulerError = new Error('scheduler failed');
    const ensureSchedulerStarted = jest.fn().mockRejectedValue(schedulerError);
    const { app, authenticate } = await loadAppHarness({ schedulerStartImpl: ensureSchedulerStarted });

    const response = await request(app).get('/health');

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(ensureSchedulerStarted).toHaveBeenCalledWith({ source: 'health' });
    expectNotReadyResponse(response, {
      database: 'ready',
      scheduler: 'not_ready',
      missing: ['scheduler']
    });
  });

  test('returns 503 from /health when the live database probe fails after prior startup readiness', async () => {
    const authenticate = jest.fn().mockRejectedValue(new Error('db down'));
    const { app, ensureSchedulerStarted, markDatabaseReady, markSchedulerReady, resetReadinessState } =
      await loadAppHarness({ authenticateImpl: authenticate });

    resetReadinessState();
    markDatabaseReady();
    markSchedulerReady();

    const response = await request(app).get('/health');

    expect(ensureSchedulerStarted).not.toHaveBeenCalled();
    expectNotReadyResponse(response, {
      database: 'not_ready',
      scheduler: 'ready',
      missing: ['database']
    });
  });

  test('documents both /livez and /health in the public OpenAPI spec', () => {
    const openapi = readOpenApiSpec();

    expect(openapi.paths['/livez']).toBeDefined();
    expect(openapi.paths['/health']).toBeDefined();
    expect(openapi.paths['/health'].get.responses['503']).toBeDefined();
  });
});
