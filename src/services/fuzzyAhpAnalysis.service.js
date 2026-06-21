import axios from 'axios';
import { Op } from 'sequelize';

import * as models from '../models/index.js';
import fuzzyEngine from '../utils/fuzzyAhpEngine.js';
import { calculateDistance, toJakartaTime } from '../utils/geofence.js';

const { Attendance, Booking, Location, LocationEvent, User } = models;

const CR_THRESHOLD = 0.1;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const WORK_START_MINUTES = 8 * 60;
const FULL_WORK_DAY_HOURS = 8;
const GEOAPIFY_PLACES_URL = 'https://api.geoapify.com/v2/places';
const GEOAPIFY_WFA_CATEGORIES = 'catering,accommodation,office,education';

const EMPTY_DISTRIBUTION = {
  'Sangat Tinggi': 0,
  Tinggi: 0,
  Sedang: 0,
  Rendah: 0,
  'Sangat Rendah': 0
};

const pad2 = (value) => String(value).padStart(2, '0');

const wibDateToUtc = ({ year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0 }) =>
  new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - WIB_OFFSET_MS);

const getWibParts = (date) => {
  const shifted = new Date(date.getTime() + WIB_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds()
  };
};

const formatWibDateOnly = (date) => {
  const parts = getWibParts(date);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
};

export const formatWibDateTime = (date) => {
  const parts = getWibParts(date);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(
    parts.minute
  )}:${pad2(parts.second)}+07:00`;
};

const parseWibDateOnly = (value, endOfDay = false) => {
  const [year, month, day] = value.split('-').map(Number);
  return wibDateToUtc({
    year,
    month,
    day,
    hour: endOfDay ? 23 : 0,
    minute: endOfDay ? 59 : 0,
    second: endOfDay ? 59 : 0,
    millisecond: endOfDay ? 999 : 0
  });
};

export const getWibAnalysisWindow = (period, { from, to } = {}) => {
  if (period === 'custom') {
    return {
      startAt: parseWibDateOnly(from),
      endAt: parseWibDateOnly(to, true),
      requestedWindow: {
        start_at: `${from}T00:00:00+07:00`,
        end_at: `${to}T23:59:59+07:00`
      }
    };
  }

  const now = new Date();
  const wibNow = getWibParts(now);

  if (period === 'weekly') {
    const currentWibMidnight = wibDateToUtc({
      year: wibNow.year,
      month: wibNow.month,
      day: wibNow.day
    });
    const currentWibDay = new Date(currentWibMidnight.getTime() + WIB_OFFSET_MS).getUTCDay();
    const mondayOffset = currentWibDay === 0 ? -6 : 1 - currentWibDay;
    const start = new Date(currentWibMidnight.getTime() + mondayOffset * 24 * 60 * 60 * 1000);
    return {
      startAt: start,
      endAt: now,
      requestedWindow: {
        start_at: null,
        end_at: null
      }
    };
  }

  return {
    startAt: wibDateToUtc({ year: wibNow.year, month: wibNow.month, day: 1 }),
    endAt: now,
    requestedWindow: {
      start_at: null,
      end_at: null
    }
  };
};

export const getAnalysisWindow = (period) => {
  const { startAt, endAt } = getWibAnalysisWindow(period);
  return { startAt, endAt };
};

const buildConsistency = ({ CR, CI = 0, lambda_max = 0 }) => ({
  CR,
  CI,
  lambda_max,
  threshold: CR_THRESHOLD,
  is_consistent: CR <= CR_THRESHOLD,
  verdict:
    CR <= CR_THRESHOLD
      ? `Matriks perbandingan konsisten (CR < ${CR_THRESHOLD.toFixed(2)})`
      : `Matriks perbandingan belum konsisten (CR >= ${CR_THRESHOLD.toFixed(2)})`
});

const buildDistribution = (ranking) => {
  return ranking.reduce((acc, item) => {
    acc[item.label] = (acc[item.label] || 0) + 1;
    return acc;
  }, { ...EMPTY_DISTRIBUTION });
};

export class GeoapifyProviderUnavailableError extends Error {
  constructor(reason) {
    super(`Geoapify provider unavailable: ${reason}`);
    this.name = 'GeoapifyProviderUnavailableError';
    this.code = 'AUTH_OR_PROVIDER_UNAVAILABLE';
    this.provider = 'geoapify';
    this.reason = reason;
  }
}

const mapGeoapifyUnavailableReason = (error) => {
  const status = Number(error?.response?.status ?? error?.status);

  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') return 'timeout';
  if (status === 408) return 'timeout';
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 429) return 'quota_or_rate_limited';
  if (status >= 500) return 'provider_5xx';
  if (error?.code === 'ECONNRESET' || error?.code === 'ENOTFOUND' || error?.code === 'EAI_AGAIN') {
    return 'provider_unavailable';
  }
  return null;
};

const getGeoapifyPlaceId = (place, index) => {
  const properties = place.properties || {};
  return (
    properties.place_id ||
    properties.datasource?.raw?.place_id ||
    properties.datasource?.raw?.osm_id ||
    properties.osm_id ||
    `geoapify:${index}`
  );
};

const hasValidCoordinates = (place) => {
  const coordinates = place.geometry?.coordinates;
  return (
    Array.isArray(coordinates) &&
    coordinates.length >= 2 &&
    Number.isFinite(Number(coordinates[0])) &&
    Number.isFinite(Number(coordinates[1]))
  );
};

const deriveGeoapifyAmenityScore = (place) => {
  const properties = place.properties || {};
  const amenities = properties.amenities || {};
  const categories = Array.isArray(properties.categories) ? properties.categories : [];
  const categoryText = categories.join(' ').toLowerCase();
  const evidenceValues = [];

  for (const key of [
    'wifi',
    'internet_access',
    'power_outlets',
    'tables',
    'seating',
    'quiet',
    'air_conditioning',
    'business_center',
    'conference_room'
  ]) {
    if (Object.hasOwn(amenities, key)) evidenceValues.push(Boolean(amenities[key]));
  }

  if (properties.contact?.website !== undefined) evidenceValues.push(Boolean(properties.contact.website));
  if (properties.contact?.phone !== undefined) evidenceValues.push(Boolean(properties.contact.phone));
  if (properties.opening_hours !== undefined) evidenceValues.push(Boolean(properties.opening_hours));
  if (properties.rating !== undefined) evidenceValues.push(Number(properties.rating) > 0);
  if (properties.reviews_count !== undefined) evidenceValues.push(Number(properties.reviews_count) > 0);
  if (categories.length) {
    evidenceValues.push(
      categoryText.includes('cafe') || categoryText.includes('office') || categoryText.includes('coworking')
    );
  }

  if (!evidenceValues.length) return 0;

  const positiveEvidence = evidenceValues.reduce((sum, value) => (value ? sum + 1 : sum), 0);
  return Math.min(100, Math.round((positiveEvidence / evidenceValues.length) * 100));
};

const getGeoapifyDistanceMeters = ({ place, latitude, longitude }) => {
  const propertyDistance = Number(place.properties?.distance);
  if (Number.isFinite(propertyDistance)) return Math.round(propertyDistance);

  if (!hasValidCoordinates(place)) return null;

  return Math.round(
    calculateDistance(latitude, longitude, Number(place.geometry.coordinates[1]), Number(place.geometry.coordinates[0]))
  );
};

const fetchGeoapifyPlaces = async ({ latitude, longitude, radiusMeters }) => {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    throw new GeoapifyProviderUnavailableError('auth_missing');
  }

  try {
    const response = await axios.get(GEOAPIFY_PLACES_URL, {
      params: {
        categories: GEOAPIFY_WFA_CATEGORIES,
        filter: `circle:${longitude},${latitude},${radiusMeters}`,
        limit: 50,
        apiKey,
        lang: 'en'
      },
      timeout: 30000,
      headers: {
        'User-Agent': 'Infinit-Track-WFA-Analysis/1.0',
        Accept: 'application/json'
      }
    });

    return Array.isArray(response.data?.features) ? response.data.features : [];
  } catch (error) {
    const reason = mapGeoapifyUnavailableReason(error);
    if (reason) {
      throw new GeoapifyProviderUnavailableError(reason);
    }
    throw error;
  }
};

const getWorkdayCount = (startAt, endAt) => {
  const startParts = getWibParts(startAt);
  const endParts = getWibParts(endAt);
  let current = Date.UTC(startParts.year, startParts.month - 1, startParts.day);
  const end = Date.UTC(endParts.year, endParts.month - 1, endParts.day);
  let count = 0;

  while (current <= end) {
    const day = new Date(current).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    current += 24 * 60 * 60 * 1000;
  }

  return count;
};

const getJakartaMinutesOfDay = (dateLike) => {
  const jakartaTime = toJakartaTime(dateLike);
  return jakartaTime.getUTCHours() * 60 + jakartaTime.getUTCMinutes();
};

const round2 = (value) => Math.round(value * 100) / 100;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const buildDisciplineMetrics = (attendances, startAt, endAt) => {
  const totalWorkingDays = getWorkdayCount(startAt, endAt);
  const presentAttendances = attendances.filter((att) => Number(att.status_id) !== 3);
  const lateAttendances = presentAttendances.filter((att) => Number(att.status_id) === 2).length;
  const alphaAttendances = attendances.filter((att) => Number(att.status_id) === 3).length;

  const totalLatenessMinutes = presentAttendances.reduce((sum, att) => {
    if (!att.time_in) return sum;
    const latenessMinutes = Math.max(0, getJakartaMinutesOfDay(att.time_in) - WORK_START_MINUTES);
    return sum + latenessMinutes;
  }, 0);

  const consistentWorkHours = presentAttendances.filter((att) => {
    const workHour = Number(att.work_hour || 0);
    return !Number.isNaN(workHour) && workHour >= FULL_WORK_DAY_HOURS;
  }).length;

  const avgLatenessMinutes = presentAttendances.length
    ? totalLatenessMinutes / presentAttendances.length
    : 0;
  const workHourConsistency = presentAttendances.length
    ? (consistentWorkHours / presentAttendances.length) * 100
    : 0;

  return {
    alpha_rate: totalWorkingDays > 0 ? round2((alphaAttendances / totalWorkingDays) * 100) : 0,
    avg_lateness_minutes: round2(clamp(avgLatenessMinutes, 0, 60)),
    lateness_frequency:
      totalWorkingDays > 0 ? round2((lateAttendances / totalWorkingDays) * 100) : 0,
    work_hour_consistency: round2(clamp(workHourConsistency, 0, 100))
  };
};

export const buildDisciplineAnalysis = async ({ startAt, endAt, includeLegacyId = true }) => {
  const users = await User.findAll({});
  const weightsObj = fuzzyEngine.getDisciplineAhpWeights();
  const criteria = ['alpha_rate', 'lateness_severity', 'lateness_frequency', 'work_focus'];
  const values = [
    weightsObj.alpha_rate,
    weightsObj.lateness_severity,
    weightsObj.lateness_frequency,
    weightsObj.work_focus
  ];

  const attendanceDateRange = [formatWibDateOnly(startAt), formatWibDateOnly(endAt)];
  const userIds = users.map((user) => user.id_users);
  const attendances = userIds.length
    ? await Attendance.findAll({
        where: {
          user_id: {
            [Op.in]: userIds
          },
          attendance_date: {
            [Op.between]: attendanceDateRange
          }
        }
      })
    : [];
  const emptyResult = {
    entity_kind: 'user',
    consistency: buildConsistency({
      CR: Number(weightsObj.consistency_ratio?.toFixed?.(3) || 0),
      CI: 0,
      lambda_max: 0
    }),
    weights: {
      criteria,
      values,
      method: "Chang's Extent Analysis"
    },
    distribution: { ...EMPTY_DISTRIBUTION },
    ranking: []
  };

  if (!attendances.length) {
    return emptyResult;
  }

  const attendancesByUserId = attendances.reduce((acc, attendance) => {
    const userAttendances = acc.get(attendance.user_id) || [];
    userAttendances.push(attendance);
    acc.set(attendance.user_id, userAttendances);
    return acc;
  }, new Map());

  const ranking = [];

  for (const user of users) {
    const userAttendances = attendancesByUserId.get(user.id_users) || [];
    if (!userAttendances.length) continue;

    const metrics = buildDisciplineMetrics(userAttendances, startAt, endAt);
    const result = await fuzzyEngine.calculateDisciplineIndex(metrics, weightsObj);

    ranking.push({
      [includeLegacyId ? 'id' : 'user_id']: user.id_users,
      name: user.full_name,
      score: result.score,
      label: result.label,
      breakdown: result.breakdown
    });
  }

  ranking.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  ranking.forEach((item, index) => {
    item.rank = index + 1;
  });

  return {
    entity_kind: 'user',
    consistency: buildConsistency({
      CR: Number(weightsObj.consistency_ratio?.toFixed?.(3) || 0),
      CI: 0,
      lambda_max: 0
    }),
    weights: {
      criteria,
      values,
      method: "Chang's Extent Analysis"
    },
    distribution: buildDistribution(ranking),
    ranking
  };
};

export const buildDisciplineFahpPayload = async ({ period, from, to }) => {
  const { startAt, endAt, requestedWindow } = getWibAnalysisWindow(period, { from, to });
  const result = await buildDisciplineAnalysis({ startAt, endAt, includeLegacyId: false });

  return {
    type: 'discipline',
    period,
    generated_at: formatWibDateTime(endAt),
    timezone: 'Asia/Jakarta',
    requested_window: requestedWindow,
    executed_window: {
      start_at: formatWibDateTime(startAt),
      end_at: formatWibDateTime(endAt)
    },
    ...result
  };
};

export const buildWfaFahpPayload = async ({ lat, lon, radiusMeters }) => {
  const latitude = Number(lat);
  const longitude = Number(lon);
  const searchRadiusMeters = Number(radiusMeters ?? 5000);
  const places = await fetchGeoapifyPlaces({ latitude, longitude, radiusMeters: searchRadiusMeters });
  const weightsObj = fuzzyEngine.getWfaAhpWeights();
  const criteria = ['location_type', 'distance_factor', 'amenity_score'];
  const values = [weightsObj.location_type, weightsObj.distance_factor, weightsObj.amenity_score];
  const consistency = buildConsistency({
    CR: Number(weightsObj.consistency_ratio?.toFixed?.(3) || 0),
    CI: 0,
    lambda_max: 0
  });

  const basePayload = {
    type: 'wfa',
    timezone: 'Asia/Jakarta',
    data_source: 'geoapify_live',
    query: {
      lat: latitude,
      lon: longitude,
      radius_meters: searchRadiusMeters
    },
    entity_kind: 'place',
    consistency,
    weights: {
      criteria,
      values,
      method: "Chang's Extent Analysis"
    }
  };

  if (!places.length) {
    return {
      ...basePayload,
      distribution: { ...EMPTY_DISTRIBUTION },
      ranking: [],
      empty_real: true
    };
  }

  const ranking = [];

  for (const [index, place] of places.entries()) {
    if (!hasValidCoordinates(place)) continue;

    const distanceMeters = getGeoapifyDistanceMeters({ place, latitude, longitude });
    if (!Number.isFinite(distanceMeters)) continue;

    const amenityScore = deriveGeoapifyAmenityScore(place);
    const placeForScoring = {
      ...place,
      properties: {
        ...(place.properties || {}),
        distance: distanceMeters,
        amenity_score: amenityScore
      },
      userLocation: { lat: latitude, lon: longitude }
    };
    const result = await fuzzyEngine.calculateWfaScore(placeForScoring, weightsObj);

    ranking.push({
      place_id: getGeoapifyPlaceId(place, index),
      name:
        place.properties?.name || place.properties?.address_line1 || place.properties?.formatted || 'Tempat Tidak Diketahui',
      score: result.score,
      label: result.label,
      breakdown: {
        location_type: fuzzyEngine.categorizePlace(placeForScoring),
        distance_m: distanceMeters,
        amenity_score: amenityScore
      }
    });
  }

  ranking.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  ranking.forEach((item, index) => {
    item.rank = index + 1;
  });

  return {
    ...basePayload,
    distribution: buildDistribution(ranking),
    ranking,
    empty_real: ranking.length === 0
  };
};

export const buildWfaAnalysis = async () => {
  const places = await Location.findAll({});
  const weightsObj = fuzzyEngine.getWfaAhpWeights();
  const criteria = ['location_type', 'distance_factor', 'amenity_score'];
  const values = [weightsObj.location_type, weightsObj.distance_factor, weightsObj.amenity_score];

  const ranking = [];

  for (const place of places) {
    const placeDetails = {
      properties: {
        name: place.description,
        amenity_score: 50,
        distance: 1000
      },
      geometry: {
        coordinates: [Number(place.longitude), Number(place.latitude)]
      }
    };

    const result = await fuzzyEngine.calculateWfaScore(placeDetails, weightsObj);
    ranking.push({
      id: place.location_id,
      name: place.description,
      score: result.score,
      label: result.label,
      breakdown: {
        location_type: fuzzyEngine.categorizePlace(placeDetails),
        amenity_score: 50,
        distance: 1000
      }
    });
  }

  ranking.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  ranking.forEach((item, index) => {
    item.rank = index + 1;
  });

  return {
    entity_kind: 'place',
    consistency: buildConsistency({
      CR: Number(weightsObj.consistency_ratio?.toFixed?.(3) || 0),
      CI: 0,
      lambda_max: 0
    }),
    weights: {
      criteria,
      values,
      method: "Chang's Extent Analysis"
    },
    distribution: buildDistribution(ranking),
    ranking
  };
};

const SMART_AC_CRITERIA = ['history', 'checkin_pattern', 'context', 'transition'];

const getSmartAcWeightMetadata = () => {
  const weightsObj = fuzzyEngine.getSmartAcAhpWeights();
  return {
    values: [weightsObj.history, weightsObj.checkin_pattern, weightsObj.context, weightsObj.transition],
    consistency: buildConsistency({
      CR: Number(weightsObj.consistency_ratio?.toFixed?.(3) || 0),
      CI: Number(weightsObj.consistency_index?.toFixed?.(3) || 0),
      lambda_max: Number(weightsObj.lambda_max?.toFixed?.(3) || 0)
    })
  };
};

const formatWibTimeOnly = (date) => {
  const parts = getWibParts(date);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
};

const buildSmartAcMetrics = async (user, startAt, endAt) => {
  const attendances = await Attendance.findAll({
    where: {
      user_id: user.id_users,
      attendance_date: {
        [Op.between]: [formatWibDateOnly(startAt), formatWibDateOnly(endAt)]
      }
    },
    order: [
      ['attendance_date', 'DESC'],
      ['time_out', 'DESC'],
      ['time_in', 'DESC'],
      ['id_attendance', 'DESC']
    ]
  });

  const latest = attendances[0] || null;
  const targetDate = latest?.attendance_date instanceof Date ? formatWibDateOnly(latest.attendance_date) : latest?.attendance_date;
  const expectedLocation = latest
    ? await resolveExpectedLocationEvidence({
        attendance: latest,
        userId: user.id_users,
        targetDate
      })
    : null;
  const eventStartAt = latest?.time_in
    ? new Date(Math.max(new Date(latest.time_in).getTime(), startAt.getTime()))
    : startAt;
  const transitionDayEndAt = targetDate ? parseWibDateOnly(targetDate, true) : endAt;
  const transitionUpperBoundAt = transitionDayEndAt.getTime() < endAt.getTime() ? transitionDayEndAt : endAt;
  const transitionEvent =
    latest?.time_in && expectedLocation?.location_id != null
      ? await LocationEvent.findOne({
          where: {
            user_id: user.id_users,
            event_type: 'EXIT',
            location_id: expectedLocation.location_id,
            event_timestamp: {
              [Op.gte]: eventStartAt,
              [Op.lte]: transitionUpperBoundAt
            }
          },
          order: [['event_timestamp', 'DESC']]
        })
      : null;
  const transitionCandidate = transitionEvent?.event_timestamp ? new Date(transitionEvent.event_timestamp) : null;

  return {
    history_checkout_minutes: latest?.time_out ? getJakartaMinutesOfDay(latest.time_out) : 0,
    checkin_pattern_minutes: latest?.time_in ? getJakartaMinutesOfDay(latest.time_in) : 0,
    context_checkout_minutes: transitionCandidate ? getJakartaMinutesOfDay(transitionCandidate) : 0,
    transition_checkout_minutes: transitionCandidate ? getJakartaMinutesOfDay(transitionCandidate) : 0
  };
};

const computeSmartAcScore = (metrics, weights) => {
  const ordered = [
    metrics.history_checkout_minutes,
    metrics.checkin_pattern_minutes,
    metrics.context_checkout_minutes,
    metrics.transition_checkout_minutes
  ];
  const scoreBase = ordered.reduce((sum, value, index) => sum + value * weights[index], 0);
  const normalized = ordered.some((value) => value > 0) ? Math.min(100, scoreBase / 10) : 0;
  const label =
    normalized >= 80
      ? 'Sangat Tinggi'
      : normalized >= 60
        ? 'Tinggi'
        : normalized >= 40
          ? 'Sedang'
          : normalized >= 20
            ? 'Rendah'
            : 'Sangat Rendah';

  return {
    score: Number(normalized.toFixed(2)),
    label,
    breakdown: metrics
  };
};

export const buildSmartAcAnalysis = async ({ startAt, endAt }) => {
  const users = await User.findAll({});
  const { values, consistency } = getSmartAcWeightMetadata();
  const criteria = SMART_AC_CRITERIA;

  const ranking = [];

  for (const user of users) {
    const metrics = await buildSmartAcMetrics(user, startAt, endAt);
    const result = computeSmartAcScore(metrics, values);

    ranking.push({
      id: user.id_users,
      name: user.full_name,
      score: result.score,
      label: result.label,
      breakdown: result.breakdown
    });
  }

  ranking.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  ranking.forEach((item, index) => {
    item.rank = index + 1;
  });

  return {
    entity_kind: 'user',
    consistency,
    weights: {
      criteria,
      values,
      method: "Chang's Extent Analysis"
    },
    distribution: buildDistribution(ranking),
    ranking
  };
};

const buildLatestAttendanceSummary = (attendance) => {
  if (!attendance) return null;

  return {
    attendance_id: attendance.id_attendance ?? null,
    attendance_date: String(attendance.attendance_date),
    time_in: attendance.time_in ? formatWibDateTime(new Date(attendance.time_in)) : null,
    time_out: attendance.time_out ? formatWibDateTime(new Date(attendance.time_out)) : null,
    category_id: attendance.category_id ?? null,
    location_id: attendance.location_id ?? null,
    booking_id: attendance.booking_id ?? null
  };
};

const buildExitEventSummary = (event) => {
  if (!event) return null;

  return {
    event_id: event.id ?? null,
    event_type: event.event_type,
    location_id: event.location_id,
    event_timestamp: formatWibDateTime(new Date(event.event_timestamp))
  };
};

const getApprovedWfaBooking = async ({ attendance, userId, targetDate }) => {
  if (!Booking?.findOne) return null;

  const where = {
    user_id: userId,
    schedule_date: targetDate,
    status: 1
  };

  if (attendance?.booking_id) {
    where.booking_id = attendance.booking_id;
  }

  return Booking.findOne({ where });
};

const getLocationDescription = async (locationId) => {
  if (locationId == null || !Location?.findByPk) return null;
  const location = await Location.findByPk(locationId);
  return location?.description ?? null;
};

const resolveExpectedLocationEvidence = async ({ attendance, userId, targetDate }) => {
  if (attendance?.location_id != null) {
    return {
      source: 'wfo_attendance_location',
      location_id: attendance.location_id,
      description: await getLocationDescription(attendance.location_id)
    };
  }

  const booking = await getApprovedWfaBooking({ attendance, userId, targetDate });
  if (booking?.location_id != null) {
    return {
      source: 'approved_wfa_booking',
      location_id: booking.location_id,
      description: await getLocationDescription(booking.location_id)
    };
  }

  return null;
};

export const buildSmartAcFahpPayload = async () => {
  const now = new Date();
  const targetDate = formatWibDateOnly(now);
  const startAt = parseWibDateOnly(targetDate);
  const endAt = parseWibDateOnly(targetDate, true);
  const users = await User.findAll({});
  const { values, consistency } = getSmartAcWeightMetadata();
  const userIds = users.map((user) => user.id_users);
  const attendances = userIds.length
    ? await Attendance.findAll({
        where: {
          user_id: {
            [Op.in]: userIds
          },
          attendance_date: targetDate
        },
        order: [
          ['time_in', 'DESC'],
          ['id_attendance', 'DESC']
        ]
      })
    : [];

  const latestAttendanceByUserId = attendances.reduce((acc, attendance) => {
    if (!acc.has(attendance.user_id)) acc.set(attendance.user_id, attendance);
    return acc;
  }, new Map());

  const ranking = [];

  for (const user of users) {
    const attendance = latestAttendanceByUserId.get(user.id_users) || null;
    const expectedLocation = await resolveExpectedLocationEvidence({
      attendance,
      userId: user.id_users,
      targetDate
    });
    const eventStartAt = attendance?.time_in
      ? new Date(Math.max(new Date(attendance.time_in).getTime(), startAt.getTime()))
      : startAt;
    const latestExitEvent =
      attendance?.time_in && expectedLocation?.location_id != null
        ? await LocationEvent.findOne({
            where: {
              user_id: user.id_users,
              event_type: 'EXIT',
              location_id: expectedLocation.location_id,
              event_timestamp: {
                [Op.gte]: eventStartAt,
                [Op.lte]: endAt
              }
            },
            order: [['event_timestamp', 'DESC']]
          })
        : null;
    const hasSufficientEvidence = Boolean(attendance?.time_in && expectedLocation && latestExitEvent?.event_timestamp);

    ranking.push({
      user_id: user.id_users,
      name: user.full_name,
      predicted_time_out: hasSufficientEvidence ? formatWibTimeOnly(new Date(latestExitEvent.event_timestamp)) : null,
      evidence_summary: {
        latest_attendance: buildLatestAttendanceSummary(attendance),
        expected_location: expectedLocation,
        latest_exit_event: buildExitEventSummary(latestExitEvent)
      },
      needs_data: !hasSufficientEvidence
    });
  }

  ranking.sort((a, b) => {
    if (a.needs_data !== b.needs_data) return a.needs_data ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  ranking.forEach((item, index) => {
    item.rank = index + 1;
  });

  return {
    type: 'smart_ac',
    target_date: targetDate,
    timezone: 'Asia/Jakarta',
    executed_window: {
      start_at: formatWibDateTime(startAt),
      end_at: formatWibDateTime(endAt)
    },
    entity_kind: 'user',
    consistency,
    weights: {
      criteria: SMART_AC_CRITERIA,
      values,
      method: "Chang's Extent Analysis"
    },
    ranking
  };
};
