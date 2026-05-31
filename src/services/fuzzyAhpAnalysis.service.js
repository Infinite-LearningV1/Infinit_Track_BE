import { Op } from 'sequelize';

import { Attendance, AttendanceCategory, Booking, Location, LocationEvent, User } from '../models/index.js';
import fuzzyEngine from '../utils/fuzzyAhpEngine.js';

const CR_THRESHOLD = parseFloat(process.env.AHP_CR_THRESHOLD || '0.10');

const WORK_START_MINUTES_WIB = 8 * 60;

const EMPTY_DISTRIBUTION = {
  'Sangat Baik': 0,
  Baik: 0,
  Cukup: 0,
  Rendah: 0
};

function buildConsistency({ CR, CI = 0, lambda_max = 0, threshold = CR_THRESHOLD }) {
  const formattedThreshold = threshold.toFixed(2);

  return {
    CR,
    CI,
    lambda_max,
    threshold,
    is_consistent: CR <= threshold,
    verdict:
      CR <= threshold
        ? `Matriks perbandingan konsisten (CR < ${formattedThreshold})`
        : `Matriks perbandingan belum konsisten (CR >= ${formattedThreshold})`
  };
}

function buildDistribution(ranking) {
  return ranking.reduce((acc, item) => {
    acc[item.label] = (acc[item.label] || 0) + 1;
    return acc;
  }, { ...EMPTY_DISTRIBUTION });
}

function buildConsistencyFromWeights(weightsObj) {
  return buildConsistency({
    CR: Number(weightsObj.consistency_ratio?.toFixed?.(3) || 0),
    CI: Number(weightsObj.consistency_index?.toFixed?.(3) || 0),
    lambda_max: Number(weightsObj.lambda_max?.toFixed?.(3) || 0)
  });
}

function getWorkdayCount(startAt, endAt) {
  const current = new Date(startAt);
  let count = 0;

  while (current <= endAt) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count += 1;
    current.setDate(current.getDate() + 1);
  }

  return count;
}

function toWibParts(date, options) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    ...options
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function toWibDateString(date) {
  const values = toWibParts(date, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  return `${values.year}-${values.month}-${values.day}`;
}

function toWibMinutesOfDay(date) {
  const values = toWibParts(date, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });

  return Number(values.hour) * 60 + Number(values.minute);
}

function buildDateRange(startAt, endAt) {
  return [toWibDateString(startAt), toWibDateString(endAt)];
}

function finalizeRanking(ranking) {
  ranking.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  ranking.forEach((item, index) => {
    item.rank = index + 1;
  });

  return ranking;
}

function buildAnalysisPayload({ entityKind, ranking, consistency, weights, scope, windowApplied, dataSource }) {
  const result = {
    entity_kind: entityKind,
    consistency,
    weights,
    distribution: buildDistribution(ranking),
    ranking
  };

  if (scope != null) {
    result.scope = scope;
  }

  if (windowApplied != null) {
    result.window_applied = windowApplied;
  }

  if (dataSource != null) {
    result.data_source = dataSource;
  }

  return result;
}

function buildDisciplineMetrics(attendances, startAt, endAt) {
  const totalWorkingDays = getWorkdayCount(startAt, endAt);
  const lateAttendances = attendances.filter((att) => Number(att.status_id) === 2).length;
  const alphaAttendances = attendances.filter((att) => Number(att.status_id) === 3).length;

  const avgLatenessMinutes = attendances.length
    ? attendances
        .map((att) => Math.max(0, toWibMinutesOfDay(new Date(att.time_in)) - WORK_START_MINUTES_WIB))
        .reduce((sum, minutes) => sum + minutes, 0) / attendances.length
    : 0;

  const totalWorkHour = attendances.reduce((sum, att) => sum + Number(att.work_hour || 0), 0);

  return {
    alpha_rate: totalWorkingDays > 0 ? (alphaAttendances / totalWorkingDays) * 100 : 0,
    avg_lateness_minutes: avgLatenessMinutes,
    lateness_frequency: totalWorkingDays > 0 ? (lateAttendances / totalWorkingDays) * 100 : 0,
    work_hour_consistency: attendances.length > 0 ? totalWorkHour / attendances.length : 0
  };
}

export async function buildDisciplineAnalysis({ startAt, endAt }) {
  const users = await User.findAll({});
  const weightsObj = fuzzyEngine.getDisciplineAhpWeights();
  const criteria = ['alpha_rate', 'lateness_severity', 'lateness_frequency', 'work_focus'];
  const values = [
    weightsObj.alpha_rate,
    weightsObj.lateness_severity,
    weightsObj.lateness_frequency,
    weightsObj.work_focus
  ];
  const attendanceDateRange = buildDateRange(startAt, endAt);
  const userIds = users.map((user) => user.id_users);
  const attendanceRows = userIds.length
    ? await Attendance.findAll({
        where: {
          user_id: { [Op.in]: userIds },
          attendance_date: {
            [Op.between]: attendanceDateRange
          }
        }
      })
    : [];
  const attendancesByUser = attendanceRows.reduce((groups, attendance) => {
    const userAttendances = groups.get(attendance.user_id) || [];
    userAttendances.push(attendance);
    groups.set(attendance.user_id, userAttendances);
    return groups;
  }, new Map());
  const ranking = [];

  for (const user of users) {
    const metrics = buildDisciplineMetrics(attendancesByUser.get(user.id_users) || [], startAt, endAt);
    const result = await fuzzyEngine.calculateDisciplineIndex(metrics, weightsObj);

    ranking.push({
      id: user.id_users,
      name: user.full_name,
      score: result.score,
      label: result.label,
      breakdown: result.breakdown
    });
  }

  finalizeRanking(ranking);

  return buildAnalysisPayload({
    entityKind: 'user',
    ranking,
    consistency: buildConsistencyFromWeights(weightsObj),
    weights: {
      criteria,
      values,
      method: "Chang's Extent Analysis"
    }
  });
}

export async function buildWfaAnalysis(_window = {}) {
  const places = await Location.findAll({});
  const weightsObj = fuzzyEngine.getWfaAhpWeights();
  const criteria = ['location_type', 'distance_factor', 'amenity_score'];
  const values = [
    weightsObj.location_type,
    weightsObj.distance_factor,
    weightsObj.amenity_score
  ];
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

  finalizeRanking(ranking);

  return buildAnalysisPayload({
    entityKind: 'place',
    ranking,
    consistency: buildConsistencyFromWeights(weightsObj),
    weights: {
      criteria,
      values,
      method: "Chang's Extent Analysis"
    },
    scope: 'place_catalog_static',
    windowApplied: false,
    dataSource: {
      type: 'location_catalog_static',
      assumptions: [
        { field: 'amenity_score', value: 50 },
        { field: 'distance', value: 1000 }
      ],
      warning: 'WFA analysis uses static location catalog assumptions because no runtime visit telemetry is applied.'
    }
  });
}

function getSmartAcExpectedLocationId(attendance, targetDate) {
  const categoryName = (attendance?.attendance_category?.category_name || '').toLowerCase();

  if (categoryName.includes('wfo') || categoryName.includes('work from office')) {
    return attendance.location_id || null;
  }

  if (categoryName.includes('wfa') || categoryName.includes('work from anywhere')) {
    const booking = attendance.booking;
    const bookingDate = booking?.schedule_date instanceof Date
      ? toWibDateString(booking.schedule_date)
      : booking?.schedule_date;

    if (booking?.location_id && bookingDate === targetDate && Number(booking.status) === 1) {
      return booking.location_id;
    }
  }

  return null;
}

async function getSmartAcTransitionEvent(userId, attendance, targetDate) {
  const expectedLocationId = getSmartAcExpectedLocationId(attendance, targetDate);

  if (expectedLocationId == null || !attendance?.time_in) {
    return null;
  }

  const timeIn = new Date(attendance.time_in);
  const dayStart = new Date(`${targetDate}T00:00:00.000Z`);
  const dayEnd = new Date(`${targetDate}T23:59:59.999Z`);

  return LocationEvent.findOne({
    where: {
      user_id: userId,
      event_type: 'EXIT',
      location_id: expectedLocationId,
      event_timestamp: {
        [Op.gte]: new Date(Math.max(timeIn.getTime(), dayStart.getTime())),
        [Op.lte]: dayEnd
      }
    },
    order: [['event_timestamp', 'DESC']]
  });
}

async function buildSmartAcMetrics(user, startAt, endAt, weights) {
  const attendanceDateRange = buildDateRange(startAt, endAt);
  const attendances = await Attendance.findAll({
    where: {
      user_id: user.id_users,
      attendance_date: {
        [Op.between]: attendanceDateRange
      }
    },
    include: [
      {
        model: AttendanceCategory,
        as: 'attendance_category',
        attributes: ['category_name'],
        required: false
      },
      {
        model: Booking,
        as: 'booking',
        attributes: ['schedule_date', 'location_id', 'status'],
        required: false
      }
    ],
    order: [
      ['attendance_date', 'DESC'],
      ['time_in', 'DESC']
    ]
  });

  const latest = attendances[0] || null;
  const targetDate = latest?.attendance_date instanceof Date
    ? toWibDateString(latest.attendance_date)
    : latest?.attendance_date;
  const transitionEvent = latest ? await getSmartAcTransitionEvent(user.id_users, latest, targetDate) : null;
  const transitionCandidate = transitionEvent?.event_timestamp ? new Date(transitionEvent.event_timestamp) : null;
  const predictedCheckout = latest
    ? fuzzyEngine.weightedPrediction(
        {
          HIST: latest.time_out ? new Date(latest.time_out) : null,
          CHECKIN: latest.time_in ? new Date(latest.time_in) : null,
          CONTEXT: transitionCandidate,
          TRANSITION: transitionCandidate
        },
        weights,
        targetDate,
        latest.time_in,
        '18:00:00'
      )
    : null;

  return {
    history_checkout_minutes: latest?.time_out ? toWibMinutesOfDay(new Date(latest.time_out)) : 0,
    checkin_pattern_minutes: latest?.time_in ? toWibMinutesOfDay(new Date(latest.time_in)) : 0,
    context_checkout_minutes: transitionCandidate ? toWibMinutesOfDay(transitionCandidate) : 0,
    transition_checkout_minutes: transitionCandidate ? toWibMinutesOfDay(transitionCandidate) : 0,
    predicted_checkout_minutes: predictedCheckout ? toWibMinutesOfDay(predictedCheckout) : 0
  };
}

function getSmartAcLabel(score) {
  return fuzzyEngine.getWfaScoreLabel(score);
}

function computeSmartAcScore(metrics, weights) {
  const ordered = [
    metrics.history_checkout_minutes,
    metrics.checkin_pattern_minutes,
    metrics.context_checkout_minutes,
    metrics.transition_checkout_minutes
  ];
  const scoreBase = ordered.reduce((sum, value, index) => sum + value * weights[index], 0);
  const normalized = ordered.some((value) => value > 0) ? Math.min(100, scoreBase / 10) : 0;

  return {
    score: Number(normalized.toFixed(2)),
    label: getSmartAcLabel(normalized),
    breakdown: metrics
  };
}

export async function buildSmartAcAnalysis({ startAt, endAt }) {
  const users = await User.findAll({});
  const weightsObj = fuzzyEngine.getSmartAcAhpWeights();
  const values = [
    weightsObj.history,
    weightsObj.checkin_pattern,
    weightsObj.context,
    weightsObj.transition
  ];
  const criteria = ['history', 'checkin_pattern', 'context', 'transition'];
  const ranking = [];

  for (const user of users) {
    const metrics = await buildSmartAcMetrics(user, startAt, endAt, values);
    const result = computeSmartAcScore(metrics, values);

    ranking.push({
      id: user.id_users,
      name: user.full_name,
      score: result.score,
      label: result.label,
      breakdown: result.breakdown
    });
  }

  finalizeRanking(ranking);

  return buildAnalysisPayload({
    entityKind: 'user',
    ranking,
    consistency: buildConsistencyFromWeights(weightsObj),
    weights: {
      criteria,
      values,
      method: "Chang's Extent Analysis"
    }
  });
}
