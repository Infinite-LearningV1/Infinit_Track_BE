import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(process.cwd());
const reportingBoundaryPath = path.join(repoRoot, 'docs', 'reporting-analytics-boundary.md');
const reportingBoundary = fs.readFileSync(reportingBoundaryPath, 'utf8');
const requestMap = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'postman', 'fahp-thesis-hybrid.request-map.json'), 'utf8')
);

const dedicatedProductionPaths = [
  'GET /api/analysis/fuzzy-ahp/discipline',
  'GET /api/analysis/fuzzy-ahp/wfa',
  'GET /api/analysis/fuzzy-ahp/smart-ac'
];

const dashboardRecapEndpointPath = 'GET /api/analysis/fuzzy-ahp/dashboard';
const legacyCombinedEndpointPath = 'GET /api/analysis/fuzzy-ahp';
const maximumAllowedMeaningfulLines = 10;

const extractSection = (markdown, heading, nextHeadingPattern = /\n##\s/) => {
  const sectionStart = markdown.indexOf(heading);
  if (sectionStart === -1) return '';

  const contentStart = sectionStart + heading.length;
  const nextHeading = markdown.slice(contentStart).search(nextHeadingPattern);
  return nextHeading === -1
    ? markdown.slice(contentStart)
    : markdown.slice(contentStart, contentStart + nextHeading);
};

const fahpSection = extractSection(reportingBoundary, '## Fuzzy AHP Endpoints Contract');
const meaningfulFahpLines = fahpSection
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const sectionSubheadingPattern = /^\s*#{3,6}\s+/m;
const markdownTableRowPattern = /^\s*\|.*\|\s*$/m;

const endpointPathPattern = /`(GET \/api\/analysis\/fuzzy-ahp(?:\/[a-z_-]+)?)`/g;
const endpointBullets = [...new Set([...fahpSection.matchAll(endpointPathPattern)].map((match) => match[1]))];

describe('Postman Fuzzy AHP documentation contract', () => {
  test('keeps the FAHP documentation section short', () => {
    expect(meaningfulFahpLines.length).toBeLessThanOrEqual(maximumAllowedMeaningfulLines);
  });

  test('keeps the FAHP documentation section as a Postman-first boundary pointer', () => {
    expect(fahpSection).toContain('Postman collection `Infinite Track`');
    expect(fahpSection).toContain('folder `FuzzyAhp`');
    expect(fahpSection).toContain('primary manual smoke surface for the dedicated FAHP endpoints');
    expect(fahpSection).toContain('contains curated Discipline, WFA, and Smart AC requests');
    expect(fahpSection).toContain('Keep detailed per-endpoint validation, examples, and run guidance in Postman instead of duplicating a manual guide here');
  });

  test('documents the legacy combined endpoint as transition-only compatibility', () => {
    expect(endpointBullets).toContain(legacyCombinedEndpointPath);
    expect(fahpSection).toMatch(
      /`GET \/api\/analysis\/fuzzy-ahp` remains temporarily supported as the legacy combined endpoint[^\n]*transition-only/i
    );
    expect(fahpSection).toMatch(/Use the legacy combined endpoint only for explicit migration compatibility checks\./i);
  });

  test('keeps the legacy WFA request as a 410 migration check and points live validation to schedule_date', () => {
    const legacyWfa = requestMap.requests.find(({ name }) => name === 'Migration / Legacy Combined / WFA');
    const dedicatedWfa = requestMap.requests.find(({ name }) => name === 'Validation / Dedicated / WFA Live');

    expect(legacyWfa).toMatchObject({
      endpoint: '/api/analysis/fuzzy-ahp?type=wfa&period=monthly',
      purpose: 'migration_check',
      expectedStatus: 410
    });
    expect(dedicatedWfa.queryVariables).toContain('wfa_schedule_date');
  });

  test('lists exactly the three dedicated production endpoint paths plus the dashboard recap adapter route', () => {
    const dedicatedEndpointBullets = endpointBullets.filter(
      (endpointPath) => endpointPath !== legacyCombinedEndpointPath
    );

    expect(dedicatedEndpointBullets).toEqual([
      ...dedicatedProductionPaths,
      dashboardRecapEndpointPath
    ]);
  });

  test('documents the dashboard recap endpoint as recap-only, not a canonical detail surface', () => {
    expect(endpointBullets).toContain(dashboardRecapEndpointPath);
    expect(fahpSection).toMatch(
      /`GET \/api\/analysis\/fuzzy-ahp\/dashboard` owns the lightweight monthly dashboard recap contract only; it is not the canonical detail-analysis surface\./i
    );
  });

  test('does not expand the FAHP section into a standalone manual guide', () => {
    expect(fahpSection).not.toMatch(sectionSubheadingPattern);
    expect(fahpSection).not.toMatch(markdownTableRowPattern);
  });
});
