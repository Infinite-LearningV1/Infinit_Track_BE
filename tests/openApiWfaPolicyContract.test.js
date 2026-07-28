import fs from 'fs';
import path from 'path';
import YAML from 'yamljs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const openapi = YAML.parse(
  fs.readFileSync(path.join(__dirname, '..', 'docs', 'openapi.yaml'), 'utf8')
);

const requestSchema = (operation) =>
  operation.requestBody.content['application/json'].schema;

describe('INF-270 public OpenAPI contract', () => {
  test('documents the authenticated WFA request configuration endpoint', () => {
    const operation = openapi.paths['/api/wfa/request-config'].get;
    const data = operation.responses['200'].content['application/json'].schema.properties.data;

    expect(data.required).toEqual(['radius_meters', 'reasons']);
    expect(data.properties.radius_meters).toMatchObject({ type: 'integer', minimum: 1 });
    expect(data.properties.reasons.items.$ref).toBe('#/components/schemas/WfaPublicReason');
    expect(operation.responses).toHaveProperty('500');
  });

  test.each(['request', 'rejection'])(
    'documents %s reason catalog management without a delete route',
    (catalog) => {
      const collection = openapi.paths[`/api/settings/wfa/${catalog}-reasons`];
      const member = openapi.paths[`/api/settings/wfa/${catalog}-reasons/{id}`];

      expect(Object.keys(collection).sort()).toEqual(['get', 'post']);
      expect(Object.keys(member).sort()).toEqual(['patch']);
      expect(requestSchema(collection.post).$ref).toBe('#/components/schemas/WfaReasonCreateRequest');
      expect(requestSchema(member.patch).$ref).toBe('#/components/schemas/WfaReasonUpdateRequest');
    }
  );

  test('documents the catalog mutation wrapper returned by controllers', () => {
    const mutation =
      openapi.components.responses.WfaReasonMutationResponse.content['application/json'].schema;

    expect(mutation.properties.data.required).toEqual(['reason']);
    expect(mutation.properties.data.properties.reason.$ref).toBe('#/components/schemas/WfaReason');
    expect(openapi.components.schemas.WfaReason.required).toEqual(
      expect.arrayContaining(['created_at', 'updated_at'])
    );
  });

  test('adds the server-owned radius to operational settings', () => {
    const settings = openapi.components.schemas.OperationalSettings;
    const patch = openapi.components.schemas.OperationalSettingsPatchRequest;

    expect(settings.required).toContain('wfaRequestRadiusM');
    expect(settings.properties.wfaRequestRadiusM).toMatchObject({
      type: 'integer',
      minimum: 1
    });
    expect(patch.properties.wfaRequestRadiusM).toMatchObject({
      type: 'integer',
      minimum: 1
    });
  });

  test('documents the server-owned booking creation policy inputs and outputs', () => {
    const operation = openapi.paths['/api/bookings'].post;
    const schema = requestSchema(operation);
    const data = operation.responses['201'].content['application/json'].schema.properties.data;

    expect(schema.required).toEqual([
      'schedule_date',
      'request_reason_id',
      'latitude',
      'longitude'
    ]);
    expect(schema.properties.schedule_date.pattern).toBe('^\\d{4}-\\d{2}-\\d{2}$');
    expect(schema.properties).toHaveProperty('request_other_reason');
    expect(schema.properties).not.toHaveProperty('radius');
    expect(schema.properties).not.toHaveProperty('suitability_score');
    expect(schema.properties).not.toHaveProperty('status');
    expect(operation.description).toContain('WFA_OTHER_REASON_REQUIRED');
    expect(operation.description).toContain('DUPLICATE_BOOKING');
    expect(data.properties).toHaveProperty('request_reason');
    expect(data.properties).toHaveProperty('radius_snapshot');
    expect(data.properties.location.$ref).toBe('#/components/schemas/WfaBookingLocation');
    expect(openapi.components.schemas.WfaBookingLocation.properties).toHaveProperty('radius');
  });

  test('documents structured rejection inputs and reason projections', () => {
    const patch = requestSchema(openapi.paths['/api/bookings/{id}'].patch);
    const booking = openapi.components.schemas.Booking;
    const history = openapi.components.schemas.BookingHistoryItem;

    expect(patch.properties).toHaveProperty('rejection_reason_id');
    expect(patch.properties).toHaveProperty('rejection_note');
    expect(patch.properties).not.toHaveProperty('admin_notes');
    expect(openapi.paths['/api/bookings/{id}'].patch.description).toContain(
      'REJECTION_NOTE_REQUIRED'
    );
    expect(booking.properties).toHaveProperty('request_reason');
    expect(booking.properties).toHaveProperty('rejection_reason');
    expect(booking.properties).toHaveProperty('radius_snapshot');
    expect(history.properties).toHaveProperty('request_reason');
    expect(history.properties).toHaveProperty('rejection_reason');
    expect(history.properties).toHaveProperty('radius_snapshot');
  });
});
