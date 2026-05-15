import { Op } from 'sequelize';

import {
  Attendance,
  AttendanceCategory,
  AttendanceStatus,
  LocationEvent
} from '../models/index.js';
import {
  buildDisciplineAnalysis,
  buildSmartAcAnalysis,
  buildWfaAnalysis
} from '../controllers/analysis.controller.js';
import {
  addUtcDays,
  buildEffectiveWindow,
  buildJakartaDayStartUtc,
  buildRequestedWindow,
  enumerateDateRange,
  formatDateOnly
} from './historicalDateWindow.js';

const STATUS_ALPHA = new Set(['alpa', 'alpha']);
const STATUS_LATE = new Set(['terlambat', 'late']);
const STATUS_EARLY = new Set(['early', 'lebih awal']);
const CATEGORY_MAP = {
  wfo: 'wfo',
  'work from office': 'wfo',
  wfh: 'wfh',
  'work from home': 'wfh',
  wfa: 'wfa',
  'work from anywhere': 'wfa'
};

const buildExecutedWindow = (effectiveWindow) => ({
  from: effectiveWindow.startDateStr,
  to: effectiveWindow.endDateStr
});

const buildSectionWindows = (effectiveWindow) => ({
  executive_kpis: buildExecutedWindow(effectiveWindow),
  historical_trend: buildExecutedWindow(effectiveWindow),
  mode_mix: buildExecutedWindow(effectiveWindow),
  fuzzy_ahp_snapshot: buildExecutedWindow(effectiveWindow),
  geofence_evidence_context: buildExecutedWindow(effectiveWindow)
});

const buildEmptySnapshotCard = (effectiveWindow, generatedAt) => ({
  status: 'no_data',
  generated_at: generatedAt,
  window: buildExecutedWindow(effectiveWindow),
  weights: {},
  consistency: null,
  top_rank: null,
  distribution: {}
});

const roundToTwo = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const percentageOf = (count, total) => (total > 0 ? roundToTwo((count / total) * 100) : 0);

const normalizeCategoryName = (categoryName) => {
  if (!categoryName) return null;
  return CATEGORY_MAP[String(categoryName).trim().toLowerCase()] ?? null;
};

const normalizeStatusName = (statusName) => String(statusName || '').trim().toLowerCase();

const getAttendanceStatusFlags = (statusName) => {
  const normalizedStatusName = normalizeStatusName(statusName);
  const isAlpha = STATUS_ALPHA.has(normalizedStatusName);

  return {
    isAlpha,
    isLate: !isAlpha && STATUS_LATE.has(normalizedStatusName),
    isEarly: !isAlpha && STATUS_EARLY.has(normalizedStatusName)
  };
};

const incrementAttendanceCounters = (counters, { isAlpha, isLate, isEarly }) => {
  if (isAlpha) {
    counters.alpha += 1;
    return;
  }

  counters.present += 1;

  if (isLate) {
    counters.late += 1;
    return;
  }

  if (!isEarly) {
    counters.on_time += 1;
  }
};

const buildWeightsObject = (weights) => {
  if (!weights?.criteria || !weights?.values) {
    return {};
  }

  return weights.criteria.reduce((acc, criterion, index) => {
    acc[criterion] = weights.values[index] ?? null;
    return acc;
  }, {});
};

const buildDistributionFromRanking = (ranking) => {
  return ranking.reduce((acc, item) => {
    acc[item.label] = (acc[item.label] || 0) + 1;
    return acc;
  }, {});
};

const buildSnapshotCard = ({ analysis, effectiveWindow, generatedAt, allowedIds = null }) => {
  const ranking = Array.isArray(analysis?.ranking) ? analysis.ranking : [];
  const filteredRanking =
    allowedIds == null ? ranking : ranking.filter((item) => allowedIds.has(String(item.id)));

  if (filteredRanking.length === 0) {
    return buildEmptySnapshotCard(effectiveWindow, generatedAt);
  }

  const topRank = filteredRanking[0];

  return {
    status: 'ready',
    generated_at: generatedAt,
    window: buildExecutedWindow(effectiveWindow),
    weights: buildWeightsObject(analysis?.weights),
    consistency: analysis?.consistency ?? null,
    top_rank: {
      id: topRank.id,
      name: topRank.name,
      score: topRank.score,
      label: topRank.label
    },
    distribution: buildDistributionFromRanking(filteredRanking)
  };
};

const buildGeofenceEvidenceContext = ({ effectiveWindow, locationEvents }) => {
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

  return {
    status: locationEvents.length > 0 ? 'available' : 'no_events',
    authority: 'context_only',
    final_attendance_authority: 'attendance_records',
    window: buildExecutedWindow(effectiveWindow),
    raw_counts: {
      total_events: locationEvents.length,
      enter_events: enterEvents,
      exit_events: exitEvents,
      unique_users: uniqueUsers.size
    }
  };
};

const buildInsights = ({ executiveKpis, modeMix }) => {
  const items = [];
  const rawCounts = executiveKpis.raw_counts;

  if (rawCounts.total_attendance_records > 0) {
    const alphaRate = (rawCounts.total_alpha / rawCounts.total_attendance_records) * 100;
    if (alphaRate >= 20) {
      items.push({
        type: 'alpha_spike',
        title: 'Alpha rate elevated',
        message: `Alpha reached ${alphaRate.toFixed(1)}% of attendance records in the selected window.`,
        severity: 'high'
      });
    }
  }

  const totalMode = modeMix.totals.wfo + modeMix.totals.wfh + modeMix.totals.wfa;
  if (totalMode > 0 && modeMix.percentages.wfa >= 50) {
    items.push({
      type: 'wfa_dominant',
      title: 'WFA is the dominant mode',
      message: `WFA contributed ${modeMix.percentages.wfa.toFixed(1)}% of recorded attendance modes.`,
      severity: 'medium'
    });
  }

  if (executiveKpis.avg_discipline != null && executiveKpis.avg_discipline < 60) {
    items.push({
      type: 'discipline_drop',
      title: 'Discipline average needs attention',
      message: `Average discipline score is ${executiveKpis.avg_discipline.toFixed(2)} for the selected window.`,
      severity: 'medium'
    });
  }

  return { items };
};

export const buildDashboardAnalytics = async ({ period = '30d', from = null, to = null } = {}) => {
  const requestedWindow = buildRequestedWindow({ period, from, to });
  const effectiveWindow = buildEffectiveWindow({ period, from, to });
  const historicalDates = enumerateDateRange(effectiveWindow.startDate, effectiveWindow.endDate);
  const generatedAt = new Date().toISOString();
  const geofenceStartInclusive = buildJakartaDayStartUtc(effectiveWindow.startDateStr);
  const geofenceEndExclusive = buildJakartaDayStartUtc(formatDateOnly(addUtcDays(effectiveWindow.endDate, 1)));

  const [attendanceRows, locationEvents, disciplineAnalysis, wfaAnalysis, smartAcAnalysis] =
    await Promise.all([
      Attendance.findAll({
        where: {
          attendance_date: {
            [Op.between]: [effectiveWindow.startDateStr, effectiveWindow.endDateStr]
          }
        },
        attributes: ['attendance_date', 'user_id'],
        include: [
          {
            model: AttendanceStatus,
            as: 'status',
            attributes: ['attendance_status_name']
          },
          {
            model: AttendanceCategory,
            as: 'attendance_category',
            attributes: ['category_name']
          }
        ],
        order: [['attendance_date', 'ASC']]
      }),
      LocationEvent.findAll({
        where: {
          event_timestamp: {
            [Op.gte]: geofenceStartInclusive,
            [Op.lt]: geofenceEndExclusive
          }
        },
        attributes: ['user_id', 'event_type'],
        order: [['event_timestamp', 'ASC']]
      }),
      buildDisciplineAnalysis({
        startAt: effectiveWindow.startDate,
        endAt: effectiveWindow.endDate
      }),
      buildWfaAnalysis({
        startAt: effectiveWindow.startDate,
        endAt: effectiveWindow.endDate
      }),
      buildSmartAcAnalysis({
        startAt: effectiveWindow.startDate,
        endAt: effectiveWindow.endDate
      })
    ]);

  const historicalMap = historicalDates.reduce((acc, date) => {
    acc.set(date, {
      date,
      on_time: 0,
      late: 0,
      present: 0,
      alpha: 0,
      wfo: 0,
      wfh: 0,
      wfa: 0
    });
    return acc;
  }, new Map());

  const modeTotals = {
    wfo: 0,
    wfh: 0,
    wfa: 0
  };

  const attendanceTotals = {
    present: 0,
    alpha: 0,
    late: 0,
    on_time: 0
  };
  const analyzedUserIds = new Set();

  for (const attendance of attendanceRows) {
    const point = historicalMap.get(attendance.attendance_date);
    const statusFlags = getAttendanceStatusFlags(attendance.status?.attendance_status_name);
    const normalizedCategory = normalizeCategoryName(attendance.attendance_category?.category_name);

    if (point) {
      incrementAttendanceCounters(point, statusFlags);

      if (normalizedCategory) {
        point[normalizedCategory] += 1;
      }
    }

    incrementAttendanceCounters(attendanceTotals, statusFlags);

    if (normalizedCategory) {
      modeTotals[normalizedCategory] += 1;
    }

    if (attendance.user_id != null) {
      analyzedUserIds.add(String(attendance.user_id));
    }
  }

  const analyzedDisciplineRanking = (disciplineAnalysis?.ranking || []).filter((item) =>
    analyzedUserIds.has(String(item.id))
  );
  const disciplineAverage =
    analyzedDisciplineRanking.length > 0
      ? analyzedDisciplineRanking.reduce((sum, item) => sum + Number(item.score || 0), 0) /
        analyzedDisciplineRanking.length
      : null;

  const totalModeRecords = modeTotals.wfo + modeTotals.wfh + modeTotals.wfa;
  const percentages = {
    wfo: percentageOf(modeTotals.wfo, totalModeRecords),
    wfh: percentageOf(modeTotals.wfh, totalModeRecords),
    wfa: percentageOf(modeTotals.wfa, totalModeRecords)
  };

  const rawCounts = {
    total_attendance_records: attendanceRows.length,
    total_present: attendanceTotals.present,
    total_alpha: attendanceTotals.alpha,
    total_late: attendanceTotals.late,
    total_on_time: attendanceTotals.on_time,
    total_wfo: modeTotals.wfo,
    total_wfh: modeTotals.wfh,
    total_wfa: modeTotals.wfa,
    discipline_users_analyzed: analyzedDisciplineRanking.length
  };

  const executiveKpis = {
    attendance_rate: percentageOf(rawCounts.total_present, rawCounts.total_attendance_records),
    late_alpha_risk: percentageOf(rawCounts.total_late + rawCounts.total_alpha, rawCounts.total_attendance_records),
    avg_discipline: disciplineAverage == null ? null : roundToTwo(disciplineAverage),
    needs_attention:
      Number(rawCounts.total_late + rawCounts.total_alpha > 0) +
      Number(disciplineAverage != null && disciplineAverage < 60),
    raw_counts: rawCounts
  };

  const fuzzySnapshot = {
    discipline: buildSnapshotCard({
      analysis: disciplineAnalysis,
      effectiveWindow,
      generatedAt,
      allowedIds: analyzedUserIds
    }),
    wfa: buildSnapshotCard({
      analysis: wfaAnalysis,
      effectiveWindow,
      generatedAt
    }),
    smart_ac: buildSnapshotCard({
      analysis: smartAcAnalysis,
      effectiveWindow,
      generatedAt,
      allowedIds: analyzedUserIds
    })
  };
  const executedWindow = buildExecutedWindow(effectiveWindow);
  const geofenceEvidenceContext = buildGeofenceEvidenceContext({
    effectiveWindow,
    locationEvents
  });

  return {
    meta: {
      generated_at: generatedAt,
      timezone: 'Asia/Jakarta',
      requested_window: requestedWindow,
      executed_window: executedWindow,
      section_windows: buildSectionWindows(effectiveWindow),
      sources: ['Attendance', 'AttendanceCategory', 'AttendanceStatus', 'LocationEvent']
    },
    executive_kpis: executiveKpis,
    historical_trend: {
      points: Array.from(historicalMap.values())
    },
    mode_mix: {
      totals: modeTotals,
      percentages
    },
    geofence_evidence_context: geofenceEvidenceContext,
    fuzzy_ahp_snapshot: fuzzySnapshot,
    insights: buildInsights({
      executiveKpis,
      modeMix: {
        totals: modeTotals,
        percentages
      }
    })
  };
};

export default {
  buildDashboardAnalytics
};
