import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(process.cwd());
const readmePath = path.join(repoRoot, 'postman', 'README.fahp-thesis-hybrid.md');
const samplePath = path.join(repoRoot, 'postman', 'samples', 'dedicated-wfa-live.json');
const requestMapPath = path.join(repoRoot, 'postman', 'fahp-thesis-hybrid.request-map.json');

describe('INF-170 dedicated WFA live proof', () => {
  test('either stores live proof or records Needs Verification explicitly', () => {
    const readme = fs.readFileSync(readmePath, 'utf8');
    const ready = readme.includes('Dedicated WFA status: Ready');
    const needsVerification = readme.includes('Dedicated WFA status: Needs Verification');

    expect(ready || needsVerification).toBe(true);

    if (ready) {
      const body = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
      expect(body.success).toBe(true);
      expect(body.data.type).toBe('wfa');
      expect(body.data.data_source).toBe('geoapify_live');
      expect(Array.isArray(body.data.ranking)).toBe(true);
    } else {
      expect(readme).toMatch(/Reason: .+/);
    }
  });

  test('requires a future schedule date when validating the dedicated WFA contract', () => {
    const requestMap = JSON.parse(fs.readFileSync(requestMapPath, 'utf8'));
    const request = requestMap.requests.find(({ name }) => name === 'Validation / Dedicated / WFA Live');

    expect(request.queryVariables).toEqual([
      'wfa_lat',
      'wfa_lon',
      'wfa_schedule_date',
      'wfa_radius_meters'
    ]);
  });
});
