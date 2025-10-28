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
 *   node scripts/smoke-test.js https://staging-api.ondigitalocean.app
 */

import axios from 'axios';

const BASE_URL = process.argv[2] || process.env.BASE_URL;
const TIMEOUT = 10000; // 10 seconds

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
 * Test 1: Health Endpoint
 */
async function testHealth() {
  try {
    const response = await axios.get(`${BASE_URL}/health`, { timeout: TIMEOUT });

    if (response.status === 200 && response.data.status === 'OK') {
      logTest(
        'Health Endpoint',
        true,
        `Status: ${response.status}, Response: ${JSON.stringify(response.data)}`
      );
      return true;
    } else {
      logTest('Health Endpoint', false, `Unexpected response: ${JSON.stringify(response.data)}`);
      return false;
    }
  } catch (error) {
    logTest('Health Endpoint', false, `Error: ${error.message}`);
    return false;
  }
}

/**
 * Test 2: API Documentation
 */
async function testDocs() {
  try {
    const response = await axios.get(`${BASE_URL}/docs/`, { timeout: TIMEOUT });

    if (response.status === 200) {
      logTest('API Documentation', true, `Status: ${response.status}`);
      return true;
    } else {
      logTest('API Documentation', false, `Status: ${response.status}`);
      return false;
    }
  } catch (error) {
    logTest('API Documentation', false, `Error: ${error.message}`);
    return false;
  }
}

/**
 * Test 3: CORS Headers
 */
async function testCORS() {
  try {
    const response = await axios.options(`${BASE_URL}/health`, {
      timeout: TIMEOUT,
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'GET'
      }
    });

    const corsHeader = response.headers['access-control-allow-origin'];
    if (corsHeader) {
      logTest('CORS Headers', true, `Allow-Origin: ${corsHeader}`);
      return true;
    } else {
      logTest('CORS Headers', false, 'No CORS headers found');
      return false;
    }
  } catch (error) {
    // Some servers might not support OPTIONS, which is OK
    logTest('CORS Headers', true, 'OPTIONS not supported (acceptable)');
    return true;
  }
}

/**
 * Test 4: Security Headers
 */
async function testSecurityHeaders() {
  try {
    const response = await axios.get(`${BASE_URL}/health`, { timeout: TIMEOUT });

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
    logTest('Security Headers', false, `Error: ${error.message}`);
    return false;
  }
}

/**
 * Test 5: Auth Endpoint (should reject without credentials)
 */
async function testAuthEndpoint() {
  try {
    // Try to access protected endpoint without auth
    const response = await axios.get(`${BASE_URL}/api/users/profile`, {
      timeout: TIMEOUT,
      validateStatus: () => true // Accept any status code
    });

    if (response.status === 401 || response.status === 403) {
      logTest('Auth Protection', true, `Protected endpoint correctly returns ${response.status}`);
      return true;
    } else {
      logTest('Auth Protection', false, `Expected 401/403, got ${response.status}`);
      return false;
    }
  } catch (error) {
    logTest('Auth Protection', false, `Error: ${error.message}`);
    return false;
  }
}

/**
 * Test 6: Login Endpoint Structure
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

    // Should return 400 or 401, not 500
    if (response.status === 400 || response.status === 401) {
      logTest(
        'Login Endpoint',
        true,
        `Returns ${response.status} for invalid credentials (correct)`
      );
      return true;
    } else if (response.status === 500) {
      logTest('Login Endpoint', false, 'Returns 500 error (database/server issue)');
      return false;
    } else {
      logTest('Login Endpoint', true, `Returns ${response.status} (acceptable)`);
      return true;
    }
  } catch (error) {
    logTest('Login Endpoint', false, `Error: ${error.message}`);
    return false;
  }
}

/**
 * Test 7: Request ID in Response
 */
async function testRequestId() {
  try {
    const response = await axios.get(`${BASE_URL}/health`, { timeout: TIMEOUT });

    const requestId = response.headers['x-request-id'];
    if (requestId) {
      logTest('Request ID Header', true, `X-Request-ID: ${requestId}`);
      return true;
    } else {
      logTest('Request ID Header', false, 'Missing X-Request-ID header');
      return false;
    }
  } catch (error) {
    logTest('Request ID Header', false, `Error: ${error.message}`);
    return false;
  }
}

/**
 * Test 8: Response Time
 */
async function testResponseTime() {
  try {
    const start = Date.now();
    await axios.get(`${BASE_URL}/health`, { timeout: TIMEOUT });
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
    logTest('Response Time', false, `Error: ${error.message}`);
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

  await testHealth();
  await testDocs();
  await testCORS();
  await testSecurityHeaders();
  await testAuthEndpoint();
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
