import {
  buildDisciplineAnalysis,
  buildSmartAcAnalysis,
  buildWfaAnalysis
} from '../services/fuzzyAhpAnalysis.service.js';

export function getAnalysisWindow(period) {
  const now = new Date();
  const wibNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));

  if (period === 'weekly') {
    const day = wibNow.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const start = new Date(wibNow);
    start.setDate(wibNow.getDate() + mondayOffset);
    start.setHours(0, 0, 0, 0);
    return { startAt: start, endAt: wibNow };
  }

  const start = new Date(wibNow.getFullYear(), wibNow.getMonth(), 1, 0, 0, 0, 0);
  return { startAt: start, endAt: wibNow };
}

export async function getFuzzyAhpAnalysis(req, res, next) {
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
        result = await buildWfaAnalysis({ startAt, endAt });
        break;
      default:
        result = await buildSmartAcAnalysis({ startAt, endAt });
        break;
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
}
