import fs from 'fs';
import path from 'path';
import yaml from 'yamljs';

const api = yaml.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'docs/openapi.yaml'), 'utf8')
);

test('documents every Management Attendance list query parameter', () => {
  const operation = api.paths['/api/attendance'].get;
  const params = Object.fromEntries(operation.parameters.map((item) => [item.name, item]));

  expect(Object.keys(params).sort()).toEqual([
    'checkout_state', 'from', 'limit', 'mode', 'page', 'search',
    'sortBy', 'sortOrder', 'status', 'to'
  ]);
  expect(params.limit.schema).toMatchObject({ default: 10, minimum: 1, maximum: 100 });
  expect(params.status.schema.enum).toEqual(['ontime', 'late', 'alpha', 'early']);
  expect(operation.responses).toHaveProperty('400');
});

test('documents GET attendance detail separately from DELETE', () => {
  const pathItem = api.paths['/api/attendance/{id}'];

  expect(pathItem.get).toBeDefined();
  expect(pathItem.delete).toBeDefined();
  const detail = pathItem.get.responses['200'].content['application/json'].schema;
  expect(detail.properties.data.properties).toHaveProperty('booking_id');
  expect(detail.properties.data.properties.user.properties).toHaveProperty('email');
  expect(detail.properties.data.properties.location.nullable).toBe(true);
  expect(pathItem.get.responses).toHaveProperty('404');
});
