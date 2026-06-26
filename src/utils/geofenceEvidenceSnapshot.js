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

  const hasEvents = locationEvents.length > 0;

  return {
    requested_window: requestedWindow,
    executed_window: buildExecutedWindow(effectiveWindow),
    data: {
      status: hasEvents ? 'available' : 'needs_data',
      needs_data: !hasEvents,
      reason: hasEvents ? null : 'NO_GEOFENCE_EVENTS',
      authority: 'context_only',
      final_attendance_authority: 'attendance_records',
      window: buildExecutedWindow(effectiveWindow),
      raw_counts: {
        total_events: locationEvents.length,
        enter_events: enterEvents,
        exit_events: exitEvents,
        unique_users: uniqueUsers.size
      }
    }
  };
};

export default {
  buildGeofenceEvidenceSnapshot
};
