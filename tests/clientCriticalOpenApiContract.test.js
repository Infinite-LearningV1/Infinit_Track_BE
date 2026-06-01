import fs from 'fs';
import path from 'path';
import YAML from 'yamljs';
import fuzzyEngine from '../src/utils/fuzzyAhpEngine.js';

const repoRoot = path.resolve(process.cwd());
const openApiPath = path.join(repoRoot, 'docs', 'openapi.yaml');
const rawOpenApi = fs.readFileSync(openApiPath, 'utf8');
const spec = YAML.parse(rawOpenApi);

const getPath = (pathName) => spec.paths[pathName]?.get;
const getJson200 = (pathName) => getPath(pathName).responses['200'].content['application/json'];
const getResponseSchemaProperties = (pathName) => getJson200(pathName).schema.properties;
const getDataSchemaProperties = (pathName) => getResponseSchemaProperties(pathName).data.properties;
const getLegacyDataSchemaProperties = (type) => {
  const oneOf = getResponseSchemaProperties('/api/analysis/fuzzy-ahp').data.oneOf;
  const schema = oneOf.find((candidate) => candidate.properties.type.enum?.includes(type));
  return schema.properties;
};
const getResponseExampleData = (pathName, exampleName) => {
  const json200 = getJson200(pathName);
  const example = exampleName
    ? json200.examples[exampleName].value
    : (json200.example ?? json200.schema.example);
  return example.data;
};
const hasDeepKey = (value, key) => {
  if (!value || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  return Object.values(value).some((nested) => hasDeepKey(nested, key));
};
const roundedRuntimeCr = (value) => Number(value.toFixed(3));

const disciplineRuntimeWeights = fuzzyEngine.getDisciplineAhpWeights();
const wfaRuntimeWeights = fuzzyEngine.getWfaAhpWeights();
const canonicalDisciplineWeights = [
  disciplineRuntimeWeights.alpha_rate,
  disciplineRuntimeWeights.lateness_severity,
  disciplineRuntimeWeights.lateness_frequency,
  disciplineRuntimeWeights.work_focus
];
const canonicalWfaWeights = [
  wfaRuntimeWeights.location_type,
  wfaRuntimeWeights.distance_factor,
  wfaRuntimeWeights.amenity_score
];
const canonicalDisciplineCr = roundedRuntimeCr(disciplineRuntimeWeights.consistency_ratio);
const canonicalWfaCr = roundedRuntimeCr(wfaRuntimeWeights.consistency_ratio);

const expectCanonicalFahpMetadata = (exampleData, { criteria, values, cr }) => {
  expect(exampleData.consistency).toMatchObject({
    CR: cr,
    CI: 0,
    lambda_max: 0,
    threshold: 0.1,
    is_consistent: cr <= 0.1,
    verdict: 'Matriks perbandingan konsisten (CR < 0.10)'
  });
  expect(exampleData.weights).toMatchObject({
    criteria,
    values,
    method: "Chang's Extent Analysis"
  });
};

describe('client critical OpenAPI contract', () => {
  test('documents dedicated Fuzzy AHP endpoint paths and temporary legacy compatibility', () => {
    expect(getPath('/api/analysis/fuzzy-ahp')).toBeDefined();
    expect(getPath('/api/analysis/fuzzy-ahp')?.description).toContain('Fuzzy AHP analysis');

    for (const pathName of [
      '/api/analysis/fuzzy-ahp/discipline',
      '/api/analysis/fuzzy-ahp/wfa',
      '/api/analysis/fuzzy-ahp/smart-ac'
    ]) {
      expect(getPath(pathName)).toBeDefined();
      expect(getPath(pathName).security).toEqual([{ bearerAuth: [] }]);
      expect(getPath(pathName).responses['401']).toBeDefined();
      expect(getPath(pathName).responses['403']).toBeDefined();
      expect(getPath(pathName).description).toContain('legacy');
    }
  });

  test('documents legacy combined FAHP as deprecated transition-only route compatibility', () => {
    const operation = getPath('/api/analysis/fuzzy-ahp');
    const description = operation.description.toLowerCase();
    const responseContent = getJson200('/api/analysis/fuzzy-ahp');

    expect(operation.deprecated).toBe(true);
    expect(description).toContain('deprecated');
    expect(description).toContain('transition-only');
    expect(description).toContain('route-level compatibility');
    expect(description).toContain('not semantically equivalent');
    expect(description).not.toMatch(/is semantically equivalent/i);
    expect(description).not.toMatch(/same contract as the dedicated/i);
    expect(responseContent.example).toBeUndefined();
    expect(Object.keys(responseContent.examples)).toEqual(
      expect.arrayContaining(['discipline', 'wfa', 'smart_ac'])
    );
  });

  test('documents legacy WFA and Smart AC runtime shapes without dedicated-only fields', () => {
    const dedicatedOnlyFields = [
      'data_source',
      'query',
      'empty_real',
      'place_id',
      'distance_m',
      'target_date',
      'executed_window',
      'predicted_time_out',
      'evidence_summary',
      'needs_data'
    ];
    const sharedLegacyFields = ['type', 'period', 'generated_at', 'timezone', 'window'];

    const wfaSchemaProperties = getLegacyDataSchemaProperties('wfa');
    const smartAcSchemaProperties = getLegacyDataSchemaProperties('smart_ac');
    const legacyWfaExample = getResponseExampleData('/api/analysis/fuzzy-ahp', 'wfa');
    const legacySmartAcExample = getResponseExampleData('/api/analysis/fuzzy-ahp', 'smart_ac');

    for (const schemaProperties of [wfaSchemaProperties, smartAcSchemaProperties]) {
      expect(Object.keys(schemaProperties)).toEqual(expect.arrayContaining(sharedLegacyFields));
      for (const field of dedicatedOnlyFields) {
        expect(schemaProperties).not.toHaveProperty(field);
      }
    }

    expect(Object.keys(wfaSchemaProperties)).toEqual(
      expect.arrayContaining(['entity_kind', 'consistency', 'weights', 'distribution', 'ranking'])
    );
    expect(Object.keys(smartAcSchemaProperties)).toEqual(
      expect.arrayContaining(['entity_kind', 'consistency', 'weights', 'distribution', 'ranking'])
    );

    expect(Object.keys(legacyWfaExample)).toEqual(
      expect.arrayContaining([...sharedLegacyFields, 'entity_kind', 'consistency', 'weights', 'distribution', 'ranking'])
    );
    expect(Object.keys(legacySmartAcExample)).toEqual(
      expect.arrayContaining([...sharedLegacyFields, 'entity_kind', 'consistency', 'weights', 'distribution', 'ranking'])
    );
    for (const field of dedicatedOnlyFields) {
      expect(hasDeepKey(legacyWfaExample, field)).toBe(false);
      expect(hasDeepKey(legacySmartAcExample, field)).toBe(false);
    }

    expect(legacyWfaExample.ranking[0]).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        name: expect.any(String),
        score: expect.any(Number),
        label: expect.any(String),
        breakdown: expect.objectContaining({
          location_type: expect.any(String),
          amenity_score: expect.any(Number),
          distance: expect.any(Number)
        })
      })
    );
    expect(legacyWfaExample.ranking[0]).not.toHaveProperty('place_id');
    expect(legacyWfaExample.ranking[0].breakdown).not.toHaveProperty('distance_m');

    expect(legacySmartAcExample.ranking[0]).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        name: expect.any(String),
        score: expect.any(Number),
        label: expect.any(String),
        breakdown: expect.any(Object)
      })
    );
    expect(legacySmartAcExample.ranking[0]).not.toHaveProperty('predicted_time_out');
    expect(legacySmartAcExample.ranking[0]).not.toHaveProperty('evidence_summary');
    expect(legacySmartAcExample.ranking[0]).not.toHaveProperty('needs_data');
  });

  test('documents discipline query validation contract', () => {
    const operation = getPath('/api/analysis/fuzzy-ahp/discipline');
    const parameters = Object.fromEntries(operation.parameters.map((param) => [param.name, param]));

    expect(parameters.period.schema.enum).toEqual(['weekly', 'monthly', 'custom']);
    expect(parameters.period.schema.default).toBe('monthly');
    expect(parameters.from.schema.format).toBe('date');
    expect(parameters.to.schema.format).toBe('date');
    expect(parameters.period.description).toContain('365');
    expect(operation.responses['400']).toBeDefined();
  });

  test('documents WFA query validation and provider boundary contract', () => {
    const operation = getPath('/api/analysis/fuzzy-ahp/wfa');
    const parameters = Object.fromEntries(operation.parameters.map((param) => [param.name, param]));

    expect(parameters.lat.required).toBe(true);
    expect(parameters.lat.schema.minimum).toBe(-90);
    expect(parameters.lat.schema.maximum).toBe(90);
    expect(parameters.lon.required).toBe(true);
    expect(parameters.lon.schema.minimum).toBe(-180);
    expect(parameters.lon.schema.maximum).toBe(180);
    expect(parameters.radius_meters.schema.default).toBe(5000);
    expect(parameters.radius_meters.schema.minimum).toBe(100);
    expect(parameters.radius_meters.schema.maximum).toBe(50000);

    const providerUnavailable = operation.responses['503'];
    expect(providerUnavailable).toBeDefined();
    expect(providerUnavailable.content['application/json'].schema.required).toEqual([
      'success',
      'code',
      'provider',
      'reason'
    ]);
    expect(providerUnavailable.content['application/json'].example).toEqual({
      success: false,
      code: 'AUTH_OR_PROVIDER_UNAVAILABLE',
      provider: 'geoapify',
      reason: 'auth_missing'
    });
  });

  test('documents WFA 200 schema keys exposed by examples and runtime', () => {
    const dataProperties = getDataSchemaProperties('/api/analysis/fuzzy-ahp/wfa');
    const consistencyProperties = dataProperties.consistency.properties;

    expect(Object.keys(consistencyProperties)).toEqual(
      expect.arrayContaining(['CR', 'CI', 'lambda_max', 'threshold', 'is_consistent', 'verdict'])
    );
    expect(dataProperties.distribution).toMatchObject({
      type: 'object',
      additionalProperties: {
        type: 'integer'
      }
    });
  });

  test('documents canonical Discipline and WFA FAHP weight metadata in examples', () => {
    expectCanonicalFahpMetadata(getResponseExampleData('/api/analysis/fuzzy-ahp', 'discipline'), {
      criteria: ['alpha_rate', 'lateness_severity', 'lateness_frequency', 'work_focus'],
      values: canonicalDisciplineWeights,
      cr: canonicalDisciplineCr
    });
    expectCanonicalFahpMetadata(getResponseExampleData('/api/analysis/fuzzy-ahp/discipline'), {
      criteria: ['alpha_rate', 'lateness_severity', 'lateness_frequency', 'work_focus'],
      values: canonicalDisciplineWeights,
      cr: canonicalDisciplineCr
    });
    expectCanonicalFahpMetadata(getResponseExampleData('/api/analysis/fuzzy-ahp/wfa'), {
      criteria: ['location_type', 'distance_factor', 'amenity_score'],
      values: canonicalWfaWeights,
      cr: canonicalWfaCr
    });
  });

  test('documents Smart AC 200 consistency schema keys exposed by examples and runtime', () => {
    const dataProperties = getDataSchemaProperties('/api/analysis/fuzzy-ahp/smart-ac');
    const consistencyProperties = dataProperties.consistency.properties;

    expect(Object.keys(consistencyProperties)).toEqual(
      expect.arrayContaining(['CR', 'CI', 'lambda_max', 'threshold', 'is_consistent', 'verdict'])
    );
  });

  test('documents top-level success messages for legacy FAHP and today locations responses', () => {
    expect(getResponseSchemaProperties('/api/analysis/fuzzy-ahp').message).toMatchObject({
      type: 'string'
    });
    expect(getResponseSchemaProperties('/api/attendance/today-locations').message).toMatchObject({
      type: 'string'
    });
  });

  test('uses realistic WFA examples instead of fabricated placeholder values', () => {
    const wfaSection = rawOpenApi.slice(
      rawOpenApi.indexOf('  /api/analysis/fuzzy-ahp/wfa:'),
      rawOpenApi.indexOf('  /api/analysis/fuzzy-ahp/smart-ac:')
    );

    expect(wfaSection).toContain('distance_m: 412');
    expect(wfaSection).toContain('amenity_score: 83');
    expect(wfaSection).not.toContain('distance: 1000');
    expect(wfaSection).not.toContain('distance_m: 1000');
    expect(wfaSection).not.toContain('amenity_score: 50');
  });
});
