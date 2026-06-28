import { buildGeofenceEvidenceData } from '../src/utils/geofenceEvidenceSnapshot.js';

describe('geofence evidence operational context', () => {
  test('returns Needs Data operational context when no location events exist in the selected window', () => {
    const result = buildGeofenceEvidenceData({
      effectiveWindow: {
        startDateStr: '2026-04-01',
        endDateStr: '2026-04-03'
      },
      locationEvents: []
    });

    expect(result).toEqual({
      status: 'needs_data',
      needs_data: true,
      reason: 'NO_GEOFENCE_EVENTS',
      authority: 'context_only',
      final_attendance_authority: 'attendance_records',
      window: {
        from: '2026-04-01',
        to: '2026-04-03'
      },
      raw_counts: {
        total_events: 0,
        enter_events: 0,
        exit_events: 0,
        unique_users: 0
      },
      operational_context: {
        activity_label: 'Needs Data',
        activity_note: '0 users generated 0 geofence events in this range.',
        enter_context: 'ENTER events support check-in reminder monitoring.',
        exit_context: 'EXIT events support active-session exit warning monitoring.',
        dashboard_note:
          'Location context only. Final attendance validity remains determined by backend attendance records.'
      }
    });
  });
});
