#!/usr/bin/env node

/**
 * Smoke Test Script
 *
 * Performs basic health checks on the deployed backend to ensure
 * critical functionality is working after deployment.
 *
 * Usage:
 *   node scripts/smoke-test.js <base-url>
 *
 * Example:
 *   node scripts/smoke-test.js https://staging-api.example.internal
 */

import axios from 'axios';

const BASE_URL = process.argv[2] || process.env.BASE_URL;
const TIMEOUT = 10000; // 10 seconds
const ANONYMOUS_BLOCKED_STATUSES = new Set([401, 403]);
const EXPECTED_INVALID_LOGIN_STATUSES = new Set([400, 401, 422]);
const LIVEZ_URL = `${BASE_URL}/livez`;
const HEALTH_URL = `${BASE_URL}/health`;

if (!BASE_URL) {
  console.error('❌ Error: BASE_URL not provided');
  console.error('Usage: node scripts/smoke-test.js <base-url>');
  console.error('Example: node scripts/smoke-test.js https://staging-api.app');
  process.exit(1);
}

console.log('🔍 Starting smoke tests...');
console.log(`📍 Base URL: ${BASE_URL}\n`);

const results = {
  passed: 0,
  failed: 0,
  tests: []
};

function formatAxiosError(error) {
  if (error.response) {
    return `Status: ${error.response.status}, Response: ${JSON.stringify(error.response.data)}`;
  }

  return `Error: ${error.message}`;
}

function isAnonymousAccessBlocked(status) {
  return ANONYMOUS_BLOCKED_STATUSES.has(status);
}

async function requestWithAnyStatus(method, path, options = {}) {
  return axios({
    method,
    url: `${BASE_URL}${path}`,
    timeout: TIMEOUT,
    validateStatus: () => true,
    ...options
  });
}

/**
 * Test result logger
 */
function logTest(name, passed, details = '') {
  const status = passed ? '✅' : '❌';
  console.log(`${status} ${name}`);
  if (details) {
    console.log(`   ${details}`);
  }

  results.tests.push({ name, passed, details });
  if (passed) {
    results.passed++;
  } else {
    results.failed++;
  }
}

/**
 * Test 1: Liveness Endpoint
 */
async function testLiveness() {
  try {
    const response = await axios.get(LIVEZ_URL, { timeout: TIMEOUT });

    if (response.status === 200 && response.data.status === 'OK') {
      logTest(
        'Liveness Endpoint',
        true,
        `Status: ${response.status}, Response: ${JSON.stringify(response.data)}`
      );
      return true;
    } else {
      logTest('Liveness Endpoint', false, `Unexpected response: ${JSON.stringify(response.data)}`);
      return false;
    }
  } catch (error) {
    logTest('Liveness Endpoint', false, formatAxiosError(error));
    return false;
  }
}

/**
 * Test 2: Readiness Endpoint
 */
async function testReadiness() {
  try {
    const response = await axios.get(HEALTH_URL, {
      timeout: TIMEOUT,
      validateStatus: () => true
    });

    if (response.status === 200 && response.data.status === 'OK' && response.data.ready === true) {
      logTest(
        'Readiness Endpoint',
        true,
        `Status: ${response.status}, Response: ${JSON.stringify(response.data)}`
      );
      return true;
    }

    if (response.status === 503 && Array.isArray(response.data?.missing)) {
      logTest(
        'Readiness Endpoint',
        false,
        `Status: ${response.status}, Missing: ${response.data.missing.join(', ')}`
      );
      return false;
    }

    logTest(
      'Readiness Endpoint',
      false,
      `Unexpected status ${response.status}, Response: ${JSON.stringify(response.data)}`
    );
    return false;
  } catch (error) {
    logTest('Readiness Endpoint', false, formatAxiosError(error));
    return false;
  }
}

/**
 * Test 3: API Documentation Access Control
 */
async function testDocs() {
  const testName = 'API Documentation Access Control';

  try {
    const response = await requestWithAnyStatus('get', '/docs/');

    if (isAnonymousAccessBlocked(response.status)) {
      logTest(testName, true, `Anonymous access blocked with ${response.status}`);
      return true;
    }

    logTest(testName, false, `Expected 401/403 for anonymous docs access, got ${response.status}`);
    return false;
  } catch (error) {
    logTest(testName, false, formatAxiosError(error));
    return false;
  }
}

async function testRawOpenApiContract() {
  const testName = 'Raw OpenAPI Contract Access Control';

  try {
    const response = await requestWithAnyStatus('get', '/docs/openapi.yaml');

    if (isAnonymousAccessBlocked(response.status)) {
      logTest(testName, true, `Anonymous raw spec access blocked with ${response.status}`);
      return true;
    }

    logTest(
      testName,
      false,
      `Expected 401/403 for anonymous raw spec access, got ${response.status}`
    );
    return false;
  } catch (error) {
    logTest(testName, false, formatAxiosError(error));
    return false;
  }
}

/**
 * Test 4: CORS Headers
 */
async function testCORS() {
  try {
    const disallowedOrigin = 'https://example.com';
    const response = await axios.options(`${BASE_URL}/api/auth/login`, {
      timeout: TIMEOUT,
      validateStatus: () => true,
      headers: {
        Origin: disallowedOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    });

    const corsHeader = response.headers['access-control-allow-origin'];
    const credentialsHeader = response.headers['access-control-allow-credentials'];
    const methodsHeader = response.headers['access-control-allow-methods'];
    const allowedHeaders = response.headers['access-control-allow-headers'];
    const disallowedOriginRejected = corsHeader !== disallowedOrigin;
    const credentialsConfigured = credentialsHeader === 'true';
    const allowsPost = methodsHeader
      ?.split(',')
      .map((method) => method.trim().toUpperCase())
      .includes('POST');
    const allowsContentType = allowedHeaders
      ?.split(',')
      .map((header) => header.trim().toLowerCase())
      .includes('content-type');

    if (
      [200, 204].includes(response.status) &&
      disallowedOriginRejected &&
      credentialsConfigured &&
      allowsPost &&
      allowsContentType
    ) {
      logTest(
        'CORS Headers',
        true,
        `Requested-Origin: ${disallowedOrigin}, Allow-Origin: ${corsHeader || '-'}, Allow-Credentials: ${credentialsHeader}, Allow-Methods: ${methodsHeader}, Allow-Headers: ${allowedHeaders}`
      );
      return true;
    }

    logTest(
      'CORS Headers',
      false,
      `Status: ${response.status}, Requested-Origin: ${disallowedOrigin}, Allow-Origin: ${corsHeader || '-'}, Allow-Credentials: ${credentialsHeader || '-'}, Allow-Methods: ${methodsHeader || '-'}, Allow-Headers: ${allowedHeaders || '-'}`
    );
    return false;
  } catch (error) {
    logTest('CORS Headers', false, formatAxiosError(error));
    return false;
  }
}

/**
 * Test 5: Security Headers
 */
async function testSecurityHeaders() {
  try {
    const response = await axios.get(LIVEZ_URL, { timeout: TIMEOUT });

    const headers = response.headers;
    const checks = {
      'X-Content-Type-Options': headers['x-content-type-options'] === 'nosniff',
      'X-Frame-Options': !!headers['x-frame-options'],
      'X-XSS-Protection': !!headers['x-xss-protection'],
      'No X-Powered-By': !headers['x-powered-by']
    };

    const allPassed = Object.values(checks).every((v) => v);
    const details = Object.entries(checks)
      .map(([key, val]) => `${key}: ${val ? '✓' : '✗'}`)
      .join(', ');

    logTest('Security Headers', allPassed, details);
    return allPassed;
  } catch (error) {
    logTest('Security Headers', false, formatAxiosError(error));
    return false;
  }
}

/**
 * Test 6: Auth Endpoint (should reject without credentials)
 */
async function testAuthEndpoint() {
  try {
    const response = await requestWithAnyStatus('get', '/api/auth/me');

    if (isAnonymousAccessBlocked(response.status)) {
      logTest('Auth Protection', true, `Protected endpoint correctly returns ${response.status}`);
      return true;
    }

    logTest('Auth Protection', false, `Expected 401/403, got ${response.status}`);
    return false;
  } catch (error) {
    logTest('Auth Protection', false, formatAxiosError(error));
    return false;
  }
}

async function testProtectedRouteInventory() {
  const protectedEndpoints = [
    ['/api/auth/me', 'Auth Me Endpoint'],
    ['/api/bookings/history', 'Bookings History Endpoint'],
    ['/api/wfa/recommendations', 'WFA Recommendations Endpoint'],
    ['/api/summary/reports', 'Summary Reports Endpoint']
  ];

  let passed = true;

  for (const [path, label] of protectedEndpoints) {
    try {
      const response = await requestWithAnyStatus('get', path);
      const endpointPassed = isAnonymousAccessBlocked(response.status);

      logTest(
        `${label} Auth Protection`,
        endpointPassed,
        endpointPassed
          ? `Anonymous access blocked with ${response.status}`
          : `Expected 401/403, got ${response.status}`
      );

      passed = passed && endpointPassed;
    } catch (error) {
      logTest(`${label} Auth Protection`, false, formatAxiosError(error));
      passed = false;
    }
  }

  return passed;
}

async function testPublicRegisterClosed() {
  const testName = 'Public Auth Register Surface Closed';

  try {
    const response = await requestWithAnyStatus('post', '/api/auth/register', {
      headers: { 'Content-Type': 'application/json' },
      data: {}
    });

    if (response.status === 404) {
      logTest(testName, true, 'Anonymous register route is not mounted');
      return true;
    }

    logTest(testName, false, `Expected 404 for removed register route, got ${response.status}`);
    return false;
  } catch (error) {
    logTest(testName, false, formatAxiosError(error));
    return false;
  }
}

/**
 * Test 7: Login Endpoint Structure
 */
async function testLoginEndpoint() {
  try {
    // Try login with invalid credentials
    const response = await axios.post(
      `${BASE_URL}/api/auth/login`,
      { email: 'test@example.com', password: 'wrongpassword' },
      {
        timeout: TIMEOUT,
        validateStatus: () => true,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    if (EXPECTED_INVALID_LOGIN_STATUSES.has(response.status)) {
      logTest(
        'Login Endpoint',
        true,
        `Returns ${response.status} for invalid credentials (correct)`
      );
      return true;
    }

    logTest(
      'Login Endpoint',
      false,
      `Expected 400/401/422 for invalid credentials, got ${response.status}, Response: ${JSON.stringify(response.data)}`
    );
    return false;
  } catch (error) {
    logTest('Login Endpoint', false, formatAxiosError(error));
    return false;
  }
}

/**
 * Test 8: Request ID in Response
 */
async function testRequestId() {
  try {
    const response = await axios.get(LIVEZ_URL, { timeout: TIMEOUT });

    const requestId = response.headers['x-request-id'];
    if (requestId) {
      logTest('Request ID Header', true, `X-Request-ID: ${requestId}`);
      return true;
    } else {
      logTest('Request ID Header', false, 'Missing X-Request-ID header');
      return false;
    }
  } catch (error) {
    logTest('Request ID Header', false, formatAxiosError(error));
    return false;
  }
}

/**
 * Test 9: Response Time
 */
async function testResponseTime() {
  try {
    const start = Date.now();
    await axios.get(LIVEZ_URL, { timeout: TIMEOUT });
    const duration = Date.now() - start;

    if (duration < 1000) {
      logTest('Response Time', true, `${duration}ms (< 1 second)`);
      return true;
    } else if (duration < 3000) {
      logTest('Response Time', true, `${duration}ms (acceptable)`);
      return true;
    } else {
      logTest('Response Time', false, `${duration}ms (too slow)`);
      return false;
    }
  } catch (error) {
    logTest('Response Time', false, formatAxiosError(error));
    return false;
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('═══════════════════════════════════════');
  console.log('Running Smoke Tests');
  console.log('═══════════════════════════════════════\n');

  await testLiveness();
  await testReadiness();
  await testDocs();
  await testRawOpenApiContract();
  await testCORS();
  await testSecurityHeaders();
  await testAuthEndpoint();
  await testProtectedRouteInventory();
  await testPublicRegisterClosed();
  await testLoginEndpoint();
  await testRequestId();
  await testResponseTime();

  console.log('\n═══════════════════════════════════════');
  console.log('Test Results Summary');
  console.log('═══════════════════════════════════════\n');
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`📊 Total:  ${results.passed + results.failed}`);
  console.log(
    `📈 Success Rate: ${Math.round((results.passed / (results.passed + results.failed)) * 100)}%`
  );
  console.log('');

  // Exit with error code if any test failed
  if (results.failed > 0) {
    console.error('❌ Smoke tests FAILED');
    console.error('Please check the logs above for details.\n');
    process.exit(1);
  } else {
    console.log('✅ All smoke tests PASSED');
    console.log('Backend is healthy and ready! 🚀\n');
    process.exit(0);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('❌ Fatal error during smoke tests:', error.message);
  process.exit(1);
});
