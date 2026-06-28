import { Op } from 'sequelize';

import { LocationEvent } from '../models/index.js';
import {
  addUtcDays,
  buildEffectiveWindow,
  buildJakartaDayStartUtc,
  buildRequestedWindow,
  formatDateOnly
} from './historicalDateWindow.js';

const buildExecutedWindow = (effectiveWindow) => ({
  from: effectiveWindow.startDateStr,
  to: effectiveWindow.endDateStr
});

const buildOperationalContext = ({ needsData, totalEvents, uniqueUsers }) => ({
  activity_label: needsData ? 'Needs Data' : 'Active',
  activity_note: `${uniqueUsers} users generated ${totalEvents} geofence events in this range.`,
  enter_context: 'ENTER events support check-in reminder monitoring.',
  exit_context: 'EXIT events support active-session exit warning monitoring.',
  dashboard_note:
    'Location context only. Final attendance validity remains determined by backend attendance records.'
});

export const buildGeofenceEvidenceData = ({ effectiveWindow, locationEvents }) => {
  const uniqueUsers = new Set();
  let enterEvents = 0;
  let exitEvents = 0;

  for (const event of locationEvents) {
    if (event.user_id != null) {
      uniqueUsers.add(String(event.user_id));
    }

    if (event.event_type === 'ENTER') {
      enterEvents += 1;
    }

    if (event.event_type === 'EXIT') {
      exitEvents += 1;
    }
  }

  const totalEvents = locationEvents.length;
  const hasEvents = totalEvents > 0;

  return {
    status: hasEvents ? 'available' : 'needs_data',
    needs_data: !hasEvents,
    reason: hasEvents ? null : 'NO_GEOFENCE_EVENTS',
    authority: 'context_only',
    final_attendance_authority: 'attendance_records',
    window: buildExecutedWindow(effectiveWindow),
    raw_counts: {
      total_events: totalEvents,
      enter_events: enterEvents,
      exit_events: exitEvents,
      unique_users: uniqueUsers.size
    },
    operational_context: buildOperationalContext({
      needsData: !hasEvents,
      totalEvents,
      uniqueUsers: uniqueUsers.size
    })
  };
};

export const buildGeofenceEvidenceSnapshot = async ({ period = '30d', from = null, to = null } = {}) => {
  const requestedWindow = buildRequestedWindow({ period, from, to });
  const effectiveWindow = buildEffectiveWindow({ period, from, to });
  const geofenceStartInclusive = buildJakartaDayStartUtc(effectiveWindow.startDateStr);
  const geofenceEndExclusive = buildJakartaDayStartUtc(formatDateOnly(addUtcDays(effectiveWindow.endDate, 1)));

  const locationEvents = await LocationEvent.findAll({
    where: {
      event_timestamp: {
        [Op.gte]: geofenceStartInclusive,
        [Op.lt]: geofenceEndExclusive
      }
    },
    attributes: ['user_id', 'event_type'],
    order: [['event_timestamp', 'ASC']]
  });

  return {
    requested_window: requestedWindow,
    executed_window: buildExecutedWindow(effectiveWindow),
    data: buildGeofenceEvidenceData({
      effectiveWindow,
      locationEvents
    })
  };
};

export default {
  buildGeofenceEvidenceData,
  buildGeofenceEvidenceSnapshot
};
