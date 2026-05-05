import fs from 'fs';
import path from 'path';
import request from 'supertest';

const { default: app } = await import('../src/app.js');

describe('published OpenAPI spec route', () => {
  test('serves the raw OpenAPI YAML contract', async () => {
    const expectedSpec = fs.readFileSync(path.resolve(process.cwd(), 'docs/openapi.yaml'), 'utf8');
    const response = await request(app).get('/docs/openapi.yaml');

    expect(response.status).toBe(200);
    expect(response.text).toBe(expectedSpec);
    expect(response.headers['content-type']).toMatch(/yaml|text\/plain/i);
  });
});
