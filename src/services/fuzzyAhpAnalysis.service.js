import { Op } from 'sequelize';

import { Attendance, Location, LocationEvent, User } from '../models/index.js';
import fuzzyEngine from '../utils/fuzzyAhpEngine.js';

const CR_THRESHOLD = parseFloat(process.env.AHP_CR_THRESHOLD || '0.10');

const EMPTY_DISTRIBUTION = {
  'Sangat Tinggi': 0,
  Tinggi: 0,
  Sedang: 0,
  Rendah: 0,
  'Sangat Rendah': 0
};

function buildConsistency({ CR, CI = 0, lambda_max = 0, threshold = CR_THRESHOLD }) {
  return {
    CR,
    CI,
    lambda_max,
    threshold,
    is_consistent: CR <= threshold,
    verdict:
      CR <= threshold
        ? 'Matriks perbandingan konsisten (CR < 0.10)'
        : 'Matriks perbandingan belum konsisten (CR >= 0.10)'
  };
}

function buildDistribution(ranking) {
  return ranking.reduce((acc, item) => {
    acc[item.label] = (acc[item.label] || 0) + 1;
    return acc;
  }, { ...EMPTY_DISTRIBUTION });
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

function buildDateRange(startAt, endAt) {
  return [startAt.toISOString().split('T')[0], endAt.toISOString().split('T')[0]];
}

function finalizeRanking(ranking) {
  ranking.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  ranking.forEach((item, index) => {
    item.rank = index + 1;
  });

  return ranking;
}

function buildAnalysisPayload({ entityKind, ranking, consistency, weights, scope, windowApplied }) {
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

  return result;
}

function buildDisciplineMetrics(attendances, startAt, endAt) {
  const totalWorkingDays = getWorkdayCount(startAt, endAt);
  const lateAttendances = attendances.filter((att) => Number(att.status_id) === 2).length;
  const alphaAttendances = attendances.filter((att) => Number(att.status_id) === 3).length;

  const avgLatenessMinutes = attendances.length
    ? attendances
        .map((att) => {
          const timeIn = new Date(att.time_in);
          return timeIn.getUTCHours() * 60 + timeIn.getUTCMinutes();
        })
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
  const ranking = [];

  for (const user of users) {
    const attendances = await Attendance.findAll({
      where: {
        user_id: user.id_users,
        attendance_date: {
          [Op.between]: attendanceDateRange
        }
      }
    });

    const metrics = buildDisciplineMetrics(attendances, startAt, endAt);
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
    consistency: buildConsistency({
      CR: Number(weightsObj.consistency_ratio?.toFixed?.(3) || 0),
      CI: 0,
      lambda_max: 0
    }),
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
    scope: 'place_catalog_static',
    windowApplied: false
  });
}

function getSmartAcWeights() {
  return [0.4, 0.2, 0.2, 0.2];
}

async function buildSmartAcMetrics(user, startAt, endAt) {
  const attendanceDateRange = buildDateRange(startAt, endAt);
  const attendances = await Attendance.findAll({
    where: {
      user_id: user.id_users,
      attendance_date: {
        [Op.between]: attendanceDateRange
      }
    }
  });

  const latest = attendances[0] || null;
  const event = latest
    ? await LocationEvent.findOne({
        where: {
          user_id: user.id_users
        }
      })
    : null;

  return {
    history_checkout_minutes: latest?.time_out ? new Date(latest.time_out).getUTCHours() * 60 : 0,
    checkin_pattern_minutes: latest?.time_in ? new Date(latest.time_in).getUTCHours() * 60 : 0,
    context_checkout_minutes: event?.event_timestamp ? new Date(event.event_timestamp).getUTCHours() * 60 : 0,
    transition_checkout_minutes: latest?.notes?.includes('TRANSITION') ? 15 : 0
  };
}

function getSmartAcLabel(score) {
  if (score >= 80) {
    return 'Sangat Tinggi';
  }

  if (score >= 60) {
    return 'Tinggi';
  }

  if (score >= 40) {
    return 'Sedang';
  }

  if (score >= 20) {
    return 'Rendah';
  }

  return 'Sangat Rendah';
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
  const values = getSmartAcWeights();
  const criteria = ['history', 'checkin_pattern', 'context', 'transition'];
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

  finalizeRanking(ranking);

  return buildAnalysisPayload({
    entityKind: 'user',
    ranking,
    consistency: buildConsistency({
      CR: 0,
      CI: 0,
      lambda_max: 0
    }),
    weights: {
      criteria,
      values,
      method: "Chang's Extent Analysis"
    }
  });
}
