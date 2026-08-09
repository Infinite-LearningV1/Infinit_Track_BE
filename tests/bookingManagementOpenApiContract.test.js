import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yamljs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const openapi = YAML.parse(
  fs.readFileSync(path.join(__dirname, '..', 'docs', 'openapi.yaml'), 'utf8')
);

test('documents the canonical Management Booking list query surface', () => {
  const operation = openapi.paths['/api/bookings'].get;
  const parameters = Object.fromEntries(
    operation.parameters.map((parameter) => [parameter.name, parameter])
  );

  expect(Object.keys(parameters).sort()).toEqual([
    'date_from',
    'date_to',
    'limit',
    'page',
    'search',
    'sortBy',
    'sortOrder',
    'status',
    'user_id'
  ]);
  expect(parameters.search.description).toMatch(/full_name|name/i);
  expect(parameters.search.description).toMatch(/nip/i);
  expect(parameters.sortBy.description).toMatch(/deprecated|no-op/i);
  expect(parameters.sortOrder.description).toMatch(/deprecated|no-op/i);
});

test('publishes the Management Booking list item instead of the legacy Booking schema', () => {
  const operation = openapi.paths['/api/bookings'].get;
  const items = operation.responses['200']
    .content['application/json']
    .schema.properties.data.properties.bookings.items;

  expect(items.$ref).toBe('#/components/schemas/BookingManagementItem');

  const item = openapi.components.schemas.BookingManagementItem;
  expect(item.properties).toHaveProperty('booking_id');
  expect(item.properties).toHaveProperty('user_full_name');
  expect(item.properties).toHaveProperty('schedule_date');
  expect(item.properties).toHaveProperty('created_at');
  expect(item.properties).toHaveProperty('request_reason');
  expect(item.properties).toHaveProperty('rejection_reason');
  expect(item.properties).toHaveProperty('location');
  expect(item.properties).toHaveProperty('approved_by');
  expect(item.properties.processed_by.$ref).toBe('#/components/schemas/BookingProcessor');
});
test('documents processor identity and truthful nullable suitability semantics', () => {
  const item = openapi.components.schemas.BookingManagementItem;
  const processor = openapi.components.schemas.BookingProcessor;

  expect(processor).toMatchObject({ type: 'object', nullable: true });
  expect(processor.required).toEqual(['id', 'full_name', 'role']);
  expect(processor.properties.role.nullable).toBe(true);

  expect(item.properties.suitability_score).toMatchObject({
    type: 'number',
    nullable: true
  });
  expect(item.properties.suitability_label).toMatchObject({
    type: 'string',
    nullable: true
  });
  expect(item.properties.request_reason.$ref).toBe(
    '#/components/schemas/WfaRequestReasonProjection'
  );
  expect(item.properties.rejection_reason.$ref).toBe(
    '#/components/schemas/WfaRejectionReasonProjection'
  );
});
