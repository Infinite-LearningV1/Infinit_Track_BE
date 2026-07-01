import { Op } from 'sequelize';

import sequelize from '../config/database.js';
import {
  Attendance,
  AttendanceCategory,
  AttendanceStatus,
  Location,
  Role,
  Settings,
  User
} from '../models/index.js';
import fuzzyAhpEngine from '../utils/fuzzyAhpEngine.js';
import {
  buildEffectiveWindow,
  validateHistoricalDateWindowQuery
} from '../utils/historicalDateWindow.js';
import logger from '../utils/logger.js';
import { applySearch } from '../utils/searchHelper.js';
import {
  resolveSummarySearchTerm,
  SUMMARY_REPORT_SEARCH_FIELDS
} from '../utils/summaryReportQuery.js';
import { buildUserAttendanceSummary } from '../utils/userAttendanceSummary.js';
import { calculateWorkHour, formatTimeOnly, formatWorkHour } from '../utils/workHourFormatter.js';

const ON_TIME_STATUS = new Set(['tepat waktu', 'ontime']);
const LATE_STATUS = new Set(['terlambat', 'late']);
const EARLY_STATUS = new Set(['early', 'lebih awal']);
const ALPHA_STATUS = new Set(['alpa', 'alpha']);

const WFO_CATEGORY = new Set(['wfo', 'work from office']);
const WFH_CATEGORY = new Set(['wfh', 'work from home']);
const WFA_CATEGORY = new Set(['wfa', 'work from anywhere']);

const DISCIPLINE_CRITERIA = ['Alpha Rate', 'Lateness Severity', 'Lateness Frequency', 'Work Focus'];
const DEFAULT_CHECKIN_START_TIME = '08:00:00';
const DEFAULT_GENERATED_BY = 'Infinite Track System';
const DEFAULT_TIMEZONE = 'Asia/Jakarta';
const DEFAULT_REPORT_TITLE = 'Attendance Summary Report';
const DEFAULT_DATA_SOURCE = 'Attendance Summary API';
const DEFAULT_CONFIDENTIALITY = 'Confidential internal report';

const roundToTwo = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const percentageOf = (count, total) => (total > 0 ? roundToTwo((count / total) * 100) : 0);
const normalize = (value) => String(value || '').trim().toLowerCase();

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const hasActivityInSummary = (summary) => {
  return Boolean(
    summary?.latest_attendance_date ||
      summary?.valid_attendance_days ||
      summary?.alpha_days ||
      summary?.early_days ||
      summary?.wfo_days ||
      summary?.wfh_days ||
      summary?.wfa_days
  );
};

const getCategoryLabel = (attendance) => {
  return (
    attendance?.location?.attendance_category?.category_name ||
    attendance?.attendance_category?.category_name ||
    'Unknown'
  );
};

const getLocationDescription = (attendance) => {
  return attendance?.location?.description || 'Location not specified';
};

const buildLocationDetails = (attendance) => {
  const location = attendance?.location;
  if (!location) {
    return {
      location_id: null,
      description: 'Location not specified',
      category: getCategoryLabel(attendance),
      coordinates: null
    };
  }

  return {
    location_id: location.location_id,
    description: location.description,
    category: getCategoryLabel(attendance),
    coordinates:
      location.latitude == null || location.longitude == null
        ? null
        : {
            latitude: parseFloat(location.latitude),
            longitude: parseFloat(location.longitude)
          }
  };
};

const groupAttendanceRowsByUser = (attendanceRows) => {
  return attendanceRows.reduce((grouped, attendance) => {
    const userId = attendance.user?.id_users || attendance.user_id;
    if (!userId) return grouped;
    if (!grouped[userId]) grouped[userId] = [];
    grouped[userId].push(attendance);
    return grouped;
  }, {});
};

const calculateUserMetricsFromRows = (attendanceRecords, settingsMap = {}) => {
  const checkinStartTime = settingsMap['checkin.start_time'] || DEFAULT_CHECKIN_START_TIME;
  const startParts = checkinStartTime.split(':').map((value) => parseInt(value, 10) || 0);
  const startMinutes = (startParts[0] || 0) * 60 + (startParts[1] || 0);

  if (attendanceRecords.length === 0) {
    return {
      alpha_rate: 0,
      avg_lateness_minutes: 0,
      lateness_frequency: 0,
      work_hour_consistency: 0,
      total_days: 0,
      alpha_days: 0,
      late_days: 0
    };
  }

  const totalDays = attendanceRecords.length;
  let alphaDays = 0;
  const presentRecords = [];

  for (const record of attendanceRecords) {
    const statusName = normalize(record.status?.attendance_status_name);
    if (ALPHA_STATUS.has(statusName)) {
      alphaDays += 1;
      continue;
    }

    presentRecords.push(record);
  }

  const presentDays = presentRecords.length;
  let lateDays = 0;
  let totalLatenessMinutes = 0;
  let consistencyDays = 0;

  for (const record of presentRecords) {
    const statusName = normalize(record.status?.attendance_status_name);
    if (LATE_STATUS.has(statusName)) {
      lateDays += 1;
    }

    if (record.time_in) {
      const hhmm = formatTimeOnly(record.time_in);
      const parts = hhmm.split(':').map((value) => parseInt(value, 10) || 0);
      const timeInMinutes = (parts[0] || 0) * 60 + (parts[1] || 0);
      totalLatenessMinutes += Math.max(0, timeInMinutes - startMinutes);
    }

    const workHour = parseFloat(record.work_hour);
    if (!Number.isNaN(workHour) && workHour >= 8.0) {
      consistencyDays += 1;
    }
  }

  const alphaRateRatio = totalDays > 0 ? alphaDays / totalDays : 0;
  const latenessFrequencyRatio = presentDays > 0 ? lateDays / presentDays : 0;
  const avgLatenessMinutes = presentDays > 0 ? totalLatenessMinutes / presentDays : 0;
  const workHourConsistencyRatio = presentDays > 0 ? consistencyDays / presentDays : 0;

  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const clampRange = (value, low, high) => Math.max(low, Math.min(high, value));

  return {
    alpha_rate: roundToTwo(clamp01(alphaRateRatio) * 100),
    avg_lateness_minutes: roundToTwo(clampRange(avgLatenessMinutes, 0, 60)),
    lateness_frequency: roundToTwo(clamp01(latenessFrequencyRatio) * 100),
    work_hour_consistency: roundToTwo(clamp01(workHourConsistencyRatio) * 100),
    total_days: totalDays,
    alpha_days: alphaDays,
    late_days: lateDays
  };
};

const buildLegacySummary = ({ statusCounts, categoryCounts }) => {
  const summary = {
    total_ontime: 0,
    total_late: 0,
    total_early: 0,
    total_alpha: 0,
    total_wfo: 0,
    total_wfh: 0,
    total_wfa: 0
  };

  for (const item of statusCounts) {
    const statusName = normalize(item.status?.attendance_status_name);
    const total = parseInt(item.dataValues.total, 10) || 0;

    if (ON_TIME_STATUS.has(statusName)) summary.total_ontime = total;
    if (LATE_STATUS.has(statusName)) summary.total_late = total;
    if (EARLY_STATUS.has(statusName)) summary.total_early = total;
    if (ALPHA_STATUS.has(statusName)) summary.total_alpha = total;
  }

  for (const item of categoryCounts) {
    const categoryName = normalize(item.attendance_category?.category_name);
    const total = parseInt(item.dataValues.total, 10) || 0;

    if (WFO_CATEGORY.has(categoryName)) summary.total_wfo = total;
    if (WFH_CATEGORY.has(categoryName)) summary.total_wfh = total;
    if (WFA_CATEGORY.has(categoryName)) summary.total_wfa = total;
  }

  return summary;
};

const buildStatusDistribution = (summary, totalRecords) => ({
  on_time: {
    count: summary.total_ontime,
    percentage: percentageOf(summary.total_ontime, totalRecords)
  },
  late: {
    count: summary.total_late,
    percentage: percentageOf(summary.total_late, totalRecords)
  },
  early: {
    count: summary.total_early,
    percentage: percentageOf(summary.total_early, totalRecords)
  },
  alpha: {
    count: summary.total_alpha,
    percentage: percentageOf(summary.total_alpha, totalRecords)
  }
});

const buildWorkModeDistribution = (summary, totalRecords) => ({
  wfo: {
    count: summary.total_wfo,
    percentage: percentageOf(summary.total_wfo, totalRecords)
  },
  wfh: {
    count: summary.total_wfh,
    percentage: percentageOf(summary.total_wfh, totalRecords)
  },
  wfa: {
    count: summary.total_wfa,
    percentage: percentageOf(summary.total_wfa, totalRecords)
  }
});

const getDisciplineRangeKey = (score) => {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'needs_review';
  return 'attention';
};

const buildEmptyDisciplineRange = () => ({
  excellent: { count: 0, percentage: 0, range: '85-100' },
  good: { count: 0, percentage: 0, range: '70-84.99' },
  needs_review: { count: 0, percentage: 0, range: '50-69.99' },
  attention: { count: 0, percentage: 0, range: '<50' }
});

const buildDisciplineScoreRange = (disciplineMap, allowedUserIds) => {
  const buckets = buildEmptyDisciplineRange();
  const userIds = [...allowedUserIds];

  for (const userId of userIds) {
    const disciplineData = disciplineMap[userId];
    if (!disciplineData) continue;

    const bucket = getDisciplineRangeKey(disciplineData.discipline_score || 0);
    buckets[bucket].count += 1;
  }

  const denominator = userIds.length;
  Object.keys(buckets).forEach((key) => {
    buckets[key].percentage = percentageOf(buckets[key].count, denominator);
  });

  return buckets;
};

const buildUserAttendanceRate = (summary) => {
  const expectedWorkingDays = Number(summary?.expected_working_days || 0);
  if (expectedWorkingDays <= 0) return 0;
  return roundToTwo((Number(summary?.valid_attendance_days || 0) / expectedWorkingDays) * 100);
};

const buildRecommendedActionCode = ({ alphaDays, lateDays, disciplineScore }) => {
  if (alphaDays > 0) return 'review';
  if (disciplineScore < 70) return 'remind';
  if (lateDays > 0) return 'monitor';
  return 'none';
};

const buildDisciplineInsightRows = ({ userSummaries, disciplineMap }) => {
  return [...userSummaries]
    .map((summary) => {
      const userId = String(summary.user_id);
      const disciplineData = disciplineMap[userId];
      const disciplineScore = roundToTwo(disciplineData?.discipline_score || 0);

      return {
        user_id: summary.user_id,
        employee_name: summary.full_name,
        division: summary.division || null,
        attendance_rate: buildUserAttendanceRate(summary),
        late_count: Number(summary.late_days || 0),
        alpha_count: Number(summary.alpha_days || 0),
        avg_discipline_score: disciplineScore,
        discipline_label: disciplineData?.discipline_label || null,
        recommended_action_code: buildRecommendedActionCode({
          alphaDays: Number(summary.alpha_days || 0),
          lateDays: Number(summary.late_days || 0),
          disciplineScore
        })
      };
    })
    .sort((left, right) => left.employee_name.localeCompare(right.employee_name));
};

const buildSummaryScopeLabel = (searchTerm) => {
  return searchTerm ? 'filtered_records_only' : 'current_period';
};

const buildAggregateAttendanceRate = (userSummaries) => {
  if (userSummaries.length === 0) return 0;

  const totalExpectedWorkingDays = userSummaries.reduce(
    (sum, summary) => sum + Number(summary.expected_working_days || 0),
    0
  );
  const totalValidAttendanceDays = userSummaries.reduce(
    (sum, summary) => sum + Number(summary.valid_attendance_days || 0),
    0
  );

  if (totalExpectedWorkingDays <= 0) return 0;
  return roundToTwo((totalValidAttendanceDays / totalExpectedWorkingDays) * 100);
};

const buildAverageDisciplineScore = (disciplineMap, allowedUserIds) => {
  const scores = [...allowedUserIds]
    .map((userId) => disciplineMap[userId]?.discipline_score)
    .filter((score) => Number.isFinite(score));

  if (scores.length === 0) return 0;
  return roundToTwo(scores.reduce((sum, score) => sum + score, 0) / scores.length);
};

const buildPeriodSummary = ({ summary, activeUserSummaries, disciplineMap }) => {
  const activeUserIds = new Set(activeUserSummaries.map((item) => String(item.user_id)));
  const totalRecords =
    summary.total_ontime +
    summary.total_late +
    summary.total_early +
    summary.total_alpha +
    Math.max(0, summary.total_wfo + summary.total_wfh + summary.total_wfa - (summary.total_ontime + summary.total_late + summary.total_early + summary.total_alpha));

  const lateAlphaRiskUsers = activeUserSummaries.filter(
    (item) => Number(item.late_days || 0) > 0 || Number(item.alpha_days || 0) > 0
  ).length;

  const needsAttentionUsers = activeUserSummaries.filter((item) => {
    const disciplineScore = disciplineMap[String(item.user_id)]?.discipline_score || 0;
    return Number(item.alpha_days || 0) > 0 || disciplineScore < 70;
  }).length;

  return {
    total_records: totalRecords,
    attendance_rate: buildAggregateAttendanceRate(activeUserSummaries),
    average_discipline_score: buildAverageDisciplineScore(disciplineMap, activeUserIds),
    late_alpha_risk_users: lateAlphaRiskUsers,
    needs_attention_users: needsAttentionUsers,
    status_distribution: buildStatusDistribution(summary, totalRecords),
    work_mode_distribution: buildWorkModeDistribution(summary, totalRecords),
    discipline_score_range: buildDisciplineScoreRange(disciplineMap, activeUserIds)
  };
};

const buildExportScopeSummary = ({ scopeRows, scopeUserSummaries, disciplineMap, searchTerm }) => {
  const scopeUserIds = new Set(scopeUserSummaries.map((item) => String(item.user_id)));

  return {
    scope: buildSummaryScopeLabel(searchTerm),
    total_records: scopeRows.length,
    attendance_rate: buildAggregateAttendanceRate(scopeUserSummaries),
    average_discipline_score: buildAverageDisciplineScore(disciplineMap, scopeUserIds)
  };
};

const buildAnalyticsDisciplineAnalysis = ({ disciplineMap, visibleUserIds }) => {
  return {
    users_analyzed: visibleUserIds.size,
    average_discipline_score: buildAverageDisciplineScore(disciplineMap, visibleUserIds),
    methodology: 'Fuzzy AHP Engine',
    criteria: DISCIPLINE_CRITERIA
  };
};

const buildPagination = ({ count, page, limit }) => ({
  current_page: page,
  total_pages: Math.ceil(count / limit),
  total_items: count,
  items_per_page: limit,
  has_next_page: page < Math.ceil(count / limit),
  has_prev_page: page > 1
});

const getVisibleUserIds = (attendanceRows) => {
  return new Set(
    attendanceRows
      .map((attendance) => attendance.user?.id_users)
      .filter(Boolean)
      .map((userId) => String(userId))
  );
};

const buildReportDetailQueryOptions = ({ whereClause, searchTerm, limit, offset }) => {
  const queryOptions = {
    where: { ...whereClause },
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id_users', 'full_name', 'email', 'nip_nim'],
        include: [
          {
            model: Role,
            as: 'role',
            attributes: ['role_name']
          }
        ]
      },
      {
        model: Location,
        as: 'location',
        attributes: ['location_id', 'description', 'latitude', 'longitude'],
        required: false,
        include: [
          {
            model: AttendanceCategory,
            as: 'attendance_category',
            attributes: ['category_name']
          }
        ]
      },
      {
        model: AttendanceCategory,
        as: 'attendance_category',
        attributes: ['category_name']
      },
      {
        model: AttendanceStatus,
        as: 'status',
        attributes: ['attendance_status_name']
      }
    ],
    order: [
      ['attendance_date', 'DESC'],
      ['time_in', 'DESC']
    ],
    distinct: true
  };

  if (limit != null) queryOptions.limit = limit;
  if (offset != null) queryOptions.offset = offset;
  if (searchTerm) {
    applySearch(queryOptions, searchTerm, SUMMARY_REPORT_SEARCH_FIELDS);
  }

  return queryOptions;
};

const buildPeriodAttendanceQueryOptions = ({ startDateStr, endDateStr }) => ({
  where: {
    attendance_date: {
      [Op.between]: [startDateStr, endDateStr]
    }
  },
  attributes: ['id_attendance', 'attendance_date', 'time_in', 'time_out', 'work_hour', 'user_id'],
  include: [
    {
      model: AttendanceStatus,
      as: 'status',
      attributes: ['attendance_status_name']
    }
  ]
});

const loadSummaryCounts = async (whereClause) => {
  const [statusCounts, categoryCounts] = await Promise.all([
    Attendance.findAll({
      where: whereClause,
      group: ['status_id'],
      attributes: ['status_id', [sequelize.fn('COUNT', sequelize.col('status_id')), 'total']],
      include: [
        {
          model: AttendanceStatus,
          as: 'status',
          attributes: ['attendance_status_name']
        }
      ],
      raw: false
    }),
    Attendance.findAll({
      where: whereClause,
      group: ['category_id'],
      attributes: ['category_id', [sequelize.fn('COUNT', sequelize.col('category_id')), 'total']],
      include: [
        {
          model: AttendanceCategory,
          as: 'attendance_category',
          attributes: ['category_name']
        }
      ],
      raw: false
    })
  ]);

  return { statusCounts, categoryCounts };
};

const loadSettingsMap = async () => {
  const settingsMap = {};

  try {
    const settings = await Settings.findAll({
      where: {
        setting_key: {
          [Op.in]: ['checkin.start_time']
        }
      }
    });

    settings.forEach((setting) => {
      settingsMap[setting.setting_key] = setting.setting_value;
    });
  } catch (error) {
    logger.error('Error preloading summary settings:', error);
  }

  return settingsMap;
};

const buildInformationText = (attendance, renderedWorkHour) => {
  const hasTimeOut = attendance.time_out && attendance.time_out !== '00:00:00';
  let information = hasTimeOut ? `Work Duration: ${formatWorkHour(renderedWorkHour)}` : 'Currently checked in';

  const notes = attendance.notes || '';
  const smartMatch = notes.match(/\[Smart AC\]\s*pred=([^,]+),\s*used=([^,]+),/);
  const fallbackMatch = notes.match(/\[Fallback AC\]\s*used=([^,]+),/);

  let predictedOut = null;
  let modeLabel = null;

  if (smartMatch) {
    predictedOut = smartMatch[1];
    modeLabel = 'smart';
  } else if (fallbackMatch) {
    predictedOut = fallbackMatch[1];
    modeLabel = 'fallback';
  }

  if (!predictedOut) {
    return information;
  }

  information = `${information} | PredOut: ${predictedOut} (${modeLabel})`;

  try {
    const predictedDate = new Date(`${attendance.attendance_date}T${predictedOut}:00+07:00`);
    const timeInDate = new Date(attendance.time_in);
    const diffMs = Math.max(0, predictedDate.getTime() - timeInDate.getTime());
    const diffHours = diffMs / (1000 * 60 * 60);
    information = `${information} | PredDur: ${formatWorkHour(diffHours)}`;
  } catch (_error) {
    logger.debug('Failed to append predicted duration to summary report information text');
  }

  return information;
};

const buildRenderedWorkHour = (attendance) => {
  let renderedWorkHour = attendance.work_hour;

  try {
    const rawIn = attendance.time_in ? new Date(attendance.time_in) : null;
    const rawOut = attendance.time_out ? new Date(attendance.time_out) : null;
    const outBeforeIn = rawIn && rawOut ? rawOut.getTime() < rawIn.getTime() : false;
    const notes = attendance.notes || '';
    const smartMatch = notes.match(/\[Smart AC\]\s*pred=([^,]+),\s*used=([^,]+),/);
    const fallbackMatch = notes.match(/\[Fallback AC\]\s*used=([^,]+),/);
    const predictedOut = smartMatch?.[1] || fallbackMatch?.[1] || null;

    if (renderedWorkHour == null || renderedWorkHour <= 0 || outBeforeIn) {
      if (predictedOut && rawIn) {
        const predictedDate = new Date(`${attendance.attendance_date}T${predictedOut}:00+07:00`);
        renderedWorkHour = calculateWorkHour(rawIn, predictedDate);
      } else if (rawIn && rawOut) {
        renderedWorkHour = calculateWorkHour(rawIn, rawOut);
      }
    }
  } catch (_error) {
    logger.debug('Failed to derive rendered work hour for summary report row');
  }

  return renderedWorkHour;
};

const transformAttendanceRow = (attendance, disciplineMap) => {
  const userId = attendance.user?.id_users || attendance.user_id || null;
  const disciplineData = userId ? disciplineMap[String(userId)] : null;
  const categoryLabel = getCategoryLabel(attendance);
  const locationDescription = getLocationDescription(attendance);
  const statusLabel = attendance.status?.attendance_status_name || 'unknown';
  const renderedWorkHour = buildRenderedWorkHour(attendance);

  if (normalize(statusLabel) === 'alpa' || normalize(statusLabel) === 'alpha') {
    return {
      attendance_id: attendance.id_attendance,
      user_id: userId,
      full_name: attendance.user?.full_name || 'Unknown User',
      role: attendance.user?.role?.role_name || null,
      nip_nim: attendance.user?.nip_nim || null,
      email: attendance.user?.email || null,
      time_in: '00:00',
      time_out: '00:00',
      work_hour: formatWorkHour(0),
      attendance_date: attendance.attendance_date,
      location_details: null,
      location_description: null,
      work_category: categoryLabel,
      status: statusLabel,
      information: 'Alpha attendance record',
      notes: attendance.notes || '',
      discipline_score: disciplineData?.discipline_score || null,
      discipline_label: disciplineData?.discipline_label || null,
      discipline_breakdown: disciplineData?.discipline_breakdown || null
    };
  }

  return {
    attendance_id: attendance.id_attendance,
    user_id: userId,
    full_name: attendance.user?.full_name || 'Unknown User',
    role: attendance.user?.role?.role_name || null,
    nip_nim: attendance.user?.nip_nim || null,
    email: attendance.user?.email || null,
    time_in: attendance.time_in ? formatTimeOnly(attendance.time_in) : null,
    time_out: attendance.time_out ? formatTimeOnly(attendance.time_out) : null,
    work_hour: formatWorkHour(renderedWorkHour),
    attendance_date: attendance.attendance_date,
    location_details: buildLocationDetails(attendance),
    location_description: locationDescription,
    work_category: categoryLabel,
    status: statusLabel,
    information: buildInformationText(attendance, renderedWorkHour),
    notes: attendance.notes || '',
    discipline_score: disciplineData?.discipline_score || null,
    discipline_label: disciplineData?.discipline_label || null,
    discipline_breakdown: disciplineData?.discipline_breakdown || null
  };
};

const buildDisciplineMap = async ({ attendanceRowsByUser, settingsMap }) => {
  const disciplineEntries = await Promise.all(
    Object.entries(attendanceRowsByUser).map(async ([userId, attendanceRows]) => {
      try {
        const userMetrics = calculateUserMetricsFromRows(attendanceRows, settingsMap);
        const disciplineResult = await fuzzyAhpEngine.calculateDisciplineIndex(userMetrics);

        return [
          String(userId),
          {
            discipline_score: disciplineResult.score,
            discipline_label: disciplineResult.label,
            discipline_breakdown: disciplineResult.breakdown
          }
        ];
      } catch (error) {
        logger.error(`Error calculating discipline for user ${userId}:`, error);
        return [
          String(userId),
          {
            discipline_score: 50,
            discipline_label: fuzzyAhpEngine.getDisciplineLabel(50),
            discipline_breakdown: { error: 'Calculation failed' }
          }
        ];
      }
    })
  );

  return Object.fromEntries(disciplineEntries);
};

export const buildSummaryReportSource = async (query = {}, options = {}) => {
  const {
    includePaginatedReport = true,
    page: rawPage = query.page,
    limit: rawLimit = query.limit
  } = options;
  const { period = 'monthly', from = null, to = null } = query;
  const page = parsePositiveInteger(rawPage, 1);
  const limit = parsePositiveInteger(rawLimit, 10);
  const { term: summarySearchTerm } = resolveSummarySearchTerm(query);

  const validationMessage = validateHistoricalDateWindowQuery({ period, from, to });
  if (validationMessage) {
    const error = new Error(validationMessage);
    error.statusCode = 400;
    error.code = 'E_VALIDATION';
    throw error;
  }

  const effectiveWindow = buildEffectiveWindow({ period, from, to });
  const { startDateStr, endDateStr } = effectiveWindow;
  const generatedAt = new Date().toISOString();
  const whereClause = {
    attendance_date: {
      [Op.between]: [startDateStr, endDateStr]
    }
  };

  const paginatedQueryOptions = buildReportDetailQueryOptions({
    whereClause,
    searchTerm: summarySearchTerm,
    limit,
    offset: (page - 1) * limit
  });
  const scopedRowsQueryOptions = buildReportDetailQueryOptions({
    whereClause,
    searchTerm: summarySearchTerm
  });

  const [
    { statusCounts, categoryCounts },
    scopedRows,
    paginatedResult,
    fullPeriodAttendanceRows,
    settingsMap,
    userAttendanceSummary
  ] = await Promise.all([
    loadSummaryCounts(whereClause),
    Attendance.findAll(scopedRowsQueryOptions),
    includePaginatedReport
      ? Attendance.findAndCountAll(paginatedQueryOptions)
      : Promise.resolve({ count: 0, rows: [] }),
    Attendance.findAll(buildPeriodAttendanceQueryOptions({ startDateStr, endDateStr })),
    loadSettingsMap(),
    buildUserAttendanceSummary({
      startDate: startDateStr,
      endDate: endDateStr
    }).catch((error) => {
      logger.warn('Failed to build user attendance summary; continuing with raw report data only', {
        error: error.message,
        period,
        startDate: startDateStr,
        endDate: endDateStr
      });
      return [];
    })
  ]);

  const legacySummary = buildLegacySummary({ statusCounts, categoryCounts });
  const attendanceRowsByUser = groupAttendanceRowsByUser(fullPeriodAttendanceRows);
  const disciplineMap = await buildDisciplineMap({ attendanceRowsByUser, settingsMap });

  const activeUserSummaries = userAttendanceSummary.filter(hasActivityInSummary);
  const scopedUserIds = getVisibleUserIds(scopedRows);
  const visiblePaginatedUserIds = getVisibleUserIds(paginatedResult.rows);
  const scopedUserSummaries = activeUserSummaries.filter((summary) =>
    scopedUserIds.has(String(summary.user_id))
  );

  const transformedScopedRows = scopedRows.map((attendance) => transformAttendanceRow(attendance, disciplineMap));
  const transformedPaginatedRows = paginatedResult.rows.map((attendance) =>
    transformAttendanceRow(attendance, disciplineMap)
  );

  return {
    generated_at: generatedAt,
    period,
    window: {
      period,
      timezone: DEFAULT_TIMEZONE,
      start_date: startDateStr,
      end_date: endDateStr
    },
    date_range: {
      start_date: startDateStr,
      end_date: endDateStr
    },
    summary: legacySummary,
    period_summary: buildPeriodSummary({
      summary: legacySummary,
      activeUserSummaries,
      disciplineMap
    }),
    export_scope_summary: buildExportScopeSummary({
      scopeRows: transformedScopedRows,
      scopeUserSummaries: scopedUserSummaries,
      disciplineMap,
      searchTerm: summarySearchTerm
    }),
    report: {
      data: transformedPaginatedRows,
      pagination: includePaginatedReport ? buildPagination({ count: paginatedResult.count, page, limit }) : null,
      user_attendance_summary: scopedUserSummaries
    },
    analytics: {
      discipline_analysis: buildAnalyticsDisciplineAnalysis({
        disciplineMap,
        visibleUserIds: visiblePaginatedUserIds
      })
    },
    detailed_attendance_rows: transformedScopedRows,
    discipline_insight_rows: buildDisciplineInsightRows({
      userSummaries: scopedUserSummaries,
      disciplineMap
    }),
    metadata: {
      generated_by: DEFAULT_GENERATED_BY,
      timezone: DEFAULT_TIMEZONE,
      title: DEFAULT_REPORT_TITLE,
      data_source: DEFAULT_DATA_SOURCE,
      confidentiality: DEFAULT_CONFIDENTIALITY
    },
    message: 'Summary report with discipline analysis generated successfully'
  };
};

export default {
  buildSummaryReportSource
};
