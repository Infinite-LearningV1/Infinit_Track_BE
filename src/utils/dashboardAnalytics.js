import { Op } from 'sequelize';

import { Attendance, AttendanceCategory, AttendanceStatus } from '../models/index.js';
import {
  buildDisciplineAnalysis,
  buildSmartAcAnalysis,
  buildWfaAnalysis
} from '../controllers/analysis.controller.js';
import { getJakartaDateString } from './geofence.js';
import { parseIsoDateUtcStrict } from './isoDate.js';
import { buildTodayLocationsSnapshot } from './todayLocationsSnapshot.js';

const STATUS_ALPHA = new Set(['alpa', 'alpha']);
const CATEGORY_MAP = {
  wfo: 'wfo',
  'work from office': 'wfo',
  wfh: 'wfh',
  'work from home': 'wfh',
  wfa: 'wfa',
  'work from anywhere': 'wfa'
};

const buildRequestedWindow = ({ period, from, to }) => ({
  period,
  from,
  to
});

const buildExecutedWindow = (effectiveWindow) => ({
  from: effectiveWindow.startDateStr,
  to: effectiveWindow.endDateStr
});

const buildSectionWindows = (effectiveWindow) => ({
  executive_kpis: buildExecutedWindow(effectiveWindow),
  historical_trend: buildExecutedWindow(effectiveWindow),
  mode_mix: buildExecutedWindow(effectiveWindow),
  fuzzy_ahp_snapshot: buildExecutedWindow(effectiveWindow),
  today_locations: {
    mode: 'jakarta_today'
  }
});

const buildEmptySnapshotCard = (effectiveWindow) => ({
  generated_at: null,
  window: buildExecutedWindow(effectiveWindow),
  weights: {},
  consistency: null,
  top_rank: null,
  distribution: {}
});

const formatDateOnly = (date) => date.toISOString().split('T')[0];

const parseDateOnlyUtc = (value) => {
  const date = parseIsoDateUtcStrict(value);

  if (!date) {
    throw new Error(`Invalid ISO date: ${value}`);
  }

  return date;
};

const addUtcDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const normalizeCategoryName = (categoryName) => {
  if (!categoryName) return null;
  return CATEGORY_MAP[String(categoryName).trim().toLowerCase()] ?? null;
};

const isAlphaStatusName = (statusName) => STATUS_ALPHA.has(String(statusName || '').trim().toLowerCase());

const buildEffectiveWindow = ({ period, from, to }) => {
  const todayDate = getJakartaDateString();
  const todayUtc = parseDateOnlyUtc(todayDate);

  if (period === 'custom' && from && to) {
    const startDate = parseDateOnlyUtc(from);
    const endDate = parseDateOnlyUtc(to);

    return {
      startDate,
      endDate,
      startDateStr: from,
      endDateStr: to
    };
  }

  if (period === 'current_month') {
    const startDate = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), 1));
    return {
      startDate,
      endDate: todayUtc,
      startDateStr: formatDateOnly(startDate),
      endDateStr: todayDate
    };
  }

  const startDate = addUtcDays(todayUtc, -29);
  return {
    startDate,
    endDate: todayUtc,
    startDateStr: formatDateOnly(startDate),
    endDateStr: todayDate
  };
};

const enumerateDateRange = (startDate, endDate) => {
  const points = [];
  for (let cursor = new Date(startDate); cursor.getTime() <= endDate.getTime(); cursor = addUtcDays(cursor, 1)) {
    points.push(formatDateOnly(cursor));
  }
  return points;
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

const buildSnapshotCard = ({ analysis, effectiveWindow, allowedIds = null }) => {
  const ranking = Array.isArray(analysis?.ranking) ? analysis.ranking : [];
  const filteredRanking =
    allowedIds == null ? ranking : ranking.filter((item) => allowedIds.has(String(item.id)));

  if (filteredRanking.length === 0) {
    return buildEmptySnapshotCard(effectiveWindow);
  }

  const topRank = filteredRanking[0];

  return {
    generated_at: null,
    window: buildExecutedWindow(effectiveWindow),
    weights: buildWeightsObject(analysis?.weights),
    consistency: analysis?.consistency || null,
    top_rank: {
      id: topRank.id,
      name: topRank.name,
      score: topRank.score,
      label: topRank.label
    },
    distribution: buildDistributionFromRanking(filteredRanking)
  };
};

const buildInsights = ({ executiveKpis, modeMix, todayLocations }) => {
  const items = [];

  if (executiveKpis.total_attendance_records > 0) {
    const alphaRate = (executiveKpis.total_alpha / executiveKpis.total_attendance_records) * 100;
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

  if (executiveKpis.discipline_average != null && executiveKpis.discipline_average < 60) {
    items.push({
      type: 'discipline_drop',
      title: 'Discipline average needs attention',
      message: `Average discipline score is ${executiveKpis.discipline_average.toFixed(2)} for the selected window.`,
      severity: 'medium'
    });
  }

  if (todayLocations.total_users === 0) {
    return { items };
  }

  const wfhOrWfaUsers = todayLocations.locations.filter((item) => item.status === 'WFH' || item.status === 'WFA').length;
  if (todayLocations.total_users > 0 && wfhOrWfaUsers === todayLocations.total_users) {
    items.push({
      type: 'location_coverage_low',
      title: 'No office-based check-ins today',
      message: 'Today location snapshot only shows WFH or WFA check-ins.',
      severity: 'low'
    });
  }

  return { items };
};

export const buildDashboardAnalytics = async ({ period = '30d', from = null, to = null } = {}) => {
  const requestedWindow = buildRequestedWindow({ period, from, to });
  const effectiveWindow = buildEffectiveWindow({ period, from, to });
  const historicalDates = enumerateDateRange(effectiveWindow.startDate, effectiveWindow.endDate);

  const [attendanceRows, disciplineAnalysis, wfaAnalysis, smartAcAnalysis, todayLocations] =
    await Promise.all([
      Attendance.findAll({
        where: {
          attendance_date: {
            [Op.between]: [effectiveWindow.startDateStr, effectiveWindow.endDateStr]
          }
        },
        attributes: ['attendance_date', 'user_id', 'status_id', 'category_id'],
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
        order: [
          ['attendance_date', 'ASC'],
          ['id_attendance', 'ASC']
        ]
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
      }),
      buildTodayLocationsSnapshot()
    ]);

  const historicalMap = historicalDates.reduce((acc, date) => {
    acc.set(date, {
      date,
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

  let totalPresent = 0;
  let totalAlpha = 0;
  const analyzedUserIds = new Set();

  for (const attendance of attendanceRows) {
    const point = historicalMap.get(attendance.attendance_date);
    const statusName = attendance.status?.attendance_status_name;
    const normalizedCategory = normalizeCategoryName(attendance.attendance_category?.category_name);
    const isAlpha = isAlphaStatusName(statusName);

    if (point) {
      if (isAlpha) {
        point.alpha += 1;
      } else {
        point.present += 1;
      }

      if (normalizedCategory) {
        point[normalizedCategory] += 1;
      }
    }

    if (isAlpha) {
      totalAlpha += 1;
    } else {
      totalPresent += 1;
    }

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
    wfo: totalModeRecords > 0 ? (modeTotals.wfo / totalModeRecords) * 100 : 0,
    wfh: totalModeRecords > 0 ? (modeTotals.wfh / totalModeRecords) * 100 : 0,
    wfa: totalModeRecords > 0 ? (modeTotals.wfa / totalModeRecords) * 100 : 0
  };

  const executiveKpis = {
    total_attendance_records: attendanceRows.length,
    total_present: totalPresent,
    total_alpha: totalAlpha,
    total_wfo: modeTotals.wfo,
    total_wfh: modeTotals.wfh,
    total_wfa: modeTotals.wfa,
    discipline_average:
      disciplineAverage == null ? null : Math.round((disciplineAverage + Number.EPSILON) * 100) / 100,
    discipline_users_analyzed: analyzedDisciplineRanking.length
  };

  const fuzzySnapshot = {
    discipline: buildSnapshotCard({
      analysis: disciplineAnalysis,
      effectiveWindow,
      allowedIds: analyzedUserIds
    }),
    wfa: buildSnapshotCard({
      analysis: wfaAnalysis,
      effectiveWindow
    }),
    smart_ac: buildSnapshotCard({
      analysis: smartAcAnalysis,
      effectiveWindow,
      allowedIds: analyzedUserIds
    })
  };

  return {
    meta: {
      generated_at: null,
      timezone: 'Asia/Jakarta',
      requested_window: requestedWindow,
      section_windows: buildSectionWindows(effectiveWindow),
      sources: ['Attendance', 'AttendanceCategory', 'AttendanceStatus', 'Location', 'User']
    },
    executive_kpis: executiveKpis,
    historical_trend: {
      points: Array.from(historicalMap.values())
    },
    mode_mix: {
      totals: modeTotals,
      percentages
    },
    today_locations: todayLocations,
    fuzzy_ahp_snapshot: fuzzySnapshot,
    insights: buildInsights({
      executiveKpis,
      modeMix: {
        totals: modeTotals,
        percentages
      },
      todayLocations
    })
  };
};

export default {
  buildDashboardAnalytics
};
