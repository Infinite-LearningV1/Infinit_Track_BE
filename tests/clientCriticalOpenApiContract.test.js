import fs from 'fs';
import path from 'path';
import yaml from 'yamljs';

const schemaAt = (operation, statusCode = '200') =>
  operation.responses[statusCode].content['application/json'].schema;

const jsonRequestSchema = (operation) =>
  operation.requestBody.content['application/json'].schema;

describe('client-critical OpenAPI contract', () => {
  const openapi = yaml.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'docs/openapi.yaml'), 'utf8')
  );

  test('uses the live production base URL', () => {
    expect(openapi.servers).toContainEqual(
      expect.objectContaining({ url: 'https://api.infinite-track.tech' })
    );
    expect(openapi.servers).not.toContainEqual(
      expect.objectContaining({ url: 'https://your-domain.com' })
    );
  });

  test('documents check-in request body fields in the public OpenAPI contract', () => {
    const checkInSchema = jsonRequestSchema(openapi.paths['/api/attendance/check-in'].post);

    expect(checkInSchema.required).toEqual(['category_id', 'latitude', 'longitude']);
    expect(checkInSchema.properties).toMatchObject({
      category_id: {
        type: 'integer',
        enum: [1, 2, 3]
      },
      latitude: {
        type: 'number',
        format: 'float'
      },
      longitude: {
        type: 'number',
        format: 'float'
      },
      notes: {
        type: 'string'
      },
      booking_id: {
        type: 'integer'
      }
    });
    expect(checkInSchema.properties).not.toHaveProperty('face_photo');
  });

  test('documents check-in success status and envelope shape', () => {
    const checkInOperation = openapi.paths['/api/attendance/check-in'].post;
    const successSchema = schemaAt(checkInOperation, '201');

    expect(checkInOperation.responses).not.toHaveProperty('200');
    expect(successSchema.properties).toMatchObject({
      success: { type: 'boolean', example: true },
      data: { type: 'object' },
      message: {
        type: 'string',
        example: 'Check-in berhasil dengan status: ON TIME'
      }
    });
  });

  test('documents status-today response shape in the public OpenAPI contract', () => {
    const statusSchema = schemaAt(openapi.paths['/api/attendance/status-today'].get);
    const dataSchema = statusSchema.properties.data;

    expect(dataSchema.type).toBe('object');
    expect(dataSchema.properties).toMatchObject({
      can_check_in: { type: 'boolean' },
      can_check_out: {
        type: 'boolean',
        nullable: true
      },
      checked_in_at: {
        type: 'string',
        nullable: true
      },
      checked_out_at: {
        type: 'string',
        nullable: true
      },
      active_mode: { type: 'string' },
      active_location: {
        type: 'object',
        nullable: true
      },
      today_date: { type: 'string' },
      is_holiday: { type: 'boolean' },
      holiday_checkin_enabled: { type: 'boolean' },
      current_time: { type: 'string' },
      checkin_window: { type: 'object' },
      checkout_auto_time: { type: 'string' }
    });
    expect(dataSchema.properties).not.toHaveProperty('has_checked_in');
    expect(dataSchema.properties).not.toHaveProperty('has_checked_out');
    expect(dataSchema.properties).not.toHaveProperty('attendance');
  });

  test('documents attendance today-locations snapshot metadata in the public OpenAPI contract', () => {
    const todayLocationsSchema = schemaAt(openapi.paths['/api/attendance/today-locations'].get);
    const dataSchema = todayLocationsSchema.properties.data;

    expect(dataSchema.properties).toMatchObject({
      date: { type: 'string', format: 'date' },
      timezone: { type: 'string', example: 'Asia/Jakarta' },
      snapshot_type: {
        type: 'string',
        example: 'attendance_checkin_snapshot'
      },
      is_live_tracking: {
        type: 'boolean',
        example: false
      },
      total_users: { type: 'integer' },
      locations: { type: 'array' }
    });
  });

  test('documents booking creation request payload in the public OpenAPI contract', () => {
    const bookingSchema = jsonRequestSchema(openapi.paths['/api/bookings'].post);

    expect(bookingSchema.required).toEqual(['schedule_date', 'latitude', 'longitude']);
    expect(bookingSchema.properties).toMatchObject({
      schedule_date: {
        type: 'string',
        format: 'date'
      },
      latitude: {
        type: 'number',
        format: 'float'
      },
      longitude: {
        type: 'number',
        format: 'float'
      },
      radius: { type: 'number' },
      description: { type: 'string' },
      notes: { type: 'string' }
    });
    expect(bookingSchema.properties).not.toHaveProperty('date');
    expect(bookingSchema.properties).not.toHaveProperty('location_name');
    expect(bookingSchema.properties).not.toHaveProperty('reason');
  });

  test('documents booking creation success response shape in the public OpenAPI contract', () => {
    const bookingSuccessSchema = schemaAt(openapi.paths['/api/bookings'].post, '201');
    const dataSchema = bookingSuccessSchema.properties.data;

    expect(bookingSuccessSchema.properties).toMatchObject({
      success: { type: 'boolean', example: true },
      message: {
        type: 'string',
        example: 'Booking WFA berhasil diajukan dan menunggu persetujuan.'
      },
      data: { type: 'object' }
    });
    expect(dataSchema.properties).toMatchObject({
      booking_id: { type: 'integer' },
      schedule_date: { type: 'string' },
      location_id: { type: 'integer' },
      status: {
        type: 'string',
        example: 'pending'
      },
      suitability_score: {
        type: 'number',
        nullable: true
      },
      suitability_label: {
        type: 'string',
        nullable: true
      }
    });
  });

  test('documents dashboard analytics response shape in the public OpenAPI contract', () => {
    const dashboardSchema = schemaAt(openapi.paths['/api/summary/dashboard-analytics'].get);
    const dataSchema = dashboardSchema.properties.data;

    expect(dataSchema.properties.meta.properties).toMatchObject({
      generated_at: {
        type: 'string',
        format: 'date-time',
        example: '2026-05-03T02:30:00.000Z'
      },
      requested_window: { type: 'object' },
      section_windows: { type: 'object' },
      sources: { type: 'array' }
    });
    expect(dataSchema.properties.executive_kpis.properties).toMatchObject({
      attendance_rate: { type: 'number', format: 'float' },
      late_alpha_risk: { type: 'number', format: 'float' },
      avg_discipline: { type: 'number', format: 'float', nullable: true },
      needs_attention: { type: 'integer' },
      raw_counts: { type: 'object' }
    });
    expect(dataSchema.properties.historical_trend.properties.points.items.properties).toMatchObject({
      date: { type: 'string', format: 'date' },
      on_time: { type: 'integer' },
      late: { type: 'integer' },
      present: { type: 'integer' },
      alpha: { type: 'integer' }
    });
    expect(dataSchema.properties.today_locations.properties).toMatchObject({
      snapshot_type: {
        type: 'string',
        example: 'attendance_checkin_snapshot'
      },
      is_live_tracking: {
        type: 'boolean',
        example: false
      }
    });
    expect(dataSchema.properties.geofence_evidence_context.properties.status).toMatchObject({
      type: 'string',
      example: 'available'
    });
    expect(dataSchema.properties.fuzzy_ahp_snapshot.properties.discipline.properties.status).toMatchObject({
      type: 'string',
      example: 'ready'
    });
    expect(dataSchema.properties.fuzzy_ahp_snapshot.properties.discipline.properties.generated_at).toMatchObject({
      type: 'string',
      format: 'date-time',
      example: '2026-05-03T02:30:00.000Z'
    });
  });
});
