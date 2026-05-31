import {
  buildDisciplineAnalysis,
  buildSmartAcAnalysis,
  buildWfaAnalysis
} from '../services/fuzzyAhpAnalysis.service.js';

function getWibParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function wibWallTimeToDate({ year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0 }) {
  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute, second, millisecond));
}

function toWibIsoString(date) {
  const parts = getWibParts(date);
  const millisecond = String(date.getUTCMilliseconds()).padStart(3, '0');

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${millisecond}+07:00`;
}

export function getAnalysisWindow(period) {
  const now = new Date();
  const wibNow = getWibParts(now);
  const year = Number(wibNow.year);
  const month = Number(wibNow.month);
  const day = Number(wibNow.day);

  if (period === 'weekly') {
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(Date.UTC(year, month - 1, day + mondayOffset));
    const startAt = wibWallTimeToDate({
      year: monday.getUTCFullYear(),
      month: monday.getUTCMonth() + 1,
      day: monday.getUTCDate()
    });

    return { startAt, endAt: now };
  }

  return {
    startAt: wibWallTimeToDate({ year, month, day: 1 }),
    endAt: now
  };
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
        generated_at: toWibIsoString(endAt),
        timezone: 'Asia/Jakarta',
        window: {
          start_at: toWibIsoString(startAt),
          end_at: toWibIsoString(endAt)
        },
        ...result
      },
      message: 'Fuzzy AHP analysis retrieved successfully'
    });
  } catch (error) {
    next(error);
  }
}
