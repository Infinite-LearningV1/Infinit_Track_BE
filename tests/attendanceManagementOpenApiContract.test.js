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
  expect(operation.responses['400']).toEqual({
    $ref: '#/components/responses/AttendanceValidationError'
  });
});

test('documents GET attendance detail separately from DELETE', () => {
  const pathItem = api.paths['/api/attendance/{id}'];

  expect(pathItem.get).toBeDefined();
  expect(pathItem.delete).toBeDefined();
  const detail = pathItem.get.responses['200'].content['application/json'].schema;
  expect(detail.properties.data).toEqual({
    $ref: '#/components/schemas/AttendanceAuditDetail'
  });
  expect(pathItem.get.responses['400']).toEqual({
    $ref: '#/components/responses/AttendanceValidationError'
  });
  expect(pathItem.get.responses).toHaveProperty('404');
});

test('documents the exact attendance validator error envelope', () => {
  const response = api.components.responses.AttendanceValidationError;
  const schema = response.content['application/json'].schema;

  expect(schema.required).toEqual(['success', 'code', 'message', 'errors']);
  expect(schema.properties.success).toMatchObject({ type: 'boolean', enum: [false] });
  expect(schema.properties.code).toMatchObject({ type: 'string', enum: ['E_VALIDATION'] });
  expect(schema.properties.message.type).toBe('string');
  expect(schema.properties.errors).toMatchObject({ type: 'array' });
  expect(schema.properties.errors.items.required).toEqual([
    'type', 'value', 'msg', 'path', 'location'
  ]);
  expect(schema.properties.errors.items.properties).toMatchObject({
    type: { type: 'string', enum: ['field'] },
    value: {},
    msg: { type: 'string' },
    path: { type: 'string' },
    location: { type: 'string', enum: ['query', 'params'] }
  });
});
