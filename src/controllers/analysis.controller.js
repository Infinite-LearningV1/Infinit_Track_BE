import {
  buildDisciplineAnalysis,
  buildDisciplineFahpPayload,
  buildFuzzyAhpDashboardRecapPayload,
  buildSmartAcAnalysis,
  buildSmartAcFahpPayload,
  formatWibDateTime,
  getAnalysisWindow
} from '../services/fuzzyAhpAnalysis.service.js';
import { analyze } from '../services/wfaRecommendation.service.js';
import logger from '../utils/logger.js';

const sendWfaAnalysisMoved = (res) =>
  res.status(410).json({
    success: false,
    code: 'WFA_ANALYSIS_MOVED',
    message: 'Use /api/analysis/fuzzy-ahp/wfa with lat, lon, and schedule_date.'
  });

export const getDisciplineFahp = async (req, res, next) => {
  try {
    const { period = 'monthly', from, to } = req.query;
    const data = await buildDisciplineFahpPayload({ period, from, to });

    return res.status(200).json({
      success: true,
      data,
      message: 'Discipline Fuzzy AHP analysis retrieved successfully'
    });
  } catch (error) {
    next(error);
  }
};

export const getWfaFahp = async (req, res, next) => {
  try {
    const { lat, lon, schedule_date: scheduleDate, radius_meters: radiusMeters = 5000 } = req.query;
    const data = await analyze({
      latitude: Number(lat),
      longitude: Number(lon),
      scheduleDate,
      radiusMeters: Number(radiusMeters)
    });

    return res.status(200).json({
      success: true,
      data,
      message: 'WFA Fuzzy AHP analysis retrieved successfully'
    });
  } catch (error) {
    next(error);
  }
};

export const getSmartAcFahp = async (_req, res, next) => {
  try {
    const data = await buildSmartAcFahpPayload();

    return res.status(200).json({
      success: true,
      data,
      message: 'Smart AC Fuzzy AHP analysis retrieved successfully'
    });
  } catch (error) {
    next(error);
  }
};

export const getFuzzyAhpDashboardRecap = async (req, res, next) => {
  try {
    const { type } = req.query;
    if (type === 'wfa') return sendWfaAnalysisMoved(res);

    const data = await buildFuzzyAhpDashboardRecapPayload({ type });

    return res.status(200).json({
      success: true,
      data,
      message: 'Fuzzy AHP dashboard recap retrieved successfully'
    });
  } catch (error) {
    logger.error('Failed to build FAHP dashboard recap', {
      error: error.message,
      query: req.query
    });
    next(error);
  }
};

export const getFuzzyAhpAnalysis = async (req, res, next) => {
  try {
    const { type, period = 'monthly' } = req.query;

    const allowedTypes = ['wfa', 'discipline', 'smart_ac'];
    const allowedPeriods = ['weekly', 'monthly'];

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'type must be one of: wfa, discipline, smart_ac'
      });
    }

    if (!allowedPeriods.includes(period)) {
      return res.status(400).json({
        success: false,
        message: 'period must be one of: weekly, monthly'
      });
    }

    const { startAt, endAt } = getAnalysisWindow(period);
    let result;

    switch (type) {
      case 'discipline':
        result = await buildDisciplineAnalysis({ startAt, endAt });
        break;
      case 'wfa':
        return sendWfaAnalysisMoved(res);
      default:
        result = await buildSmartAcAnalysis({ startAt, endAt });
        break;
    }

    return res.status(200).json({
      success: true,
      data: {
        type,
        period,
        generated_at: formatWibDateTime(endAt),
        timezone: 'Asia/Jakarta',
        window: {
          start_at: formatWibDateTime(startAt),
          end_at: formatWibDateTime(endAt)
        },
        ...result
      },
      message: 'Fuzzy AHP analysis retrieved successfully'
    });
  } catch (error) {
    next(error);
  }
};
