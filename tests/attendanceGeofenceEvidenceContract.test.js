import { jest } from '@jest/globals';

const mockBuildGeofenceEvidenceSnapshot = jest.fn();

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: {}
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  Attendance: {},
  Booking: {},
  Location: {},
  Settings: {},
  AttendanceCategory: {},
  AttendanceStatus: {},
  BookingStatus: {},
  User: {},
  Role: {},
  Division: {},
  Program: {},
  Position: {},
  LocationEvent: {},
  Photo: {}
}));

jest.unstable_mockModule('../src/utils/geofence.js', () => ({
  calculateDistance: jest.fn(() => 0),
  getJakartaTime: jest.fn(() => new Date('2026-04-22T09:00:00+07:00')),
  getJakartaDateString: jest.fn(() => '2026-04-22'),
  getCurrentTimeForDB: jest.fn(() => new Date('2026-04-22T09:00:00+07:00')),
  toJakartaTime: jest.fn((d) => d)
}));

jest.unstable_mockModule('../src/utils/workHourFormatter.js', () => ({
  formatWorkHour: jest.fn(),
  calculateWorkHour: jest.fn(),
  formatTimeOnly: jest.fn()
}));

jest.unstable_mockModule('../src/utils/searchHelper.js', () => ({
  applySearch: jest.fn()
}));

jest.unstable_mockModule('../src/jobs/autoCheckout.job.js', () => ({
  triggerAutoCheckout: jest.fn(),
  runSmartAutoCheckoutForDate: jest.fn()
}));

jest.unstable_mockModule('../src/jobs/resolveWfaBookings.job.js', () => ({
  triggerResolveWfaBookings: jest.fn(),
  resolveWfaBookingsForDate: jest.fn()
}));

jest.unstable_mockModule('../src/jobs/createGeneralAlpha.job.js', () => ({
  runGeneralAlphaForDate: jest.fn()
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() }
}));

jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
  default: {}
}));

jest.unstable_mockModule('../src/utils/geofenceEvidenceSnapshot.js', () => ({
  buildGeofenceEvidenceSnapshot: mockBuildGeofenceEvidenceSnapshot,
  default: { buildGeofenceEvidenceSnapshot: mockBuildGeofenceEvidenceSnapshot }
}));

const buildRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis()
});

describe('attendance geofence evidence handler', () => {
  beforeEach(() => {
    mockBuildGeofenceEvidenceSnapshot.mockReset();
  });

  it('returns the dedicated geofence evidence payload under attendance ownership', async () => {
    mockBuildGeofenceEvidenceSnapshot.mockResolvedValueOnce({
      requested_window: {
        period: 'custom',
        from: '2026-04-01',
        to: '2026-04-03'
      },
      executed_window: {
        from: '2026-04-01',
        to: '2026-04-03'
      },
      data: {
        status: 'available',
        needs_data: false,
        reason: null,
        authority: 'context_only',
        final_attendance_authority: 'attendance_records',
        window: {
          from: '2026-04-01',
          to: '2026-04-03'
        },
        raw_counts: {
          total_events: 4,
          enter_events: 2,
          exit_events: 2,
          unique_users: 2
        }
      }
    });

    const { getGeofenceEvidence } = await import('../src/controllers/attendance.controller.js');
    const req = {
      user: { id: 1, role_name: 'Admin' },
      query: { period: 'custom', from: '2026-04-01', to: '2026-04-03' }
    };
    const res = buildRes();
    const next = jest.fn();

    await getGeofenceEvidence(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockBuildGeofenceEvidenceSnapshot).toHaveBeenCalledWith({
      period: 'custom',
      from: '2026-04-01',
      to: '2026-04-03'
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      requested_window: {
        period: 'custom',
        from: '2026-04-01',
        to: '2026-04-03'
      },
      executed_window: {
        from: '2026-04-01',
        to: '2026-04-03'
      },
      data: {
        status: 'available',
        needs_data: false,
        reason: null,
        authority: 'context_only',
        final_attendance_authority: 'attendance_records',
        window: {
          from: '2026-04-01',
          to: '2026-04-03'
        },
        raw_counts: {
          total_events: 4,
          enter_events: 2,
          exit_events: 2,
          unique_users: 2
        }
      },
      message: 'Geofence evidence retrieved successfully'
    });
  });
});
