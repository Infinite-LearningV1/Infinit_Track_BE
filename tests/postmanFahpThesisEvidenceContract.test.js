import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(process.cwd());
const readmePath = path.join(repoRoot, 'postman', 'README.fahp-thesis-hybrid.md');
const requestMapPath = path.join(repoRoot, 'postman', 'fahp-thesis-hybrid.request-map.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

describe('INF-170 hybrid FAHP thesis evidence contract', () => {
  test('declares Postman Infinite Track / FuzzyAhp as the runner surface', () => {
    const readme = fs.readFileSync(readmePath, 'utf8');

    expect(readme).toContain('Infinite Track');
    expect(readme).toContain('FuzzyAhp');
    expect(readme).toContain('runner');
    expect(readme).toContain('Postman MCP');
  });

  test('pins the exact hybrid request set and sample-file mapping', () => {
    const requestMap = readJson(requestMapPath);

    expect(requestMap).toEqual({
      collection: 'Infinite Track',
      folder: 'FuzzyAhp',
      requests: [
        {
          name: 'Thesis / Legacy Combined / Discipline Monthly',
          endpoint: '/api/analysis/fuzzy-ahp?type=discipline&period=monthly',
          purpose: 'thesis_comparison',
          sampleFile: 'postman/samples/legacy-discipline-monthly.json'
        },
        {
          name: 'Migration / Legacy Combined / WFA',
          endpoint: '/api/analysis/fuzzy-ahp?type=wfa&period=monthly',
          purpose: 'migration_check',
          expectedStatus: 410,
          sampleFile: 'postman/samples/legacy-wfa-monthly.json'
        },
        {
          name: 'Thesis / Legacy Combined / Smart AC Monthly',
          endpoint: '/api/analysis/fuzzy-ahp?type=smart_ac&period=monthly',
          purpose: 'thesis_comparison',
          sampleFile: 'postman/samples/legacy-smart-ac-monthly.json'
        },
        {
          name: 'Validation / Dedicated / WFA Live',
          endpoint: '/api/analysis/fuzzy-ahp/wfa',
          purpose: 'live_validation',
          queryVariables: ['wfa_lat', 'wfa_lon', 'wfa_schedule_date', 'wfa_radius_meters'],
          sampleFile: 'postman/samples/dedicated-wfa-live.json'
        }
      ]
    });
  });

  test('makes the legacy WFA caveat impossible to miss', () => {
    const readme = fs.readFileSync(readmePath, 'utf8');

    expect(readme).toContain('Legacy WFA combined requests are 410 migration checks, not thesis comparison output.');
    expect(readme).toContain('Dedicated WFA live proof belongs to the canonical endpoint /api/analysis/fuzzy-ahp/wfa.');
    expect(readme).toContain('Dedicated WFA status: Needs Verification');
    expect(readme).toContain('wfa_lat');
    expect(readme).toContain('wfa_lon');
    expect(readme).toContain('wfa_schedule_date');
    expect(readme).toContain('wfa_radius_meters');
  });
});
