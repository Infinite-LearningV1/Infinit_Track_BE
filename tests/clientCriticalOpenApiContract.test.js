import fs from 'fs';
import path from 'path';
import yaml from 'yamljs';

function schemaAt(operation, statusCode = '200') {
  return operation.responses[statusCode].content['application/json'].schema;
}

function jsonRequestSchema(operation) {
  return operation.requestBody.content['application/json'].schema;
}

function componentSchema(openapi, name) {
  return openapi.components.schemas[name];
}

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
        example: ['Attendance', 'AttendanceCategory', 'AttendanceStatus', 'LocationEvent']
      }
    });
    expect(sectionWindows).toMatchObject({
      executive_kpis: { type: 'object' },
      historical_trend: { type: 'object' },
      mode_mix: { type: 'object' },
      fuzzy_ahp_snapshot: { type: 'object' },
      geofence_evidence_context: { type: 'object' }
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

  test('documents canonical and deprecated summary report routes against the same shared schema', () => {
    const canonicalOperation = openapi.paths['/api/summary/reports'].get;
    const legacyOperation = openapi.paths['/api/summary'].get;
    const expectedPeriodValues = [
      'daily',
      'weekly',
      'monthly',
      'range',
      '30d',
      'current_month',
      'custom'
    ];
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

    expect(canonicalOperation.deprecated).not.toBe(true);
    expect(legacyOperation.deprecated).toBe(true);
    expect(schemaAt(canonicalOperation)).toEqual({
      $ref: '#/components/schemas/SummaryReportResponse'
    });
    expect(schemaAt(legacyOperation)).toEqual({
      $ref: '#/components/schemas/SummaryReportResponse'
    });
    expect(canonicalOperation.parameters).toEqual(
      expect.arrayContaining([
        expectedPeriodParameter,
        expectedFromParameter,
        expectedToParameter,
        expectedQParameter,
        ...expectedDeprecatedSearchAliases
      ])
    );
    expect(legacyOperation.parameters).toEqual(
      expect.arrayContaining([
        expectedPeriodParameter,
        expectedFromParameter,
        expectedToParameter,
        expectedQParameter,
        ...expectedDeprecatedSearchAliases
      ])
    );
    const canonicalPeriodEnum = canonicalOperation.parameters.find((param) => param.name === 'period').schema.enum;
    const legacyPeriodEnum = legacyOperation.parameters.find((param) => param.name === 'period').schema.enum;

    expect(canonicalPeriodEnum).toEqual(expect.arrayContaining(expectedPeriodValues));
    expect(canonicalPeriodEnum).toHaveLength(expectedPeriodValues.length);
    expect(legacyPeriodEnum).toEqual(expect.arrayContaining(expectedPeriodValues));
    expect(legacyPeriodEnum).toHaveLength(expectedPeriodValues.length);
    expect(canonicalPeriodEnum).not.toContain('all');
    expect(canonicalOperation.parameters.find((param) => param.name === 'q').deprecated).not.toBe(true);
    expect(legacyOperation.parameters.find((param) => param.name === 'q').deprecated).not.toBe(true);
    expect(canonicalOperation.responses['400'].content['application/json'].schema.properties.message.example).toContain(
      'daily, weekly, monthly, range, 30d, current_month, atau custom'
    );
    expect(legacyOperation.responses['400'].content['application/json'].schema.properties.message.example).toContain(
      'daily, weekly, monthly, range, 30d, current_month, atau custom'
    );
    expect(legacyOperation.description).toContain('/api/summary/reports');
  });

  test('documents summary report response shape for both per-user summaries and raw detail rows', () => {
    const summarySchema = componentSchema(openapi, 'SummaryReportResponse');
    const summaryProperties = summarySchema.properties.summary.properties;
    const reportProperties = summarySchema.properties.report.properties;
    const userSummaryProperties = reportProperties.user_attendance_summary.items.properties;
    const detailRowProperties = reportProperties.data.items.properties;

    expect(summarySchema.properties).toMatchObject({
      success: { type: 'boolean', example: true },
      generated_at: {
        type: 'string',
        format: 'date-time',
        example: '2026-05-07T09:15:00.000Z'
      },
      summary: { type: 'object' },
      report: { type: 'object' },
      analytics: { type: 'object' },
      period: { type: 'string', example: '30d' },
      date_range: { type: 'object' },
      message: {
        type: 'string',
        example: 'Summary report with discipline analysis generated successfully'
      }
    });
    expect(summaryProperties).toMatchObject({
      total_ontime: { type: 'integer', example: 14 },
      total_late: { type: 'integer', example: 3 },
      total_early: { type: 'integer', example: 1 },
      total_alpha: { type: 'integer', example: 1 },
      total_wfo: { type: 'integer', example: 10 },
      total_wfh: { type: 'integer', example: 5 },
      total_wfa: { type: 'integer', example: 3 }
    });
    expect(userSummaryProperties).toMatchObject({
      user_id: { type: 'integer', example: 7 },
      full_name: { type: 'string', example: 'Febri' },
      role_name: { type: 'string', nullable: true, example: 'User' },
      division: { type: 'string', nullable: true, example: 'Engineering' },
      expected_working_days: { type: 'integer', nullable: true, example: 10 },
      on_time_days: { type: 'integer', example: 8 },
      late_days: { type: 'integer', example: 2 },
      early_days: { type: 'integer', example: 1 },
      alpha_days: { type: 'integer', example: 0 },
      wfo_days: { type: 'integer', example: 6 },
      wfh_days: { type: 'integer', example: 3 },
      wfa_days: { type: 'integer', example: 1 },
      valid_attendance_days: { type: 'integer', example: 10 },
      attendance_coverage_label: { type: 'string', nullable: true, example: '10/10' },
      latest_attendance_status: { type: 'string', nullable: true, example: 'Tepat Waktu' },
      latest_attendance_date: {
        type: 'string',
        format: 'date',
        nullable: true,
        example: '2026-05-07'
      },
      summary_note: { type: 'string', example: 'Complete' }
    });
    expect(detailRowProperties).toMatchObject({
      attendance_id: { type: 'integer', example: 101 },
      user_id: { type: 'integer', nullable: true, example: 7 },
      full_name: { type: 'string', example: 'Febri' },
      role: { type: 'string', nullable: true, example: 'User' },
      nip_nim: { type: 'string', nullable: true, example: 'NIP-007' },
      email: { type: 'string', nullable: true, example: 'febri@example.com' },
      time_in: { type: 'string', nullable: true, example: '08:03' },
      time_out: { type: 'string', nullable: true, example: '17:01' },
      work_hour: { type: 'string', nullable: true, example: '08:58' },
      attendance_date: { type: 'string', format: 'date', example: '2026-05-04' },
      location_details: { type: 'object', nullable: true },
      status: { type: 'string', example: 'Tepat Waktu' },
      information: { type: 'string', example: 'Work Duration: 8h' },
      notes: { type: 'string', example: '' },
      discipline_score: { type: 'number', format: 'float', nullable: true, example: 88 },
      discipline_label: { type: 'string', nullable: true, example: 'Sangat Baik' },
      discipline_breakdown: { type: 'object', nullable: true, additionalProperties: true }
    });
    expect(detailRowProperties).not.toHaveProperty('user');
    expect(detailRowProperties).not.toHaveProperty('attendance_category');
    expect(reportProperties.pagination.properties).toMatchObject({
      current_page: { type: 'integer', example: 1 },
      total_pages: { type: 'integer', example: 2 },
      total_items: { type: 'integer', example: 15 },
      items_per_page: { type: 'integer', example: 10 },
      has_next_page: { type: 'boolean', example: true },
      has_prev_page: { type: 'boolean', example: false }
    });
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

  test('documents dedicated Fuzzy AHP endpoint paths and temporary legacy compatibility', () => {
    expect(openapi.paths['/api/analysis/fuzzy-ahp']?.get).toBeDefined();
    expect(openapi.paths['/api/analysis/fuzzy-ahp']?.get.description).toContain('Fuzzy AHP analysis');

    for (const pathName of [
      '/api/analysis/fuzzy-ahp/discipline',
      '/api/analysis/fuzzy-ahp/wfa',
      '/api/analysis/fuzzy-ahp/smart-ac'
    ]) {
      const operation = openapi.paths[pathName]?.get;
      expect(operation).toBeDefined();
      expect(operation.security).toEqual([{ bearerAuth: [] }]);
      expect(operation.responses['401']).toBeDefined();
      expect(operation.responses['403']).toBeDefined();
      expect(operation.description).toContain('legacy');
    }
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
    expect(Object.keys(responseContent.examples)).toEqual(expect.arrayContaining(['discipline', 'wfa', 'smart_ac']));
  });

  test('documents WFA query validation and provider boundary contract', () => {
    const operation = openapi.paths['/api/analysis/fuzzy-ahp/wfa'].get;
    const params = Object.fromEntries(operation.parameters.map((param) => [param.name, param]));

    expect(params.lat.required).toBe(true);
    expect(params.lon.required).toBe(true);
    expect(params.radius_meters.schema).toMatchObject({ type: 'integer', minimum: 100, maximum: 50000, default: 5000 });
    expect(operation.responses['503'].description).toContain('Geoapify');
    expect(operation.responses['503'].content['application/json'].schema.properties).toHaveProperty('provider');
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
