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
    const dashboardSchema = schemaAt(openapi.paths['/api/summary/dashboard-analytics'].get);
    const dataSchema = dashboardSchema.properties.data;
    const sectionWindows = dataSchema.properties.meta.properties.section_windows.properties;

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
    const expectedPeriodParameter = expect.objectContaining({
      name: 'period',
      schema: expect.objectContaining({
        type: 'string',
        enum: ['30d', 'current_month', 'custom'],
        default: '30d'
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

    expect(canonicalOperation.deprecated).not.toBe(true);
    expect(legacyOperation.deprecated).toBe(true);
    expect(schemaAt(canonicalOperation)).toEqual({
      $ref: '#/components/schemas/SummaryReportResponse'
    });
    expect(schemaAt(legacyOperation)).toEqual({
      $ref: '#/components/schemas/SummaryReportResponse'
    });
    expect(canonicalOperation.parameters).toEqual(
      expect.arrayContaining([expectedPeriodParameter, expectedFromParameter, expectedToParameter])
    );
    expect(legacyOperation.parameters).toEqual(
      expect.arrayContaining([expectedPeriodParameter, expectedFromParameter, expectedToParameter])
    );
    expect(canonicalOperation.responses['400'].content['application/json'].schema.properties.message.example).toContain(
      '30d, current_month, atau custom'
    );
    expect(legacyOperation.responses['400'].content['application/json'].schema.properties.message.example).toContain(
      '30d, current_month, atau custom'
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
});
