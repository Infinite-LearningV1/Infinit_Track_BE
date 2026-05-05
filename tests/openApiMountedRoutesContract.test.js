import fs from 'fs';
import path from 'path';
import yaml from 'yamljs';

describe('OpenAPI mounted route inventory contract', () => {
  const openapi = yaml.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'docs/openapi.yaml'), 'utf8')
  );

  test('documents mounted reference data dropdown endpoints', () => {
    expect(Object.keys(openapi.paths)).toEqual(
      expect.arrayContaining(['/api/roles', '/api/programs', '/api/positions', '/api/divisions'])
    );
  });

  test('documents mounted production-facing bookings endpoints', () => {
    expect(Object.keys(openapi.paths)).toEqual(
      expect.arrayContaining([
        '/api/bookings',
        '/api/bookings/history',
        '/api/bookings/{id}'
      ])
    );
  });

  test('documents mounted production-facing discipline endpoints', () => {
    expect(Object.keys(openapi.paths)).toEqual(
      expect.arrayContaining([
        '/api/discipline/user/{userId}',
        '/api/discipline/all',
        '/api/discipline/config'
      ])
    );
  });

  test('excludes debug, test, internal ops, and legacy endpoints from public OpenAPI', () => {
    const publicPaths = Object.keys(openapi.paths);
    const excludedPaths = [
      '/api/wfa/debug-geoapify',
      '/api/wfa/recommendations-test',
      '/api/wfa/test-ahp',
      '/api/discipline/test-ahp',
      '/api/attendance/debug-checkin-time',
      '/api/attendance/test-weighted-prediction',
      '/api/attendance/manual-auto-checkout',
      '/api/attendance/setup-auto-checkout',
      '/api/attendance/smart-prediction',
      '/api/attendance/test-timezone',
      '/api/jobs/status',
      '/api/jobs/trigger/general-alpha',
      '/api/jobs/trigger/wfa-bookings',
      '/api/jobs/trigger/auto-checkout',
      '/api/jobs/trigger/all',
      '/api/attendance-categories',
      '/api/attendance-statuses',
      '/api/locations'
    ];

    for (const excludedPath of excludedPaths) {
      expect(publicPaths).not.toContain(excludedPath);
    }
  });
});
