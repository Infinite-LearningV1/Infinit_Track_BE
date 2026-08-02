import axios from 'axios';

import { AppError } from '../shared/errors/AppError.js';
import logger from '../utils/logger.js';

const GEOAPIFY_PLACES_URL = 'https://api.geoapify.com/v2/places';
const GEOAPIFY_PLACE_DETAILS_URL = 'https://api.geoapify.com/v2/place-details';
const GEOAPIFY_TIMEOUT_MS = 30000;
const GEOAPIFY_RETRY_DELAY_MS = 250;
const GEOAPIFY_WFA_CATEGORIES = 'catering,accommodation,office,education';

const defaultSleep = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export const resolveGeoapifyApiKey = () => process.env.GEOAPIFY_API_KEY || process.env.GEOAPIFY_KEY || null;

const redactGeoapifyParams = (params) => ({
  ...params,
  apiKey: '[REDACTED]'
});

export const isTransientGeoapifyError = (error) => {
  if (['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED'].includes(error?.code)) {
    return true;
  }

  const status = error?.response?.status;
  return status === 429 || (status >= 500 && status <= 599);
};

class GeoapifyRequestError extends Error {
  constructor({ operation, retryable, status }) {
    super('Geoapify request failed');
    Object.defineProperty(this, 'name', { value: 'GeoapifyRequestError', configurable: true });
    this.code = 'GEOAPIFY_REQUEST_FAILED';
    this.geoapify = { operation, retryable, status };
  }
}

const classifyGeoapifyError = (error, operation) => {
  const classifiedRetryable = error?.geoapify?.retryable;
  const classifiedStatus = error?.geoapify?.status;
  const responseStatus = error?.response?.status;

  return new GeoapifyRequestError({
    operation,
    retryable:
      typeof classifiedRetryable === 'boolean' ? classifiedRetryable : isTransientGeoapifyError(error),
    status: Number.isInteger(classifiedStatus)
      ? classifiedStatus
      : Number.isInteger(responseStatus)
        ? responseStatus
        : null
  });
};

const requestWithRetry = async (request, { sleep, logger: clientLogger, operation, params }) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      const classifiedError = classifyGeoapifyError(error, operation);
      clientLogger.warn('Geoapify provider request failed', {
        operation,
        attempt: attempt + 1,
        retryable: classifiedError.geoapify.retryable,
        status: classifiedError.geoapify.status,
        params: redactGeoapifyParams(params)
      });

      if (attempt === 1 || !classifiedError.geoapify.retryable) {
        throw classifiedError;
      }

      await sleep(GEOAPIFY_RETRY_DELAY_MS);
    }
  }

  throw new Error('unreachable');
};

const providerUnavailableError = () =>
  new AppError('Layanan Geoapify tidak tersedia.', {
    code: 'WFA_PROVIDER_UNAVAILABLE',
    status: 503
  });

export const createGeoapifyWfaClient = ({
  httpClient = axios,
  sleep = defaultSleep,
  apiKeyResolver = resolveGeoapifyApiKey,
  logger: clientLogger = logger
} = {}) => {
  const resolveApiKey = () => {
    const apiKey = apiKeyResolver();

    if (!apiKey) {
      throw providerUnavailableError();
    }

    if (!process.env.GEOAPIFY_API_KEY && process.env.GEOAPIFY_KEY && apiKey === process.env.GEOAPIFY_KEY) {
      clientLogger.warn('Using legacy GEOAPIFY_KEY fallback for WFA Geoapify client');
    }

    return apiKey;
  };

  const searchPlaces = async ({ latitude, longitude, radiusMeters }) => {
    const apiKey = resolveApiKey();
    const params = {
      categories: GEOAPIFY_WFA_CATEGORIES,
      filter: `circle:${longitude},${latitude},${radiusMeters}`,
      limit: 50,
      apiKey,
      lang: 'en'
    };

    try {
      const response = await requestWithRetry(
        () => httpClient.get(GEOAPIFY_PLACES_URL, { params, timeout: GEOAPIFY_TIMEOUT_MS }),
        { sleep, logger: clientLogger, operation: 'places-discovery', params }
      );
      return response.data.features ?? [];
    } catch (error) {
      const classifiedError = classifyGeoapifyError(error, 'places-discovery');
      clientLogger.warn('Geoapify places discovery unavailable', {
        operation: classifiedError.geoapify.operation,
        retryable: classifiedError.geoapify.retryable,
        status: classifiedError.geoapify.status,
        params: redactGeoapifyParams(params)
      });
      throw providerUnavailableError();
    }
  };

  const fetchPlaceDetails = async (placeId) => {
    const apiKey = resolveApiKey();
    const params = { id: placeId, features: 'details', apiKey };

    try {
      const response = await requestWithRetry(
        () => httpClient.get(GEOAPIFY_PLACE_DETAILS_URL, { params, timeout: GEOAPIFY_TIMEOUT_MS }),
        { sleep, logger: clientLogger, operation: 'place-details', params }
      );
      return response.data.features?.find((feature) => feature?.properties?.feature_type === 'details') ?? null;
    } catch (error) {
      throw classifyGeoapifyError(error, 'place-details');
    }
  };

  return { searchPlaces, fetchPlaceDetails };
};

export const mapWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
};
