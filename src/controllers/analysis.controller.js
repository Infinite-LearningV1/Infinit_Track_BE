import {
  buildDisciplineAnalysis,
  buildDisciplineFahpPayload,
  buildSmartAcAnalysis,
  buildSmartAcFahpPayload,
  buildWfaAnalysis,
  buildWfaFahpPayload,
  getAnalysisWindow
} from '../services/fuzzyAhpAnalysis.service.js';

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
    const { lat, lon, radius_meters: radiusMeters = 5000 } = req.query;
    const data = await buildWfaFahpPayload({ lat, lon, radiusMeters });

    return res.status(200).json({
      success: true,
      data,
      message: 'WFA Fuzzy AHP analysis retrieved successfully'
    });
  } catch (error) {
    if (error.code === 'AUTH_OR_PROVIDER_UNAVAILABLE' && error.provider === 'geoapify') {
      return res.status(503).json({
        success: false,
        code: 'AUTH_OR_PROVIDER_UNAVAILABLE',
        provider: 'geoapify',
        reason: error.reason || 'unavailable'
      });
    }

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

    if (type === 'discipline') {
      result = await buildDisciplineAnalysis({ startAt, endAt });
    } else if (type === 'wfa') {
      result = await buildWfaAnalysis({ startAt, endAt });
    } else {
      result = await buildSmartAcAnalysis({ startAt, endAt });
    }

    return res.status(200).json({
      success: true,
      data: {
        type,
        period,
        generated_at: endAt.toISOString(),
        timezone: 'Asia/Jakarta',
        window: {
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString()
        },
        ...result
      },
      message: 'Fuzzy AHP analysis retrieved successfully'
    });
  } catch (error) {
    next(error);
  }
};
