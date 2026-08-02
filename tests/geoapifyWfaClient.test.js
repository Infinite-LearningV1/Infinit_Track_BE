import { jest } from '@jest/globals';

import { AppError } from '../src/shared/errors/AppError.js';
import {
  createGeoapifyWfaClient,
  mapWithConcurrency
} from '../src/services/geoapifyWfa.client.js';

const createClient = ({ get = jest.fn(), logger = undefined } = {}) => {
  const httpClient = { get };
  const clientLogger =
    logger || {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
  const sleep = jest.fn().mockResolvedValue(undefined);
  const client = createGeoapifyWfaClient({
    httpClient,
    sleep,
    apiKeyResolver: () => 'secret-key',
    logger: clientLogger
  });

  return { client, httpClient, clientLogger, sleep };
};

test('requests approved places discovery query and returns provider features unchanged', async () => {
  const features = [{ properties: { place_id: 'place-1' } }];
  const get = jest.fn().mockResolvedValue({ data: { features } });
  const { client, httpClient } = createClient({ get });

  await expect(
    client.searchPlaces({ latitude: -0.8917, longitude: 119.8707, radiusMeters: 5000 })
  ).resolves.toBe(features);

  expect(httpClient.get).toHaveBeenCalledWith('https://api.geoapify.com/v2/places', {
    params: {
      categories: 'catering,accommodation,office,education',
      filter: 'circle:119.8707,-0.8917,5000',
      limit: 50,
      apiKey: 'secret-key',
      lang: 'en'
    },
    timeout: 30000
  });
});

test('requests minimal place details and selects only the details feature', async () => {
  const details = { properties: { feature_type: 'details', internet_access: 'yes' } };
  const get = jest.fn().mockResolvedValue({
    data: { features: [{ properties: { feature_type: 'common' } }, details] }
  });
  const { client, httpClient } = createClient({ get });

  await expect(client.fetchPlaceDetails('place-1')).resolves.toBe(details);

  expect(httpClient.get).toHaveBeenCalledWith(
    'https://api.geoapify.com/v2/place-details',
    expect.objectContaining({
      params: { id: 'place-1', features: 'details', apiKey: 'secret-key' },
      timeout: 30000
    })
  );
});

test('treats a missing details feature as incomplete provider evidence', async () => {
  const get = jest.fn().mockResolvedValue({ data: { features: [{ properties: { feature_type: 'common' } }] } });
  const { client } = createClient({ get });

  await expect(client.fetchPlaceDetails('place-1')).resolves.toBeNull();
});

const transientErrors = [
  { code: 'ECONNABORTED' },
  { code: 'ETIMEDOUT' },
  { code: 'ECONNRESET' },
  { response: { status: 429 } },
  { response: { status: 500 } }
];

test.each(transientErrors)('retries transient Place Details failures exactly once: %p', async (error) => {
  const get = jest
    .fn()
    .mockRejectedValueOnce(error)
    .mockResolvedValueOnce({ data: { features: [{ properties: { feature_type: 'details' } }] } });
  const { client, httpClient, sleep } = createClient({ get });

  await expect(client.fetchPlaceDetails('place-1')).resolves.toEqual({
    properties: { feature_type: 'details' }
  });
  expect(httpClient.get).toHaveBeenCalledTimes(2);
  expect(sleep).toHaveBeenCalledWith(250);
});

const permanentErrors = [
  { response: { status: 400 } },
  { response: { status: 401 } },
  { response: { status: 403 } }
];

test.each(permanentErrors)('does not retry permanent Place Details failures: %p', async (error) => {
  const get = jest.fn().mockRejectedValue(error);
  const { client, httpClient, sleep } = createClient({ get });

  await expect(client.fetchPlaceDetails('place-1')).rejects.toMatchObject({
    geoapify: { operation: 'place-details', retryable: false, status: error.response.status }
  });
  expect(httpClient.get).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
});

test('does not let a provider 400 spoof retryable classified metadata', async () => {
  const providerError = {
    response: { status: 400 },
    geoapify: { retryable: true, status: 599 }
  };
  const get = jest.fn().mockRejectedValue(providerError);
  const { client, httpClient, sleep } = createClient({ get });

  await expect(client.fetchPlaceDetails('place-1')).rejects.toMatchObject({
    geoapify: { operation: 'place-details', retryable: false, status: 400 }
  });
  expect(httpClient.get).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
});

test('does not let a provider 500 suppress retry with spoofed classified metadata', async () => {
  const providerError = {
    response: { status: 500 },
    geoapify: { retryable: false, status: 400 }
  };
  const get = jest.fn().mockRejectedValue(providerError);
  const { client, httpClient, sleep } = createClient({ get });

  await expect(client.fetchPlaceDetails('place-1')).rejects.toMatchObject({
    geoapify: { operation: 'place-details', retryable: true, status: 500 }
  });
  expect(httpClient.get).toHaveBeenCalledTimes(2);
  expect(sleep).toHaveBeenCalledTimes(1);
});

test('stops after one retry and redacts the API key from failure diagnostics', async () => {
  const error = { code: 'ETIMEDOUT' };
  const get = jest.fn().mockRejectedValue(error);
  const { client, httpClient, clientLogger, sleep } = createClient({ get });

  await expect(client.fetchPlaceDetails('place-1')).rejects.toMatchObject({
    geoapify: { operation: 'place-details', retryable: true, status: null }
  });
  expect(httpClient.get).toHaveBeenCalledTimes(2);
  expect(sleep).toHaveBeenCalledTimes(1);

  const metadata = JSON.stringify(clientLogger.warn.mock.calls);
  expect(metadata).toContain('[REDACTED]');
  expect(metadata).not.toContain('secret-key');
});

test('throws a new sanitized details error without the provider request graph or API key', async () => {
  const providerError = new Error('Request failed for secret-key');
  providerError.code = 'ERR_BAD_RESPONSE';
  providerError.config = { params: { apiKey: 'secret-key' } };
  providerError.request = { path: '/v2/place-details?apiKey=secret-key' };
  providerError.response = {
    status: 500,
    config: providerError.config,
    data: { diagnostic: 'secret-key' }
  };
  providerError.geoapify = {
    retryable: { diagnostic: 'secret-key' },
    status: { diagnostic: 'secret-key' }
  };
  const get = jest.fn().mockRejectedValue(providerError);
  const { client } = createClient({ get });

  const thrown = await client.fetchPlaceDetails('place-1').catch((error) => error);

  expect(thrown).not.toBe(providerError);
  expect(thrown).toMatchObject({
    name: 'GeoapifyRequestError',
    message: 'Geoapify request failed',
    code: 'GEOAPIFY_REQUEST_FAILED',
    geoapify: { operation: 'place-details', retryable: true, status: 500 }
  });
  expect(Object.keys(thrown).sort()).toEqual(['code', 'geoapify']);
  expect(thrown).not.toHaveProperty('config');
  expect(thrown).not.toHaveProperty('request');
  expect(thrown).not.toHaveProperty('response');
  expect(thrown).not.toHaveProperty('cause');
  expect(JSON.stringify(thrown)).not.toContain('secret-key');
});

test('normalizes Places discovery failures to a typed provider error with redacted diagnostics', async () => {
  const get = jest.fn().mockRejectedValue({ response: { status: 500 } });
  const { client, clientLogger } = createClient({ get });

  await expect(
    client.searchPlaces({ latitude: -0.8917, longitude: 119.8707, radiusMeters: 5000 })
  ).rejects.toEqual(
    expect.objectContaining({
      name: 'AppError',
      code: 'WFA_PROVIDER_UNAVAILABLE',
      status: 503
    })
  );
  expect(clientLogger.warn).toHaveBeenCalled();
  const metadata = JSON.stringify(clientLogger.warn.mock.calls);
  expect(metadata).toContain('[REDACTED]');
  expect(metadata).not.toContain('secret-key');
});

test('creates a typed provider error when the Geoapify API key is unavailable', async () => {
  const client = createGeoapifyWfaClient({
    httpClient: { get: jest.fn() },
    apiKeyResolver: () => null,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  });

  await expect(
    client.searchPlaces({ latitude: -0.8917, longitude: 119.8707, radiusMeters: 5000 })
  ).rejects.toBeInstanceOf(AppError);
  await expect(
    client.searchPlaces({ latitude: -0.8917, longitude: 119.8707, radiusMeters: 5000 })
  ).rejects.toMatchObject({ code: 'WFA_PROVIDER_UNAVAILABLE', status: 503 });
});

test('enforces the details worker-pool limit while preserving input order', async () => {
  const deferred = [];
  let active = 0;
  let maxActive = 0;
  const worker = jest.fn((value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    return new Promise((resolve) => {
      deferred.push(() => {
        active -= 1;
        resolve(`result-${value}`);
      });
    });
  });

  const resultPromise = mapWithConcurrency([0, 1, 2, 3, 4, 5, 6], 5, worker);
  await Promise.resolve();
  expect(maxActive).toBe(5);

  while (deferred.length) {
    deferred.shift()();
    await Promise.resolve();
  }

  await expect(resultPromise).resolves.toEqual([
    'result-0',
    'result-1',
    'result-2',
    'result-3',
    'result-4',
    'result-5',
    'result-6'
  ]);
  expect(maxActive).toBeLessThanOrEqual(5);
});
