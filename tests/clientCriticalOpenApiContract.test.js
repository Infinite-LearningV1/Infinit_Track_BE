import fs from 'fs';
import path from 'path';
import { load as loadStrictYaml } from 'js-yaml';

function schemaAt(operation, statusCode = '200') {
  return operation.responses[statusCode].content['application/json'].schema;
}

function jsonRequestSchema(operation) {
  return operation.requestBody.content['application/json'].schema;
}

function componentSchema(openapi, name) {
  return openapi.components.schemas[name];
}

function resolveLocalRef(openapi, ref) {
  return ref
    .slice(2)
    .split('/')
    .reduce((node, token) => node?.[token.replace(/~1/g, '/').replace(/~0/g, '~')], openapi);
}

function responseAt(openapi, operation, statusCode) {
  const response = operation.responses[statusCode];
  return response.$ref ? resolveLocalRef(openapi, response.$ref) : response;
}

function responseSchemaAt(openapi, operation, statusCode) {
  const schema = responseAt(openapi, operation, statusCode).content['application/json'].schema;
  return schema.$ref ? resolveLocalRef(openapi, schema.$ref) : schema;
}

function collectLocalRefs(node, refs = []) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectLocalRefs(item, refs));
    return refs;
  }
  if (!node || typeof node !== 'object') return refs;

  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) refs.push(node.$ref);
  Object.values(node).forEach((value) => collectLocalRefs(value, refs));
  return refs;
}

describe('client-critical OpenAPI contract', () => {
  const openapi = loadStrictYaml(
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
      checked_in_at_iso: {
        type: 'string',
        format: 'date-time',
        nullable: true
      },
      checked_out_at_iso: {
        type: 'string',
        format: 'date-time',
        nullable: true
      },
      work_duration_seconds: {
        type: 'integer',
        nullable: true,
        minimum: 0
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
      checkout_auto_time: { type: 'string' },
      attendance_session_state: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          key: { type: 'string' },
          label: { type: 'string' }
        }
      },
      active_attendance_id: {
        type: 'integer',
        nullable: true
      }
    });

    expect(statusSchema.properties.meta).toMatchObject({
      type: 'object',
      properties: {
        cache_ttl_seconds: { type: 'integer' }
      }
    });

    expect(dataSchema.properties).not.toHaveProperty('has_checked_in');
    expect(dataSchema.properties).not.toHaveProperty('has_checked_out');
    expect(dataSchema.properties).not.toHaveProperty('attendance');
  });

  test('documents attendance today-locations snapshot metadata in the public OpenAPI contract', () => {
    const todayLocationsOperation = openapi.paths['/api/attendance/today-locations'].get;
    const todayLocationsSchema = schemaAt(todayLocationsOperation);
    const dataSchema = todayLocationsSchema.properties.data;

    expect(todayLocationsOperation.parameters).toContainEqual(
      expect.objectContaining({
        in: 'query',
        name: 'limit',
        schema: expect.objectContaining({ type: 'integer', minimum: 1 })
      })
    );
    expect(todayLocationsOperation.parameters).not.toContainEqual(
      expect.objectContaining({ name: 'period' })
    );
    expect(todayLocationsOperation.parameters).not.toContainEqual(expect.objectContaining({ name: 'from' }));
    expect(todayLocationsOperation.parameters).not.toContainEqual(expect.objectContaining({ name: 'to' }));
    expect(todayLocationsOperation.responses).toHaveProperty('400');
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
      authority: {
        type: 'string',
        example: 'context_only'
      },
      final_attendance_authority: {
        type: 'string',
        example: 'attendance_records'
      },
      total_users: { type: 'integer' },
      truncated: { type: 'boolean' },
      truncated_at: {
        type: 'integer',
        nullable: true
      },
      locations: { type: 'array' }
    });
  });

  test('documents attendance geofence-evidence owner endpoint in the public OpenAPI contract', () => {
    const geofenceOperation = openapi.paths['/api/attendance/geofence-evidence'].get;
    const geofenceSchema = schemaAt(geofenceOperation);
    const dataSchema = geofenceSchema.properties.data;
    const parameterNames = geofenceOperation.parameters.map((parameter) => parameter.name);

    expect(parameterNames).toEqual(expect.arrayContaining(['period', 'from', 'to']));
    expect(parameterNames).not.toContain('limit');
    expect(geofenceOperation.responses).toHaveProperty('400');
    expect(geofenceSchema.properties).toMatchObject({
      success: { type: 'boolean', example: true },
      requested_window: { type: 'object' },
      executed_window: { type: 'object' },
      data: { type: 'object' },
      message: {
        type: 'string',
        example: 'Geofence evidence retrieved successfully'
      }
    });
    expect(dataSchema.properties).toMatchObject({
      status: {
        type: 'string',
        enum: ['available', 'needs_data'],
        example: 'available'
      },
      needs_data: {
        type: 'boolean',
        example: false
      },
      reason: {
        type: 'string',
        nullable: true,
        example: null
      },
      authority: {
        type: 'string',
        example: 'context_only'
      },
      final_attendance_authority: {
        type: 'string',
        example: 'attendance_records'
      },
      window: { type: 'object' },
      raw_counts: { type: 'object' },
      operational_context: { type: 'object' }
    });
    expect(dataSchema.properties.operational_context.properties).toMatchObject({
      activity_label: { type: 'string', example: 'Active' },
      activity_note: { type: 'string', example: '2 users generated 3 geofence events in this range.' },
      enter_context: { type: 'string', example: 'ENTER events support check-in reminder monitoring.' },
      exit_context: { type: 'string', example: 'EXIT events support active-session exit warning monitoring.' },
      dashboard_note: {
        type: 'string',
        example: 'Location context only. Final attendance validity remains determined by backend attendance records.'
      }
    });
  });

  test('does not document canceled summary dashboard-map endpoint', () => {
    expect(openapi.paths).not.toHaveProperty('/api/summary/dashboard-map');
  });

  test('documents booking creation request payload in the public OpenAPI contract', () => {
    const bookingSchema = jsonRequestSchema(openapi.paths['/api/bookings'].post);

    expect(bookingSchema.required).toEqual([
      'schedule_date',
      'request_reason_id',
      'latitude',
      'longitude'
    ]);
    expect(bookingSchema.properties).toMatchObject({
      schedule_date: {
        type: 'string',
        format: 'date',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$'
      },
      request_reason_id: { type: 'integer', minimum: 1 },
      request_other_reason: { type: 'string', nullable: true },
      latitude: {
        type: 'number',
        format: 'float'
      },
      longitude: {
        type: 'number',
        format: 'float'
      },
      description: { type: 'string' },
      notes: { type: 'string' }
    });
    expect(bookingSchema.properties).not.toHaveProperty('date');
    expect(bookingSchema.properties).not.toHaveProperty('location_name');
    expect(bookingSchema.properties).not.toHaveProperty('reason');
    expect(bookingSchema.properties).not.toHaveProperty('radius');
    expect(bookingSchema.properties).not.toHaveProperty('status');
    expect(bookingSchema.properties).not.toHaveProperty('suitability_score');
  });

  test('documents booking admin list query filters exposed to clients', () => {
    const bookingListOperation = openapi.paths['/api/bookings'].get;
    const parameterNames = bookingListOperation.parameters.map((parameter) => parameter.name);

    expect(parameterNames).toEqual(
      expect.arrayContaining(['page', 'limit', 'status', 'date_from', 'date_to', 'user_id'])
    );
    expect(bookingListOperation.responses).toHaveProperty('400');
    expect(bookingListOperation.responses).toHaveProperty('401');
    expect(bookingListOperation.responses).toHaveProperty('403');
  });

  test('documents booking creation success response shape from the runtime controller', () => {
    const bookingOperation = openapi.paths['/api/bookings'].post;
    const bookingSuccessSchema = schemaAt(bookingOperation, '201');
    const dataSchema = bookingSuccessSchema.properties.data;

    expect(bookingSuccessSchema.properties).toMatchObject({
      success: { type: 'boolean', example: true },
      message: {
        type: 'string',
        example: 'Booking WFA berhasil dibuat.'
      },
      data: { type: 'object' }
    });
    expect(dataSchema.properties).toMatchObject({
      booking_id: { type: 'integer' },
      schedule_date: { type: 'string' },
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
      },
      suitability_status: {
        type: 'string',
        enum: ['ranked', 'insufficient_facility_data']
      },
      request_reason: { $ref: '#/components/schemas/WfaRequestReasonProjection' },
      location: { $ref: '#/components/schemas/WfaBookingLocation' },
      radius_snapshot: { type: 'integer', minimum: 1 },
      created_at: { type: 'string', format: 'date-time' }
    });
    expect(schemaAt(bookingOperation, '503').properties).toMatchObject({
      success: { type: 'boolean', example: false },
      code: { type: 'string', example: 'WFA_SCORING_UNAVAILABLE' },
      message: { type: 'string', example: 'Internal server error' }
    });
    expect(responseSchemaAt(openapi, bookingOperation, '500').properties).toMatchObject({
      success: { type: 'boolean', example: false },
      code: { type: 'string', example: 'WFA_CONFIG_UNAVAILABLE' },
      message: { type: 'string' }
    });
    expect(responseAt(openapi, bookingOperation, '500').content['application/json'].example).toEqual({
      success: false,
      code: 'WFA_CONFIG_UNAVAILABLE',
      message: 'Internal server error'
    });
    expect(dataSchema.required).toEqual(
      expect.arrayContaining(['suitability_score', 'suitability_label', 'suitability_status'])
    );
    expect(bookingOperation.responses['201'].content['application/json'].examples.insufficient_facility_data)
      .toMatchObject({
        value: {
          success: true,
          data: {
            suitability_score: null,
            suitability_label: null,
            suitability_status: 'insufficient_facility_data'
          }
        }
      });
  });

  test('parses the complete public OpenAPI artifact with a strict YAML parser', () => {
    expect(() => loadStrictYaml(fs.readFileSync(path.resolve(process.cwd(), 'docs/openapi.yaml'), 'utf8')))
      .not.toThrow();
  });

  test('resolves every local OpenAPI reference', () => {
    const unresolved = [...new Set(collectLocalRefs(openapi))].filter(
      (ref) => resolveLocalRef(openapi, ref) === undefined
    );

    expect(unresolved).toEqual([]);
  });

  test('documents dashboard analytics as cockpit aggregate only in the public OpenAPI contract', () => {
    const dashboardOperation = openapi.paths['/api/summary/dashboard-analytics'].get;
    const dashboardSchema = schemaAt(dashboardOperation);
    const dataSchema = dashboardSchema.properties.data;
    const sectionWindows = dataSchema.properties.meta.properties.section_windows.properties;
    const expectedPeriodValues = [
      'daily',
      'weekly',
      'monthly',
      'range',
      '30d',
      'current_month',
      'custom'
    ];
    const periodParameter = dashboardOperation.parameters.find((parameter) => parameter.name === 'period');
    const fromParameter = dashboardOperation.parameters.find((parameter) => parameter.name === 'from');
    const toParameter = dashboardOperation.parameters.find((parameter) => parameter.name === 'to');

    expect(periodParameter.schema).toMatchObject({
      type: 'string',
      default: '30d'
    });
    expect(periodParameter.schema.enum).toEqual(expect.arrayContaining(expectedPeriodValues));
    expect(periodParameter.schema.enum).toHaveLength(expectedPeriodValues.length);
    expect(periodParameter.schema.enum).not.toContain('all');
    expect(fromParameter.description).toMatch(/period=range|deprecated period=custom/);
    expect(fromParameter.description).toContain('period=range');
    expect(fromParameter.description).toContain('deprecated period=custom');
    expect(toParameter.description).toMatch(/period=range|deprecated period=custom/);
    expect(toParameter.description).toContain('period=range');
    expect(toParameter.description).toContain('deprecated period=custom');

    expect(dashboardSchema.properties).toMatchObject({
      success: { type: 'boolean', example: true },
      requested_window: { type: 'object' },
      executed_window: { type: 'object' },
      data: { type: 'object' },
      message: {
        type: 'string',
        example: 'Dashboard analytics retrieved successfully'
      }
    });
    expect(dataSchema.properties.meta.properties).toMatchObject({
      generated_at: {
        type: 'string',
        format: 'date-time',
        example: '2026-05-03T02:30:00.000Z'
      },
      requested_window: { type: 'object' },
      executed_window: { type: 'object' },
      section_windows: { type: 'object' },
      sources: {
        type: 'array',
        items: { type: 'string' },
        example: ['Attendance', 'AttendanceCategory', 'AttendanceStatus']
      }
    });
    expect(sectionWindows).toMatchObject({
      executive_kpis: { type: 'object' },
      historical_trend: { type: 'object' },
      mode_mix: { type: 'object' },
      fuzzy_ahp_snapshot: { type: 'object' }
    });
    expect(sectionWindows).not.toHaveProperty('map_context');
    expect(sectionWindows).not.toHaveProperty('today_locations');
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
    expect(dataSchema.properties.insights.properties.items).toMatchObject({
      type: 'array',
      items: { type: 'object' }
    });
    expect(dataSchema.properties.insights.properties.items.items.properties).toMatchObject({
      type: { type: 'string' },
      title: { type: 'string' },
      message: { type: 'string' },
      severity: { type: 'string' }
    });
    expect(dataSchema.properties.geofence_evidence_context.properties).toMatchObject({
      status: {
        type: 'string',
        enum: ['available', 'needs_data'],
        example: 'available'
      },
      needs_data: {
        type: 'boolean',
        example: false
      },
      reason: {
        type: 'string',
        nullable: true,
        example: null
      },
      authority: {
        type: 'string',
        example: 'context_only'
      },
      final_attendance_authority: {
        type: 'string',
        example: 'attendance_records'
      },
      operational_context: {
        type: 'object'
      }
    });
    expect(dataSchema.properties.geofence_evidence_context.properties.operational_context.properties).toMatchObject({
      activity_label: { type: 'string', example: 'Active' },
      activity_note: { type: 'string', example: '2 users generated 3 geofence events in this range.' },
      enter_context: { type: 'string', example: 'ENTER events support check-in reminder monitoring.' },
      exit_context: { type: 'string', example: 'EXIT events support active-session exit warning monitoring.' },
      dashboard_note: {
        type: 'string',
        example: 'Location context only. Final attendance validity remains determined by backend attendance records.'
      }
    });
    expect(dataSchema.properties).not.toHaveProperty('today_locations');
    expect(dataSchema.properties).not.toHaveProperty('map_context');
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

  test('documents attendance geofence evidence as a dedicated public contract', () => {
    const geofenceOperation = openapi.paths['/api/attendance/geofence-evidence'].get;
    const geofenceSchema = schemaAt(geofenceOperation);
    const periodParameter = geofenceOperation.parameters.find((parameter) => parameter.name === 'period');
    const fromParameter = geofenceOperation.parameters.find((parameter) => parameter.name === 'from');
    const toParameter = geofenceOperation.parameters.find((parameter) => parameter.name === 'to');

    expect(periodParameter.schema).toMatchObject({
      type: 'string',
      default: '30d'
    });
    expect(fromParameter.description).toContain('period=range');
    expect(fromParameter.description).toContain('deprecated period=custom');
    expect(toParameter.description).toContain('period=range');
    expect(toParameter.description).toContain('deprecated period=custom');
    expect(geofenceSchema.properties).toMatchObject({
      success: { type: 'boolean', example: true },
      requested_window: { type: 'object' },
      executed_window: { type: 'object' },
      data: { type: 'object' },
      message: {
        type: 'string',
        example: 'Geofence evidence retrieved successfully'
      }
    });
    expect(geofenceSchema.properties.data.properties).toMatchObject({
      status: { type: 'string', example: 'available' },
      needs_data: { type: 'boolean', example: false },
      reason: { type: 'string', nullable: true, example: null },
      authority: { type: 'string', example: 'context_only' },
      final_attendance_authority: { type: 'string', example: 'attendance_records' },
      window: { type: 'object' },
      raw_counts: { type: 'object' }
    });
    expect(geofenceSchema.properties.data.properties.raw_counts.properties).toMatchObject({
      total_events: { type: 'integer', example: 3 },
      enter_events: { type: 'integer', example: 1 },
      exit_events: { type: 'integer', example: 2 },
      unique_users: { type: 'integer', example: 2 }
    });
  });

  test('documents canonical summary report routes without the removed /api/summary alias', () => {
    const canonicalOperation = openapi.paths['/api/summary/reports'].get;
    const pdfOperation = openapi.paths['/api/summary/reports/pdf'].get;
    const excelOperation = openapi.paths['/api/summary/reports/excel'].get;
    const expectedPeriodValues = ['daily', 'weekly', 'monthly', 'range', '30d', 'current_month', 'custom'];
    const expectedPeriodParameter = expect.objectContaining({
      name: 'period',
      schema: expect.objectContaining({
        type: 'string',
        default: 'monthly'
      })
    });
    const expectedFromParameter = expect.objectContaining({
      name: 'from',
      schema: expect.objectContaining({ type: 'string', format: 'date' })
    });
    const expectedToParameter = expect.objectContaining({
      name: 'to',
      schema: expect.objectContaining({ type: 'string', format: 'date' })
    });
    const expectedQParameter = expect.objectContaining({
      in: 'query',
      name: 'q',
      schema: expect.objectContaining({ type: 'string' })
    });
    const expectedDeprecatedSearchAliases = ['search', 'query', 'keyword'].map((name) =>
      expect.objectContaining({
        in: 'query',
        name,
        deprecated: true,
        schema: expect.objectContaining({ type: 'string' })
      })
    );

    expect(openapi.paths['/api/summary']).toBeUndefined();
    expect(schemaAt(canonicalOperation)).toEqual({
      $ref: '#/components/schemas/SummaryReportResponse'
    });
    expect(schemaAt(pdfOperation)).toEqual({
      $ref: '#/components/schemas/SummaryReportPdfResponse'
    });
    expect(schemaAt(excelOperation)).toEqual({
      $ref: '#/components/schemas/SummaryReportExcelResponse'
    });

    [canonicalOperation, pdfOperation, excelOperation].forEach((operation) => {
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expectedPeriodParameter,
          expectedFromParameter,
          expectedToParameter,
          expectedQParameter,
          ...expectedDeprecatedSearchAliases
        ])
      );
      const periodEnum = operation.parameters.find((param) => param.name === 'period').schema.enum;
      expect(periodEnum).toEqual(expect.arrayContaining(expectedPeriodValues));
      expect(periodEnum).toHaveLength(expectedPeriodValues.length);
      expect(periodEnum).not.toContain('all');
      expect(operation.parameters.find((param) => param.name === 'q').deprecated).not.toBe(true);
      expect(operation.responses['400'].content['application/json'].schema.properties.message.example).toContain(
        'daily, weekly, monthly, range, 30d, current_month, atau custom'
      );
    });
  });

  test('documents summary report response, PDF projection, and Excel projection schemas', () => {
    const summarySchema = componentSchema(openapi, 'SummaryReportResponse');
    const periodSummarySchema = componentSchema(openapi, 'SummaryReportPeriodSummary');
    const exportScopeSchema = componentSchema(openapi, 'SummaryReportExportScopeSummary');
    const detailRowSchema = componentSchema(openapi, 'SummaryReportDataRow');
    const insightRowSchema = componentSchema(openapi, 'SummaryReportDisciplineInsightRow');
    const pdfSchema = componentSchema(openapi, 'SummaryReportPdfResponse');
    const excelSchema = componentSchema(openapi, 'SummaryReportExcelResponse');

    expect(summarySchema.properties).toMatchObject({
      success: { type: 'boolean', example: true },
      generated_at: {
        type: 'string',
        format: 'date-time',
        example: '2026-05-07T09:15:00.000Z'
      },
      summary: { $ref: '#/components/schemas/SummaryReportLegacySummary' },
      period_summary: { $ref: '#/components/schemas/SummaryReportPeriodSummary' },
      export_scope_summary: { $ref: '#/components/schemas/SummaryReportExportScopeSummary' },
      report: { type: 'object' },
      analytics: { type: 'object' },
      period: { type: 'string', example: 'monthly' },
      date_range: { $ref: '#/components/schemas/SummaryReportDateRange' },
      message: {
        type: 'string',
        example: 'Summary report with discipline analysis generated successfully'
      }
    });

    expect(periodSummarySchema.properties).toMatchObject({
      total_records: { type: 'integer', example: 14 },
      attendance_rate: { type: 'number', format: 'float', example: 87.5 },
      average_discipline_score: { type: 'number', format: 'float', example: 79.25 },
      late_alpha_risk_users: { type: 'integer', example: 2 },
      needs_attention_users: { type: 'integer', example: 1 }
    });
    expect(exportScopeSchema.properties).toMatchObject({
      scope: { type: 'string', example: 'filtered_records_only' },
      total_records: { type: 'integer', example: 2 },
      attendance_rate: { type: 'number', format: 'float', example: 100 },
      average_discipline_score: { type: 'number', format: 'float', example: 88 }
    });
    expect(detailRowSchema.properties).toMatchObject({
      attendance_id: { type: 'integer', example: 101 },
      user_id: { type: 'integer', nullable: true, example: 7 },
      full_name: { type: 'string', example: 'Febri' },
      work_category: { type: 'string', example: 'WFO' },
      location_description: { type: 'string', nullable: true, example: 'Kantor Pusat' },
      discipline_score: { type: 'number', format: 'float', nullable: true, example: 88 },
      discipline_label: { type: 'string', nullable: true, example: 'Sangat Baik' }
    });
    expect(insightRowSchema.properties).toMatchObject({
      user_id: { type: 'integer', example: 7 },
      employee_name: { type: 'string', example: 'Febri' },
      attendance_rate: { type: 'number', format: 'float', example: 95 },
      late_count: { type: 'integer', example: 1 },
      alpha_count: { type: 'integer', example: 0 },
      avg_discipline_score: { type: 'number', format: 'float', example: 88 },
      recommended_action_code: { type: 'string', example: 'monitor' }
    });

    expect(pdfSchema.properties).toHaveProperty('period_summary');
    expect(pdfSchema.properties).toHaveProperty('export_scope_summary');
    expect(pdfSchema.properties).toHaveProperty('detailed_attendance_table');
    expect(pdfSchema.properties).not.toHaveProperty('report_insight');

    expect(excelSchema.properties).toHaveProperty('summary_sheet');
    expect(excelSchema.properties).toHaveProperty('attendance_report_sheet');
    expect(excelSchema.properties).toHaveProperty('discipline_insight_sheet');
  });

  test('defines the Analysis tag used by published analysis endpoints', () => {
    expect(openapi.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Analysis'
        })
      ])
    );
  });

  test('documents reference data endpoints as Admin/Management-only surfaces', () => {
    const referenceDataPaths = [
      '/api/roles',
      '/api/programs',
      '/api/positions',
      '/api/divisions'
    ];

    for (const referenceDataPath of referenceDataPaths) {
      const operation = openapi.paths[referenceDataPath].get;

      expect(operation.summary).toContain('(Admin/Management only)');
      expect(operation.responses).toHaveProperty('401');
      expect(operation.responses).toHaveProperty('403');
    }
  });

  test('documents reference data response items and filters from the live controllers', () => {
    const rolesItemSchema = schemaAt(openapi.paths['/api/roles'].get).properties.data.items;
    const programsItemSchema = schemaAt(openapi.paths['/api/programs'].get).properties.data.items;
    const positionsOperation = openapi.paths['/api/positions'].get;
    const positionsItemSchema = schemaAt(positionsOperation).properties.data.items;
    const divisionsItemSchema = schemaAt(openapi.paths['/api/divisions'].get).properties.data.items;
    const roleProperties = componentSchema(openapi, 'ReferenceRole').properties;
    const positionProperties = componentSchema(openapi, 'ReferencePosition').properties;
    const divisionProperties = componentSchema(openapi, 'ReferenceDivision').properties;

    expect(rolesItemSchema).toEqual({ $ref: '#/components/schemas/ReferenceRole' });
    expect(roleProperties).toMatchObject({
      id_roles: { type: 'integer' },
      role_name: { type: 'string' }
    });
    expect(roleProperties).not.toHaveProperty('id');
    expect(roleProperties).not.toHaveProperty('name');

    expect(programsItemSchema.properties).toMatchObject({
      id_programs: { type: 'integer' },
      program_name: { type: 'string' }
    });

    expect(positionsOperation.parameters.map((parameter) => parameter.name)).toContain('program_id');
    expect(positionsItemSchema).toEqual({ $ref: '#/components/schemas/ReferencePosition' });
    expect(positionProperties).toMatchObject({
      id_positions: { type: 'integer' },
      position_name: { type: 'string' },
      id_programs: { type: 'integer' },
      program: {
        type: 'object',
        nullable: true
      }
    });
    expect(positionProperties.program.properties).toMatchObject({
      program_name: { type: 'string' }
    });
    expect(positionProperties).not.toHaveProperty('id');
    expect(positionProperties).not.toHaveProperty('name');

    expect(divisionsItemSchema).toEqual({ $ref: '#/components/schemas/ReferenceDivision' });
    expect(divisionProperties).toMatchObject({
      id_divisions: { type: 'integer' },
      division_name: { type: 'string' }
    });
    expect(divisionProperties).not.toHaveProperty('id');
    expect(divisionProperties).not.toHaveProperty('name');
  });

  test('documents dedicated Fuzzy AHP endpoint paths, dashboard recap adapter route, and temporary legacy compatibility', () => {
    expect(openapi.paths['/api/analysis/fuzzy-ahp']?.get).toBeDefined();
    expect(openapi.paths['/api/analysis/fuzzy-ahp']?.get.description).toContain('Fuzzy AHP analysis');

    for (const pathName of [
      '/api/analysis/fuzzy-ahp/discipline',
      '/api/analysis/fuzzy-ahp/wfa',
      '/api/analysis/fuzzy-ahp/smart-ac',
      '/api/analysis/fuzzy-ahp/dashboard'
    ]) {
      const operation = openapi.paths[pathName]?.get;
      expect(operation).toBeDefined();
      expect(operation.security).toEqual(
        pathName === '/api/analysis/fuzzy-ahp/wfa'
          ? [{ bearerAuth: [] }, { cookieAuth: [] }]
          : [{ bearerAuth: [] }]
      );
      expect(operation.responses['401']).toBeDefined();
      expect(operation.responses['403']).toBeDefined();
    }

    expect(openapi.paths['/api/analysis/fuzzy-ahp/discipline'].get.description).toContain('legacy');
    expect(openapi.paths['/api/analysis/fuzzy-ahp/wfa'].get.description).toContain('legacy');
    expect(openapi.paths['/api/analysis/fuzzy-ahp/smart-ac'].get.description).toContain('legacy');
  });

  test('documents legacy combined FAHP as deprecated transition-only route compatibility', () => {
    const operation = openapi.paths['/api/analysis/fuzzy-ahp'].get;
    const description = operation.description.toLowerCase();
    const responseContent = operation.responses['200'].content['application/json'];

    expect(operation.deprecated).toBe(true);
    expect(description).toContain('deprecated');
    expect(description).toContain('transition-only');
    expect(description).toContain('route-level compatibility');
    expect(description).toContain('not semantically equivalent');
    expect(description).not.toMatch(/is semantically equivalent/i);
    expect(description).not.toMatch(/same contract as the dedicated/i);
    expect(responseContent.example).toBeUndefined();
    expect(Object.keys(responseContent.examples)).toEqual(expect.arrayContaining(['discipline', 'smart_ac']));
    expect(responseContent.examples).not.toHaveProperty('wfa');
  });

  test('documents canonical WFA facility-scoring query, candidates, and failure envelopes', () => {
    const recommendationOperation = openapi.paths['/api/wfa/recommendations'].get;
    const analysisOperation = openapi.paths['/api/analysis/fuzzy-ahp/wfa'].get;
    const recommendationParams = Object.fromEntries(
      recommendationOperation.parameters.map((param) => [param.name, param])
    );
    const analysisParams = Object.fromEntries(analysisOperation.parameters.map((param) => [param.name, param]));
    const candidateSchema = componentSchema(openapi, 'WFARecommendation');
    const analysisData = schemaAt(analysisOperation).properties.data;

    expect(schemaAt(recommendationOperation).properties.data.properties.recommendations.items).toEqual({
      $ref: '#/components/schemas/WFARecommendation'
    });
    expect(schemaAt(analysisOperation).properties.data.properties.candidates.items).toEqual({
      $ref: '#/components/schemas/WFARecommendation'
    });
    expect(analysisData.required).toEqual(['candidates', 'searchCriteria', 'methodology']);
    expect(analysisData.properties).toMatchObject({
      searchCriteria: { type: 'object' },
      methodology: { type: 'object' }
    });
    expect(analysisData.properties).not.toHaveProperty('search_criteria');
    expect(analysisData.properties).not.toHaveProperty('fahp_methodology');

    expect(openapi.components.securitySchemes.cookieAuth).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'token'
    });
    for (const operation of [recommendationOperation, analysisOperation]) {
      expect(operation.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);

      const validationResponse = responseAt(openapi, operation, '400');
      const validationSchema = responseSchemaAt(openapi, operation, '400');
      expect(validationSchema.required).toEqual(['success', 'code', 'message', 'errors']);
      expect(validationSchema.properties).toMatchObject({
        success: { type: 'boolean', enum: [false] },
        code: { type: 'string', enum: ['E_VALIDATION'] },
        message: { type: 'string' },
        errors: { type: 'array' }
      });
      expect(validationSchema.properties.errors.items.required).toEqual([
        'type', 'msg', 'path', 'location'
      ]);
      expect(validationSchema.properties.errors.items.properties).toMatchObject({
        type: { type: 'string', enum: ['field'] },
        value: { type: 'string', nullable: true, example: 'not-a-coordinate' },
        msg: { type: 'string', example: 'lat must be a valid latitude' },
        path: { type: 'string', example: 'lat' },
        location: { type: 'string', enum: ['query'] }
      });
      expect(validationResponse.content['application/json'].example).toEqual({
        success: false,
        code: 'E_VALIDATION',
        message: 'lat must be a valid latitude',
        errors: [{
          type: 'field',
          value: 'not-a-coordinate',
          msg: 'lat must be a valid latitude',
          path: 'lat',
          location: 'query'
        }]
      });
    }

    expect(Object.keys(recommendationParams)).toEqual(['lat', 'lng', 'schedule_date']);
    expect(Object.keys(analysisParams)).toEqual(['lat', 'lon', 'schedule_date', 'radius_meters']);
    expect(recommendationParams.schedule_date).toMatchObject({
      required: true,
      schema: { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
    });
    expect(analysisParams.schedule_date).toMatchObject({
      required: true,
      schema: { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
    });
    expect(analysisParams.radius_meters.schema).toMatchObject({
      type: 'integer', minimum: 100, maximum: 50000, default: 5000
    });

    expect(candidateSchema.properties).toMatchObject({
        place_id: { type: 'string' },
        status: {
          type: 'string',
          enum: ['ranked', 'insufficient_facility_data', 'facility_enrichment_failed']
        },
        distance_meters: { type: 'number' },
        location_type: { type: 'string' },
        facility_score: { type: 'number', nullable: true },
        facility_confidence: { type: 'number', nullable: true },
        facilities: { type: 'object' },
        final_score: { type: 'number', nullable: true },
        final_label: { type: 'string', nullable: true },
        rank: { type: 'integer', nullable: true }
    });
    expect(candidateSchema.properties.facilities.properties).toMatchObject({
        internet_access: { type: 'integer', enum: [0, 1], nullable: true },
        air_conditioning: { type: 'integer', enum: [0, 1], nullable: true },
        toilets: { type: 'integer', enum: [0, 1], nullable: true },
        opening_hours: { type: 'integer', enum: [0, 1], nullable: true },
        wheelchair_accessibility: { type: 'integer', enum: [0, 1], nullable: true }
    });
    expect(candidateSchema.required).toEqual(
      expect.arrayContaining(['place_id', 'name', 'address', 'latitude', 'longitude', 'facilities'])
    );
    expect(candidateSchema.properties.facilities.required).toEqual([
      'internet_access',
      'air_conditioning',
      'toilets',
      'opening_hours',
      'wheelchair_accessibility'
    ]);
    expect(candidateSchema.properties).not.toHaveProperty('amenity_score');

    for (const operation of [recommendationOperation, analysisOperation]) {
      const data = schemaAt(operation).properties.data;
      const searchCriteria = data.properties.search_criteria ?? data.properties.searchCriteria;
      const methodology = data.properties.fahp_methodology ?? data.properties.methodology;

      expect(data.required).toEqual(
        operation === recommendationOperation
          ? ['recommendations', 'search_criteria', 'fahp_methodology']
          : ['candidates', 'searchCriteria', 'methodology']
      );
      expect(searchCriteria.required).toEqual([
        'center_latitude',
        'center_longitude',
        'search_radius_meters',
        'categories_searched',
        'total_candidates_found',
        'recommendations_returned'
      ]);
      expect(methodology.required).toEqual(['approach', 'criteria_weights']);
      expect(methodology.properties.criteria_weights.required).toEqual([
        'location_type',
        'distance_factor',
        'facility_score',
        'consistency_ratio',
        'weighting_method'
      ]);

      expect(searchCriteria.properties.categories_searched).toMatchObject({
        minItems: 4,
        maxItems: 4,
        uniqueItems: true,
        items: {
          type: 'string',
          enum: ['catering', 'accommodation', 'office', 'education']
        },
        example: ['catering', 'accommodation', 'office', 'education']
      });
      expect(methodology.properties.criteria_weights.properties).toMatchObject({
        location_type: { type: 'number' },
        distance_factor: { type: 'number' },
        facility_score: { type: 'number' },
        consistency_ratio: { type: 'number', example: 0.0576 },
        weighting_method: { type: 'string', example: 'row_geometric_mean_fallback' }
      });
    }

    for (const operation of [recommendationOperation, analysisOperation]) {
      const failureSchema = schemaAt(operation, '503');
      expect(failureSchema.properties).toMatchObject({
        success: { type: 'boolean', example: false },
        code: { type: 'string' },
        message: { type: 'string', example: 'Internal server error' }
      });
    }
    expect(schemaAt(recommendationOperation, '503').properties.code.example).toBe('WFA_PROVIDER_UNAVAILABLE');
    expect(schemaAt(analysisOperation, '503').properties.code.example).toBe('WFA_PROVIDER_UNAVAILABLE');
    for (const operation of [recommendationOperation, analysisOperation]) {
      expect(responseSchemaAt(openapi, operation, '500').properties.code.example)
        .toBe('WFA_CONFIG_UNAVAILABLE');
      expect(responseAt(openapi, operation, '500').content['application/json'].example).toEqual({
        success: false,
        code: 'WFA_CONFIG_UNAVAILABLE',
        message: 'Internal server error'
      });
    }
    expect(schemaAt(recommendationOperation, '409').properties.code.example).toBe('DUPLICATE_BOOKING');
  });

  test('documents exact 410 migration bodies for retired WFA analysis variants', () => {
    for (const pathName of ['/api/analysis/fuzzy-ahp', '/api/analysis/fuzzy-ahp/dashboard']) {
      const operation = openapi.paths[pathName].get;
      const movedSchema = schemaAt(operation, '410');

      expect(movedSchema.properties).toMatchObject({
        success: { type: 'boolean', example: false },
        code: { type: 'string', example: 'WFA_ANALYSIS_MOVED' },
        message: {
          type: 'string',
          example: 'Use /api/analysis/fuzzy-ahp/wfa with lat, lon, and schedule_date.'
        }
      });
    }
  });

  test('documents Smart AC evidence sufficiency fields', () => {
    const dataProperties = schemaAt(openapi.paths['/api/analysis/fuzzy-ahp/smart-ac'].get).properties.data.properties;
    const rankingProperties = dataProperties.ranking.items.properties;

    expect(dataProperties).toHaveProperty('target_date');
    expect(dataProperties).toHaveProperty('executed_window');
    expect(rankingProperties).toHaveProperty('predicted_time_out');
    expect(rankingProperties).toHaveProperty('evidence_summary');
    expect(rankingProperties).toHaveProperty('needs_data');
  });

  test('documents dashboard recap query contract and additive display fields', () => {
    const operation = openapi.paths['/api/analysis/fuzzy-ahp/dashboard'].get;
    const responseSchema = schemaAt(operation);
    const dataSchema = responseSchema.properties.data;
    const typeParameter = operation.parameters.find((parameter) => parameter.name === 'type');

    expect(typeParameter.required).toBe(true);
    expect(typeParameter.schema.enum).toEqual(['discipline', 'wfa', 'smart_ac']);
    expect(operation.parameters).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'period' }),
        expect.objectContaining({ name: 'from' }),
        expect.objectContaining({ name: 'to' })
      ])
    );
    expect(operation.description.toLowerCase()).toContain('dashboard-specific');
    expect(operation.description.toLowerCase()).toContain('monthly');
    expect(operation.description.toLowerCase()).toContain('not expose the full dedicated detail payloads');
    expect(dataSchema.properties).toMatchObject({
      type: { type: 'string' },
      type_label: { type: 'string', example: 'Discipline' },
      generated_at: { type: 'string', format: 'date-time' },
      timezone: { type: 'string', example: 'Asia/Jakarta' },
      requested_window: { type: 'object' },
      executed_window: { type: 'object' },
      status: { type: 'string', example: 'ready' },
      needs_data: { type: 'boolean', example: false },
      consistency: { type: 'object' },
      criteria_weights: { type: 'array' },
      ranking_preview: { type: 'object' },
      distribution: { type: 'object' }
    });
    expect(dataSchema.properties.consistency.properties).toMatchObject({
      CR: { type: 'number', format: 'float' },
      threshold: { type: 'number', format: 'float' },
      is_consistent: { type: 'boolean' },
      summary_label: { type: 'string', example: 'Konsistensi dapat diterima' }
    });
    expect(dataSchema.properties.consistency.properties).not.toHaveProperty('CI');
    expect(dataSchema.properties.consistency.properties).not.toHaveProperty('lambda_max');
    expect(dataSchema.properties.consistency.properties).not.toHaveProperty('verdict');
    expect(dataSchema.properties.criteria_weights.items.properties).toMatchObject({
      key: { type: 'string' },
      label: { type: 'string' },
      display_label: { type: 'string', example: 'Disiplin Kehadiran' },
      value: { type: 'number', format: 'float' }
    });
    expect(dataSchema.properties).not.toHaveProperty('ranking');
    expect(dataSchema.properties).not.toHaveProperty('weights');
    expect(dataSchema.properties).not.toHaveProperty('entity_kind');
  });

});
