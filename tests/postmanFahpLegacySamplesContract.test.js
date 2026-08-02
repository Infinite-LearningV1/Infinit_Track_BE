import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(process.cwd());

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

describe('INF-170 legacy thesis samples', () => {
  const expectations = [
    {
      file: 'postman/samples/legacy-discipline-monthly.json',
      type: 'discipline'
    },
    {
      file: 'postman/samples/legacy-smart-ac-monthly.json',
      type: 'smart_ac'
    }
  ];

  test.each(expectations)('keeps the required thesis fields for %s', ({ file, type }) => {
    const body = readJson(file);

    expect(body.success).toBe(true);
    expect(body.data.type).toBe(type);
    expect(body.data).toHaveProperty('consistency');
    expect(body.data).toHaveProperty('weights');
    expect(body.data).toHaveProperty('ranking');
    expect(body.data).toHaveProperty('distribution');
    expect(body.data).toHaveProperty('generated_at');
    expect(body.data).toHaveProperty('window');
    expect(body.data).toHaveProperty('timezone', 'Asia/Jakarta');
  });

  test('records the retired combined WFA request as the exact migration response', () => {
    expect(readJson('postman/samples/legacy-wfa-monthly.json')).toEqual({
      success: false,
      code: 'WFA_ANALYSIS_MOVED',
      message: 'Use /api/analysis/fuzzy-ahp/wfa with lat, lon, and schedule_date.'
    });
  });
});
